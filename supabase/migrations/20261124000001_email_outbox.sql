-- =============================================================
-- Phase 1 — portal automation: email outbox, app settings, job log
-- (2026-11-24, replaces n8n email sending)
--
--   app_settings  key/value config: recipient addresses, timings,
--                 and the per-job automation switch (off|dry_run|live)
--   email_outbox  every email the portal sends goes through here
--                 (retries, dedupe, audit). Sent by the `send-emails`
--                 edge function over SMTP.
--   job_runs      one row per scheduler / mailbox-poll run
--
-- Safe to re-run (idempotent). Apply to DEV first; to PROD at go-live.
-- =============================================================

-- ── app_settings ─────────────────────────────────────────────
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb       not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings: admin all" on public.app_settings;
create policy "app_settings: admin all" on public.app_settings
  using (public.current_user_role() = 'admin'::public.user_role)
  with check (public.current_user_role() = 'admin'::public.user_role);

insert into public.app_settings (key, value, description) values
  ('rzr_email',         '"hugo@rzrinc.net"',                 'RZR (customer) — receives payment-request and "paid" emails; only sender whose replies can approve an advance'),
  ('rzr_reply_senders', '["hugo@rzrinc.net"]',               'Addresses whose "Accepted"/"Approved" replies count as RZR agreeing to the 97% advance'),
  ('admin_alert_email', '"brianbarroso.stap@gmail.com"',     'Brian — receives "not approved" and failure alerts'),
  ('ryder_ap_email',    '"ryderap.invoices@godocufree.com"', 'Ryder AP (Docufree) inbox — invoices are submitted here'),
  ('inbound_mailbox',   '"brianbarroso.stap@gmail.com"',     'Mailbox the portal sends from and reads (via Composio) for RZR replies + Ryder/Docufree confirmations'),
  ('payment_request_subject', '"Payment Request for"',       'Subject phrase of the RZR approval email; replies are matched on it. DEV must use a different phrase so live n8n ignores dev emails'),
  ('auto_paid_hours',   '12',                                'Hours after Advance Agreed before the invoice is auto-marked Advance Paid'),
  ('ryder_wait_days',   '7',                                 'Days after Advance Paid before the invoice is emailed to Ryder'),
  ('resubmit_hours',    '48',                                'Hours without Ryder acknowledgement before the invoice is re-sent (unlimited)'),
  ('automation',        '{"send_emails":"live","auto_advance_paid":"off","submit_to_ryder":"off","ryder_resubmit":"off","poll_mailbox":"off"}',
                        'Per-job switch: off | dry_run | live')
on conflict (key) do nothing;

-- ── email_outbox ─────────────────────────────────────────────
create table if not exists public.email_outbox (
  id                  uuid        primary key default extensions.uuid_generate_v4(),
  kind                text        not null,              -- payment_request | advance_paid | ryder_submit | ryder_resubmit | not_approved_alert | test | ...
  to_emails           text[]      not null,
  cc_emails           text[]      not null default '{}',
  subject             text        not null,
  body_html           text,
  body_text           text,
  attachments         jsonb       not null default '[]', -- [{bucket, path, filename, content_type}]
  related_invoice_ids uuid[]      not null default '{}',
  related_batch_id    uuid        references public.batches(id) on delete set null,
  dedupe_key          text        unique,                -- same key can never be queued twice
  status              text        not null default 'pending'
                      check (status in ('pending','sending','sent','failed','cancelled')),
  attempts            int         not null default 0,
  max_attempts        int         not null default 5,
  next_attempt_at     timestamptz not null default now(),
  locked_at           timestamptz,
  last_error          text,
  sent_at             timestamptz,
  smtp_message_id     text,
  redirected_to       text,                              -- set when EMAIL_REDIRECT_TO diverted it (dev)
  created_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_email_outbox_due     on public.email_outbox (status, next_attempt_at);
create index if not exists idx_email_outbox_created on public.email_outbox (created_at desc);
create index if not exists idx_email_outbox_invoices on public.email_outbox using gin (related_invoice_ids);

alter table public.email_outbox enable row level security;

drop policy if exists "email_outbox: admin read" on public.email_outbox;
create policy "email_outbox: admin read" on public.email_outbox
  for select using (public.current_user_role() = 'admin'::public.user_role);
-- No insert/update policies: only edge functions (service role) write.

drop trigger if exists trg_email_outbox_updated_at on public.email_outbox;
create trigger trg_email_outbox_updated_at
  before update on public.email_outbox
  for each row execute function public.set_updated_at();

-- Atomically claim due emails for sending. Rows stuck in 'sending' for
-- more than 10 minutes (function crashed mid-send) are reclaimed.
create or replace function public.claim_email_outbox(p_limit int default 10)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id
    from public.email_outbox
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'sending' and locked_at < now() - interval '10 minutes')
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  update public.email_outbox o
     set status    = 'sending',
         locked_at = now(),
         attempts  = o.attempts + 1
    from due
   where o.id = due.id
  returning o.*;
end;
$$;

revoke all on function public.claim_email_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(int) to service_role;

-- ── job_runs ─────────────────────────────────────────────────
create table if not exists public.job_runs (
  id          uuid        primary key default extensions.uuid_generate_v4(),
  job         text        not null,                     -- send_emails | auto_advance_paid | submit_to_ryder | ryder_resubmit | poll_mailbox
  mode        text        not null default 'live',      -- live | dry_run
  status      text        not null default 'running' check (status in ('running','ok','error')),
  summary     jsonb       not null default '{}',
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_job_runs_job_started on public.job_runs (job, started_at desc);

alter table public.job_runs enable row level security;

drop policy if exists "job_runs: admin read" on public.job_runs;
create policy "job_runs: admin read" on public.job_runs
  for select using (public.current_user_role() = 'admin'::public.user_role);
