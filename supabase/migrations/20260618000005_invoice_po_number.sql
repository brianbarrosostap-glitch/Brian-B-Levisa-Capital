-- =============================================================
-- Add PO (Purchase Order) number to invoices
--
-- Brian's invoices print a PO# (e.g. "0245437560" / "024543") that
-- wasn't being captured. n8n/Gemini reads it off the invoice and sends
-- it to ingest-invoice; we store it here and surface it in both portals.
--
-- Run on project fhmdtbvpjqftwsbdihcu.
-- =============================================================

do $$
begin
  if to_regclass('public.invoices') is null then
    raise exception 'public.invoices not found — wrong Supabase project? Use fhmdtbvpjqftwsbdihcu.';
  end if;
end $$;

alter table public.invoices
  add column if not exists po_number text;

create index if not exists idx_invoices_po_number on public.invoices(po_number);

-- v_invoices uses i.*, so the new column flows through automatically.
-- Rebuild it (drop+create) so the column order stays valid (42P16 guard).
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

comment on column public.invoices.po_number is
  'Purchase Order number printed on the invoice (PO#), extracted by n8n/Gemini.';
