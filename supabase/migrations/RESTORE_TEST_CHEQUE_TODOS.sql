-- =============================================================
-- ONE-OFF: restore audit to-dos that were ticked off while TESTING
--
-- Puts every to-do (cheques, advances, Ryder no-confirmation) that was
-- marked verified TODAY back into the "To verify" list. Real
-- verifications from earlier days stay as-is.
--
-- Run on project fhmdtbvpjqftwsbdihcu, in the SQL Editor.
-- Step 1 is a preview (read-only). Run step 2 only if the list is right.
-- =============================================================

-- ── Step 1: PREVIEW — what will be restored ───────────────────
select t.kind,
       coalesce(t.check_number, 'ADV-' || lpad(t.advance_number::text, 4, '0'), t.invoice_id::text) as item,
       t.done_at,
       p.full_name as verified_by
from public.audit_todos t
left join public.profiles p on p.id = t.done_by
where t.done
  and t.done_at::date = current_date
order by t.kind, t.done_at;

-- ── Step 2: RESTORE — move them back to "To verify" ───────────
update public.audit_todos
set done = false, done_at = null, done_by = null
where done
  and done_at::date = current_date;
