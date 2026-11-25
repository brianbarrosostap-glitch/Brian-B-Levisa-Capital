# Go-live runbook — portal automation (replaces n8n)

Prepared 2026-11-24. Do this **after** the 3–4 days of testing on the `develop` preview.
PROD = Supabase `fhmdtbvpjqftwsbdihcu` · DEV = `zwvjkhtehkpdjjrfyhhv`.
n8n keeps running until each step below switches it off — never run an n8n workflow and its portal job at the same time.
The job switches ("Automation `<job>` = …" below) are in the collapsed **Advanced — automation switches** card at the bottom of the Automation tab.

## 0. Before you start
- [ ] Preview testing signed off (uploads, cheques, advance request → reply → paid → Ryder (kapil) → resubmit, deleted/restore, Automation tab).
- [ ] Rotate the keys that appeared in the n8n exports / chat: Supabase **service_role** key (update n8n credentials if anything still uses it) and the **Composio API key**.
- [ ] Pick a quiet time (no advance requests in flight).

## 1. PROD function secrets (Dashboard → Edge Functions → Secrets)
Set: `SMTP_USER`, `SMTP_PASS`, `COMPOSIO_API_KEY`, `COMPOSIO_USER_ID`, `COMPOSIO_GMAIL_ACCOUNT_ID`, `COMPOSIO_DRIVE_ACCOUNT_ID`, `COMPOSIO_SHEETS_ACCOUNT_ID`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-2.5-flash`, `DOC_CONVERT_URL`, `DOC_DOWNLOADER_URL`, `INTERNAL_SECRET` (**new** random 40 chars — not the dev one).
**Do NOT set** `EMAIL_ALLOWED_DOMAINS`, `EMAIL_REDIRECT_TO`, `DISABLE_N8N_WEBHOOKS` (dev-only).

## 2. PROD database (SQL editor, in this order)
1. `20260617000005_needs_attention_check_only.sql` — run the `alter type … add value` line **alone first**, then the rest. (Never applied to prod before.)
2. `20261124000001_email_outbox.sql` — settings default to the real addresses (hugo@rzrinc.net, ryderap.invoices@godocufree.com, brianbarroso.stap@gmail.com, subject "Payment Request for"); every job except `send_emails` starts **off**.
3. `20261124000003_deleted_invoices.sql`
4. `20261124000004_documents_storage.sql`
5. `20261124000005_restore_invoice.sql`
6. `20261124000007_fix_po_letter_o.sql` (fixes the 249 "O…" PO numbers)
7. Vault secrets:
   ```sql
   select vault.create_secret('https://fhmdtbvpjqftwsbdihcu.supabase.co', 'project_url');
   select vault.create_secret('<the PROD INTERNAL_SECRET>', 'internal_secret');
   ```
8. `20261124000002_cron_send_emails.sql`, then `20261124000006_cron_scheduler_mailbox.sql`
   (jobs are off in `app_settings`, so the schedules do nothing yet).
9. `20261125000001_connections.sql` (Connections tab: `connection_status`, `cron_status()`, hourly `check-connections` timer).

## 3. Deploy + switch the two webhook flows (same 10 minutes)
- [ ] `.\deploy-functions.ps1 -Target prod` (types PROD to confirm).
      From this moment `submit-advance-request` emails RZR itself and `delete-invoice` archives itself.
- [ ] n8n: deactivate **Send Confirmation Mail for Requested Amount to Customer** and **Removed Invoices Move To Removed Invoices By RZR**.
- [ ] Merge `develop` → `main` → Vercel production build. Check the live site loads and the new tabs appear.
- [ ] Connections tab → **Check now**: all 8 should be green (SMTP, Gemini, Composio Gmail/Drive/Sheets, both PDF services, timers). Fix any red card before going on.

## 4. Uploads instead of Drive folders
- [ ] n8n: deactivate **Invoices Drive to Supabase** and **Cheques to Supabase and Drive Folders**.
- [ ] Tell RZR to upload invoices in the portal (Upload invoice / My Uploads) instead of the Drive folder.

## 5. Mailbox (RZR replies + Ryder confirmations)
- [ ] n8n: deactivate **Reply Confirmation for Advance Agreed Invoice by Customer** and **Recieved Invoice Confirmation from Ryder # via Email**.
- [ ] PROD `app_settings`: **no** `mailbox_never_mark_read_from` row (that is DEV-only — it stops DEV marking Docufree emails read while n8n shares the mailbox). `mailbox_mark_read` absent or `["rzr_reply","ryder_confirmation"]`; Automation → Settings → *Ryder confirmation senders* = `workflow@docufree.com` only (DEV also lists test addresses).
- [ ] Automation tab → `poll_mailbox` = **dry_run**, wait 5 min, check the Mailbox log (it reads UNREAD emails from the last 7 days only — n8n marked the ones it handled as read).
- [ ] `poll_mailbox` = **live**. From now on each handled email is marked read in Gmail (as n8n did).

## 6. Timed jobs
- [ ] n8n: deactivate **After 12 hour invoice Status Advance Paid** → Automation `auto_advance_paid` = **live**.
- [ ] n8n: deactivate **Send Invoice to Ryder on change of status as Advance Paid**, then in n8n → Executions **stop every "waiting" execution** of it (its 7-day Wait would otherwise still send later).
- [ ] Supabase PROD → Database → Webhooks: **delete** "Send Invoice to Ryder on change of status as Advance Paid" and "Advance Invoice Requested By RzR".
- [ ] Automation `submit_to_ryder` = **dry_run** → Job runs shows what is due.
      ⚠️ **Decision:** the 8 invoices that n8n never sent (Advance Paid > 7 days: 22157055, 22157022, 22157067, 22157062, 22157049, 22157074, 22157064, 22157059 — as of 2026-11-24) will be emailed to Ryder on the first **live** run. If they must NOT be sent, change their status first (e.g. to "Submitted to Ryder" if Brian sent them by hand) — otherwise leave them and they go out.
- [ ] `submit_to_ryder` = **live**.
- [ ] n8n: deactivate **48 hour - Check Invoice Confirmation From Ryder** → `ryder_resubmit` = **live** (every 48h from the last send, until acknowledged).

## 7. Copy Drive files into Storage (one time)
Run until `remaining` is 0 for both (admin JWT or the internal secret):
`POST /functions/v1/import-drive-files {"kind":"invoices","limit":10}` and `{"kind":"cheques","limit":10}`.
Invoices still in the Ryder pipeline are copied first.

## 8. Watch, then clean up
- [ ] 1–2 weeks: Automation tab (emails sent/failed, job runs, mailbox log) and Upload Review daily.
- [ ] Then delete the `ingest-*` functions and shut n8n down.

## Rollback
Automation tab → set the affected job **off**, re-activate the matching n8n workflow. To undo the function changes for advance requests / deletes, redeploy those two functions from the previous `main` commit.
