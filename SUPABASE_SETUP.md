# Levisa Capital — Supabase Setup Guide

## Step 1 — Create your Supabase project

1. Go to https://supabase.com → New Project
2. Name it `levisa-capital`
3. Choose a region close to you
4. Save the database password somewhere safe

---

## Step 2 — Run the migration

1. In Supabase Dashboard → **SQL Editor** → **New query**
2. Open `supabase/migrations/20260616000001_initial_schema.sql`
3. Paste the entire file and click **Run**

This creates:
- `profiles` — extends auth.users with role (admin/customer)
- `clients` — customer companies
- `invoices` — all invoice records (with computed advance_amount, factoring_fee)
- `batches` — advance requests
- `invoice_timeline` — immutable status history
- `needs_attention` — manual review queue
- RLS policies on every table
- Auto-updated_at triggers
- `v_kpi` view for the dashboard

---

## Step 3 — Create auth users

In Supabase Dashboard → **Authentication** → **Users** → **Add user** (manual):

| Full Name       | Email                      | Password        | Role   |
|----------------|---------------------------|----------------|--------|
| Brian Levisa   | brian@levisacapital.com   | (your choice)  | admin  |
| Sarah Mitchell | sarah@rzrinc.com          | (your choice)  | customer |

After creating, the `handle_new_user` trigger auto-creates a `profiles` row.
Then go to **SQL Editor** and run this to set roles:

```sql
-- Set Brian as admin
UPDATE public.profiles
SET role = 'admin', full_name = 'Brian Levisa', initials = 'BL'
WHERE id = (SELECT id FROM auth.users WHERE email = 'brian@levisacapital.com');

-- Set Sarah as customer
UPDATE public.profiles
SET role = 'customer', full_name = 'Sarah Mitchell', initials = 'SM'
WHERE id = (SELECT id FROM auth.users WHERE email = 'sarah@rzrinc.com');
```

---

## Step 4 — Run seed data

After both auth users exist, re-run the migration OR paste just the `DO $$ ... $$` block at
the bottom of the migration file into the SQL Editor. It will insert:
- RZR Inc client linked to Sarah's account
- 8 sample invoices in various statuses
- 1 pending batch (REQ-2026-014)
- 2 needs-attention alerts

---

## Step 5 — Deploy Edge Functions

Install the Supabase CLI first:
```bash
npm install -g supabase
```

Then link your project:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy all 4 functions:
```bash
supabase functions deploy approve-batch
supabase functions deploy submit-advance-request
supabase functions deploy match-confirmation
supabase functions deploy mark-invoice-status
```

Your project ref is in: Dashboard → Project Settings → General → Reference ID

---

## Step 6 — Configure .env.local

Copy values from: Dashboard → **Project Settings** → **API**

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## Step 7 — Run the app

```bash
npm run dev
```

Open http://localhost:5173

Sign in as:
- **Brian Levisa** (brian@levisacapital.com) → Admin Portal
- **Sarah Mitchell** (sarah@rzrinc.com) → Client Portal

---

## Edge Function Summary

| Function | Called by | What it does |
|---|---|---|
| `submit-advance-request` | Customer | Creates a batch + sets invoices to "Payment Requested" |
| `approve-batch` | Admin | Approves/rejects a batch, updates invoice statuses |
| `match-confirmation` | Admin | Links a Ryder conf# or check# to an invoice, resolves the alert |
| `mark-invoice-status` | Admin | General status override (Void, Paid, Resubmit, etc.) |

All functions:
- Validate the caller's JWT via `supabase.auth.getUser()`
- Check the caller's role from `profiles`
- Use the service-role key for writes (so DB triggers fire cleanly)
- Return `{ success: true, ... }` or `{ error: "..." }` with appropriate HTTP status

---

## Table Reference

```
profiles          id (uuid FK→auth.users), role, full_name, initials
clients           id, name, debtor, contact_name, contact_email, factoring_rate, advance_rate, owner_id
invoices          id, invoice_number, unit_number, client_id, invoice_date, due_date,
                  invoice_amount, advance_rate, advance_amount*, factoring_fee*,
                  status, batch_id, ryder_*, submitted_at, confirmed_at, advance_paid_at, paid_at
batches           id, request_number, client_id, status, submitted_at, reviewed_at, reviewed_by
invoice_timeline  id, invoice_id, status, occurred_at, actor_id, note
needs_attention   id, invoice_id, type, title, detail, resolved, ryder_conf_number, check_number

* computed/generated columns
```
