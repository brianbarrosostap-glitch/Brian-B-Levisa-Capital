-- =============================================================
-- BACKFILL_PROFILES — create profile rows for existing auth users
--
-- Symptom this fixes:
--   App login fails with  PGRST116  "The result contains 0 rows"
--   because public.profiles is empty even though auth.users has rows.
--
-- Cause:
--   The on_auth_user_created trigger only fires for NEW auth users.
--   Users created before the trigger existed (or before the schema
--   was last re-run, which drops + recreates profiles) never got a
--   profile row. This script backfills them.
--
-- Safe to run multiple times (idempotent via ON CONFLICT).
-- Run in: Supabase Dashboard -> SQL Editor (project fhmdtbvpjqftwsbdihcu)
-- =============================================================

-- ── Known users with explicit roles ─────────────────────────
insert into public.profiles (id, role, full_name, initials)
select id, 'admin'::user_role, 'Brian Levisa', 'BL'
from auth.users where email = 'brian@levisacapital.com'
on conflict (id) do update
  set role = excluded.role, full_name = excluded.full_name, initials = excluded.initials;

insert into public.profiles (id, role, full_name, initials)
select id, 'admin'::user_role, 'Divyanshu Sharma', 'DS'
from auth.users where email = 'divyanshu.sharma@growwstacks.com'
on conflict (id) do update
  set role = excluded.role, full_name = excluded.full_name, initials = excluded.initials;

insert into public.profiles (id, role, full_name, initials)
select id, 'customer'::user_role, 'Sarah Mitchell', 'SM'
from auth.users where email = 'divyanshutest2@gmail.com'
on conflict (id) do update
  set role = excluded.role, full_name = excluded.full_name, initials = excluded.initials;

-- ── Safety net: any OTHER auth user with no profile gets a
--    default 'customer' profile so login never 0-rows again ──
insert into public.profiles (id, role, full_name)
select u.id, 'customer'::user_role,
       coalesce(u.raw_user_meta_data->>'full_name', u.email)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ── Verify (should list every auth user with a role) ────────
select p.id, u.email, p.role, p.full_name, p.initials
from public.profiles p
join auth.users u on u.id = p.id
order by p.role, u.email;
