-- =============================================================
-- Levisa Capital — Seed Data
-- Run this AFTER:
--   1. Running 20260616000001_initial_schema.sql
--   2. Creating auth users in Dashboard → Authentication → Users:
--        brian@levisacapital.com  (any password)
--        sarah@rzrinc.com         (any password)
-- =============================================================

do $$
declare
  v_admin_id    uuid;
  v_customer_id uuid;
  v_client_id   uuid;
  v_batch_id    uuid;
begin

  -- Look up the auth user IDs by email
  select id into v_admin_id    from auth.users where email = 'brian@levisacapital.com' limit 1;
  select id into v_customer_id from auth.users where email = 'sarah@rzrinc.com'        limit 1;

  if v_admin_id is null then
    raise exception 'brian@levisacapital.com not found in auth.users — create the user first.';
  end if;

  if v_customer_id is null then
    raise exception 'sarah@rzrinc.com not found in auth.users — create the user first.';
  end if;

  -- ── Profiles (set roles) ────────────────────────────────────
  insert into public.profiles (id, role, full_name, initials)
  values
    (v_admin_id,    'admin',    'Brian Levisa',   'BL'),
    (v_customer_id, 'customer', 'Sarah Mitchell', 'SM')
  on conflict (id) do update set
    role      = excluded.role,
    full_name = excluded.full_name,
    initials  = excluded.initials;

  -- ── Client ──────────────────────────────────────────────────
  insert into public.clients
    (name, debtor, contact_name, contact_email, factoring_rate, advance_rate, owner_id)
  values
    ('RZR Inc', 'Ryder Systems', 'Sarah Mitchell', 'sarah@rzrinc.com', 0.03, 0.97, v_customer_id)
  on conflict (name) do update set owner_id = excluded.owner_id
  returning id into v_client_id;

  -- If on conflict branch ran, returning gives null — look it up
  if v_client_id is null then
    select id into v_client_id from public.clients where name = 'RZR Inc';
  end if;

  -- ── Invoices ────────────────────────────────────────────────
  insert into public.invoices
    (invoice_number, unit_number, client_id,
     invoice_date, due_date, invoice_amount, advance_rate, status,
     ryder_submitted_at, ryder_conf_number, ryder_paid_at,
     submitted_at, confirmed_at, advance_paid_at, paid_at)
  values
    -- Paid (oldest)
    ('2215-5964', '248773', v_client_id,
     '2025-10-10', '2026-01-10', 2082.17, 0.97, 'Paid',
     '2025-10-12 09:00:00+00', '10041100', '2026-01-05 00:00:00+00',
     '2025-10-10 10:22:00+00', '2025-10-11 00:00:00+00', '2025-10-12 00:00:00+00', '2026-01-05 00:00:00+00'),

    -- Resubmitted
    ('2715-6407', '777769', v_client_id,
     '2025-12-05', null, 1897.41, 0.97, 'Resubmitted',
     null, null, null,
     '2025-12-05 00:00:00+00', null, null, null),

    -- Acknowledged (has unmatched conf#)
    ('2215-6030', '785737', v_client_id,
     '2025-11-20', null, 521.22, 0.97, 'Acknowledged',
     '2025-11-22 00:00:00+00', null, null,
     '2025-11-20 00:00:00+00', '2025-11-21 00:00:00+00', '2025-11-22 00:00:00+00', null),

    -- Submitted to Ryder
    ('2715-6315', '234019', v_client_id,
     '2026-02-21', null, 922.32, 0.97, 'Submitted to Ryder',
     '2026-02-23 11:30:00+00', null, null,
     '2026-02-21 11:30:00+00', '2026-02-22 00:00:00+00', '2026-02-23 00:00:00+00', null),

    -- Acknowledged (invoice detail example)
    ('2215-7002', '501338', v_client_id,
     '2026-03-15', '2026-04-29', 1450.00, 0.97, 'Acknowledged',
     '2026-03-15 00:00:00+00', '10040022', null,
     '2026-03-13 00:00:00+00', '2026-03-13 00:00:00+00', '2026-03-13 00:00:00+00', null),

    -- Advance Paid (has unreadable check)
    ('2215-7055', '678912', v_client_id,
     '2026-05-01', null, 3200.00, 0.97, 'Advance Paid',
     null, null, null,
     '2026-05-01 09:14:00+00', '2026-05-01 00:00:00+00', '2026-05-01 00:00:00+00', null),

    -- Payment Requested — part of batch REQ-2026-014
    ('2215-7102', '312450', v_client_id,
     '2026-05-28', null, 3150.00, 0.97, 'Payment Requested',
     null, null, null, null, null, null, null),

    -- Payment Requested — part of batch REQ-2026-014
    ('2215-7108', '398221', v_client_id,
     '2026-05-30', null, 1820.75, 0.97, 'Payment Requested',
     null, null, null, null, null, null, null)

  on conflict (invoice_number) do nothing;

  -- ── Batch ───────────────────────────────────────────────────
  insert into public.batches (request_number, client_id, status, submitted_at)
  values ('REQ-2026-014', v_client_id, 'Pending', '2026-06-05 08:14:00+00')
  on conflict (request_number) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select id into v_batch_id from public.batches where request_number = 'REQ-2026-014';
  end if;

  -- Link the two pending invoices to the batch
  update public.invoices
  set batch_id = v_batch_id
  where invoice_number in ('2215-7102', '2215-7108');

  -- ── Needs Attention ─────────────────────────────────────────
  -- Unmatched Ryder confirmation number
  insert into public.needs_attention
    (invoice_id, type, title, detail, action_label, ryder_conf_number, ryder_amount)
  select
    i.id, 'conf_match',
    'Confirmation Number Match',
    'Invoice 2215-6030 — Ryder email (conf. #11042301) could not be auto-matched to this invoice.',
    'Match Now', '11042301', 521.22
  from public.invoices i
  where i.invoice_number = '2215-6030'
  on conflict do nothing;

  -- Unreadable check scan
  insert into public.needs_attention
    (invoice_id, type, title, detail, action_label, check_number)
  select
    i.id, 'check_unreadable',
    'Check Unreadable',
    'Invoice 2215-7055 — Check #4471 scanned but invoice ID is unreadable.',
    'Enter Manually', '4471'
  from public.invoices i
  where i.invoice_number = '2215-7055'
  on conflict do nothing;

  raise notice 'Seed data inserted successfully.';
end;
$$ language plpgsql;
