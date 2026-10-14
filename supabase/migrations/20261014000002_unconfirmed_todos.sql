-- =============================================================
-- Audit to-do: invoices Ryder never confirmed
--
-- Third to-do section. Which invoices appear is computed LIVE in the
-- Dashboard (AuditTodos.jsx) from `invoices`:
--   status in ('Submitted to Ryder','Resubmitted')   -- no Ryder conf yet
--   AND (resubmit_count >= 3  OR  waiting >= 7 days)  -- n8n resends every 48h
-- An invoice drops off by itself the moment Ryder's confirmation lands
-- (ingest-confirmation → 'Acknowledged').
--
-- This migration only lets the admin TICK one off ("investigated"):
-- audit_todos gets kind = 'unconfirmed' anchored to invoice_id, written by
-- the toggle-audit-todo edge function (upsert on invoice_id).
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

alter table public.audit_todos
  add column if not exists invoice_id uuid unique references public.invoices(id) on delete cascade;

alter table public.audit_todos drop constraint if exists audit_todos_kind_check;
alter table public.audit_todos
  add constraint audit_todos_kind_check check (kind in ('cheque', 'advance', 'unconfirmed'));

alter table public.audit_todos drop constraint if exists audit_todos_anchor;
alter table public.audit_todos
  add constraint audit_todos_anchor check (
    (kind = 'cheque'      and cheque_id is not null) or
    (kind = 'advance'     and advance_number is not null) or
    (kind = 'unconfirmed' and invoice_id is not null)
  );
