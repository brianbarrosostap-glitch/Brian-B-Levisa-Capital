-- =============================================================
-- Advance numbers — one unique, sequential number per advance
--
-- Every time RZR approves (agrees to) an advance, all invoices in that
-- advance are stamped with the same sequential advance_number (1, 2, 3 …,
-- shown in the UI as ADV-0001). Admin can search Master by it to see the
-- invoices, individual amounts and the total — used to reconcile the
-- actual bank transfers against what the system says was advanced.
--
-- Grouping: one advance = one batch (advance request). The number is
-- stored on batches.advance_number and copied to invoices.advance_number.
-- An invoice with no batch gets its own number.
--
-- Assigned automatically by trigger the first time an invoice reaches
-- 'Advance Agreed' (or any later paid-out stage, if Advance Agreed was
-- skipped), or when RZR's confirmation is stamped (customer_confirmed_at).
-- Once assigned it never changes. Works no matter who moves the status
-- (dashboard, n8n, ingest-confirmation).
--
-- Run on project fhmdtbvpjqftwsbdihcu. Safe to re-run.
-- =============================================================

do $$
begin
  if to_regclass('public.invoices') is null then
    raise exception 'public.invoices not found — wrong Supabase project? Use fhmdtbvpjqftwsbdihcu.';
  end if;
end $$;

create sequence if not exists public.advance_number_seq start 1;

alter table public.batches  add column if not exists advance_number integer unique;
alter table public.invoices add column if not exists advance_number integer;

create index if not exists idx_invoices_advance_number on public.invoices(advance_number);

comment on column public.batches.advance_number is
  'Sequential advance number, assigned when RZR agrees to the advance. Shared by all invoices in the batch.';
comment on column public.invoices.advance_number is
  'Advance this invoice was paid out under (see batches.advance_number). Set by trg_assign_advance_number.';

-- ── Trigger function ─────────────────────────────────────────
create or replace function public.assign_advance_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num integer;
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
      update public.batches set advance_number = v_num where id = new.batch_id;
    end if;
  else
    v_num := nextval('public.advance_number_seq');
  end if;

  new.advance_number := v_num;
  return new;
end;
$$;

-- ── Backfill existing advances (oldest first) ────────────────
do $$
declare
  b record;
begin
  for b in
    select bt.id
    from public.batches bt
    where bt.advance_number is null
      and exists (
        select 1 from public.invoices i
        where i.batch_id = bt.id
          and (i.status::text in ('Advance Agreed', 'Advance Paid', 'Submitted to Ryder',
                                  'Acknowledged', 'Resubmitted', 'Paid')
               or (i.status::text = 'Advance Confirmed' and i.customer_confirmed_at is not null))
      )
    order by coalesce(bt.reviewed_at, bt.submitted_at), bt.submitted_at
  loop
    update public.batches set advance_number = nextval('public.advance_number_seq') where id = b.id;
  end loop;
end $$;

update public.invoices i
set advance_number = bt.advance_number
from public.batches bt
where i.batch_id = bt.id
  and i.advance_number is null
  and bt.advance_number is not null
  and (i.status::text in ('Advance Agreed', 'Advance Paid', 'Submitted to Ryder',
                          'Acknowledged', 'Resubmitted', 'Paid')
       or (i.status::text = 'Advance Confirmed' and i.customer_confirmed_at is not null));

-- Batch-less invoices already past agreement get their own number.
update public.invoices i
set advance_number = nextval('public.advance_number_seq')
where i.advance_number is null
  and i.batch_id is null
  and (i.status::text in ('Advance Agreed', 'Advance Paid', 'Submitted to Ryder',
                          'Acknowledged', 'Resubmitted', 'Paid')
       or (i.status::text = 'Advance Confirmed' and i.customer_confirmed_at is not null));

-- ── Attach trigger (after backfill) ──────────────────────────
drop trigger if exists trg_assign_advance_number on public.invoices;
create trigger trg_assign_advance_number
  before insert or update on public.invoices
  for each row execute procedure public.assign_advance_number();

-- v_invoices uses i.*, so rebuild it to pick up the new column (42P16 guard).
drop view if exists public.v_invoices cascade;

create view public.v_invoices as
select
  i.*,
  case
    when i.ryder_submitted_at is not null
    then extract(day from (now() - i.ryder_submitted_at))::integer
    else null
  end as ryder_days_out
from public.invoices i;
