-- =============================================================
-- Audit to-do fixes (from review, 2026-10-14)
--
-- 1. RE-OPEN a verified advance when another invoice joins it later.
--    RZR can agree invoices of the same batch on different days; the late
--    invoice joins the existing ADV number and raises its total. If Brian
--    had already ticked that advance, the extra transfer was never checked.
--    Same for a cheque: a new row with an already-verified check_number
--    re-opens that cheque's to-do.
-- 2. Deleting ONE cheque row no longer wipes the to-do for the whole
--    cheque — the to-do is re-pointed to another row with the same number.
-- 3. v_audit_todos: advance totals EXCLUDE Void/Cancelled invoices (matches
--    Master's Active tab), and per-invoice amounts no longer overflow to
--    '###' for invoices >= $1,000,000.
--
-- REQUIRES the earlier audit-todo migrations. Run on fhmdtbvpjqftwsbdihcu.
-- Safe to re-run.
-- =============================================================

do $$
begin
  if to_regclass('public.audit_todos') is null then
    raise exception 'Run the earlier audit_todos migrations first (or wrong project — use fhmdtbvpjqftwsbdihcu).';
  end if;
end $$;

-- ── 1a. Advance: re-open when an invoice joins an existing number ──
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
  else
    -- Invoice joined an existing advance → its total grew → verify again.
    update public.audit_todos
       set done = false, done_at = null, done_by = null
     where kind = 'advance' and advance_number = v_num and done;
  end if;

  new.advance_number := v_num;
  return new;
end;
$$;

-- ── 1b. Cheque: re-open when another row of a verified cheque arrives ──
create or replace function public.create_cheque_todo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_todos (kind, cheque_id, check_number)
  values ('cheque', new.id, new.check_number)
  on conflict do nothing;

  if new.check_number is not null then
    update public.audit_todos
       set done = false, done_at = null, done_by = null
     where kind = 'cheque' and check_number = new.check_number and done
       and cheque_id is distinct from new.id;
  end if;
  return new;
end;
$$;

-- ── 2. Re-point a cheque to-do before its anchor row is deleted ──
create or replace function public.repoint_cheque_todo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
begin
  if old.check_number is not null then
    select id into v_other
      from public.cheques
     where check_number = old.check_number and id <> old.id
     order by received_at
     limit 1;
    if v_other is not null then
      update public.audit_todos set cheque_id = v_other where cheque_id = old.id;
    end if;
  end if;
  return old;   -- if no other row exists, the FK cascade removes the to-do as before
end;
$$;

drop trigger if exists trg_repoint_cheque_todo on public.cheques;
create trigger trg_repoint_cheque_todo
  before delete on public.cheques
  for each row execute procedure public.repoint_cheque_todo();

-- ── 3. Rebuild the view (void-safe advance totals, wider money mask) ──
drop view if exists public.v_audit_todos cascade;

create view public.v_audit_todos with (security_invoker = true) as
select
  t.*,
  p.full_name                           as done_by_name,
  -- cheque side (all rows sharing this check_number). n8n stores the FULL
  -- cheque amount on every row, so it's taken once (max), never summed.
  chq.amount                            as cheque_amount,
  chq.received_at                       as cheque_received_at,
  chq.drive_url                         as cheque_drive_url,
  chi.invoice_count                     as cheque_line_count,
  chi.lines                             as cheque_lines,
  chi.invoice_total                     as cheque_invoice_total,
  coalesce(chi.invoice_numbers, chq.raw_invoice_numbers) as cheque_invoice_numbers,
  -- advance side (Void/Cancelled excluded — never paid out)
  adv.invoice_count                     as advance_invoice_count,
  adv.invoice_total                     as advance_invoice_total,
  adv.advance_total                     as advance_total,
  adv.paid_count                        as advance_paid_count,
  adv.last_paid_at                      as advance_paid_at,
  adv.client_name                       as advance_client_name
from public.audit_todos t
left join public.profiles p on p.id = t.done_by
left join lateral (
  select
    max(c.amount)                                                  as amount,
    min(c.received_at)                                             as received_at,
    (array_agg(c.drive_file_url order by c.received_at)
       filter (where c.drive_file_url is not null))[1]             as drive_url,
    string_agg(distinct c.invoice_number, ', ')                    as raw_invoice_numbers
  from public.cheques c
  where t.kind = 'cheque'
    and (   (t.check_number is not null and c.check_number = t.check_number)
         or (t.check_number is null     and c.id = t.cheque_id))
) chq on true
left join lateral (
  select
    count(*)                                                       as invoice_count,
    sum(i.invoice_amount)                                          as invoice_total,
    string_agg(i.invoice_number, ', ' order by i.invoice_number)   as invoice_numbers,
    string_agg(i.invoice_number || ': ' || to_char(i.invoice_amount, 'FM$999,999,999,990.00'),
               ', ' order by i.invoice_number)                     as lines
  from public.invoices i
  where t.kind = 'cheque'
    and i.id in (
      select ci.invoice_id
        from public.cheques c
        join public.cheque_invoices ci on ci.cheque_id = c.id
       where (t.check_number is not null and c.check_number = t.check_number)
          or (t.check_number is null     and c.id = t.cheque_id)
      union
      select c.invoice_id
        from public.cheques c
       where c.invoice_id is not null
         and (   (t.check_number is not null and c.check_number = t.check_number)
              or (t.check_number is null     and c.id = t.cheque_id))
    )
) chi on true
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
  where t.kind = 'advance'
    and i.advance_number = t.advance_number
    and i.status::text not in ('Void', 'Cancelled')
) adv on true;
