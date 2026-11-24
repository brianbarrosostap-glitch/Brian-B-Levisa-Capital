// Email outbox: every portal email is queued in public.email_outbox and
// sent by processOutbox() — immediately after queueing (best effort) and
// every 2 minutes by the send-emails cron (retries).
//
// dedupe_key is UNIQUE: queueing the same key twice is a no-op, which is
// what makes "never email Ryder twice for the same attempt" hold.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMail, type MailAttachment } from './mailer.ts'
import { runInBackground } from './http.ts'
import { runAfterSendHook } from './emailHooks.ts'

export interface OutboxAttachment {
  bucket: string
  path: string
  filename: string
  content_type?: string
}

export interface QueueEmailInput {
  kind: string
  to: string[]
  cc?: string[]
  subject: string
  html?: string
  text?: string
  attachments?: OutboxAttachment[]
  relatedInvoiceIds?: string[]
  relatedBatchId?: string | null
  dedupeKey?: string | null
  createdBy?: string | null
  sendAfter?: Date
}

export interface QueueResult {
  id: string | null
  duplicate: boolean
}

export async function queueEmail(admin: SupabaseClient, e: QueueEmailInput): Promise<QueueResult> {
  const row = {
    kind: e.kind,
    to_emails: e.to,
    cc_emails: e.cc ?? [],
    subject: e.subject,
    body_html: e.html ?? null,
    body_text: e.text ?? null,
    attachments: e.attachments ?? [],
    related_invoice_ids: e.relatedInvoiceIds ?? [],
    related_batch_id: e.relatedBatchId ?? null,
    dedupe_key: e.dedupeKey ?? null,
    created_by: e.createdBy ?? null,
    next_attempt_at: (e.sendAfter ?? new Date()).toISOString(),
  }
  const { data, error } = await admin.from('email_outbox').insert(row).select('id').single()
  if (error) {
    if (error.code === '23505') return { id: null, duplicate: true } // dedupe_key already queued
    throw error
  }
  return { id: data.id, duplicate: false }
}

// Retry delays after attempt 1, 2, 3, 4 fail (minutes). Attempt 5 failing is final.
const BACKOFF_MINUTES = [1, 5, 15, 60]

export interface OutboxRunResult {
  claimed: number
  sent: number
  retrying: number
  failed: number
  errors: { id: string; subject: string; error: string }[]
}

async function loadAttachments(admin: SupabaseClient, list: OutboxAttachment[]): Promise<MailAttachment[]> {
  const out: MailAttachment[] = []
  for (const a of list) {
    const { data, error } = await admin.storage.from(a.bucket).download(a.path)
    if (error || !data) throw new Error(`attachment ${a.bucket}/${a.path}: ${error?.message ?? 'not found'}`)
    out.push({
      filename: a.filename,
      content: new Uint8Array(await data.arrayBuffer()),
      contentType: a.content_type ?? data.type ?? undefined,
    })
  }
  return out
}

/** Claims due emails and sends them. Safe to run concurrently (rows are locked). */
export async function processOutbox(admin: SupabaseClient, limit = 10): Promise<OutboxRunResult> {
  const result: OutboxRunResult = { claimed: 0, sent: 0, retrying: 0, failed: 0, errors: [] }
  const { data: rows, error } = await admin.rpc('claim_email_outbox', { p_limit: limit })
  if (error) throw error
  result.claimed = rows?.length ?? 0

  for (const row of rows ?? []) {
    try {
      const attachments = await loadAttachments(admin, row.attachments ?? [])
      const sent = await sendMail({
        to: row.to_emails,
        cc: row.cc_emails,
        subject: row.subject,
        html: row.body_html,
        text: row.body_text,
        attachments,
      })
      await admin.from('email_outbox').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        smtp_message_id: sent.messageId,
        redirected_to: sent.redirectedTo,
        last_error: null,
        locked_at: null,
      }).eq('id', row.id)
      result.sent++

      // Follow-up DB updates for this kind of email (e.g. payment_request → Advance Confirmed).
      const hookError = await runAfterSendHook(admin, row)
      if (hookError) {
        await admin.from('email_outbox').update({ last_error: `after-send: ${hookError}`.slice(0, 2000) }).eq('id', row.id)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const final = row.attempts >= row.max_attempts
      const delay = BACKOFF_MINUTES[Math.min(row.attempts - 1, BACKOFF_MINUTES.length - 1)]
      await admin.from('email_outbox').update({
        status: final ? 'failed' : 'pending',
        last_error: message.slice(0, 2000),
        locked_at: null,
        next_attempt_at: final ? row.next_attempt_at : new Date(Date.now() + delay * 60_000).toISOString(),
      }).eq('id', row.id)
      result.errors.push({ id: row.id, subject: row.subject, error: message })
      if (final) {
        result.failed++
        await admin.from('notifications').insert({
          audience: 'admin',
          title: `Email failed after ${row.attempts} attempts`,
          body: `"${row.subject}" to ${row.to_emails.join(', ')} — ${message}`.slice(0, 1000),
        })
      } else {
        result.retrying++
      }
    }
  }
  return result
}

/** Fire-and-forget send right after queueing; the cron retries anything left. */
export function kickOutbox(admin: SupabaseClient): void {
  runInBackground(processOutbox(admin, 10))
}
