-- =============================================================
-- Add explicit confirmation columns for the two-confirmation flow
--
-- The end-to-end flow has TWO email-driven confirmation gates,
-- both parsed by the n8n automation and written here:
--
--   1. CUSTOMER (RZR) confirmation — after the admin approves the
--      advance request, RZR replies by email confirming they want
--      the advance. n8n parses that email and stamps:
--        customer_confirmed_at  + customer_conf_email
--
--   2. RYDER confirmation — after we email the invoice to Ryder
--      (payment step), Ryder replies with the invoice ID. n8n
--      matches by invoice_number and stamps:
--        ryder_confirmed_at  (ryder_conf_number already exists)
--
-- Safe / idempotent: uses IF NOT EXISTS.
-- =============================================================

-- ── Guard: make sure we're connected to the right database ──
-- If this raises, you are NOT in the project that has the Levisa
-- schema (e.g. wrong Supabase project tab selected, or a prior
-- failed statement aborted the transaction). Fix that before re-running.
do $$
begin
  if to_regclass('public.invoices') is null then
    raise exception
      'public.invoices not found in this database. You are likely in the WRONG Supabase project (use fhmdtbvpjqftwsbdihcu), or a previous statement aborted this transaction. Open a fresh SQL editor tab on the correct project and run this alone.';
  end if;
end $$;

-- ── Customer (RZR) confirmation ─────────────────────────────
alter table public.invoices
  add column if not exists customer_confirmed_at timestamptz;

alter table public.invoices
  add column if not exists customer_conf_email   text;          -- raw email / message id n8n parsed it from

-- ── Ryder confirmation ──────────────────────────────────────
-- ryder_conf_number already exists; add the timestamp of when
-- Ryder's confirmation email arrived and was matched.
alter table public.invoices
  add column if not exists ryder_confirmed_at    timestamptz;

-- ── Surface the new columns in v_invoices so the UI can read
--    them through the same view it already uses. ─────────────
-- NOTE: must DROP then CREATE (not CREATE OR REPLACE). Because the view
-- uses `i.*`, adding columns to `invoices` shifts the expanded column
-- order, and CREATE OR REPLACE cannot rename/reorder existing view
-- columns (error 42P16). Dropping first sidesteps that.
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

comment on column public.invoices.customer_confirmed_at is
  'When RZR confirmed (via email, parsed by n8n) that they want the advance.';
comment on column public.invoices.customer_conf_email is
  'Source email / message id the customer confirmation was parsed from.';
comment on column public.invoices.ryder_confirmed_at is
  'When Ryder confirmed payment (via email, parsed by n8n) — matched by invoice id.';
