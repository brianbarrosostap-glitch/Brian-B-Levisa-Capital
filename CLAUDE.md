# Levisa Capital — Invoice Factoring Platform

## What This Is

A full-stack invoice factoring web app for **Levisa Capital**. Clients submit invoices for cash advances; admins review, approve, and track them through a lifecycle with Ryder Systems as the debtor.

**Stack:** React + Vite (no TypeScript) · Supabase (auth + database + edge functions) · Lucide React icons · Inline styles (no Tailwind CSS classes for colors/spacing — use design tokens from `src/tokens.js`)

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
      InvoiceDetailModal.jsx       # Full invoice detail + timeline + action buttons
    customer/
      CustomerApp.jsx              # Customer shell with sidebar nav
      InvoicesToAdvance.jsx        # Select invoices → submit advance request
      AdvancedInvoices.jsx         # Read-only view of submitted/processed invoices
  components/
    ui.jsx                         # All shared UI components (see list below)

supabase/
  config.toml
  migrations/
    STEP1_drop_and_recreate.sql    # USE THIS — drops orphaned types + creates all tables
    20260616000001_initial_schema.sql  # Clean schema (only safe on truly fresh DB)
    20260616000002_seed_data.sql   # Demo data (run AFTER creating auth users)
  functions/
    approve-batch/index.ts
    submit-advance-request/index.ts
    match-confirmation/index.ts
    mark-invoice-status/index.ts

deploy-functions.ps1               # Windows: deploy all 4 edge functions
deploy-functions.sh                # Mac/Linux: deploy all 4 edge functions
SUPABASE_SETUP.md                  # Step-by-step Supabase setup guide
```

---

## Authentication

**Supabase native email+password auth only.** No custom auth, no JWT manipulation, no portal selector.

- Single `<Login />` page — calls `supabase.auth.signInWithPassword({ email, password })`
- `App.jsx` listens to `supabase.auth.onAuthStateChange` → fetches `profiles` row → reads `role`
- `role = 'admin'` → `<AdminApp />` | `role = 'customer'` → `<CustomerApp />`
- Sign out: `supabase.auth.signOut()` passed as `onSignOut` prop to both apps

**Demo users (must be created in Supabase Dashboard → Authentication → Users):**

| Email | Role | Name |
|---|---|---|
| brian@levisacapital.com | admin | Brian Levisa |
| sarah@rzrinc.com | customer | Sarah Mitchell / RZR Inc |

---

## Environment Variables

File: `.env.local` (root of project — never commit this)

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Get both from: **Supabase Dashboard → Project Settings → API**

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
| `invoices` | Central fact table. `advance_amount` and `factoring_fee` are **generated/computed columns**. **Drive:** `drive_file_id` + `drive_file_url` point at the invoice PDF in the INVOICES Drive folder |
| `invoice_timeline` | Append-only status log. Written automatically by DB trigger on `invoices.status` change (status + invoice only) |
| `needs_attention` | Admin alerts: unmatched conf numbers, unreadable checks, overdue |
| `checks` | One row per file in the CHECKS Drive folder (payment proof from Ryder). Columns: `check_number`, `amount`, `ryder_conf_number`, `drive_file_id`/`drive_file_url`, `status` (unmatched/matched/unreadable) |
| `check_invoices` | Join table: which invoice(s) a check pays (a check can cover many invoices). PK `(check_id, invoice_id)` |
| `audit_logs` | **Comprehensive append-only audit trail** — who did what, when, on which row, across all core tables. Written by a generic DB trigger (auto safety net, before/after JSON) **and** by edge functions (rich rows with the real human actor + note) |

### Google Drive flow (two folders)
- **Invoices folder** → invoice PDFs. Your external automation drops a file, then calls the **`ingest-invoice`** edge function, which inserts/updates the `invoices` row and stores `drive_file_id` + `drive_file_url`. **Both** admin and customer portals link to the PDF via `drive_file_url`.
- **Checks folder** → payment-proof from Ryder. Automation calls **`ingest-check`**, which inserts a `checks` row, auto-matches to invoice(s) by `invoice_number` (→ `check_invoices`), advances matched invoices (Submitted to Ryder → Acknowledged → Paid), and records the Drive link. Customers can read checks tied to their own invoices.
- **Where the Drive data lives:** invoice files → `invoices.drive_file_id/url`; check files → `checks.drive_file_id/url`. Nothing else stores Drive handles.

### Views
- `v_kpi` — aggregated KPI numbers used by the admin Dashboard. `overdue_60` computes "days out" live from `ryder_submitted_at`
- `v_invoices` — `invoices.*` plus a live-computed `ryder_days_out` column
- `v_audit_logs` — `audit_logs` newest-first, joined to `profiles` for a readable `actor_name`. Use this for the admin audit-log screen
- `v_checks` — each check plus a comma-separated list of the invoice numbers it pays. Use this for the admin Checks screen

### Enum Types
```sql
invoice_status: Uploaded | Eligible | Payment Requested | Ready for Payment |
                Advance Confirmed | Advance Paid | Submitted to Ryder |
                Acknowledged | Resubmitted | Paid | Void | Cancelled

batch_status:   Pending | Approved | Rejected | Partially Approved

user_role:      admin | customer

attention_type: conf_match | check_unreadable | overdue

audit_action:   insert | update | delete | status_change

check_status:   unmatched | matched | unreadable
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

The **machine ingest** ones (`ingest-*`) are called server-side by the Drive automation with the service-role key as the bearer token; they have `verify_jwt = false` in `config.toml` and verify the bearer equals the service key.

| Function | Caller | What it does |
|---|---|---|
| `approve-batch` | admin | Reviews a batch — marks approved invoices as "Advance Confirmed", excluded ones as "Eligible", updates batch status |
| `submit-advance-request` | customer | Creates a new batch with REQ-YYYY-NNN number, links invoices, sets status to "Payment Requested" |
| `match-confirmation` | admin | Links `ryder_conf_number` or `check_number` to invoice, advances status (Submitted→Acknowledged, or →Paid), marks `needs_attention` resolved |
| `mark-invoice-status` | admin | General status override. Actions: `mark_paid_override`, `set_void`, `mark_ryder_paid`, `resubmit`, `mark_advance_paid` |
| `ingest-invoice` | Drive automation (service role) | Invoice PDF dropped in the INVOICES folder → upsert `invoices` row + store `drive_file_id`/`drive_file_url` |
| `ingest-check` | Drive automation (service role) | Check file dropped in the CHECKS folder → create `checks` row, auto-match to invoice(s) by `invoice_number`, link via `check_invoices`, advance matched invoices |

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
