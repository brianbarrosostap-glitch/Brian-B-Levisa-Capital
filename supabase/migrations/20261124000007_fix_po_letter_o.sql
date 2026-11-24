-- =============================================================
-- Fix PO numbers stored with letters instead of digits.
--
-- n8n read POs from the PDF text layer, where the leading 0 is often
-- rendered as the letter O (e.g. "O245437560" instead of "0245437560").
-- On 2026-11-24, 249 of 304 prod invoices were affected; every one is only
-- digits + O/I/L, so the fix is a straight character swap. New uploads are
-- normalised in code (normalizePo), so this is a one-time data fix.
--
-- Only rows whose PO becomes ALL DIGITS are touched. Safe to re-run.
-- Apply to DEV first; to PROD at go-live.
-- =============================================================

update public.invoices
   set po_number = translate(upper(po_number), 'OIL', '011')
 where po_number ~ '[OoIiLl]'
   and translate(upper(po_number), 'OIL', '011') ~ '^[0-9]+$';

-- Keep the archived copies of deleted invoices consistent too.
update public.deleted_invoices
   set snapshot = jsonb_set(snapshot, '{po_number}', to_jsonb(translate(upper(snapshot ->> 'po_number'), 'OIL', '011')))
 where snapshot ->> 'po_number' ~ '[OoIiLl]'
   and translate(upper(snapshot ->> 'po_number'), 'OIL', '011') ~ '^[0-9]+$';
