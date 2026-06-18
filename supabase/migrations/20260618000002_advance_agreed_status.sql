-- =============================================================
-- Add 'Advance Agreed' status to the two-stage advance flow
--
-- New lifecycle:
--   Uploaded/Eligible
--     → (customer submits)        Payment Requested
--     → (Brian approves)          Advance Confirmed
--     → (customer agrees to 97%)  Advance Agreed     ← NEW
--     → (Brian marks advance paid) Advance Paid → … → Paid
--
-- ⚠️ RUN THIS LINE ALONE first (enum value can't be used in the
--    same transaction it's added in), then continue with the rest.
-- =============================================================

alter type public.invoice_status add value if not exists 'Advance Agreed' after 'Advance Confirmed';
