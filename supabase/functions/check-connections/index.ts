/**
 * Edge Function: check-connections
 *
 * Health check of every outside service the portal depends on, for the admin
 * "Connections" tab. Each check makes a cheap, read-only call (nothing is sent):
 *   smtp                SMTP login with the Gmail App Password (no email sent)
 *   gemini              the API key can see the main + fallback models
 *   composio_gmail      Composio connected-account status (mailbox read / mark read)
 *   composio_drive      Composio connected-account status (Google Sheet links, import)
 *   composio_sheets     Composio connected-account status (Google Sheet links)
 *   doc_downloader      Docufree viewer → PDF service is reachable
 *   doc_converter       Excel → PDF service is reachable
 *   cron                the pg_cron timers (send-emails, poll-mailbox, scheduler) run
 *
 * Results are upserted into public.connection_status. When a connection BREAKS
 * (was not error, now error) admins get a bell notification and an alert email
 * (unless SMTP itself is the broken one); when it recovers, a notification.
 *
 * Called hourly by pg_cron (x-internal-secret) or by an admin ("Check now").
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, json, preflight } from '../_shared/http.ts'
import { adminClient, isInternalCall, requireRole } from '../_shared/auth.ts'
import { getSettings } from '../_shared/settings.ts'
import { verifySmtp } from '../_shared/mailer.ts'
import { fallbackModel } from '../_shared/gemini.ts'
import { kickOutbox, queueEmail } from '../_shared/outbox.ts'

type Status = 'ok' | 'warning' | 'error'
interface Check { key: string; label: string; status: Status; message: string; details?: Record<string, unknown> }

const TIMEOUT = 15_000
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400)

/* ── individual checks ── */

async function checkSmtp(): Promise<Check> {
  const base = { key: 'smtp', label: 'Email sending (Gmail SMTP)' }
  try {
    const r = await Promise.race([
      verifySmtp(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out connecting to the SMTP server')), TIMEOUT)),
    ])
    return { ...base, status: 'ok', message: `Logged in as ${r.user} (${r.host}:${r.port})`, details: r }
  } catch (e) {
    const m = errText(e)
    const auth = /535|auth|credentials|password|username/i.test(m)
    return { ...base, status: 'error', message: auth ? `Login rejected — the Gmail App Password is wrong or was revoked. (${m})` : m }
  }
}

async function checkGemini(): Promise<Check> {
  const base = { key: 'gemini', label: 'Gemini AI (reads invoices & cheques)' }
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return { ...base, status: 'error', message: 'GEMINI_API_KEY is not set' }
  const models = [...new Set([Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash', fallbackModel()])]
  const results: Record<string, string> = {}
  let worst: Status = 'ok'
  let message = ''
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
        headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(TIMEOUT),
      })
      if (res.ok) { results[model] = 'ok'; continue }
      const body = await res.json().catch(() => null)
      const m = String(body?.error?.message ?? `HTTP ${res.status}`)
      results[model] = m
      if (res.status === 429) { if (worst === 'ok') { worst = 'warning'; message = `Quota / rate limit reached: ${m}` } continue }
      worst = 'error'
      message = /expired/i.test(m) ? `The API key has expired — create a new key. (${m})`
        : /not valid|invalid|API_KEY/i.test(m) ? `The API key is not valid. (${m})`
        : res.status === 404 ? `Model ${model} is not available to this key. (${m})`
        : m
      break
    } catch (e) { worst = 'error'; message = `Could not reach Google: ${errText(e)}`; results[model] = message; break }
  }
  return { ...base, status: worst, message: worst === 'ok' ? `Key valid · models ${models.join(', ')} available` : message, details: { models: results } }
}

async function checkComposio(kind: 'gmail' | 'drive' | 'sheets'): Promise<Check> {
  const meta = {
    gmail:  { key: 'composio_gmail',  label: 'Gmail mailbox (Composio)',        env: 'COMPOSIO_GMAIL_ACCOUNT_ID' },
    drive:  { key: 'composio_drive',  label: 'Google Drive (Composio)',         env: 'COMPOSIO_DRIVE_ACCOUNT_ID' },
    sheets: { key: 'composio_sheets', label: 'Google Sheets (Composio)',        env: 'COMPOSIO_SHEETS_ACCOUNT_ID' },
  }[kind]
  const base = { key: meta.key, label: meta.label }
  const apiKey = Deno.env.get('COMPOSIO_API_KEY')
  const id = Deno.env.get(meta.env)
  if (!apiKey) return { ...base, status: 'error', message: 'COMPOSIO_API_KEY is not set' }
  if (!id) return { ...base, status: 'error', message: `${meta.env} is not set` }
  try {
    const res = await fetch(`https://backend.composio.dev/api/v3/connected_accounts/${encodeURIComponent(id)}`, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT),
    })
    const body = await res.json().catch(() => null)
    if (res.status === 401 || res.status === 403) return { ...base, status: 'error', message: 'Composio rejected the API key (COMPOSIO_API_KEY) — create a new key in Composio.' }
    if (res.status === 404) return { ...base, status: 'error', message: `Connected account ${id} no longer exists in Composio — reconnect it.` }
    if (!res.ok) return { ...base, status: 'error', message: `Composio HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 200)}` }
    const st = String(body?.status ?? body?.data?.status ?? 'unknown').toUpperCase()
    const who = body?.data?.email ?? body?.state?.val?.email ?? body?.params?.email ?? null
    const details = { account_id: id, composio_status: st, toolkit: body?.toolkit?.slug ?? null, ...(who ? { account: who } : {}) }
    if (st === 'ACTIVE') return { ...base, status: 'ok', message: `Connected${who ? ` as ${who}` : ''} (status ACTIVE)`, details }
    const reason = body?.status_reason ?? body?.statusReason ?? ''
    return {
      ...base, status: 'error', details,
      message: `Composio connection is ${st}${reason ? ` (${reason})` : ''} — the Google sign-in must be re-authorised in Composio.`,
    }
  } catch (e) {
    return { ...base, status: 'error', message: `Could not reach Composio: ${errText(e)}` }
  }
}

async function checkReachable(key: string, label: string, env: string): Promise<Check> {
  const url = Deno.env.get(env)
  if (!url) return { key, label, status: 'error', message: `${env} is not set` }
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT) })
    await res.body?.cancel()
    // Any HTTP answer means the service is up (it expects POSTs, so 404/405 here is normal).
    return { key, label, status: res.status >= 500 ? 'warning' : 'ok', message: res.status >= 500 ? `Reachable but answered HTTP ${res.status}` : `Reachable (HTTP ${res.status})`, details: { url } }
  } catch (e) {
    return { key, label, status: 'error', message: `Not reachable: ${errText(e)}`, details: { url } }
  }
}

const TIMERS: Record<string, number> = { 'send-emails': 2, 'poll-mailbox': 5, 'scheduler': 10 }   // minutes

async function checkCron(admin: SupabaseClient): Promise<Check> {
  const base = { key: 'cron', label: 'Scheduled timers (pg_cron)' }
  const { data, error } = await admin.rpc('cron_status')
  if (error) return { ...base, status: 'error', message: `Could not read the timers: ${error.message}` }
  const rows = (data ?? []) as { jobname: string; active: boolean; last_start: string | null; last_status: string | null; last_message: string | null }[]
  const problems: string[] = []
  const timers: Record<string, unknown> = {}
  for (const [name, every] of Object.entries(TIMERS)) {
    const r = rows.find((x) => x.jobname === name)
    if (!r) { problems.push(`${name} is not scheduled`); continue }
    const ageMin = r.last_start ? (Date.now() - new Date(r.last_start).getTime()) / 60000 : null
    timers[name] = { every_min: every, active: r.active, last_run: r.last_start, last_status: r.last_status }
    if (!r.active) problems.push(`${name} is switched off in pg_cron`)
    else if (ageMin === null || ageMin > every * 3 + 2) problems.push(`${name} has not run for ${ageMin === null ? 'ever' : `${Math.round(ageMin)} min`}`)
    else if (r.last_status === 'failed') problems.push(`${name} last run failed: ${r.last_message ?? ''}`)
  }
  return problems.length
    ? { ...base, status: 'error', message: problems.join(' · '), details: { timers } }
    : { ...base, status: 'ok', message: `All timers running (emails every 2 min, mailbox every 5 min, jobs every 10 min)`, details: { timers } }
}

/* ── main ── */

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const admin = adminClient()
  try {
    const internal = isInternalCall(req)
    if (!internal) await requireRole(req, admin, ['admin'])

    const checks = await Promise.all([
      checkSmtp(),
      checkGemini(),
      checkComposio('gmail'),
      checkComposio('drive'),
      checkComposio('sheets'),
      checkReachable('doc_downloader', 'Docufree PDF downloader', 'DOC_DOWNLOADER_URL'),
      checkReachable('doc_converter', 'Excel → PDF converter', 'DOC_CONVERT_URL'),
      checkCron(admin),
    ])

    const { data: prevRows } = await admin.from('connection_status').select('key, status')
    const prev = new Map((prevRows ?? []).map((r) => [r.key, r.status]))
    const now = new Date().toISOString()

    await admin.from('connection_status').upsert(checks.map((c) => ({
      key: c.key, label: c.label, status: c.status, message: c.message, details: c.details ?? {},
      checked_at: now, updated_at: now,
      ...(c.status === 'ok' ? { last_ok_at: now } : {}),
      ...(c.status === 'error' ? { last_error_at: now } : {}),
    })), { onConflict: 'key' })

    // Tell admins when something breaks or recovers (only on the change, not every hour).
    const broke = checks.filter((c) => c.status === 'error' && prev.get(c.key) !== 'error')
    const fixed = checks.filter((c) => c.status === 'ok' && prev.get(c.key) === 'error')
    if (broke.length || fixed.length) {
      await admin.from('notifications').insert([
        ...broke.map((c) => ({ audience: 'admin', title: `Connection problem: ${c.label}`, body: c.message })),
        ...fixed.map((c) => ({ audience: 'admin', title: `Connection restored: ${c.label}`, body: c.message })),
      ])
    }
    const emailable = broke.filter((c) => c.key !== 'smtp')
    if (emailable.length) {
      const s = await getSettings(admin)
      const to = String(s.admin_alert_email ?? '')
      if (to && !checks.some((c) => c.key === 'smtp' && c.status === 'error')) {
        const lines = emailable.map((c) => `• ${c.label}: ${c.message}`).join('\n')
        await queueEmail(admin, {
          kind: 'connection_alert', to: [to],
          subject: `Levisa portal — connection problem: ${emailable.map((c) => c.label).join(', ')}`,
          text: `The portal's hourly check found a broken connection:\n\n${lines}\n\nOpen the portal → Connections for what to do.`,
          dedupeKey: `connection_alert:${emailable.map((c) => c.key).sort().join(',')}:${now.slice(0, 13)}`,
        })
        kickOutbox(admin)
      }
    }

    return json({ checked_at: now, trigger: internal ? 'cron' : 'admin', checks, broke: broke.map((c) => c.key), fixed: fixed.map((c) => c.key) })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error('check-connections error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, status)
  }
})
