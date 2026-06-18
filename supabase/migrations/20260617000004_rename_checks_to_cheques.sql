-- =============================================================
-- Rename  checks → cheques  (table, join table, FK, view)
--
-- Scope (renamed):
--   table  public.checks          → public.cheques
--   table  public.check_invoices  → public.cheque_invoices
--   column cheque_invoices.check_id → cheque_id
--   view   public.v_checks        → public.v_cheques
--   indexes / trigger renamed to match
--
-- Intentionally NOT renamed (kept to limit blast radius — these are
-- internal identifiers the UI/labels already depend on):
--   column  cheques.check_number      (stays check_number)
--   column  cheques.ryder_conf_number (unchanged)
--   enum    public.check_status       (unchanged)
--
-- Run this AFTER the base schema. Idempotent-ish: guarded so it is
-- safe if the old names still exist; re-running after rename is a no-op
-- on the already-renamed objects.
-- =============================================================

-- 1) Rename the join table's FK column first (while table still 'check_invoices')
alter table if exists public.check_invoices rename column check_id to cheque_id;

-- 2) Rename the tables
alter table if exists public.checks          rename to cheques;
alter table if exists public.check_invoices  rename to cheque_invoices;

-- 3) Recreate the view under the new name, dropping the old one
drop view if exists public.v_checks cascade;

create or replace view public.v_cheques as
select
  c.*,
  (
    select string_agg(i.invoice_number, ', ' order by i.invoice_number)
    from public.cheque_invoices ci
    join public.invoices i on i.id = ci.invoice_id
    where ci.cheque_id = c.id
  ) as invoice_numbers
from public.cheques c
order by c.received_at desc;

-- 4) RLS policies: drop old AND new names, then recreate. Dropping the
--    new names too makes this migration safe to re-run after a partial
--    failure (otherwise the second run errors: policy already exists).
drop policy if exists "checks: admin all"            on public.cheques;
drop policy if exists "checks: customer read"        on public.cheques;
drop policy if exists "cheques: admin all"           on public.cheques;
drop policy if exists "cheques: customer read"       on public.cheques;
drop policy if exists "checkinv: admin all"          on public.cheque_invoices;
drop policy if exists "checkinv: customer read"      on public.cheque_invoices;
drop policy if exists "cheque_invoices: admin all"   on public.cheque_invoices;
drop policy if exists "cheque_invoices: customer read" on public.cheque_invoices;

create policy "cheques: admin all"
  on public.cheques for all
  using (public.current_user_role() = 'admin');

create policy "cheques: customer read"
  on public.cheques for select
  using (
    id in (
      select ci.cheque_id
      from public.cheque_invoices ci
      join public.invoices i on i.id = ci.invoice_id
      join public.clients  cl on cl.id = i.client_id
      where cl.owner_id = auth.uid()
    )
  );

create policy "cheque_invoices: admin all"
  on public.cheque_invoices for all
  using (public.current_user_role() = 'admin');

create policy "cheque_invoices: customer read"
  on public.cheque_invoices for select
  using (
    invoice_id in (
      select i.id
      from public.invoices i
      join public.clients cl on cl.id = i.client_id
      where cl.owner_id = auth.uid()
    )
  );

-- 5) Done. Indexes & the updated_at / audit triggers follow the table
--    automatically on rename, so no further action is needed.
