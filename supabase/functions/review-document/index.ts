/**
 * Edge Function: review-document   (admin only)
 *
 * Resolves an upload that could not be saved automatically (Upload Review).
 *
 * POST /functions/v1/review-document
 *   { job_id, action: 'approve', fields, note? }   save with the admin's corrected fields
 *   { job_id, action: 'retry' }                    read the document again
 *   { job_id, action: 'reject', note? }            discard (customer sees "Not accepted")
 *
 * fields — invoice: { invoice_number, po_number, unit_number, invoice_date, invoice_amount }
 *          cheque:  { check_number, check_date, batch_number?, amount, lines: [{ invoice_number, amount_paid }] }
 *
 * Returns { job }.
 */

import { HttpError, json, preflight } from '../_shared/http.ts'
import { adminClient, requireRole } from '../_shared/auth.ts'
import { processJob } from '../_shared/documents.ts'
import { createInvoice, ingestCheque } from '../_shared/ingest.ts'
import {
  type ChequeFields, type InvoiceFields, normalizeInvoiceNumber, normalizePo, parseDate, toNumber,
} from '../_shared/extract.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const admin = adminClient()
  try {
    const caller = await requireRole(req, admin, ['admin'])
    const body = await req.json().catch(() => ({})) as {
      job_id?: string; action?: string; fields?: Record<string, unknown>; note?: string
    }
    if (!body.job_id) throw new HttpError(400, 'job_id is required')

    const { data: job, error } = await admin.from('document_jobs').select('*').eq('id', body.job_id).single()
    if (error || !job) throw new HttpError(404, 'Upload not found')
    if (job.status === 'added') throw new HttpError(409, 'This upload was already saved')

    const actor = { id: caller.user.id, email: caller.user.email ?? null }
    const reviewed = { reviewed_by: caller.user.id, reviewed_at: new Date().toISOString(), review_note: body.note ?? null }

    if (body.action === 'retry') {
      const final = await processJob(admin, job.id, actor)
      return json({ job: final })
    }

    if (body.action === 'reject') {
      const { data: rejected } = await admin.from('document_jobs')
        .update({ ...reviewed, status: 'rejected', status_reason: body.note ? `Rejected: ${body.note}` : 'Rejected by admin' })
        .eq('id', job.id).select('*').single()
      if (job.kind === 'invoice' && job.client_id) {
        await admin.from('notifications').insert({
          client_id: job.client_id,
          audience: 'customer',
          title: 'Upload not accepted',
          body: `${job.original_filename ?? 'Your upload'} was not accepted${body.note ? `: ${body.note}` : '.'}`,
        })
      }
      return json({ job: rejected })
    }

    if (body.action !== 'approve') throw new HttpError(400, "action must be 'approve', 'retry' or 'reject'")
    const f = body.fields ?? {}

    if (job.kind === 'invoice') {
      const fields: InvoiceFields = {
        invoice_number: normalizeInvoiceNumber(f.invoice_number),
        po_number: normalizePo(f.po_number),
        unit_number: f.unit_number ? String(f.unit_number).trim() : null,
        invoice_date: parseDate(f.invoice_date),
        invoice_amount: toNumber(f.invoice_amount),
      }
      if (!fields.invoice_number) throw new HttpError(400, 'Invoice number is required')
      if (!fields.invoice_amount || fields.invoice_amount <= 0) throw new HttpError(400, 'Amount must be greater than 0')
      if (!fields.invoice_date) throw new HttpError(400, 'Invoice date is required (YYYY-MM-DD)')
      if (!job.client_id) throw new HttpError(400, 'Upload has no client')

      const result = await createInvoice(admin, {
        fields,
        clientId: job.client_id,
        storagePath: job.storage_path,
        pdfPath: job.extracted?.pdf_path ?? null,
        fileSha256: job.file_sha256,
        source: 'review-document',
        actorId: actor.id,
        actorEmail: actor.email,
      })
      const { data: saved } = await admin.from('document_jobs').update({
        ...reviewed,
        status: result.outcome,
        invoice_id: result.invoiceId,
        extracted: { ...(job.extracted ?? {}), ...fields, reviewed: true },
        status_reason: result.outcome === 'duplicate'
          ? `Invoice ${fields.invoice_number} already exists (status ${result.status})`
          : 'Saved by admin review',
      }).eq('id', job.id).select('*').single()
      return json({ job: saved })
    }

    // cheque
    const lines = Array.isArray(f.lines) ? (f.lines as Record<string, unknown>[]) : []
    const fields: ChequeFields = {
      check_number: f.check_number ? String(f.check_number).trim() : null,
      check_date: parseDate(f.check_date),
      batch_number: f.batch_number ? String(f.batch_number) : null,
      amount: toNumber(f.amount),
      lines: lines
        .map((l) => ({
          invoice_number: normalizeInvoiceNumber(l.invoice_number) ?? '',
          amount_paid: toNumber(l.amount_paid),
          invoice_amount: toNumber(l.invoice_amount),
          deduction: toNumber(l.deduction),
        }))
        .filter((l) => l.invoice_number),
    }
    if (!fields.check_number) throw new HttpError(400, 'Cheque number is required')
    if (!fields.amount || fields.amount <= 0) throw new HttpError(400, 'Amount must be greater than 0')

    const result = await ingestCheque(admin, {
      fields, storagePath: job.storage_path, fileSha256: job.file_sha256,
      source: 'review-document', actorId: actor.id, actorEmail: actor.email,
    })
    const { data: saved } = await admin.from('document_jobs').update({
      ...reviewed,
      status: result.outcome,
      cheque_id: result.chequeId,
      extracted: { ...(job.extracted ?? {}), ...fields, reviewed: true },
      status_reason: result.outcome === 'duplicate'
        ? `Cheque ${fields.check_number} is already recorded`
        : `Saved by admin review — matched ${result.matched.length} invoice(s)`
          + (result.missing.length ? `; not in portal: ${result.missing.join(', ')}` : ''),
    }).eq('id', job.id).select('*').single()
    return json({ job: saved })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error('review-document error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, status)
  }
})
