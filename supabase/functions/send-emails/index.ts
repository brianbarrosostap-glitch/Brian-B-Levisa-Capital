/**
 * Edge Function: send-emails
 *
 * Sends queued emails from public.email_outbox over SMTP.
 *
 * Callers:
 *   • pg_cron every 2 minutes  — header `x-internal-secret` (retries + anything queued)
 *   • admin from the portal    — JWT; may also send a test email
 *
 * POST /functions/v1/send-emails
 * Body (all optional):
 *   { limit?: number }                 how many due emails to send this run (default 20)
 *   { test_to?: string }               ADMIN ONLY — queue + send a test email to this address
 *
 * Honours app_settings.automation.send_emails (off | dry_run | live).
 */

import { corsHeaders, HttpError, json, preflight } from '../_shared/http.ts'
import { adminClient, isInternalCall, requireRole } from '../_shared/auth.ts'
import { jobMode, logJobRun } from '../_shared/settings.ts'
import { processOutbox, queueEmail } from '../_shared/outbox.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const admin = adminClient()
  try {
    const internal = isInternalCall(req)
    const caller = internal ? null : await requireRole(req, admin, ['admin'])
    const body = await req.json().catch(() => ({})) as { limit?: number; test_to?: string }
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 50)

    // ── Admin test email ────────────────────────────────────
    let testId: string | null = null
    if (body.test_to) {
      if (!caller) throw new HttpError(400, 'test_to is only allowed for admin users')
      const to = String(body.test_to).trim()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new HttpError(400, 'test_to is not a valid email')
      const q = await queueEmail(admin, {
        kind: 'test',
        to: [to],
        subject: 'Levisa Capital — SMTP test',
        text: `This is a test email from the Levisa Capital portal.\nSent at ${new Date().toISOString()} by ${caller.user.email}.`,
        html: `<p>This is a test email from the <b>Levisa Capital</b> portal.</p>`
          + `<p style="color:#4a6070;font-size:12px">Sent at ${new Date().toISOString()} by ${caller.user.email}.</p>`,
        createdBy: caller.user.id,
      })
      testId = q.id
    }

    // ── Mode switch ─────────────────────────────────────────
    const mode = await jobMode(admin, 'send_emails')
    if (mode !== 'live') {
      const { count } = await admin.from('email_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending').lte('next_attempt_at', new Date().toISOString())
      return json({ mode, skipped: true, due: count ?? 0, test_id: testId })
    }

    // ── Send ────────────────────────────────────────────────
    // Only runs that actually did something are logged (the cron fires every 2 min).
    const startedAt = new Date()
    const trigger = internal ? 'cron' : 'admin'
    try {
      const result = await processOutbox(admin, limit)
      if (result.claimed > 0) {
        await logJobRun(admin, 'send_emails', mode, result.errors.length ? 'error' : 'ok',
          { ...result, trigger }, undefined, startedAt)
      }
      return json({ mode, ...result, test_id: testId })
    } catch (err) {
      await logJobRun(admin, 'send_emails', mode, 'error', { trigger }, String(err), startedAt)
      throw err
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error('send-emails error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
