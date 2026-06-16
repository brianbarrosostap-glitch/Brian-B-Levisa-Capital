-- =============================================================
-- Levisa Capital — Invoice Factoring Platform
-- Safe to run on a FRESH Supabase project (no tables yet)
-- =============================================================

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

-- =============================================================
-- 2. PROFILES
-- Extends auth.users — one row per Supabase auth user.
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
-- 3. CLIENTS
-- One row per customer company (e.g. RZR Inc).
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
-- One batch = one advance request submitted by a customer.
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
-- 5. INVOICES
-- Central fact table. advance_amount and factoring_fee are
-- computed automatically from invoice_amount × rate.
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
  ryder_days_out      integer               generated always as (
                        case when ryder_submitted_at is not null
                        then extract(day from (now() - ryder_submitted_at))::integer
                        else null end
                      ) stored,
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
  id                uuid                 primary key default uuid_generate_v4(),
  invoice_id        uuid                 not null references public.invoices(id) on delete cascade,
  type              public.attention_type not null,
  title             text                 not null,
  detail            text                 not null default '',
  action_label      text                 not null default 'Review',
  resolved          boolean              not null default false,
  resolved_at       timestamptz,
  resolved_by       uuid                 references public.profiles(id) on delete set null,
  ryder_conf_number text,
  ryder_amount      numeric(12,2),
  check_number      text,
  created_at        timestamptz          not null default now()
);

-- =============================================================
-- 8. INDEXES
-- =============================================================

create index idx_invoices_client  on public.invoices(client_id);
create index idx_invoices_status  on public.invoices(status);
create index idx_invoices_batch   on public.invoices(batch_id);
create index idx_invoices_number  on public.invoices(invoice_number);
create index idx_batches_client   on public.batches(client_id);
create index idx_batches_status   on public.batches(status);
create index idx_timeline_invoice on public.invoice_timeline(invoice_id, occurred_at desc);
create index idx_attention_open   on public.needs_attention(resolved, created_at desc);

-- =============================================================
-- 9. UPDATED_AT TRIGGERS
-- =============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute procedure public.set_updated_at();

create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute procedure public.set_updated_at();

create trigger trg_batches_updated_at
  before update on public.batches
  for each row execute procedure public.set_updated_at();

-- =============================================================
-- 10. STATUS → TIMELINE TRIGGER
-- Writes one timeline row every time invoices.status changes.
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
-- 11. ROW-LEVEL SECURITY
-- =============================================================

alter table public.profiles         enable row level security;
alter table public.clients          enable row level security;
alter table public.invoices         enable row level security;
alter table public.batches          enable row level security;
alter table public.invoice_timeline enable row level security;
alter table public.needs_attention  enable row level security;

-- Helper — reads current user's role (used in every policy below)
create or replace function public.current_user_role()
returns public.user_role language sql stable security definer as $$
  select role from public.profiles where id = auth.uid()
$$;

-- profiles: each user sees only their own row; admins see all
create policy "profiles: own row"
  on public.profiles for all
  using (id = auth.uid());

create policy "profiles: admin read all"
  on public.profiles for select
  using (public.current_user_role() = 'admin');

-- clients: admins full access; customers read their own
create policy "clients: admin all"
  on public.clients for all
  using (public.current_user_role() = 'admin');

create policy "clients: customer own"
  on public.clients for select
  using (owner_id = auth.uid());

-- invoices: admins full; customers read+insert their own client
create policy "invoices: admin all"
  on public.invoices for all
  using (public.current_user_role() = 'admin');

create policy "invoices: customer select"
  on public.invoices for select
  using (client_id in (select id from public.clients where owner_id = auth.uid()));

create policy "invoices: customer insert"
  on public.invoices for insert
  with check (client_id in (select id from public.clients where owner_id = auth.uid()));

-- batches: admins full; customers read+insert their own client
create policy "batches: admin all"
  on public.batches for all
  using (public.current_user_role() = 'admin');

create policy "batches: customer select"
  on public.batches for select
  using (client_id in (select id from public.clients where owner_id = auth.uid()));

create policy "batches: customer insert"
  on public.batches for insert
  with check (client_id in (select id from public.clients where owner_id = auth.uid()));

-- invoice_timeline: admins full; customers read their own invoices' history
create policy "timeline: admin all"
  on public.invoice_timeline for all
  using (public.current_user_role() = 'admin');

create policy "timeline: customer select"
  on public.invoice_timeline for select
  using (
    invoice_id in (
      select i.id from public.invoices i
      join public.clients c on c.id = i.client_id
      where c.owner_id = auth.uid()
    )
  );

-- needs_attention: admin only
create policy "needs_attention: admin all"
  on public.needs_attention for all
  using (public.current_user_role() = 'admin');

-- =============================================================
-- 12. KPI VIEW  (used by admin dashboard)
-- =============================================================

create or replace view public.v_kpi as
select
  count(*)                                                          as total_invoices,
  count(*) filter (where status = 'Uploaded')                      as pending_invoices,
  count(*) filter (where status = 'Advance Confirmed')             as awaiting_confirmation,
  count(*) filter (where status = 'Payment Requested')             as open_payment_requests,
  count(*) filter (where status = 'Submitted to Ryder'
                   and ryder_days_out >= 60)                       as overdue_60,
  coalesce(sum(invoice_amount), 0)                                 as total_face_value,
  coalesce(sum(advance_amount) filter (where status in (
    'Advance Paid','Submitted to Ryder','Acknowledged','Paid'
  )), 0)                                                            as total_advanced,
  coalesce(sum(factoring_fee) filter (where status = 'Paid'), 0)   as discount_revenue,
  coalesce(sum(advance_amount) filter (where status in (
    'Submitted to Ryder','Acknowledged'
  )), 0)                                                            as pending_with_ryder,
  coalesce(sum(advance_amount) filter (where status = 'Paid'), 0)  as collected_from_ryder
from public.invoices
where status not in ('Void','Cancelled');

-- =============================================================
-- END OF SCHEMA
-- =============================================================
