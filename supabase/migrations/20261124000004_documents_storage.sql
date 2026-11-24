-- =============================================================
-- Portal automation — documents, storage, inbound email (2026-11-24)
-- Replaces the Google Drive folders + n8n intake/mailbox workflows.
--
--   storage buckets  invoices (private), cheques (private, admin only)
--   invoices         + storage_path, pdf_path, file_sha256, advance_agreed_at
--   cheques          + storage_path, file_sha256, check_date, batch_number
--   cheque_invoices  + amount_paid, invoice_amount_on_cheque, deduction
--   document_jobs    one row per upload (invoice/cheque) → My Uploads + Upload Review
--   processed_emails one row per inbound Gmail message the portal handled
--   trigger          stamps advance_agreed_at when status becomes Advance Agreed
--
-- Safe to re-run. Apply to DEV first; to PROD at go-live.
-- =============================================================

-- ── Storage buckets ──────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('invoices', 'invoices', false, 26214400),   -- 25 MB
       ('cheques',  'cheques',  false, 26214400)
on conflict (id) do nothing;

-- invoices bucket layout: <client_id>/...   cheques bucket: admin only
drop policy if exists "invoices bucket: admin all"        on storage.objects;
drop policy if exists "invoices bucket: customer read"    on storage.objects;
drop policy if exists "invoices bucket: customer upload"  on storage.objects;
drop policy if exists "cheques bucket: admin all"         on storage.objects;

create policy "invoices bucket: admin all" on storage.objects
  for all
  using      (bucket_id = 'invoices' and public.current_user_role() = 'admin'::public.user_role)
  with check (bucket_id = 'invoices' and public.current_user_role() = 'admin'::public.user_role);

create policy "invoices bucket: customer read" on storage.objects
  for select
  using (bucket_id = 'invoices'
         and (storage.foldername(name))[1] in (select c.id::text from public.clients c where c.owner_id = auth.uid()));

create policy "invoices bucket: customer upload" on storage.objects
  for insert
  with check (bucket_id = 'invoices'
              and (storage.foldername(name))[1] in (select c.id::text from public.clients c where c.owner_id = auth.uid())
              and (storage.foldername(name))[2] = 'uploads');

create policy "cheques bucket: admin all" on storage.objects
  for all
  using      (bucket_id = 'cheques' and public.current_user_role() = 'admin'::public.user_role)
  with check (bucket_id = 'cheques' and public.current_user_role() = 'admin'::public.user_role);

-- ── New columns ──────────────────────────────────────────────
alter table public.invoices add column if not exists storage_path      text;        -- original upload (bucket 'invoices')
alter table public.invoices add column if not exists pdf_path          text;        -- PDF sent to Ryder (bucket 'invoices')
alter table public.invoices add column if not exists file_sha256       text;
alter table public.invoices add column if not exists advance_agreed_at timestamptz;

comment on column public.invoices.storage_path      is 'Original uploaded file in Storage bucket "invoices" (replaces drive_file_url for new invoices)';
comment on column public.invoices.pdf_path          is 'PDF version in bucket "invoices" — attached to the Ryder email';
comment on column public.invoices.advance_agreed_at is 'When RZR agreed to the 97% advance — the 12h auto Advance Paid timer starts here';

create index if not exists idx_invoices_file_sha256 on public.invoices (file_sha256);

alter table public.cheques add column if not exists storage_path text;             -- bucket 'cheques'
alter table public.cheques add column if not exists file_sha256  text;
alter table public.cheques add column if not exists check_date   date;
alter table public.cheques add column if not exists batch_number text;
create index if not exists idx_cheques_check_number on public.cheques (check_number);

alter table public.cheque_invoices add column if not exists invoice_amount_on_cheque numeric(12,2);
alter table public.cheque_invoices add column if not exists deduction                numeric(12,2);

-- Back-fill: existing Advance Agreed invoices start their 12h timer from their last update
update public.invoices
   set advance_agreed_at = updated_at
 where status = 'Advance Agreed' and advance_agreed_at is null;

-- Stamp advance_agreed_at whenever an invoice reaches Advance Agreed (any path).
create or replace function public.stamp_advance_agreed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status::text = 'Advance Agreed'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.advance_agreed_at := coalesce(new.advance_agreed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_advance_agreed_at on public.invoices;
create trigger trg_stamp_advance_agreed_at
  before insert or update of status on public.invoices
  for each row execute function public.stamp_advance_agreed_at();

-- v_invoices lists columns explicitly → rebuild to expose the new ones.
drop view if exists public.v_invoices cascade;
create view public.v_invoices as
select i.*,
       case when i.ryder_submitted_at is not null
            then extract(day from (now() - i.ryder_submitted_at))::integer
       end as ryder_days_out
from public.invoices i;
grant all on public.v_invoices to anon, authenticated, service_role;   -- same grants as before the rebuild

-- ── document_jobs ────────────────────────────────────────────
create table if not exists public.document_jobs (
  id                uuid        primary key default extensions.uuid_generate_v4(),
  kind              text        not null check (kind in ('invoice','cheque')),
  source            text        not null default 'upload' check (source in ('upload','sheet_link','drive_import')),
  client_id         uuid        references public.clients(id) on delete set null,
  storage_bucket    text,
  storage_path      text,
  original_filename text,
  mime_type         text,
  file_sha256       text,
  sheet_url         text,
  status            text        not null default 'pending'
                    check (status in ('pending','processing','added','duplicate','needs_review','failed','rejected')),
  status_reason     text,                                  -- human-readable why (shown to admin; customer sees a friendly word)
  extracted         jsonb       not null default '{}',     -- fields read from the document
  checks            jsonb       not null default '[]',     -- validation results [{name, ok, detail}]
  invoice_id        uuid        references public.invoices(id) on delete set null,
  cheque_id         uuid        references public.cheques(id)  on delete set null,
  attempts          int         not null default 0,
  created_by        uuid        references public.profiles(id) on delete set null,
  reviewed_by       uuid        references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_document_jobs_created on public.document_jobs (created_at desc);
create index if not exists idx_document_jobs_status  on public.document_jobs (status);
create index if not exists idx_document_jobs_client  on public.document_jobs (client_id);
create index if not exists idx_document_jobs_sha     on public.document_jobs (file_sha256);

alter table public.document_jobs enable row level security;

drop policy if exists "document_jobs: admin all"     on public.document_jobs;
drop policy if exists "document_jobs: customer read" on public.document_jobs;
create policy "document_jobs: admin all" on public.document_jobs
  using      (public.current_user_role() = 'admin'::public.user_role)
  with check (public.current_user_role() = 'admin'::public.user_role);
create policy "document_jobs: customer read" on public.document_jobs
  for select
  using (kind = 'invoice'
         and client_id in (select c.id from public.clients c where c.owner_id = auth.uid()));

drop trigger if exists trg_document_jobs_updated_at on public.document_jobs;
create trigger trg_document_jobs_updated_at
  before update on public.document_jobs
  for each row execute function public.set_updated_at();

-- ── processed_emails ─────────────────────────────────────────
create table if not exists public.processed_emails (
  message_id      text        primary key,              -- Gmail messageId
  thread_id       text,
  kind            text        not null,                  -- rzr_reply | ryder_confirmation | ignored
  from_email      text,
  subject         text,
  received_at     timestamptz,
  result          text        not null,                  -- approved | not_approved | acknowledged | no_match | error | skipped | dry_run
  detail          jsonb       not null default '{}',
  invoice_numbers text[]      not null default '{}',
  processed_at    timestamptz not null default now()
);

create index if not exists idx_processed_emails_processed on public.processed_emails (processed_at desc);

alter table public.processed_emails enable row level security;
drop policy if exists "processed_emails: admin read" on public.processed_emails;
create policy "processed_emails: admin read" on public.processed_emails
  for select using (public.current_user_role() = 'admin'::public.user_role);

-- ── Settings used by the new jobs ────────────────────────────
insert into public.app_settings (key, value, description) values
  ('ryder_vendor_number', '"7023492"',   'RZR vendor # printed on every invoice — an invoice that reads a different number goes to review'),
  ('mailbox_lookback_days', '7',         'How far back poll-mailbox looks for RZR replies / Ryder confirmations')
on conflict (key) do nothing;
