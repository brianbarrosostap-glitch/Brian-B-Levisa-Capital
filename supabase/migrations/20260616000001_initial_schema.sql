-- =============================================================
-- Levisa Capital — Invoice Factoring Platform
-- FRESH RESET — idempotent full rebuild
--
-- Safe to run on ANY state of the database (empty, partial, or
-- fully populated). It DROPS every object this app owns, then
-- recreates all tables, indexes, triggers, RLS policies, and the
-- KPI view from scratch.
--
-- Paste this ENTIRE file into Supabase → SQL Editor → Run.
-- After it succeeds:
--   1. Authentication → Users → create (any password):
--        divyanshu.sharma@growwstacks.com  (admin)
--        divyanshutest2@gmail.com          (customer)
--   2. Run 20260616000002_seed_data.sql
-- =============================================================

-- ─── 0. DROP EVERYTHING (in dependency order) ────────────────

-- Views first (depend on tables)
drop view if exists public.v_kpi        cascade;
drop view if exists public.v_invoices   cascade;
drop view if exists public.v_audit_logs cascade;
drop view if exists public.v_checks     cascade;

-- Tables (cascade clears their triggers, policies, FKs)
drop table if exists public.audit_logs       cascade;
drop table if exists public.check_invoices   cascade;
drop table if exists public.checks           cascade;
drop table if exists public.needs_attention  cascade;
drop table if exists public.invoice_timeline cascade;
drop table if exists public.invoices         cascade;
drop table if exists public.batches          cascade;
drop table if exists public.clients          cascade;
drop table if exists public.profiles         cascade;

-- Functions
drop function if exists public.handle_new_user()          cascade;
drop function if exists public.set_updated_at()           cascade;
drop function if exists public.log_invoice_status_change() cascade;
drop function if exists public.current_user_role()        cascade;
drop function if exists public.record_audit_log()         cascade;

-- The trigger on auth.users is owned by a function we just dropped
-- with cascade, but drop it explicitly too in case it lingers.
drop trigger if exists on_auth_user_created on auth.users;

-- Enum types last (tables that used them are already gone)
drop type if exists public.invoice_status  cascade;
drop type if exists public.batch_status    cascade;
drop type if exists public.user_role       cascade;
drop type if exists public.attention_type  cascade;
drop type if exists public.audit_action    cascade;
drop type if exists public.check_status     cascade;

-- Also drop any non-schema-qualified leftovers from earlier runs
drop type if exists invoice_status  cascade;
drop type if exists batch_status    cascade;
drop type if exists user_role       cascade;
drop type if exists attention_type  cascade;
drop type if exists audit_action    cascade;
drop type if exists check_status    cascade;

-- ─── Extension ────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- =============================================================
-- 1. ENUM TYPES
-- =============================================================

create type public.invoice_status as enum (
  'Uploaded',
  'Eligible',
  'Payment Requested',
  'Ready for Payment',
  'Advance Confirmed',
  'Advance Paid',
  'Submitted to Ryder',
  'Acknowledged',
  'Resubmitted',
  'Paid',
  'Void',
  'Cancelled'
);

create type public.batch_status as enum (
  'Pending',
  'Approved',
  'Rejected',
  'Partially Approved'
);

create type public.user_role as enum (
  'admin',
  'customer'
);

create type public.attention_type as enum (
  'conf_match',
  'check_unreadable',
  'overdue'
);

create type public.audit_action as enum (
  'insert',
  'update',
  'delete',
  'status_change'
);

create type public.check_status as enum (
  'unmatched',   -- check file landed in Drive but not yet linked to an invoice
  'matched',     -- linked to an invoice (Ryder confirmation)
  'unreadable'   -- scan landed but the invoice number couldn't be read
);

-- =============================================================
-- 2. PROFILES — one row per Supabase auth user
-- =============================================================

create table public.profiles (
  id          uuid             primary key references auth.users(id) on delete cascade,
  role        public.user_role not null default 'customer',
  full_name   text             not null default '',
  initials    text             not null default '',
  created_at  timestamptz      not null default now(),
  updated_at  timestamptz      not null default now()
);

comment on table public.profiles is
  'role=admin → AdminApp  |  role=customer → CustomerApp';

-- Auto-create a profile row whenever a new auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =============================================================
-- 3. CLIENTS — one row per customer company (e.g. RZR Inc)
-- =============================================================

create table public.clients (
  id              uuid         primary key default uuid_generate_v4(),
  name            text         not null unique,
  debtor          text         not null default '',
  contact_name    text         not null default '',
  contact_email   text         not null default '',
  factoring_rate  numeric(5,4) not null default 0.03,
  advance_rate    numeric(5,4) not null default 0.97,
  owner_id        uuid         references public.profiles(id) on delete set null,
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);

-- =============================================================
-- 4. BATCHES  (must come BEFORE invoices — invoices FK → batches)
-- =============================================================

create table public.batches (
  id              uuid                primary key default uuid_generate_v4(),
  request_number  text                not null unique,
  client_id       uuid                not null references public.clients(id) on delete restrict,
  status          public.batch_status not null default 'Pending',
  submitted_at    timestamptz         not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid                references public.profiles(id) on delete set null,
  notes           text,
  created_at      timestamptz         not null default now(),
  updated_at      timestamptz         not null default now()
);

-- =============================================================
-- 5. INVOICES — central fact table
-- advance_amount and factoring_fee are computed columns.
-- =============================================================

create table public.invoices (
  id                  uuid                  primary key default uuid_generate_v4(),
  invoice_number      text                  not null unique,
  unit_number         text                  not null default '',
  client_id           uuid                  not null references public.clients(id) on delete restrict,
  invoice_date        date                  not null,
  due_date            date,
  invoice_amount      numeric(12,2)         not null,
  advance_rate        numeric(5,4)          not null default 0.97,
  advance_amount      numeric(12,2)         generated always as (round(invoice_amount * advance_rate, 2)) stored,
  factoring_fee       numeric(12,2)         generated always as (round(invoice_amount * (1 - advance_rate), 2)) stored,
  status              public.invoice_status not null default 'Uploaded',
  batch_id            uuid                  references public.batches(id) on delete set null,
  ryder_submitted_at  timestamptz,
  ryder_conf_number   text,
  -- NOTE: ryder_days_out is NOT a generated column. Postgres forbids now()
  -- in a stored generated expression (it is not immutable). "Days out" is
  -- computed live in the v_invoices view + the frontend fallback instead.
  ryder_paid_at       timestamptz,
  drive_file_id       text,
  drive_file_url      text,
  submitted_at        timestamptz,
  confirmed_at        timestamptz,
  advance_paid_at     timestamptz,
  paid_at             timestamptz,
  voided_at           timestamptz,
  created_at          timestamptz           not null default now(),
  updated_at          timestamptz           not null default now()
);

-- =============================================================
-- 6. INVOICE TIMELINE  (append-only audit log)
-- =============================================================

create table public.invoice_timeline (
  id          uuid                  primary key default uuid_generate_v4(),
  invoice_id  uuid                  not null references public.invoices(id) on delete cascade,
  status      public.invoice_status not null,
  occurred_at timestamptz           not null default now(),
  actor_id    uuid                  references public.profiles(id) on delete set null,
  note        text
);

-- =============================================================
-- 7. NEEDS ATTENTION
-- =============================================================

create table public.needs_attention (
  id                uuid                  primary key default uuid_generate_v4(),
  invoice_id        uuid                  not null references public.invoices(id) on delete cascade,
  type              public.attention_type not null,
  title             text                  not null,
  detail            text                  not null default '',
  action_label      text                  not null default 'Review',
  resolved          boolean               not null default false,
  resolved_at       timestamptz,
  resolved_by       uuid                  references public.profiles(id) on delete set null,
  ryder_conf_number text,
  ryder_amount      numeric(12,2),
  check_number      text,
  created_at        timestamptz           not null default now()
);

-- =============================================================
-- 8. CHECKS  (one row per check file dropped in the CHECKS Drive folder)
-- A check is the payment proof we receive from Ryder. It lives in a
-- SEPARATE Drive folder from invoices. A check may pay one or many
-- invoices — link rows live in check_invoices below.
--
-- Drive columns:
--   drive_file_id  — Google Drive file ID (stable handle)
--   drive_file_url — shareable webViewLink (what the UI links to)
-- =============================================================

create table public.checks (
  id             uuid                primary key default uuid_generate_v4(),
  check_number   text,                                  -- may be null until read
  amount         numeric(12,2),                         -- amount on the check
  ryder_conf_number text,                               -- Ryder confirmation # if present
  drive_file_id  text,                                  -- Drive file ID (checks folder)
  drive_file_url text,                                  -- Drive webViewLink
  status         public.check_status not null default 'unmatched',
  received_at    timestamptz         not null default now(),
  matched_at     timestamptz,
  matched_by     uuid                references public.profiles(id) on delete set null,
  note           text,
  created_at     timestamptz         not null default now(),
  updated_at     timestamptz         not null default now()
);

-- Join table: which invoice(s) a check pays (many-to-many).
-- A check covering 3 invoices = 3 rows here.
create table public.check_invoices (
  check_id    uuid          not null references public.checks(id)   on delete cascade,
  invoice_id  uuid          not null references public.invoices(id) on delete cascade,
  amount      numeric(12,2),                            -- portion of the check applied to this invoice
  created_at  timestamptz   not null default now(),
  primary key (check_id, invoice_id)
);

-- =============================================================
-- 9. AUDIT LOGS  (append-only — who did what, when, on which row)
-- Captures every action across all core tables. Two writers:
--   • DB trigger (record_audit_log)   → automatic safety net,
--     logs every insert/update/delete with before/after JSON.
--   • Edge functions                  → richer rows that set the
--     real human actor_id + a human note (the trigger can't know
--     which user a service-role write came from).
-- =============================================================

create table public.audit_logs (
  id           uuid                primary key default uuid_generate_v4(),
  table_name   text                not null,            -- e.g. 'invoices'
  record_id    uuid,                                    -- PK of the affected row
  action       public.audit_action not null,           -- insert | update | delete | status_change
  actor_id     uuid                references public.profiles(id) on delete set null,
  actor_email  text,                                    -- denormalized for readability
  summary      text                not null default '', -- human sentence ("Invoice 2215-5964 cleared / Paid")
  invoice_number text,                                  -- convenience for invoice-related rows
  old_status   text,                                    -- previous status (status_change)
  new_status   text,                                    -- new status (status_change)
  old_data     jsonb,                                   -- full previous row (trigger writes)
  new_data     jsonb,                                   -- full new row (trigger writes)
  source       text                not null default 'trigger', -- 'trigger' | edge-fn name
  created_at   timestamptz         not null default now()
);

-- =============================================================
-- 10. INDEXES
-- =============================================================

create index idx_invoices_client  on public.invoices(client_id);
create index idx_invoices_status  on public.invoices(status);
create index idx_invoices_batch   on public.invoices(batch_id);
create index idx_invoices_number  on public.invoices(invoice_number);
create index idx_batches_client   on public.batches(client_id);
create index idx_batches_status   on public.batches(status);
create index idx_timeline_invoice on public.invoice_timeline(invoice_id, occurred_at desc);
create index idx_attention_open   on public.needs_attention(resolved, created_at desc);
create index idx_checks_status    on public.checks(status, received_at desc);
create index idx_checks_number    on public.checks(check_number);
create index idx_checkinv_invoice on public.check_invoices(invoice_id);
create index idx_audit_table      on public.audit_logs(table_name, created_at desc);
create index idx_audit_record     on public.audit_logs(record_id, created_at desc);
create index idx_audit_created    on public.audit_logs(created_at desc);

-- =============================================================
-- 11. UPDATED_AT TRIGGERS
-- =============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at  before update on public.profiles  for each row execute procedure public.set_updated_at();
create trigger trg_clients_updated_at   before update on public.clients   for each row execute procedure public.set_updated_at();
create trigger trg_invoices_updated_at  before update on public.invoices  for each row execute procedure public.set_updated_at();
create trigger trg_batches_updated_at   before update on public.batches   for each row execute procedure public.set_updated_at();
create trigger trg_checks_updated_at    before update on public.checks    for each row execute procedure public.set_updated_at();

-- =============================================================
-- 12. STATUS → TIMELINE TRIGGER
-- =============================================================

create or replace function public.log_invoice_status_change()
returns trigger language plpgsql security definer as $$
begin
  if old.status is distinct from new.status then
    insert into public.invoice_timeline (invoice_id, status)
    values (new.id, new.status);
  end if;
  return new;
end;
$$;

create trigger trg_invoice_status_log
  after update of status on public.invoices
  for each row execute procedure public.log_invoice_status_change();

-- =============================================================
-- 13. AUDIT LOG TRIGGER  (generic — attached to all core tables)
-- Automatic safety net. Logs every insert/update/delete with a
-- before/after JSON snapshot. For invoices it also detects status
-- changes and fills old_status/new_status + a readable summary.
-- It tries to attribute the actor via auth.uid(); service-role
-- writes (edge functions) have no auth.uid(), so those rows show
-- actor_id = null here — the edge function then writes its OWN
-- richer audit row with the real human actor + note.
-- =============================================================

create or replace function public.record_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_email      text;
  v_action     public.audit_action;
  v_record_id  uuid;
  v_inv_number text;
  v_old_status text;
  v_new_status text;
  v_summary    text;
begin
  -- Resolve the acting user's email (may be null for service-role writes)
  if v_actor is not null then
    select email into v_email from auth.users where id = v_actor;
  end if;

  -- Determine action + the affected record id
  if (tg_op = 'INSERT') then
    v_action    := 'insert';
    v_record_id := new.id;
  elsif (tg_op = 'DELETE') then
    v_action    := 'delete';
    v_record_id := old.id;
  else
    v_action    := 'update';
    v_record_id := new.id;
  end if;

  -- Invoice-specific enrichment (status change + readable summary)
  if (tg_table_name = 'invoices') then
    if (tg_op = 'DELETE') then
      v_inv_number := old.invoice_number;
    else
      v_inv_number := new.invoice_number;
    end if;

    if (tg_op = 'UPDATE' and old.status is distinct from new.status) then
      v_action     := 'status_change';
      v_old_status := old.status::text;
      v_new_status := new.status::text;
      v_summary    := 'Invoice ' || coalesce(v_inv_number, '?') ||
                      ': ' || v_old_status || ' → ' || v_new_status;
    elsif (tg_op = 'INSERT') then
      v_summary := 'Invoice ' || coalesce(v_inv_number, '?') || ' created (' || new.status::text || ')';
    elsif (tg_op = 'DELETE') then
      v_summary := 'Invoice ' || coalesce(v_inv_number, '?') || ' deleted';
    else
      v_summary := 'Invoice ' || coalesce(v_inv_number, '?') || ' updated';
    end if;
  else
    v_summary := initcap(tg_table_name) || ' ' || v_action::text;
  end if;

  insert into public.audit_logs (
    table_name, record_id, action, actor_id, actor_email,
    summary, invoice_number, old_status, new_status,
    old_data, new_data, source
  ) values (
    tg_table_name,
    v_record_id,
    v_action,
    v_actor,
    v_email,
    v_summary,
    v_inv_number,
    v_old_status,
    v_new_status,
    case when tg_op <> 'INSERT' then to_jsonb(old) else null end,
    case when tg_op <> 'DELETE' then to_jsonb(new) else null end,
    'trigger'
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_audit_invoices
  after insert or update or delete on public.invoices
  for each row execute procedure public.record_audit_log();

create trigger trg_audit_batches
  after insert or update or delete on public.batches
  for each row execute procedure public.record_audit_log();

create trigger trg_audit_needs_attention
  after insert or update or delete on public.needs_attention
  for each row execute procedure public.record_audit_log();

create trigger trg_audit_clients
  after insert or update or delete on public.clients
  for each row execute procedure public.record_audit_log();

create trigger trg_audit_checks
  after insert or update or delete on public.checks
  for each row execute procedure public.record_audit_log();

-- =============================================================
-- 14. ROW-LEVEL SECURITY
-- =============================================================

alter table public.profiles         enable row level security;
alter table public.clients          enable row level security;
alter table public.invoices         enable row level security;
alter table public.batches          enable row level security;
alter table public.invoice_timeline enable row level security;
alter table public.needs_attention  enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.checks           enable row level security;
alter table public.check_invoices   enable row level security;

-- Helper — reads current user's role.
-- SECURITY DEFINER + a dedicated search_path means this runs as the
-- function owner and BYPASSES RLS, so calling it inside a policy does
-- NOT re-trigger the profiles policies (no infinite recursion).
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Lock the helper down so it can't be abused, but stays callable by the app.
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated, anon, service_role;

-- profiles
-- IMPORTANT: the ONLY profiles policy must be "own row". The login flow
-- fetches the signed-in user's OWN profile (App.jsx → .eq('id', auth.uid())),
-- which this covers. Admin-wide profile reads are NOT needed by the app and
-- would require a policy that queries profiles again → infinite recursion.
-- All server-side profile reads go through the service role (bypasses RLS).
create policy "profiles: own row"
  on public.profiles
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- clients
create policy "clients: admin all"       on public.clients          for all    using (public.current_user_role() = 'admin');
create policy "clients: customer own"    on public.clients          for select using (owner_id = auth.uid());

-- invoices
create policy "invoices: admin all"      on public.invoices         for all    using (public.current_user_role() = 'admin');
create policy "invoices: cust select"    on public.invoices         for select using (client_id in (select id from public.clients where owner_id = auth.uid()));
create policy "invoices: cust insert"    on public.invoices         for insert with check (client_id in (select id from public.clients where owner_id = auth.uid()));

-- batches
create policy "batches: admin all"       on public.batches          for all    using (public.current_user_role() = 'admin');
create policy "batches: cust select"     on public.batches          for select using (client_id in (select id from public.clients where owner_id = auth.uid()));
create policy "batches: cust insert"     on public.batches          for insert with check (client_id in (select id from public.clients where owner_id = auth.uid()));

-- invoice_timeline
create policy "timeline: admin all"      on public.invoice_timeline for all    using (public.current_user_role() = 'admin');
create policy "timeline: cust select"    on public.invoice_timeline for select using (invoice_id in (select i.id from public.invoices i join public.clients c on c.id = i.client_id where c.owner_id = auth.uid()));

-- needs_attention (admin only)
create policy "attention: admin all"     on public.needs_attention  for all    using (public.current_user_role() = 'admin');

-- audit_logs (admin read only — append-only, never edited from the app;
-- writes come from triggers + edge functions via the service role)
create policy "audit: admin read"        on public.audit_logs       for select using (public.current_user_role() = 'admin');

-- checks: admins full access; customers may READ checks linked to their
-- own invoices (so they can see "Ryder confirmed / paid" proof).
-- All writes go through the service role (ingest-check edge function).
create policy "checks: admin all"        on public.checks           for all    using (public.current_user_role() = 'admin');
create policy "checks: customer read"    on public.checks           for select using (
  id in (
    select ci.check_id
    from public.check_invoices ci
    join public.invoices i on i.id = ci.invoice_id
    join public.clients  c on c.id = i.client_id
    where c.owner_id = auth.uid()
  )
);

-- check_invoices (join): same visibility as checks
create policy "checkinv: admin all"      on public.check_invoices   for all    using (public.current_user_role() = 'admin');
create policy "checkinv: customer read"  on public.check_invoices   for select using (
  invoice_id in (
    select i.id from public.invoices i
    join public.clients c on c.id = i.client_id
    where c.owner_id = auth.uid()
  )
);

-- =============================================================
-- 15. INVOICES VIEW  (adds live-computed ryder_days_out)
-- The app reads invoices directly; this view is available if you
-- ever want a server-computed ryder_days_out without a stored col.
-- =============================================================

create or replace view public.v_invoices as
select
  i.*,
  case
    when i.ryder_submitted_at is not null
    then extract(day from (now() - i.ryder_submitted_at))::integer
    else null
  end as ryder_days_out
from public.invoices i;

-- =============================================================
-- 16. KPI VIEW  (used by admin dashboard)
-- overdue_60 computes "days out" live from ryder_submitted_at.
-- =============================================================

create or replace view public.v_kpi as
select
  count(*)                                                                                        as total_invoices,
  count(*) filter (where status = 'Uploaded')                                                    as pending_invoices,
  count(*) filter (where status = 'Advance Confirmed')                                           as awaiting_confirmation,
  count(*) filter (where status = 'Payment Requested')                                           as open_payment_requests,
  count(*) filter (where status = 'Submitted to Ryder'
                   and ryder_submitted_at is not null
                   and extract(day from (now() - ryder_submitted_at)) >= 60)                     as overdue_60,
  coalesce(sum(invoice_amount), 0)                                                               as total_face_value,
  coalesce(sum(advance_amount)  filter (where status in ('Advance Paid','Submitted to Ryder','Acknowledged','Paid')), 0) as total_advanced,
  coalesce(sum(factoring_fee)   filter (where status = 'Paid'), 0)                              as discount_revenue,
  coalesce(sum(advance_amount)  filter (where status in ('Submitted to Ryder','Acknowledged')), 0) as pending_with_ryder,
  coalesce(sum(advance_amount)  filter (where status = 'Paid'), 0)                              as collected_from_ryder
from public.invoices
where status not in ('Void','Cancelled');

-- =============================================================
-- 17. AUDIT LOG VIEW  (newest-first, ready for the admin UI)
-- =============================================================

create or replace view public.v_audit_logs as
select
  a.id,
  a.created_at,
  a.table_name,
  a.action,
  a.summary,
  a.invoice_number,
  a.old_status,
  a.new_status,
  a.actor_email,
  coalesce(p.full_name, a.actor_email, 'System') as actor_name,
  a.source,
  a.record_id
from public.audit_logs a
left join public.profiles p on p.id = a.actor_id
order by a.created_at desc;

-- =============================================================
-- 18. CHECKS VIEW  (each check + the invoice numbers it pays)
-- Ready for the admin "Checks" screen. newest-first.
-- =============================================================

create or replace view public.v_checks as
select
  c.id,
  c.check_number,
  c.amount,
  c.ryder_conf_number,
  c.drive_file_id,
  c.drive_file_url,
  c.status,
  c.received_at,
  c.matched_at,
  c.note,
  -- comma-separated list of invoice numbers this check is linked to
  (
    select string_agg(i.invoice_number, ', ' order by i.invoice_number)
    from public.check_invoices ci
    join public.invoices i on i.id = ci.invoice_id
    where ci.check_id = c.id
  ) as invoice_numbers
from public.checks c
order by c.received_at desc;

-- =============================================================
-- SUCCESS — all 9 tables, indexes, triggers, RLS, and views
-- created. Now create the two auth users, then run the seed file.
-- =============================================================
