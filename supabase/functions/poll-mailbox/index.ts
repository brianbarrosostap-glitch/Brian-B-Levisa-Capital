/**
 * Edge Function: poll-mailbox
 *
 * Reads the inbound mailbox (brianbarroso.stap@gmail.com) via Composio and
 * replaces two n8n Gmail-trigger workflows:
 *
 *   • "Reply Confirmation for Advance Agreed Invoice by Customer"
 *       RZR replies to the payment-request email. "Approved"/"Accepted" in the
 *       NEW part of the reply (quoted text ignored) → Advance Agreed. Anything
 *       else → "not approved" alert to Brian. Only allow-listed senders count.
 *   • "Received Invoice Confirmation from Ryder # via Email"
 *       Docufree "Invoice Confirmation from Ryder #<conf>" → open the
 *       "View Invoice" link with the PDF downloader → read "Invoice #" →
 *       Acknowledged + conf # + 60-day due date. Senders come from
 *       app_settings.ryder_confirmation_senders (default workflow@docufree.com).
 *       From any other allowed sender (a typed test confirmation) the portal
 *       invoice number written in the subject/body is used first; the link
 *       (also a bare pasted docuview URL) only if there is none.
 *
 * Like n8n: only UNREAD emails are read, and each one is marked read once it
 * has been handled (live mode, final result — errors stay unread so someone
 * notices). app_settings.mailbox_mark_read lists which kinds are marked
 * (default both). app_settings.mailbox_never_mark_read_from lists senders that
 * are never marked (DEV: workflow@docufree.com, while prod n8n shares the mailbox).
 * public.processed_emails still makes each message run only once.
 *
 * Called by pg_cron every 5 min (x-internal-secret) or by an admin.
 * Obeys app_settings.automation.poll_mailbox (off | dry_run | live).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, json, preflight } from '../_shared/http.ts'
import { adminClient, isInternalCall, requireRole } from '../_shared/auth.ts'
import { getSettings, jobMode, logJobRun } from '../_shared/settings.ts'
import { fetchEmails, markEmailRead, type GmailMessage } from '../_shared/composio.ts'
import { applyRyderConfirmation, markAdvanceAgreed } from '../_shared/ingest.ts'
import { downloadViewerPdf, pdfText } from '../_shared/files.ts'
import { kickOutbox, queueEmail } from '../_shared/outbox.ts'
import { notApprovedEmail } from '../_shared/templates.ts'
import {
  htmlToText, invoiceNumberFromPdfText, invoiceNumbersFromSubject, isApproval, newReplyText, viewerLink,
} from '../_shared/mailParse.ts'

const MAX_RYDER_PER_RUN = 4   // each needs a headless-browser PDF download (~10–30 s)
const MAX_ATTEMPTS = 3
const MAX_MARK_READ_PER_RUN = 30   // one Composio call each

// ── Handlers ─────────────────────────────────────────────────

interface Outcome {
  kind: 'rzr_reply' | 'ryder_confirmation' | 'ignored'
  result: string
  invoice_numbers: string[]
  detail: Record<string, unknown>
}

async function handleRzrReply(
  admin: SupabaseClient, m: GmailMessage, s: Record<string, unknown>, live: boolean,
): Promise<Outcome> {
  const senders = ((s.rzr_reply_senders as string[]) ?? []).map((x) => x.toLowerCase())
  const numbers = invoiceNumbersFromSubject(m.subject)
  if (!senders.includes(m.fromEmail)) {
    return { kind: 'ignored', result: 'skipped', invoice_numbers: numbers, detail: { reason: `sender ${m.fromEmail} is not an RZR reply address` } }
  }
  const reply = newReplyText(m.html)
  if (!numbers.length) {
    return { kind: 'rzr_reply', result: 'skipped', invoice_numbers: [], detail: { reason: 'no invoice numbers in subject', reply: reply.slice(0, 500) } }
  }
  if (isApproval(reply)) {
    if (!live) return { kind: 'rzr_reply', result: 'dry_run', invoice_numbers: numbers, detail: { would: 'Advance Agreed', reply: reply.slice(0, 300) } }
    const r = await markAdvanceAgreed(admin, numbers, { fromEmail: m.fromEmail, messageId: m.id, source: 'poll-mailbox' })
    return { kind: 'rzr_reply', result: r.agreed.length ? 'approved' : 'no_match', invoice_numbers: numbers, detail: { ...r, reply: reply.slice(0, 300) } }
  }

  if (!live) return { kind: 'rzr_reply', result: 'dry_run', invoice_numbers: numbers, detail: { would: 'not approved alert', reply: reply.slice(0, 300) } }
  const to = String(s.admin_alert_email ?? '')
  const mail = notApprovedEmail(m.subject, numbers, m.fromEmail, reply)
  if (to) {
    await queueEmail(admin, {
      kind: 'not_approved_alert', to: [to], subject: mail.subject, text: mail.text, html: mail.html,
      dedupeKey: `not_approved:${m.id}`,
    })
  }
  await admin.from('notifications').insert({
    audience: 'admin',
    title: `RZR did not approve ${numbers.join(', ')}`,
    body: `Reply from ${m.fromEmail}: ${reply.slice(0, 300)}`,
  })
  return { kind: 'rzr_reply', result: 'not_approved', invoice_numbers: numbers, detail: { reply: reply.slice(0, 300) } }
}

const DOCUFREE = 'workflow@docufree.com'

/**
 * Portal invoice numbers written in an email (subject + body). Only numbers that are real
 * portal invoices count, so dates, amounts or a confirmation # can't match by accident.
 * `exclude` drops one number (Docufree's confirmation # in the subject).
 */
async function portalInvoiceNumbersIn(admin: SupabaseClient, m: GmailMessage, exclude: string | null): Promise<string[]> {
  for (const text of [`${m.subject}\n${newReplyText(m.html)}`, htmlToText(m.html)]) {
    const nums = [...new Set((text.match(/\b\d{5,12}\b/g) ?? []).filter((n) => n !== exclude))]
    if (!nums.length) continue
    const { data } = await admin.from('invoices').select('invoice_number').in('invoice_number', nums)
    const found = (data ?? []).map((r) => r.invoice_number as string)
    if (found.length) return found
  }
  return []
}

async function handleRyderConfirmation(admin: SupabaseClient, m: GmailMessage, live: boolean): Promise<Outcome> {
  const subjectNumber = m.subject.match(/#\s*(\d+)/)?.[1] ?? null
  const link = viewerLink(m.html)
  const fromDocufree = m.fromEmail === DOCUFREE
  let numbers: string[] = []
  let conf = subjectNumber

  // A confirmation typed by someone else (test / forwarded): the invoice number written in it
  // wins — any pasted Docufree link may belong to another invoice.
  if (!fromDocufree) {
    numbers = await portalInvoiceNumbersIn(admin, m, null)
    if (numbers.length && subjectNumber && numbers.includes(subjectNumber)) conf = null   // the "#" number was the invoice, not a conf #
  }
  if (!numbers.length && link) {
    // Real Docufree email: open the "View Invoice" link and read "Invoice #" from the PDF.
    const invoiceNumber = invoiceNumberFromPdfText(await pdfText(await downloadViewerPdf(link)))
    if (!invoiceNumber) {
      return { kind: 'ryder_confirmation', result: 'error', invoice_numbers: [], detail: { conf, link, reason: 'Invoice # not found in the PDF' } }
    }
    numbers = [invoiceNumber]
  }
  if (!numbers.length && fromDocufree) numbers = await portalInvoiceNumbersIn(admin, m, subjectNumber)
  if (!numbers.length) {
    return { kind: 'ryder_confirmation', result: 'error', invoice_numbers: [], detail: { conf, reason: 'no "View Invoice" link and no portal invoice number in the email' } }
  }
  if (numbers.length > 1) {
    // Several invoices in one (typed) confirmation — acknowledge each.
    const parts = await Promise.all(numbers.map((n) => confirmOne(admin, n, conf, live, link)))
    const results = [...new Set(parts.map((o) => o.result))]
    return { kind: 'ryder_confirmation', result: results.length === 1 ? results[0] : 'acknowledged', invoice_numbers: numbers, detail: { conf, each: parts.map((o) => ({ invoice: o.invoice_numbers[0], result: o.result })) } }
  }
  return confirmOne(admin, numbers[0], conf, live, link)
}

async function confirmOne(admin: SupabaseClient, invoiceNumber: string, conf: string | null, live: boolean, link: string | null): Promise<Outcome> {
  if (!live) {
    const { data: cur } = await admin.from('invoices').select('status, ryder_confirmed_at').eq('invoice_number', invoiceNumber).maybeSingle()
    const would = !cur ? 'no match (not in portal)' : cur.ryder_confirmed_at ? `nothing — already acknowledged (${cur.status})` : 'Acknowledged'
    return { kind: 'ryder_confirmation', result: 'dry_run', invoice_numbers: [invoiceNumber], detail: { conf, would } }
  }

  const r = await applyRyderConfirmation(admin, invoiceNumber, conf, 'poll-mailbox')
  if (r.already) {
    return { kind: 'ryder_confirmation', result: 'already_acknowledged', invoice_numbers: [invoiceNumber], detail: { conf, status: r.status } }
  }
  if (!r.found) {
    await admin.from('notifications').insert({
      audience: 'admin',
      title: `Ryder confirmation for unknown invoice ${invoiceNumber}`,
      body: `Ryder confirmation #${conf ?? '?'} refers to invoice ${invoiceNumber}, which is not in the portal.`,
    })
    return { kind: 'ryder_confirmation', result: 'no_match', invoice_numbers: [invoiceNumber], detail: { conf, link } }
  }
  return { kind: 'ryder_confirmation', result: 'acknowledged', invoice_numbers: [invoiceNumber], detail: { conf, status: r.status } }
}

// ── Main ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const admin = adminClient()
  const startedAt = new Date()
  try {
    const internal = isInternalCall(req)
    if (!internal) await requireRole(req, admin, ['admin'])

    const mode = await jobMode(admin, 'poll_mailbox')
    if (mode === 'off') return json({ mode, skipped: true })
    const live = mode === 'live'
    const s = await getSettings(admin)
    const days = Number(s.mailbox_lookback_days ?? 7)
    const phrase = String(s.payment_request_subject ?? 'Payment Request for')
    const confSenders = (Array.isArray(s.ryder_confirmation_senders) && s.ryder_confirmation_senders.length
      ? (s.ryder_confirmation_senders as string[]) : ['workflow@docufree.com']).map((x) => x.trim().toLowerCase()).filter(Boolean)

    const [ryder, rzr] = await Promise.all([
      fetchEmails(`is:unread from:(${confSenders.join(' OR ')}) subject:"Invoice Confirmation from Ryder" newer_than:${days}d`, 100),
      fetchEmails(`is:unread subject:"${phrase}" newer_than:${days}d -from:me`, 50),
    ])

    const ids = [...ryder, ...rzr].map((m) => m.id)
    const { data: seen } = ids.length
      ? await admin.from('processed_emails').select('message_id, result, detail').in('message_id', ids)
      : { data: [] }
    const seenMap = new Map((seen ?? []).map((r) => [r.message_id, r]))
    const pending = (m: GmailMessage) => {
      const prev = seenMap.get(m.id)
      return !prev || (prev.result === 'error' && Number(prev.detail?.attempts ?? 1) < MAX_ATTEMPTS)
    }

    const handled: Record<string, unknown>[] = []
    const results = new Map<string, string>()   // message id → result recorded in this run (live only)
    const record = async (m: GmailMessage, o: Outcome) => {
      handled.push({ subject: m.subject, from: m.fromEmail, ...o })
      if (!live) return // dry run: nothing is recorded, so switching to live processes these for real
      results.set(m.id, o.result)
      const prev = seenMap.get(m.id)
      const attempts = o.result === 'error' ? Number(prev?.detail?.attempts ?? 0) + 1 : undefined
      await admin.from('processed_emails').upsert({
        message_id: m.id, thread_id: m.threadId, kind: o.kind, from_email: m.fromEmail, subject: m.subject,
        received_at: m.timestamp, result: o.result, invoice_numbers: o.invoice_numbers,
        detail: attempts ? { ...o.detail, attempts } : o.detail, processed_at: new Date().toISOString(),
      })
    }

    for (const m of rzr.filter(pending)) {
      try { await record(m, await handleRzrReply(admin, m, s, live)) } catch (err) {
        await record(m, { kind: 'rzr_reply', result: 'error', invoice_numbers: [], detail: { error: String(err) } })
      }
    }

    let ryderDone = 0
    // oldest first, so confirmations are applied in the order Ryder sent them
    for (const m of ryder.filter(pending).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))) {
      if (ryderDone >= MAX_RYDER_PER_RUN) break
      ryderDone++
      try { await record(m, await handleRyderConfirmation(admin, m, live)) } catch (err) {
        await record(m, { kind: 'ryder_confirmation', result: 'error', invoice_numbers: [], detail: { error: String(err) } })
      }
    }

    // ── Mark handled emails as read (n8n did the same) ──
    let markedRead = 0
    const markErrors: string[] = []
    if (live) {
      const kinds = new Set<string>(Array.isArray(s.mailbox_mark_read)
        ? (s.mailbox_mark_read as string[]) : ['rzr_reply', 'ryder_confirmation'])
      // DEV shares the mailbox with prod n8n, which only reads UNREAD Docufree emails —
      // so DEV lists workflow@docufree.com here and never marks those read.
      const neverFrom = new Set(((s.mailbox_never_mark_read_from as string[]) ?? []).map((x) => x.toLowerCase()))
      const resultOf = (m: GmailMessage) => results.get(m.id) ?? seenMap.get(m.id)?.result
      const due = [
        ...(kinds.has('rzr_reply') ? rzr : []),
        ...(kinds.has('ryder_confirmation') ? ryder : []),
      ].filter((m) => {
        const r = resultOf(m)
        return !!r && r !== 'error' && !neverFrom.has(m.fromEmail) && (m.labelIds.length === 0 || m.labelIds.includes('UNREAD'))
      }).slice(0, MAX_MARK_READ_PER_RUN)
      for (const m of due) {
        try { await markEmailRead(m.id); markedRead++ } catch (err) { markErrors.push(`${m.subject}: ${String(err).slice(0, 200)}`) }
      }
    }

    const summary = {
      trigger: internal ? 'cron' : 'admin',
      found: { ryder: ryder.length, rzr: rzr.length },
      handled,
      ryder_backlog: Math.max(0, ryder.filter(pending).length - ryderDone),
      marked_read: markedRead,
      ...(markErrors.length ? { mark_read_errors: markErrors.slice(0, 5) } : {}),
    }
    if (handled.length || markedRead || markErrors.length) {
      await logJobRun(admin, 'poll_mailbox', mode, handled.some((h) => h.result === 'error') ? 'error' : 'ok', summary, undefined, startedAt)
      kickOutbox(admin)
    }
    return json({ mode, ...summary })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) {
      console.error('poll-mailbox error:', err)
      await logJobRun(admin, 'poll_mailbox', 'live', 'error', {}, String(err), startedAt).catch(() => {})
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, status)
  }
})
