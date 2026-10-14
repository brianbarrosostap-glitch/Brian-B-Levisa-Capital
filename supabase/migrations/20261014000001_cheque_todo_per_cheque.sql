-- =============================================================
-- One audit to-do per CHEQUE (not per invoice line)
--
-- n8n can store one `cheques` row per invoice paid by a physical cheque
-- (same check_number repeated). Previously that produced one to-do per
-- row. Now cheque to-dos are keyed by check_number:
--   • audit_todos.check_number (unique) — one to-do per cheque number.
--   • Rows with no readable check_number still get their own to-do.
--   • v_audit_todos shows the cheque amount ONCE (n8n repeats the full
--     cheque amount on every row) plus the matched invoices + their total.
--
-- Existing duplicate to-dos are merged (kept as verified if ANY of the
-- duplicates was already checked off).
--
-- REQUIRES 20261013000002_audit_todos.sql. Run on fhmdtbvpjqftwsbdihcu.
-- Safe to re-run.
-- =============================================================

do $$
begin
  if to_regclass('public.audit_todos') is null then
    raise exception 'Run 20261013000002_audit_todos.sql first (or wrong project — use fhmdtbvpjqftwsbdihcu).';
  end if;
end $$;

alter table public.audit_todos add column if not exists check_number text;

-- ── Merge existing duplicate cheque to-dos ───────────────────
with ranked as (
  select
    t.id,
    c.check_number,
    row_number() over w                                              as rn,
    bool_or(t.done) over w                                           as any_done,
    max(t.done_at) over w                                            as any_done_at,
    (array_agg(t.done_by) filter (where t.done_by is not null) over w)[1] as any_done_by
  from public.audit_todos t
  join public.cheques c on c.id = t.cheque_id
  where t.kind = 'cheque'
    and t.check_number is null
    and c.check_number is not null
    and not exists (select 1 from public.audit_todos x where x.check_number = c.check_number)
  window w as (partition by c.check_number order by c.received_at, t.created_at
               rows between unbounded preceding and unbounded following)
),
del as (
  delete from public.audit_todos where id in (select id from ranked where rn > 1)
  returning id
)
update public.audit_todos t
set check_number = r.check_number,
    done         = t.done or r.any_done,
    done_at      = coalesce(t.done_at, r.any_done_at),
    done_by      = coalesce(t.done_by, r.any_done_by)
from ranked r
where r.id = t.id and r.rn = 1;

-- Any leftover cheque to-do whose number already has a to-do → remove.
delete from public.audit_todos t
using public.cheques c
where t.kind = 'cheque' and t.check_number is null
  and c.id = t.cheque_id and c.check_number is not null
  and exists (select 1 from public.audit_todos x where x.check_number = c.check_number);

create unique index if not exists uq_audit_todos_check_number
  on public.audit_todos(check_number) where check_number is not null;

-- ── Trigger: one to-do per cheque number ─────────────────────
create or replace function public.create_cheque_todo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Same check_number already has a to-do → this is another invoice line
  -- of the same cheque; it's rolled into that to-do by v_audit_todos.
  insert into public.audit_todos (kind, cheque_id, check_number)
  values ('cheque', new.id, new.check_number)
  on conflict do nothing;
  return new;
end;
$$;

-- ── Rebuild the view: cheque totals across all its rows ──────
drop view if exists public.v_audit_todos cascade;

create view public.v_audit_todos with (security_invoker = true) as
select
  t.*,
  p.full_name                           as done_by_name,
  -- cheque side (all rows sharing this check_number).
  -- n8n stores the FULL cheque amount on every row of a multi-invoice
  -- cheque, so the cheque amount is taken once (max), never summed.
  chq.amount                            as cheque_amount,
  chq.received_at                       as cheque_received_at,
  chq.drive_url                         as cheque_drive_url,
  chi.invoice_count                     as cheque_line_count,
  chi.lines                             as cheque_lines,
  chi.invoice_total                     as cheque_invoice_total,
  coalesce(chi.invoice_numbers, chq.raw_invoice_numbers) as cheque_invoice_numbers,
  -- advance side
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
-- Matched invoices this cheque pays, with their own amounts (from invoices).
left join lateral (
  select
    count(*)                                                       as invoice_count,
    sum(i.invoice_amount)                                          as invoice_total,
    string_agg(i.invoice_number, ', ' order by i.invoice_number)   as invoice_numbers,
    string_agg(i.invoice_number || ': ' || to_char(i.invoice_amount, 'FM$999,999,990.00'),
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
  where t.kind = 'advance' and i.advance_number = t.advance_number
) adv on true;
