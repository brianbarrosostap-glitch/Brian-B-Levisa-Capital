-- =============================================================
-- Add a direct invoice reference to the cheques table
--
-- The cheque↔invoice link already lives in cheque_invoices (a cheque
-- can pay many invoices). This adds a convenience reference for the
-- PRIMARY invoice a cheque pays, directly on the cheque row:
--   • invoice_number — the human-readable number printed on the cheque
--   • invoice_id     — FK → invoices(id), the matched invoice
--
-- n8n sends the invoice_number it read off the cheque; ingest-check
-- resolves it to invoice_id and stamps both here, AND still writes the
-- cheque_invoices join row(s) for multi-invoice cheques.
--
-- (The Drive reference — "device number" — already exists as
--  cheques.drive_file_id / drive_file_url. Nothing to add there.)
--
-- Run on project fhmdtbvpjqftwsbdihcu.
-- =============================================================

do $$
begin
  if to_regclass('public.cheques') is null then
    raise exception 'public.cheques not found — wrong Supabase project? Use fhmdtbvpjqftwsbdihcu.';
  end if;
end $$;

alter table public.cheques
  add column if not exists invoice_number text;

alter table public.cheques
  add column if not exists invoice_id uuid
    references public.invoices(id) on delete set null;

create index if not exists idx_cheques_invoice_number on public.cheques(invoice_number);
create index if not exists idx_cheques_invoice_id      on public.cheques(invoice_id);

-- Rebuild v_cheques to expose the new columns (drop+create because the
-- view uses c.*, see migration-gotchas in CLAUDE.md).
drop view if exists public.v_cheques cascade;

create view public.v_cheques as
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

comment on column public.cheques.invoice_number is
  'Primary invoice number read off the cheque (n8n). For multi-invoice cheques, the full list is in cheque_invoices / v_cheques.invoice_numbers.';
comment on column public.cheques.invoice_id is
  'FK to the primary matched invoice. Null until matched.';
