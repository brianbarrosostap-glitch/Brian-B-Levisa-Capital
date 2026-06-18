-- =============================================================
-- Allow CHECK-ONLY needs_attention alerts
--
-- Gap: when n8n/Gemini ingests a cheque it cannot match to any
-- invoice, ingest-check had no way to raise an admin alert because
-- needs_attention.invoice_id was NOT NULL. Such cheques only showed
-- on the Checks screen, never in the Needs Attention queue.
--
-- This migration:
--   1. Makes invoice_id nullable (a check-only alert has no invoice).
--   2. Adds cheque_id so the alert can point back to the cheque.
--   3. Adds a guard: an alert must reference at least one of the two.
--
-- Idempotent. Run on project fhmdtbvpjqftwsbdihcu.
--
-- ⚠️ RUN IN TWO STEPS in the SQL editor:
--   STEP 1: run the single `alter type ... add value` line below ALONE,
--           then click Run. (Postgres won't let a new enum value be used
--           in the same transaction it was added in.)
--   STEP 2: select everything from "-- STEP 2" down and run it.
-- =============================================================

-- ───────────────────────────── STEP 1 ─────────────────────────────
-- New attention type for cheques that could not be auto-matched
-- (distinct from 'check_unreadable', which means the scan failed).
alter type public.attention_type add value if not exists 'check_unmatched';

-- ───────────────────────────── STEP 2 ─────────────────────────────

-- Safety guard: right project?
do $$
begin
  if to_regclass('public.needs_attention') is null then
    raise exception 'public.needs_attention not found — wrong Supabase project? Use fhmdtbvpjqftwsbdihcu.';
  end if;
end $$;

-- 1) invoice_id may now be null (check-only alerts)
alter table public.needs_attention
  alter column invoice_id drop not null;

-- 2) Link an alert to the cheque it concerns (nullable)
alter table public.needs_attention
  add column if not exists cheque_id uuid
    references public.cheques(id) on delete cascade;

-- 3) Every alert must anchor to an invoice OR a cheque (not neither)
alter table public.needs_attention
  drop constraint if exists needs_attention_anchor_chk;
alter table public.needs_attention
  add constraint needs_attention_anchor_chk
  check (invoice_id is not null or cheque_id is not null);
