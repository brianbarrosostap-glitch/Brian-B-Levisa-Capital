-- =============================================================
-- Audit to-do list (admin Dashboard)
--
-- Two kinds of to-do, created AUTOMATICALLY by the database:
--   kind = 'cheque'  → one per cheque row (n8n ingest-check inserts it).
--                      Admin compares the cheque amount to the actual
--                      bank deposit, then checks it off.
--   kind = 'advance' → one per advance number (assigned when RZR agrees).
--                      Admin compares the advance total to the actual bank
--                      transfer to RZR, then checks it off.
--
-- Amounts are NOT copied onto the to-do — v_audit_todos computes them live
-- (cheque amount may be filled in later; advance total = sum of invoices).
-- Checking off goes through the `toggle-audit-todo` edge function.
--
-- REQUIRES 20261013000001_advance_number.sql to have been run first.
-- Run on project fhmdtbvpjqftwsbdihcu. Safe to re-run.
-- =============================================================

do $$
begin
  if to_regclass('public.cheques') is null then
    raise exception 'public.cheques not found — wrong Supabase project? Use fhmdtbvpjqftwsbdihcu.';
  end if;
  if to_regclass('public.advance_number_seq') is null then
    raise exception 'Run 20261013000001_advance_number.sql first.';
  end if;
end $$;

create table if not exists public.audit_todos (
  id              uuid        primary key default uuid_generate_v4(),
  kind            text        not null check (kind in ('cheque', 'advance')),
  cheque_id       uuid        unique references public.cheques(id) on delete cascade,
  advance_number  integer     unique,
  done            boolean     not null default false,
  done_at         timestamptz,
  done_by         uuid        references public.profiles(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  constraint audit_todos_anchor check (
    (kind = 'cheque'  and cheque_id is not null) or
    (kind = 'advance' and advance_number is not null)
  )
);

create index if not exists idx_audit_todos_done on public.audit_todos(done, created_at desc);

alter table public.audit_todos enable row level security;
drop policy if exists "audit_todos: admin all" on public.audit_todos;
create policy "audit_todos: admin all" on public.audit_todos
  for all using (public.current_user_role() = 'admin');

-- ── Cheque inserted → cheque to-do ───────────────────────────
create or replace function public.create_cheque_todo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_todos (kind, cheque_id)
  values ('cheque', new.id)
  on conflict (cheque_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_cheque_todo on public.cheques;
create trigger trg_cheque_todo
  after insert on public.cheques
  for each row execute procedure public.create_cheque_todo();

-- ── New advance number → advance to-do ───────────────────────
-- Same function as in 20261013000001, plus the to-do insert whenever a
-- NEW number is drawn from the sequence.
create or replace function public.assign_advance_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num integer;
  v_new boolean := false;
begin
  if new.advance_number is not null then
    return new;
  end if;

  if not (
       new.status::text in ('Advance Agreed', 'Advance Paid', 'Submitted to Ryder',
                            'Acknowledged', 'Resubmitted', 'Paid')
    or (new.status::text = 'Advance Confirmed' and new.customer_confirmed_at is not null)
  ) then
    return new;
  end if;

  if new.batch_id is not null then
    -- Lock the batch so concurrent agreements in the same advance share one number.
    select advance_number into v_num from public.batches where id = new.batch_id for update;
    if v_num is null then
      v_num := nextval('public.advance_number_seq');
      v_new := true;
      update public.batches set advance_number = v_num where id = new.batch_id;
    end if;
  else
    v_num := nextval('public.advance_number_seq');
    v_new := true;
  end if;

  if v_new then
    insert into public.audit_todos (kind, advance_number)
    values ('advance', v_num)
    on conflict (advance_number) do nothing;
  end if;

  new.advance_number := v_num;
  return new;
end;
$$;

-- ── Backfill to-dos for existing cheques + advances ──────────
insert into public.audit_todos (kind, cheque_id, created_at)
select 'cheque', c.id, c.received_at
from public.cheques c
on conflict (cheque_id) do nothing;

insert into public.audit_todos (kind, advance_number)
select distinct 'advance', i.advance_number
from public.invoices i
where i.advance_number is not null
on conflict (advance_number) do nothing;

-- ── Readable view with live amounts ──────────────────────────
-- security_invoker → RLS on the underlying tables applies (admin only).
drop view if exists public.v_audit_todos cascade;

create view public.v_audit_todos with (security_invoker = true) as
select
  t.*,
  p.full_name                           as done_by_name,
  -- cheque side
  c.check_number,
  c.amount                              as cheque_amount,
  c.received_at                         as cheque_received_at,
  c.drive_file_url                      as cheque_drive_url,
  c.status::text                        as cheque_status,
  coalesce(
    (select string_agg(i.invoice_number, ', ' order by i.invoice_number)
       from public.cheque_invoices ci
       join public.invoices i on i.id = ci.invoice_id
      where ci.cheque_id = c.id),
    c.invoice_number
  )                                     as cheque_invoice_numbers,
  -- advance side
  adv.invoice_count                     as advance_invoice_count,
  adv.invoice_total                     as advance_invoice_total,
  adv.advance_total                     as advance_total,
  adv.paid_count                        as advance_paid_count,
  adv.last_paid_at                      as advance_paid_at,
  adv.client_name                       as advance_client_name
from public.audit_todos t
left join public.profiles p on p.id = t.done_by
left join public.cheques  c on c.id = t.cheque_id
left join lateral (
  select
    count(*)                                         as invoice_count,
    coalesce(sum(i.invoice_amount), 0)               as invoice_total,
    coalesce(sum(i.advance_amount), 0)               as advance_total,
    count(*) filter (where i.advance_paid_at is not null) as paid_count,
    max(i.advance_paid_at)                           as last_paid_at,
    min(cl.name)                                     as client_name
  from public.invoices i
  left join public.clients cl on cl.id = i.client_id
  where t.kind = 'advance' and i.advance_number = t.advance_number
) adv on true;
