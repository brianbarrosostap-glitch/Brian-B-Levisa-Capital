-- =============================================================
-- Track how many times an invoice was re-sent to Ryder
--
-- n8n re-emails the invoice to Ryder if they don't reply within 48h.
-- Each resend, n8n updates this counter (1, 2, 3, …) so the admin has
-- a log of how many times an invoice was resubmitted. Optional companion
-- timestamp records WHEN the last resend happened.
--
-- n8n owns the increment (it's part of the resend automation). The
-- portal just reads + displays the value. Safe / idempotent.
-- Run on project fhmdtbvpjqftwsbdihcu.
-- =============================================================

do $$
begin
  if to_regclass('public.invoices') is null then
    raise exception 'public.invoices not found — wrong Supabase project? Use fhmdtbvpjqftwsbdihcu.';
  end if;
end $$;

alter table public.invoices
  add column if not exists resubmit_count integer not null default 0;

alter table public.invoices
  add column if not exists last_resubmitted_at timestamptz;

comment on column public.invoices.resubmit_count is
  'How many times n8n re-sent this invoice to Ryder (no reply in 48h). n8n increments; portal displays.';
comment on column public.invoices.last_resubmitted_at is
  'Timestamp of the most recent resend to Ryder (set by n8n).';

-- v_invoices uses i.*, so the new columns flow through automatically.
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
