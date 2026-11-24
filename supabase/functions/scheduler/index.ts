/**
 * Edge Function: scheduler
 *
 * Time-based jobs that replace the n8n schedules. Called by pg_cron every
 * 10 minutes (header x-internal-secret), or by an admin to run one job now.
 *
 *   auto_advance_paid  Advance Agreed for ≥ auto_paid_hours (12)  → Advance Paid + "Invoice X is Paid" email to RZR
 *                      (n8n "After 12 hour invoice Status Advance Paid")
 *   submit_to_ryder    Advance Paid for ≥ ryder_wait_days (7)     → email PDF to Ryder AP → Submitted to Ryder
 *                      (n8n "Send Invoice to Ryder …" with its 7-day Wait — but re-checks the status first)
 *   ryder_resubmit     Submitted/Resubmitted, not acknowledged, last send ≥ resubmit_hours (48) ago → resend
 *                      (n8n "48 hour - Check Invoice Confirmation" — fixed: counts from the LAST send, so it
 *                       no longer re-sends every hour). Unlimited until Ryder acknowledges.
 *
 * Each job obeys app_settings.automation.<job>: off | dry_run (report only) | live.
 *
 * POST /functions/v1/scheduler   {}  or  { job: 'submit_to_ryder' }
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, json, preflight } from '../_shared/http.ts'
import { adminClient, isInternalCall, requireRole } from '../_shared/auth.ts'
import { getSettings, jobMode, type JobMode, type JobName, logJobRun } from '../_shared/settings.ts'
import { kickOutbox } from '../_shared/outbox.ts'
import { queueAdvancePaidEmail, queueRyderSubmission } from '../_shared/ryder.ts'

const BATCH = 10 // invoices per job per run (each Ryder email loads a PDF)

type JobFn = (admin: SupabaseClient, mode: JobMode, s: Record<string, unknown>) => Promise<Record<string, unknown>>

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

// ── auto_advance_paid ────────────────────────────────────────
const autoAdvancePaid: JobFn = async (admin, mode, s) => {
  const hours = Number(s.auto_paid_hours ?? 12)
  const { data: due, error } = await admin.from('invoices')
    .select('id, invoice_number, advance_agreed_at')
    .eq('status', 'Advance Agreed').lte('advance_agreed_at', hoursAgo(hours))
    .order('advance_agreed_at').limit(50)
  if (error) throw error
  if (mode !== 'live' || !due?.length) return { due: due?.map((i) => i.invoice_number) ?? [] }

  const now = new Date().toISOString()
  const { data: paid, error: upErr } = await admin.from('invoices')
    .update({ status: 'Advance Paid', advance_paid_at: now })
    .in('id', due.map((i) => i.id)).eq('status', 'Advance Agreed')
    .select('id, invoice_number')
  if (upErr) throw upErr
  if (paid?.length) {
    await admin.from('audit_logs').insert({
      table_name: 'invoices', action: 'status_change', new_status: 'Advance Paid',
      summary: `Auto: ${hours}h after RZR agreed → Advance Paid: ${paid.map((i) => i.invoice_number).join(', ')}`,
      source: 'scheduler',
    })
    await queueAdvancePaidEmail(admin, paid)
  }
  return { paid: paid?.map((i) => i.invoice_number) ?? [] }
}

// ── submit_to_ryder ──────────────────────────────────────────
const submitToRyder: JobFn = async (admin, mode, s) => {
  const days = Number(s.ryder_wait_days ?? 7)
  const { data: due, error } = await admin.from('invoices')
    .select('*')
    .eq('status', 'Advance Paid').lte('advance_paid_at', hoursAgo(days * 24))
    .order('advance_paid_at').limit(BATCH)
  if (error) throw error
  if (mode !== 'live' || !due?.length) return { due: due?.map((i) => i.invoice_number) ?? [] }

  const queued: string[] = []
  const failed: { invoice: string; error: string }[] = []
  for (const inv of due) {
    try {
      const q = await queueRyderSubmission(admin, inv, 0)
      if (!q.duplicate) queued.push(inv.invoice_number)
    } catch (err) {
      failed.push({ invoice: inv.invoice_number, error: String(err) })
      await raiseOnce(admin, inv, `Could not prepare the Ryder email for ${inv.invoice_number}: ${String(err)}`)
    }
  }
  return { queued, failed }
}

// ── ryder_resubmit ───────────────────────────────────────────
const ryderResubmit: JobFn = async (admin, mode, s) => {
  const hours = Number(s.resubmit_hours ?? 48)
  const cutoff = hoursAgo(hours)
  const { data: candidates, error } = await admin.from('invoices')
    .select('*')
    .in('status', ['Submitted to Ryder', 'Resubmitted'])
    .is('ryder_confirmed_at', null)
    .order('ryder_submitted_at').limit(200)
  if (error) throw error
  const due = (candidates ?? []).filter((i) => {
    const last = i.last_resubmitted_at ?? i.ryder_submitted_at
    return last && last <= cutoff
  }).slice(0, BATCH)
  if (mode !== 'live' || !due.length) {
    return { due: due.map((i) => `${i.invoice_number} (sent ${i.resubmit_count ?? 0}x)`) }
  }

  const queued: string[] = []
  const failed: { invoice: string; error: string }[] = []
  for (const inv of due) {
    try {
      const q = await queueRyderSubmission(admin, inv, (inv.resubmit_count ?? 0) + 1)
      if (!q.duplicate) queued.push(`${inv.invoice_number} #${(inv.resubmit_count ?? 0) + 1}`)
    } catch (err) {
      failed.push({ invoice: inv.invoice_number, error: String(err) })
      await raiseOnce(admin, inv, `Could not prepare the Ryder resubmission for ${inv.invoice_number}: ${String(err)}`)
    }
  }
  return { queued, failed }
}

/** One open needs_attention alert per invoice for scheduler problems (no repeats every 10 min). */
// deno-lint-ignore no-explicit-any
async function raiseOnce(admin: SupabaseClient, inv: Record<string, any>, detail: string) {
  const { data: open } = await admin.from('needs_attention')
    .select('id').eq('invoice_id', inv.id).eq('title', 'Ryder email could not be prepared').eq('resolved', false).limit(1)
  if (open?.length) return
  await admin.from('needs_attention').insert({
    invoice_id: inv.id, type: 'conf_match', title: 'Ryder email could not be prepared',
    detail: detail.slice(0, 1000), action_label: 'Review',
  })
}

const JOBS: Record<string, JobFn> = {
  auto_advance_paid: autoAdvancePaid,
  submit_to_ryder: submitToRyder,
  ryder_resubmit: ryderResubmit,
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const admin = adminClient()
  try {
    const internal = isInternalCall(req)
    if (!internal) await requireRole(req, admin, ['admin'])
    const body = await req.json().catch(() => ({})) as { job?: string }
    const names = body.job ? [body.job] : Object.keys(JOBS)
    if (names.some((n) => !JOBS[n])) throw new HttpError(400, `job must be one of ${Object.keys(JOBS).join(', ')}`)

    const settings = await getSettings(admin)
    const results: Record<string, unknown> = {}
    let queuedAny = false
    for (const name of names) {
      const mode = await jobMode(admin, name as JobName)
      if (mode === 'off') { results[name] = { mode }; continue }
      const startedAt = new Date()
      try {
        const summary = await JOBS[name](admin, mode, settings)
        results[name] = { mode, ...summary }
        const didSomething = Object.values(summary).some((v) => Array.isArray(v) && v.length)
        if (didSomething) {
          await logJobRun(admin, name as JobName, mode, 'ok', { ...summary, trigger: internal ? 'cron' : 'admin' }, undefined, startedAt)
          if (mode === 'live') queuedAny = true
        }
      } catch (err) {
        results[name] = { mode, error: String(err) }
        await logJobRun(admin, name as JobName, mode, 'error', {}, String(err), startedAt)
      }
    }
    if (queuedAny) kickOutbox(admin)
    return json({ results })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error('scheduler error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, status)
  }
})
