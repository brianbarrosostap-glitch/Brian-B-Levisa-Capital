-- =============================================================
-- FIX_PROFILES — backfill profile rows for existing auth users
--
-- Run this if the `profiles` table is empty (login fails with
-- PGRST116 "0 rows"). This happens when auth users were created
-- but the seed never ran, OR the on_auth_user_created trigger
-- was added AFTER the users already existed (so it never fired
-- for them).
--
-- STEP A first lets you SEE what auth users actually exist.
-- STEP B backfills a profile for EVERY auth user, then sets the
-- two known roles. Safe to run multiple times.
-- =============================================================

-- ─── STEP A — inspect (run this SELECT alone first to verify emails) ───
-- select id, email, created_at from auth.users order by created_at;

-- ─── STEP B — backfill every auth user that has no profile yet ────────
insert into public.profiles (id, full_name, role)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email),
  'customer'                       -- default; corrected below
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ─── Set the two known roles by email (edit emails if yours differ) ───
update public.profiles p
set role = 'admin', full_name = 'Divyanshu Sharma', initials = 'DS'
from auth.users u
where u.id = p.id
  and u.email = 'divyanshu.sharma@growwstacks.com';

update public.profiles p
set role = 'customer', full_name = 'Sarah Mitchell', initials = 'SM'
from auth.users u
where u.id = p.id
  and u.email = 'divyanshutest2@gmail.com';

-- ─── Verify ───────────────────────────────────────────────────────────
select p.id, u.email, p.role, p.full_name, p.initials
from public.profiles p
join auth.users u on u.id = p.id
order by p.role;
