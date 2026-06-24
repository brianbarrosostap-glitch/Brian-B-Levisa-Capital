-- =============================================================
-- Add two new users to the platform
--
-- New admin  : brianbarroso.stap@gmail.com
-- New customer: ruiz2215@gmail.com
--
-- Step 1 — Run this SQL in Supabase Dashboard → Authentication → Users
--           (or use the invite flow described below)
-- Step 2 — Send invite emails via Supabase Auth:
--           Dashboard → Authentication → Users → "Invite user"
--           Enter each email. Supabase sends a confirmation/magic-link
--           email. On first login they set their password.
-- Step 3 — Run the SQL block below so profiles + client ownership exist
--           before they log in (otherwise they see a blank portal).
-- =============================================================

-- ── Step A: create profiles once the auth users exist ──────────
-- Run this AFTER creating the two auth users in the Dashboard.
-- The upsert is safe to re-run.

do $$
declare
  v_new_admin_id    uuid;
  v_new_customer_id uuid;
  v_client_id       uuid;
begin

  -- Look up new users by email (must exist in auth.users first)
  select id into v_new_admin_id    from auth.users where email = 'brianbarroso.stap@gmail.com' limit 1;
  select id into v_new_customer_id from auth.users where email = 'ruiz2215@gmail.com'               limit 1;

  -- ── Admin profile ────────────────────────────────────────────
  if v_new_admin_id is not null then
    insert into public.profiles (id, role, full_name, initials)
    values (v_new_admin_id, 'admin', 'Brian Barroso', 'BB')
    on conflict (id) do update set
      role      = 'admin',
      full_name = excluded.full_name,
      initials  = excluded.initials;
    raise notice 'Admin profile created/updated for brianbarroso.stap@gmail.com';
  else
    raise notice 'SKIP: brianbarroso.stap@gmail.com not found in auth.users — create/invite them first.';
  end if;

  -- ── Customer profile + client link ──────────────────────────
  if v_new_customer_id is not null then
    insert into public.profiles (id, role, full_name, initials)
    values (v_new_customer_id, 'customer', 'RZR Inc', 'RZ')
    on conflict (id) do update set
      role      = 'customer',
      full_name = excluded.full_name,
      initials  = excluded.initials;

    -- Link to the existing RZR Inc client (so they see invoices immediately)
    select id into v_client_id from public.clients where name = 'RZR Inc' limit 1;

    if v_client_id is not null then
      update public.clients
      set owner_id = v_new_customer_id
      where id = v_client_id;
      raise notice 'Customer profile created and linked to RZR Inc client.';
    else
      raise notice 'WARNING: RZR Inc client not found — customer will see blank portal until a client row is linked.';
    end if;

  else
    raise notice 'SKIP: ruiz2215@gmail.com not found in auth.users — create/invite them first.';
  end if;

end;
$$ language plpgsql;

-- =============================================================
-- HOW TO SEND CONFIRMATION / INVITE EMAILS
-- =============================================================
-- Supabase does not expose auth.admin functions in plain SQL.
-- To send invite emails, use ONE of these methods:
--
-- Option A (Dashboard — easiest):
--   1. Go to Supabase Dashboard → Authentication → Users
--   2. Click "Invite user"
--   3. Enter brianbarroso.stap@gmail.com → Send invite
--   4. Enter ruiz2215@gmail.com              → Send invite
--   Supabase emails each user a magic link to set their password.
--   Then run the DO block above to create their profiles.
--
-- Option B (CLI — if you have supabase CLI + service role):
--   supabase auth invite --email brianbarroso.stap@gmail.com \
--     --project-ref fhmdtbvpjqftwsbdihcu
--   supabase auth invite --email ruiz2215@gmail.com \
--     --project-ref fhmdtbvpjqftwsbdihcu
-- =============================================================
