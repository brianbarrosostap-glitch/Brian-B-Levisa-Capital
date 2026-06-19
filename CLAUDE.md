# Levisa Capital — Invoice Factoring Platform

## What This Is

A full-stack invoice factoring web app for **Levisa Capital**. Clients submit invoices for cash advances; admins review, approve, and track them through a lifecycle with Ryder Systems as the debtor.

**Stack:** React + Vite (no TypeScript) · Supabase (auth + database + edge functions) · Lucide React icons · Inline styles (no Tailwind CSS classes for colors/spacing — use design tokens from `src/tokens.js`)

---

## ⚠️ OPERATIONAL NOTES — READ FIRST (added 2026-06-17)

These are non-obvious, hard-won facts. A fresh chat must read these before touching anything.

### Live Supabase project
- **The app's real project ref is `fhmdtbvpjqftwsbdihcu`** ("brianbarrosostap-glitch's Project"). `.env` (NOT `.env.local`) holds `VITE_SUPABASE_URL=https://fhmdtbvpjqftwsbdihcu.supabase.co`.
- The Supabase **MCP tools in this environment connect to a DIFFERENT project** (`WorkWitness` / `yzouxdikchgxlbitvzix`, an unrelated time-tracking app). So MCP `execute_sql` CANNOT reach the Levisa DB — the user runs SQL manually in the dashboard SQL Editor.
- If a migration errors `42P01 relation "public.invoices" does not exist` although it clearly exists, the cause is **wrong project selected in the SQL editor** (or a prior failed statement aborted the transaction), NOT a SQL bug. Confirm with `select to_regclass('public.invoices');` in a fresh editor tab on the right project.

### n8n owns ALL automation — DO NOT rebuild it (project charter)
n8n + Gemini handle every trigger/timer/email/file-watch/PDF/OCR/external-API. Claude's job is ONLY: DB schema, the endpoints n8n calls, and the UI. **Never** write a file watcher, email sender, PDF generator, cron/scheduler, polling loop, or webhook listener. If a task involves *sending/watching/waiting/calling an external API* (Gmail, Drive, Gemini, Docufree) → it's n8n's job; expose an endpoint instead and comment `// Called by n8n. Do not add trigger logic here.`

### Status enum — keep as-is
A generic charter once proposed a different status list (`Pending/Advance Approved/...`). **We deliberately kept the existing enum** (Uploaded → … → Paid) because the whole app + n8n already depend on it. Do not migrate the enum without explicit instruction.

### Auth bearer for ingest-* functions
The `ingest-*` functions verify the caller holds the **service_role** key. They now accept any valid `service_role` JWT (decode `role` claim) AND the exact injected key — robust to JWT-secret rotation. A 403 "service role required" from n8n almost always means the wrong key (anon vs service_role) or a stale deployed key (redeploy fixes it). Each function needs its own `deno.json` mapping `@supabase/supabase-js` → `npm:@supabase/supabase-js@2`, or it fails to bundle on deploy.

### Known data fixes (not code bugs)
- **Empty `profiles` → login `PGRST116` / blank admin UI.** The `on_auth_user_created` trigger only fires for NEW users; users created before it have no profile, so RLS (`current_user_role()`) returns null and the admin sees zero rows. Fix: run `supabase/migrations/BACKFILL_PROFILES.sql`.
- **Blank CUSTOMER UI (`clients?owner_id=eq... → 0 rows`).** A customer sees nothing unless a `clients` row has `owner_id = their auth.uid()`. The seed often fails to link this. Fix: `update public.clients set owner_id = (select id from auth.users where email='<customer>') where id in (select distinct client_id from public.invoices);`

### Migration gotchas
- A view selecting `i.*` cannot be updated with `create or replace` after adding table columns (error 42P16) — must `drop view ... cascade; create view ...`.
- `alter type ... add value` must run in its OWN statement/transaction before the value is used.

### UI conventions added 2026-06-18
- **Notifications:** `public.notifications` table + `trg_notify_status` trigger (fires on every `invoices.status` change — covers dashboard AND n8n/email). RLS role-scoped (admin all; customer only own client). Shared `src/components/NotificationBell.jsx` in both Topbars (polls every 20s). Migration: `20260618000001_notifications.sql`.
- **Active tab persists** via `localStorage` (`admin.page` / `customer.page`) — refresh stays on the same screen.
- **Sign Out** lives at the BOTTOM of the sidebar (rendered by `Shell` via `onSignOut` prop) — not in the nav list. Don't re-add inline Sign Out buttons in the App shells.
- **Responsive:** `useIsMobile()` hook in `ui.jsx`; `Shell` collapses the sidebar into a hamburger drawer < 760px; tables are wrapped in `overflow-x:auto`. Keep new tables wrapped.
- **Customer panel is Ryder-free:** `AdvancedInvoices`/`InvoicesToAdvance` must NOT show Advance@97%, Ryder/RZR confirmation, or advance-paid columns. Customer sees invoice #, amount, submitted, status, Drive link only.
- **Master nav badge** is the live unresolved `needs_attention` count (was hardcoded 7). The dead "Date Range" filter was removed.
- **`mark_advance_paid`** sets status to 'Advance Paid' ONLY (never auto-jumps to Paid). The InvoiceDetailModal "Mark Advance Paid" button + Master kebab both use it.

### Two-stage advance flow + 'Advance Agreed' (added 2026-06-18)
- **New status `Advance Agreed`** (enum, between Advance Confirmed and Advance Paid). Migration `20260618000002_advance_agreed_status.sql` (run the `alter type add value` line ALONE first). Lifecycle: `Payment Requested → (Brian approves) Advance Confirmed → (customer agrees to 97%) Advance Agreed → (Brian pays) Advance Paid → …`.
- **`agree-advance` edge function** (customer JWT) — customer accepts 97% on an `Advance Confirmed` invoice → `Advance Agreed` + notifies admin. Brian does NOT pay out until the customer has agreed. UI: "Agree to 97%" button on customer Advanced Invoices.
- **`approve-batch`** keeps invoices at `Advance Confirmed` (does not pay/raise anything) and notifies the customer to agree.
- **Customer never sees raw internal statuses or Ryder data.** `src/tokens.js` → `CUSTOMER_STATUS_LABEL` / `customerStatus()` maps statuses to friendly words (e.g. Payment Requested→"Submitted"). The 97% advance amount is shown ONLY after approval (status in the APPROVED list).

### Notifications are ROLE-TARGETED (changed 2026-06-18)
- The DB status-change trigger was DROPPED (`20260618000003_notifications_role_based.sql`). Notifications are now inserted by edge functions with an explicit `audience` ('admin' | 'customer') + `client_id`. `NotificationBell` takes a `role` prop and filters by audience; customer reads are further RLS-scoped to their own client. Do NOT re-add a blanket DB trigger.

### PO number (added 2026-06-18)
- **`invoices.po_number`** (text) — Purchase Order number printed on the invoice (e.g. "0245437560"). Migration `20260618000005_invoice_po_number.sql`. Extracted by n8n/Gemini and sent to `ingest-invoice` as `po_number`. Surfaced in admin Master table + InvoiceDetailModal and customer AdvancedInvoices.
- **Cheque→invoice direct ref:** `cheques.invoice_number` + `cheques.invoice_id` (FK) added (migration `20260618000004`). `ingest-check` accepts a single `invoice_number` (primary) plus the existing `invoice_numbers[]`; the join table `cheque_invoices` still handles multi-invoice cheques. Cheques tab shows an "Invoice #" column.

### Dashboard rebuilt — dynamic + date-filtered (2026-06-19)
- The admin Dashboard is fully data-driven (no static numbers). It no longer reads `v_kpi`; instead it calls SQL functions in migration `20260619000001_dashboard_metrics.sql`:
  - `dashboard_metrics(p_start, p_end)` → JSON of every tile (pipeline status, financial summary, operational metrics), filtered by **invoice_date** in range.
  - `dashboard_volume(p_start,p_end,p_grain)` and `dashboard_profit_trend(...)` → chart series.
  - `fn_factoring_rate()` → the **3% margin as a named function** (change it there to update Total Profit everywhere). Surfaced to the UI as `metrics.factoring_rate`.
- **Charts use Recharts** (`npm i recharts`, the only chart dep). Components in `src/pages/admin/DashboardCharts.jsx`: Volume (bar), Pipeline Breakdown (donut), Profit Trend (line), Overdue Aging buckets (bar). Overdue buckets are computed client-side from a live invoices query.
- **Shared date filter:** `src/hooks/useDateRange.js` (presets: This Month/Quarter/Last 6 Months/This Year/All Time + custom range). One `{start,end}` drives ALL queries so metrics never drift. Sticky `DateRangeBar` at top.
- **Labeling convention:** every tile/chart tags the party — **RZR** (customer we advance to), **Ryder** (debtor who pays Lavisa), **Lavisa** (our earnings). Keep this on any new metric.

### Other UI (2026-06-18)
- **Admin Audit Logs tab** — `src/pages/admin/AuditLogs.jsx` reads `v_audit_logs`. Admin nav: Dashboard / Master / Cheques / Audit Logs (the "Checks" tab is labelled **Cheques** now; internal route key is `cheques`).
- **Customer "remove" is UI-only and persisted** in `localStorage` (`customer.hiddenInvoices`) — stays hidden across refresh; never touches the DB.

---

## Project Structure

```
src/
  App.jsx                          # Root — auth listener, role-based routing
  tokens.js                        # Design tokens (ALL colors, shadows, badge colors)
  data.js                          # Legacy mock data — kept for reference, not used in production
  lib/
    supabase.js                    # Supabase client + callFunction() helper
  pages/
    Login.jsx                      # Single sign-in page (email + password)
    admin/
      AdminApp.jsx                 # Admin shell with sidebar nav
      Dashboard.jsx                # KPI cards + needs-attention panel
      Master.jsx                   # Invoice table + batch approval modal
      InvoiceDetailModal.jsx       # Full invoice detail + timeline + Confirmations section
      Checks.jsx                   # Admin Cheques screen (reads v_cheques)
    customer/
      CustomerApp.jsx              # Customer shell with sidebar nav
      InvoicesToAdvance.jsx        # Select invoices → submit advance request
      AdvancedInvoices.jsx         # Read-only view + RZR/Ryder Confirmed columns
  components/
    ui.jsx                         # All shared UI components (see list below)

supabase/
  config.toml                      # verify_jwt=false for all ingest-* functions
  migrations/
    STEP1_drop_and_recreate.sql    # USE THIS — drops orphaned types + creates all tables
    20260616000001_initial_schema.sql  # Clean schema (only safe on truly fresh DB)
    20260616000002_seed_data.sql   # Demo data (run AFTER creating auth users)
    BACKFILL_PROFILES.sql          # Fix empty profiles (login PGRST116 / blank admin UI)
    20260617000003_add_confirmation_columns.sql   # customer_/ryder_confirmed_at + v_invoices rebuild
    20260617000004_rename_checks_to_cheques.sql   # checks→cheques, check_invoices→cheque_invoices
    20260617000005_needs_attention_check_only.sql # nullable invoice_id + cheque_id + check_unmatched (run in 2 steps)
  functions/
    approve-batch/index.ts
    submit-advance-request/index.ts
    match-confirmation/index.ts
    mark-invoice-status/index.ts
    ingest-invoice/index.ts        # n8n → create invoice (each fn has its own deno.json)
    ingest-check/index.ts          # n8n → create cheque + match + alert
    ingest-confirmation/index.ts   # n8n → customer/ryder confirmation (NEW)

deploy-functions.ps1               # Windows: deploy edge functions (set PROJECT_REF=fhmdtbvpjqftwsbdihcu)
deploy-functions.sh                # Mac/Linux: deploy edge functions
SUPABASE_SETUP.md                  # Step-by-step Supabase setup guide
```

---

## Authentication

**Supabase native email+password auth only.** No custom auth, no JWT manipulation, no portal selector.

- Single `<Login />` page — calls `supabase.auth.signInWithPassword({ email, password })`
- `App.jsx` listens to `supabase.auth.onAuthStateChange` → fetches `profiles` row → reads `role`
- `role = 'admin'` → `<AdminApp />` | `role = 'customer'` → `<CustomerApp />`
- Sign out: `supabase.auth.signOut()` passed as `onSignOut` prop to both apps

**Demo users (must be created in Supabase Dashboard → Authentication → Users).**
NOTE: the live DB actually uses these emails (the originals in older docs were
placeholders). The seed file `20260616000002_seed_data.sql` matches by these:

| Email | Role | Name |
|---|---|---|
| divyanshu.sharma@growwstacks.com | admin | Divyanshu Sharma |
| divyanshutest2@gmail.com | customer | Sarah Mitchell / RZR Inc |

(A second admin `brian@levisacapital.com` also exists in auth.) After creating
auth users, run `BACKFILL_PROFILES.sql` so each gets a `profiles` row, and make
sure the customer owns a `clients` row (see Operational Notes → Known data fixes).

---

## Environment Variables

File: `.env` (this repo currently uses `.env`, not `.env.local` — Vite reads both).
Never commit real keys. The live values point at project **`fhmdtbvpjqftwsbdihcu`**:

```
VITE_SUPABASE_URL=https://fhmdtbvpjqftwsbdihcu.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...    # anon/public key ONLY — never the service_role key
```

Get both from: **Supabase Dashboard → Project Settings → API**.
The **service_role** key is used only server-side by n8n when calling `ingest-*`
functions — never put it in any frontend env file.

---

## Design System

**All colors come from `src/tokens.js` — never hardcode hex values, always import `C`.**

```js
import { C, shadow, shadowMd, STATUS_COLOURS, ROW_BG } from '../tokens'
```

Key tokens:
- `C.primary` = `#007953` (green — brand color)
- `C.sidebar` = `#072418` (dark green sidebar background)
- `C.bg` = `#f2f5f8` (page background)
- `C.border` = `#dde4ec` | `C.borderMd` = `#c4cdd8`
- `C.text` = `#0d1b14` | `C.textSm` = `#4a6070` | `C.textMut` = `#8fa3b0`
- `C.red` / `C.redLt` / `C.amber` / `C.amberLt` / `C.info` / `C.infoLt`

`STATUS_COLOURS` maps every invoice status string to `{ bg, text }` for badges.
`ROW_BG` maps statuses to row highlight background colors.

**No Tailwind color or spacing classes.** All layout uses inline `style={{}}` props.

---

## Shared UI Components (`src/components/ui.jsx`)

```
Shell          — full-page layout wrapper with sidebar
Topbar         — top navigation bar with breadcrumb + user avatar
PageContent    — main content area with padding
Card           — white card with border + shadow (prop: noPad)
Btn            — button (variants: primary|secondary|ghost|danger|outline|subtle; size: default|sm)
Badge          — colored status pill using STATUS_COLOURS
Field          — label/value display block (props: accent, red, mono)
TH             — table header cell
TD             — table data cell
Modal          — centered overlay modal (prop: onClose, width)
ModalBody      — modal content area
ModalFooter    — modal footer with action buttons
Tabs           — tab navigation (props: tabs, active, onChange)
SearchBar      — search input with icon
FilterChip     — filter toggle pill
KebabMenu      — three-dot dropdown menu
TimelineStep   — single row in invoice timeline (icon, label, date, note)
```

---

## Database Schema

### Tables

| Table | Purpose |
|---|---|
| `profiles` | Extends `auth.users`. Columns: `id` (FK → auth.users), `role` (enum), `full_name`, `initials` |
| `clients` | One per customer company. Has `owner_id` → `profiles.id` for RLS |
| `batches` | One advance request = one batch. Has `request_number` (REQ-YYYY-NNN format) |
| `invoices` | Central fact table. `advance_amount` and `factoring_fee` are **generated/computed columns**. **Drive:** `drive_file_id` + `drive_file_url` point at the invoice PDF in the INVOICES Drive folder. **Confirmation columns (added 2026-06-17):** `customer_confirmed_at`, `customer_conf_email` (RZR confirms post-approval), `ryder_confirmed_at` (Ryder confirms post-payment; pairs with existing `ryder_conf_number`) |
| `invoice_timeline` | Append-only status log. Written automatically by DB trigger on `invoices.status` change (status + invoice only) |
| `needs_attention` | Admin alerts. **`invoice_id` is NULLABLE (2026-06-17)** + has `cheque_id` so a CHEQUE that couldn't be matched can raise a check-only alert. Constraint: must anchor to an invoice OR a cheque. Types: `conf_match`, `check_unreadable`, `check_unmatched`, `overdue` |
| `cheques` | **(Renamed from `checks` on 2026-06-17.)** One row per file in the CHECKS Drive folder (payment proof from Ryder). Columns KEPT their names: `check_number`, `amount`, `ryder_conf_number`, `drive_file_id`/`drive_file_url`, `status` (`check_status`: unmatched/matched/unreadable) |
| `cheque_invoices` | **(Renamed from `check_invoices`.)** Join table: which invoice(s) a cheque pays. PK `(cheque_id, invoice_id)` — FK col renamed `check_id` → `cheque_id` |
| `audit_logs` | **Comprehensive append-only audit trail** — who did what, when, on which row, across all core tables. Written by a generic DB trigger (auto safety net, before/after JSON) **and** by edge functions (rich rows with the real human actor + note) |

### Google Drive flow (two folders)
- **Invoices folder** → invoice PDFs. Your external automation drops a file, then calls the **`ingest-invoice`** edge function, which inserts/updates the `invoices` row and stores `drive_file_id` + `drive_file_url`. **Both** admin and customer portals link to the PDF via `drive_file_url`.
- **Checks folder** → payment-proof from Ryder. Automation calls **`ingest-check`**, which inserts a **`cheques`** row, auto-matches to invoice(s) by `invoice_number` (→ **`cheque_invoices`**), advances matched invoices (Submitted to Ryder → Acknowledged → Paid), and records the Drive link. If it can't match, it now inserts a **check-only `needs_attention` alert** (anchored to `cheque_id`). Customers can read cheques tied to their own invoices.
- **Where the Drive data lives:** invoice files → `invoices.drive_file_id/url`; cheque files → `cheques.drive_file_id/url`. Nothing else stores Drive handles.

### Views
- `v_kpi` — aggregated KPI numbers used by the admin Dashboard. `overdue_60` computes "days out" live from `ryder_submitted_at`
- `v_invoices` — `invoices.*` plus a live-computed `ryder_days_out` column
- `v_audit_logs` — `audit_logs` newest-first, joined to `profiles` for a readable `actor_name`. Use this for the admin audit-log screen
- `v_cheques` — **(renamed from `v_checks`)** each cheque plus a comma-separated list of the invoice numbers it pays. Use this for the admin Checks screen (`Checks.jsx`)

### Enum Types
```sql
invoice_status: Uploaded | Eligible | Payment Requested | Ready for Payment |
                Advance Confirmed | Advance Paid | Submitted to Ryder |
                Acknowledged | Resubmitted | Paid | Void | Cancelled

batch_status:   Pending | Approved | Rejected | Partially Approved

user_role:      admin | customer

attention_type: conf_match | check_unreadable | check_unmatched | overdue   -- check_unmatched added 2026-06-17

audit_action:   insert | update | delete | status_change

check_status:   unmatched | matched | unreadable   -- enum name kept as check_status (table is `cheques`)
```

### Generated Columns (do NOT try to insert into these)
- `invoices.advance_amount` = `round(invoice_amount * advance_rate, 2)`
- `invoices.factoring_fee` = `round(invoice_amount * (1 - advance_rate), 2)`

> ⚠️ `ryder_days_out` is **NOT** a generated column. Postgres forbids `now()` in a stored generated expression (not immutable). "Days out" is computed live in `v_invoices` / `v_kpi` and via a frontend fallback. Do not re-add it as `generated always as (... now() ...)` — it will break the whole schema.

### Key Triggers
- `on_auth_user_created` — auto-creates a `profiles` row when a new auth user signs up
- `trg_invoice_status_log` — writes to `invoice_timeline` every time `invoices.status` changes
- `trg_audit_*` (`record_audit_log`) — generic audit trigger on `invoices`, `batches`, `clients`, `needs_attention`; logs every insert/update/delete to `audit_logs` with before/after JSON. Service-role writes have no `auth.uid()`, so these rows have `actor_id = null` (`source = 'trigger'`) — the edge function then writes its own row with the real actor (`source = '<function-name>'`)
- `set_updated_at` — updates `updated_at` on all tables before each UPDATE

### RLS
All tables have Row-Level Security enabled. Admins have full access to everything. Customers can only see data belonging to their `clients.owner_id`. Edge functions use the **service role key** to bypass RLS for writes.

---

## Edge Functions

All functions live in `supabase/functions/`. The **user-facing** ones (first four):
1. Read the JWT from `Authorization` header
2. Fetch the caller's profile to verify role (admin or customer)
3. Use the **service role key** (`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`) for DB writes to bypass RLS

The **machine ingest** ones (`ingest-*`) are called server-side by the n8n/Drive automation with the service-role key as the bearer token; they have `verify_jwt = false` in `config.toml`. Their auth check (`isServiceRole`) accepts the exact injected `SUPABASE_SERVICE_ROLE_KEY` **or** any JWT whose `role` claim is `service_role` (robust to JWT-secret rotation). Each ingest function needs its own `deno.json` (import map) or it won't bundle on deploy.

| Function | Caller | What it does |
|---|---|---|
| `approve-batch` | admin | Reviews a batch — marks approved invoices as "Advance Confirmed", excluded ones as "Eligible", updates batch status |
| `submit-advance-request` | customer | Creates a new batch with REQ-YYYY-NNN number, links invoices, sets status to "Payment Requested" |
| `match-confirmation` | admin | Links `ryder_conf_number` or `check_number` to invoice, advances status (Submitted→Acknowledged, or →Paid), marks `needs_attention` resolved (admin-triggered, needs a `needs_attention` row) |
| `mark-invoice-status` | admin | General status override. Actions: `mark_paid_override`, `set_void`, `mark_ryder_paid`, `resubmit`, `mark_advance_paid` |
| `ingest-invoice` | n8n (service role) | Invoice PDF dropped in the INVOICES folder → upsert `invoices` row + store `drive_file_id`/`drive_file_url`. Body unchanged by recent edits. |
| `ingest-check` | n8n (service role) | Cheque file dropped in the CHECKS folder → create `cheques` row, auto-match to invoice(s) by `invoice_number`, link via `cheque_invoices`, advance matched invoices. **If unmatched/unreadable → inserts a check-only `needs_attention` alert.** Body unchanged. |
| `ingest-confirmation` | n8n (service role) | **NEW (2026-06-17).** Records the two email-driven confirmations. Body: `{ kind: "customer"|"ryder", invoice_number, conf_number?, conf_email?, confirmed_at? }`. Matches invoice **by `invoice_number` only**. `kind:customer` → stamps `customer_confirmed_at`. `kind:ryder` → stamps `ryder_confirmed_at` + `ryder_conf_number`, advances `Submitted to Ryder → Acknowledged`. `confirmed_at` optional (defaults to now). |

**Invoking from React:**
```js
import { callFunction } from '../../lib/supabase'
await callFunction('approve-batch', { batch_id, approved_ids, excluded_ids })
```

---

## Running the App

```bash
npm install
npm run dev        # http://localhost:5173
```

Fill in `.env.local` before starting.

---

## Supabase Setup Order (IMPORTANT — do in this exact order)

1. **Run cleanup SQL** (only needed if previous migration partially ran — types exist but no tables):
   ```sql
   drop type if exists public.invoice_status  cascade;
   drop type if exists public.batch_status    cascade;
   drop type if exists public.user_role       cascade;
   drop type if exists public.attention_type  cascade;
   ```

2. **Run schema** — paste `supabase/migrations/STEP1_drop_and_recreate.sql` into SQL Editor

3. **Create auth users** in Dashboard → Authentication → Users:
   - `brian@levisacapital.com` (will be set to `role = admin` by seed)
   - `sarah@rzrinc.com` (will be set to `role = customer` by seed)

4. **Run seed data** — paste `supabase/migrations/20260616000002_seed_data.sql` into SQL Editor

5. **Deploy edge functions** — edit `deploy-functions.ps1`, set your `PROJECT_REF`, then run:
   ```powershell
   .\deploy-functions.ps1
   ```

---

## Invoice Status Lifecycle

```
Uploaded → Eligible → Payment Requested → Advance Confirmed → Advance Paid
                                                            → Submitted to Ryder → Acknowledged → Paid
                                                                                 → Resubmitted → Acknowledged → Paid
```

- **Customer actions:** submit advance request (Uploaded/Eligible → Payment Requested)
- **Admin actions:** approve batch, mark advance paid, submit to Ryder, match confirmation, mark paid
- Void/Cancelled are terminal states (admin only)

---

## Key Patterns & Conventions

- **No TypeScript** — plain `.jsx` and `.js` throughout
- **No Tailwind** — all styles are inline `style={{}}` using tokens from `src/tokens.js`
- **No custom auth** — only `supabase.auth.signInWithPassword` and `supabase.auth.signOut`
- **Edge functions for all writes that bypass RLS** — the React app only does reads via the anon key; mutations go through edge functions with the service role key
- **`callFunction(name, body)`** in `src/lib/supabase.js` is the only way to call edge functions from the frontend
- **`profiles` table drives routing** — after login, `App.jsx` reads `profiles.role` to decide which portal to show
- Lucide React is the icon library — import individual icons by name
- Font: Inter (loaded via index.css or system fallback)
