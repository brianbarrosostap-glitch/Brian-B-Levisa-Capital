// Queueing the Ryder submission email and the "Invoice X is Paid" email to RZR.
// Status changes happen in emailHooks.ts once the email is actually SENT.

import type { SupabaseClient } from '@supabase/supabase-js'
import { queueEmail, type QueueResult } from './outbox.ts'
import { getSettings } from './settings.ts'
import { advancePaidEmail, ryderSubmissionEmail } from './templates.ts'
import { ensureInvoicePdf } from './invoicePdf.ts'

// deno-lint-ignore no-explicit-any
type Invoice = Record<string, any>

/**
 * attempt 0 = first submission (after the 7-day wait) → kind ryder_submit
 * attempt N = Nth resubmission (every 48h, or the admin "Resubmit" action) → kind ryder_resubmit
 * The dedupe key makes each attempt impossible to send twice.
 */
export async function queueRyderSubmission(
  admin: SupabaseClient, inv: Invoice, attempt: number, createdBy: string | null = null,
): Promise<QueueResult> {
  const settings = await getSettings(admin)
  const to = String(settings.ryder_ap_email ?? '')
  if (!to) throw new Error('app_settings.ryder_ap_email is not configured')
  const pdf = await ensureInvoicePdf(admin, inv)
  const { subject, text } = ryderSubmissionEmail(inv.invoice_number)
  return await queueEmail(admin, {
    kind: attempt === 0 ? 'ryder_submit' : 'ryder_resubmit',
    to: [to],
    subject,
    text,
    attachments: [{ bucket: pdf.bucket, path: pdf.path, filename: pdf.filename, content_type: 'application/pdf' }],
    relatedInvoiceIds: [inv.id],
    dedupeKey: `ryder_submit:${inv.id}:${attempt}`,
    createdBy,
  })
}

/** One email to RZR listing the invoices whose advance was just paid. */
export async function queueAdvancePaidEmail(
  admin: SupabaseClient, invoices: Invoice[], createdBy: string | null = null,
): Promise<QueueResult | null> {
  if (!invoices.length) return null
  const settings = await getSettings(admin)
  const to = String(settings.rzr_email ?? '')
  if (!to) throw new Error('app_settings.rzr_email is not configured')
  const ids = invoices.map((i) => i.id).sort()
  const { subject, text, html } = advancePaidEmail(invoices.map((i) => i.invoice_number))
  return await queueEmail(admin, {
    kind: 'advance_paid',
    to: [to],
    subject,
    text,
    html,
    relatedInvoiceIds: ids,
    dedupeKey: `advance_paid:${ids.join(',')}`.slice(0, 2000),
    createdBy,
  })
}
