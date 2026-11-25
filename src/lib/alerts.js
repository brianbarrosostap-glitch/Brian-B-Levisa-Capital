// Alerts feed: everything that went wrong, gathered from the tables the system
// already writes to. Used by the admin Alerts page and the sidebar badge.
// Every alert is rewritten in plain words: { title, detail, fix } — the raw
// technical text is kept in `tech` for the "Technical details" toggle.
import { supabase } from './supabase'

export const ALERT_DAYS = 30
const DAYS = ALERT_DAYS
const since = () => new Date(Date.now() - DAYS * 86400000).toISOString()
const str = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v))
const has = (text, re) => re.test(String(text || ''))

const JOB_LABEL = {
  send_emails: 'Sending queued emails',
  auto_advance_paid: 'Auto Advance Paid',
  submit_to_ryder: 'Send invoices to Ryder',
  ryder_resubmit: 'Resend invoices to Ryder',
  poll_mailbox: 'Mailbox check',
}

/* ── plain-language rewrites, one per source ── */

function fromMailbox(r) {
  const why = str(r.detail?.error ?? r.detail?.reason ?? r.detail)
  const ryder = r.kind === 'ryder_confirmation'
  const base = { title: ryder ? 'A Ryder confirmation email could not be matched to an invoice' : 'An RZR reply could not be processed', tech: why, page: 'master' }
  const email = `“${r.subject}” from ${r.from_email}`
  if (has(why, /no "View Invoice" link and no portal invoice number/i)) {
    return { ...base, detail: `${email} doesn’t say which invoice it confirms — it has no Docufree “View Invoice” link and no portal invoice number.`,
      fix: 'Find the invoice in Master and set it to “Acknowledged by Ryder” yourself (enter the confirmation #), or ask for a confirmation that includes the invoice number.' }
  }
  if (has(why, /Invoice # not found in the PDF/i)) {
    return { ...base, detail: `${email}: the portal opened Ryder’s invoice page but couldn’t find an invoice number on it.`,
      fix: 'Open the email’s “View Invoice” link yourself, then set that invoice to “Acknowledged by Ryder” in Master.' }
  }
  if (has(why, /DOC_DOWNLOADER|download|fetch failed|timed? ?out|ECONN|network/i)) {
    return { ...base, detail: `${email}: the portal couldn’t open Ryder’s “View Invoice” page (the PDF downloader didn’t answer).`,
      fix: 'Check Connections → Docufree PDF downloader. Once it works, set the invoice to “Acknowledged by Ryder” in Master if it still isn’t.' }
  }
  return { ...base, detail: email, fix: ryder ? 'Check the email in Gmail and update the invoice in Master if needed.' : 'Read the reply in Gmail and update the invoices in Master if needed.' }
}

function fromJob(r) {
  const name = JOB_LABEL[r.job] || r.job
  const err = r.error || ''
  const tech = err || str(r.summary)
  const title = `Automatic job failed: ${name}${r.mode === 'dry_run' ? ' (dry run)' : ''}`
  if (has(err, /composio|gmail|oauth|token|unauthori[sz]ed|401|403/i)) {
    return { title, tech, detail: 'The job couldn’t reach Gmail through Composio — the Google sign-in may need re-authorising.', fix: 'Open Connections and check “Gmail mailbox (Composio)”.' }
  }
  if (has(err, /gemini|generativelanguage|api key/i)) {
    return { title, tech, detail: 'The job couldn’t use the Gemini AI key.', fix: 'Open Connections and check “Gemini AI”.' }
  }
  const failed = Array.isArray(r.summary?.failed) ? r.summary.failed : []
  if (!err && failed.length) {
    return { title, tech, detail: `It could not process: ${failed.map(f => (typeof f === 'string' ? f : f.invoice || f.invoice_number || str(f))).join(', ')}.`, fix: 'Open Automation → Scheduled job runs for the reason, fix it, and the next run (every 10 min) tries again.' }
  }
  return { title, tech, detail: err ? err.slice(0, 220) : 'The job reported an error.', fix: 'Open Automation → Scheduled job runs for details. If it keeps failing, tell your developer.' }
}

function fromEmail(r) {
  const err = r.last_error || ''
  const to = (r.to_emails || []).join(', ')
  const title = `Email not sent: ${r.subject || r.kind}`
  const tech = `${err} (${r.attempts} attempt${r.attempts === 1 ? '' : 's'})`
  if (has(err, /535|auth|credentials|password|username/i)) {
    return { title, tech, detail: `Gmail rejected the portal’s login, so the email to ${to} wasn’t sent.`, fix: 'Open Connections → “Email sending”. Once fixed, press “Send queued now” in Automation → Emails.' }
  }
  if (has(err, /550|553|mailbox unavailable|does not exist|no such user|user unknown|recipient/i)) {
    return { title, tech, detail: `The address ${to} doesn’t accept email (it may be mistyped or closed).`, fix: 'Check the address in Automation → Settings, correct it, then send again.' }
  }
  if (has(err, /timeout|timed out|ETIMEDOUT|ECONN|network/i)) {
    return { title, tech, detail: `Gmail didn’t answer when sending to ${to}.`, fix: 'Usually temporary — press “Send queued now” in Automation → Emails.' }
  }
  return { title, tech, detail: `The email to ${to} failed after ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}.`, fix: 'See Automation → Emails for the reason.' }
}

function fromUpload(r) {
  const why = r.status_reason || ''
  const what = r.kind === 'cheque' ? 'Cheque' : 'Invoice'
  const file = r.original_filename || r.sheet_url || 'file'
  const title = `${what} upload failed: ${file}`
  if (has(why, /gemini|generativelanguage|api key|quota|429|RESOURCE_EXHAUSTED/i)) {
    return { title, tech: why, detail: 'The AI that reads uploads (Gemini) didn’t work — a key or quota problem.', fix: 'Open Connections → “Gemini AI”. Once fixed, press “Retry reading” in Upload Review.' }
  }
  if (has(why, /Unsupported file type/i)) {
    return { title, tech: why, detail: 'This kind of file can’t be read.', fix: 'Upload a PDF, a photo, an Excel file or a Google Sheet link instead.' }
  }
  if (has(why, /composio|drive|sheet/i)) {
    return { title, tech: why, detail: 'The Google Sheet / Drive link couldn’t be opened.', fix: 'Check the link is shared, and Connections → Google Drive / Sheets. Then “Retry reading” in Upload Review.' }
  }
  return { title, tech: why, detail: why ? why.slice(0, 220) : 'The file could not be processed.', fix: 'Open Upload Review: “Retry reading”, or enter the details by hand.' }
}

function fromAttention(r) {
  const cheque = String(r.type || '').startsWith('check')
  return {
    title: r.title, tech: '', detail: r.detail || (r.check_number ? `Cheque ${r.check_number}` : ''),
    fix: cheque ? 'Open Cheques, compare the cheque with its invoices, and set any unmatched invoice to Paid in Master once you know which it is.'
      : 'Open the invoice in Master, check it, and correct it if needed.',
    page: cheque ? 'cheques' : 'master',
  }
}

/** Loads every source in parallel → [{ id, source, severity, at, title, detail, fix, tech, count, recent }]. */
export async function loadAlerts() {
  const from = since()
  const [conn, jobs, emails, uploads, mailbox, attention] = await Promise.all([
    supabase.from('connection_status').select('key, label, status, message, checked_at').in('status', ['error', 'warning']),
    supabase.from('job_runs').select('id, job, mode, error, summary, started_at').eq('status', 'error').gte('started_at', from).order('started_at', { ascending: false }).limit(300),
    supabase.from('email_outbox').select('id, kind, subject, to_emails, last_error, attempts, updated_at, created_at').eq('status', 'failed').gte('created_at', from).order('created_at', { ascending: false }).limit(300),
    supabase.from('document_jobs').select('id, kind, original_filename, sheet_url, status_reason, updated_at, created_at').eq('status', 'failed').gte('created_at', from).order('created_at', { ascending: false }).limit(300),
    supabase.from('processed_emails').select('message_id, kind, subject, from_email, detail, processed_at').eq('result', 'error').gte('processed_at', from).order('processed_at', { ascending: false }).limit(300),
    supabase.from('needs_attention').select('id, type, title, detail, check_number, created_at').eq('resolved', false).order('created_at', { ascending: false }).limit(300),
  ])
  const out = []
  for (const r of conn.data ?? []) out.push({
    id: `c-${r.key}`, source: 'connection', severity: r.status === 'error' ? 'error' : 'warning', at: r.checked_at,
    title: `${r.label} ${r.status === 'error' ? 'is not working' : 'needs attention'}`, detail: r.message, tech: '',
    fix: 'Open Connections — the card for it shows step by step how to fix it.',
  })
  for (const r of jobs.data ?? []) {
    // A mailbox run is marked "error" when one email failed — that email is already its own Mailbox alert.
    if (r.job === 'poll_mailbox' && !r.error) continue
    out.push({ id: `j-${r.id}`, source: 'job', severity: 'error', at: r.started_at, ...fromJob(r) })
  }
  for (const r of emails.data ?? []) out.push({ id: `e-${r.id}`, source: 'email', severity: 'error', at: r.updated_at || r.created_at, ...fromEmail(r) })
  for (const r of uploads.data ?? []) out.push({ id: `u-${r.id}`, source: 'upload', severity: 'error', at: r.updated_at || r.created_at, ...fromUpload(r) })
  for (const r of mailbox.data ?? []) out.push({ id: `m-${r.message_id}`, source: 'mailbox', severity: 'error', at: r.processed_at, ...fromMailbox(r) })
  for (const r of attention.data ?? []) out.push({ id: `a-${r.id}`, source: 'attention', severity: 'warning', at: r.created_at, ...fromAttention(r) })

  // The same alert repeated (e.g. one duplicate-invoice warning written 3×) is shown once with a count.
  const merged = new Map()
  for (const a of out.sort((x, y) => String(y.at).localeCompare(String(x.at)))) {
    const k = `${a.source}|${a.title}|${a.detail}`
    const m = merged.get(k)
    if (m) m.count++
    else merged.set(k, { ...a, count: 1 })
  }
  const day = Date.now() - 86400000
  const alerts = [...merged.values()]
  for (const a of alerts) a.recent = !!a.at && new Date(a.at).getTime() >= day
  const failed = [conn, jobs, emails, uploads, mailbox, attention].filter(r => r.error).map(r => r.error.message)
  return { alerts, failed }
}

/** Sidebar badge: current connection problems + errors / open alerts from the last 24 hours (head counts only). */
export async function countRecentAlerts() {
  const day = new Date(Date.now() - 86400000).toISOString()
  const head = { count: 'exact', head: true }
  const rs = await Promise.all([
    supabase.from('connection_status').select('key', head).in('status', ['error', 'warning']),
    // mailbox runs that failed only because of one email are counted via processed_emails below
    supabase.from('job_runs').select('id', head).eq('status', 'error').gte('started_at', day).or('error.not.is.null,job.neq.poll_mailbox'),
    supabase.from('email_outbox').select('id', head).eq('status', 'failed').gte('updated_at', day),
    supabase.from('document_jobs').select('id', head).eq('status', 'failed').gte('updated_at', day),
    supabase.from('processed_emails').select('message_id', head).eq('result', 'error').gte('processed_at', day),
    supabase.from('needs_attention').select('id', head).eq('resolved', false).gte('created_at', day),
  ])
  return rs.reduce((n, r) => n + (r.error ? 0 : r.count ?? 0), 0)
}
