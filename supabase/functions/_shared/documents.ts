// Upload pipeline: a document_jobs row goes from processing → added | duplicate | needs_review | failed.
// Used by process-document (new uploads) and review-document (retry).
//
//   Invoice PDF          → Gemini reads it
//   Invoice Excel/CSV    → spreadsheet label parser (Gemini fallback on the PDF copy) + PDF copy for Ryder
//   Google Sheet link    → Composio exports xlsx (parse) + PDF (for Ryder)
//   Cheque photo / PDF   → Gemini reads cheque + remittance lines

import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadDriveFile, driveFileIdFromUrl, XLSX_MIME } from './composio.ts'
import {
  allOk, type Check, type ChequeFields, chequeFromAi, chequeKey, failedSummary, type InvoiceFields, invoiceFromAi,
  invoiceFromRows, round2, rowsFromSpreadsheet, validateCheque, validateInvoice,
} from './extract.ts'
import {
  CHEQUE_INSTRUCTIONS, CHEQUE_SCHEMA, fallbackModel, geminiExtract, INVOICE_INSTRUCTIONS, INVOICE_SCHEMA,
} from './gemini.ts'
import {
  convertToPdf, downloadStorage, extOf, IMAGE_EXT, isPdf, mimeFor, sha256Hex, SPREADSHEET_EXT, uploadStorage,
} from './files.ts'
import { createInvoice, ingestCheque } from './ingest.ts'
import { getSetting } from './settings.ts'

// deno-lint-ignore no-explicit-any
export type Job = Record<string, any>

interface Actor { id: string | null; email: string | null }

async function updateJob(admin: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<Job> {
  const { data, error } = await admin.from('document_jobs').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

function sameFolder(path: string, file: string): string {
  return path.replace(/[^/]+$/, file)
}

/** Runs (or re-runs) one job to a final status. Never throws — failures become status 'failed'. */
export async function processJob(admin: SupabaseClient, jobId: string, actor: Actor): Promise<Job> {
  let job: Job = await updateJob(admin, jobId, { status: 'processing', status_reason: null })
  await admin.from('document_jobs').update({ attempts: (job.attempts ?? 0) + 1 }).eq('id', jobId)
  try {
    job = job.kind === 'cheque' ? await processCheque(admin, job, actor) : await processInvoice(admin, job, actor)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`processJob ${jobId} failed:`, message)
    job = await updateJob(admin, jobId, {
      status: 'failed', status_reason: message.slice(0, 1000), processed_at: new Date().toISOString(),
    })
  }
  if (job.status === 'needs_review' || job.status === 'failed') {
    await admin.from('notifications').insert({
      client_id: job.client_id ?? null,
      audience: 'admin',
      title: `Upload needs review — ${job.original_filename ?? job.kind}`,
      body: `${job.kind === 'cheque' ? 'Cheque' : 'Invoice'} upload could not be saved automatically: ${job.status_reason ?? ''}`.slice(0, 1000),
    })
  }
  return job
}

// ── Invoices ─────────────────────────────────────────────────

async function processInvoice(admin: SupabaseClient, job: Job, actor: Actor): Promise<Job> {
  if (!job.client_id) throw new Error('Invoice upload has no client')
  const vendor = await getSetting<string | null>(admin, 'ryder_vendor_number', null)

  let original: Uint8Array
  let filename: string = job.original_filename ?? 'invoice'
  let storagePath: string | null = job.storage_path
  let pdfBytes: Uint8Array | null = null
  let sheetBytes: Uint8Array | null = null

  if (job.source === 'sheet_link') {
    const fileId = driveFileIdFromUrl(job.sheet_url ?? '')
    if (!fileId) throw new Error('That does not look like a Google Sheets / Drive link')
    const xlsx = await downloadDriveFile(fileId, XLSX_MIME)
    sheetBytes = xlsx.bytes
    original = xlsx.bytes
    filename = (xlsx.name || `sheet-${fileId}`).replace(/\.(xlsx)?$/i, '') + '.xlsx'
    const base = `${job.client_id}/uploads/${job.id}`
    storagePath = `${base}/${filename.replace(/[^A-Za-z0-9._-]/g, '_')}`
    await uploadStorage(admin, 'invoices', storagePath, original, XLSX_MIME)
    const pdf = await downloadDriveFile(fileId, 'application/pdf')
    if (isPdf(pdf.bytes)) pdfBytes = pdf.bytes
    await updateJob(admin, job.id, {
      storage_bucket: 'invoices', storage_path: storagePath, original_filename: filename, mime_type: XLSX_MIME,
    })
  } else {
    if (!storagePath) throw new Error('Upload has no file')
    original = await downloadStorage(admin, 'invoices', storagePath)
  }

  const sha = await sha256Hex(original)
  const dupFile = await findDuplicateFile(admin, 'invoice', sha, job.id)
  if (dupFile) {
    return await updateJob(admin, job.id, {
      file_sha256: sha, status: 'duplicate', invoice_id: dupFile.invoice_id ?? null,
      status_reason: 'This exact file was uploaded before', processed_at: new Date().toISOString(),
    })
  }

  const ext = extOf(filename)
  let fields: InvoiceFields | null = null
  let method = ''

  if (sheetBytes || SPREADSHEET_EXT.includes(ext)) {
    fields = invoiceFromRows(rowsFromSpreadsheet(sheetBytes ?? original))
    method = 'spreadsheet'
    if (!pdfBytes) {
      // Non-fatal: if the converter is down, the PDF is created later (ensureInvoicePdf) before Ryder is emailed.
      try { pdfBytes = await convertToPdf(original, filename) } catch (err) { console.warn('PDF conversion failed:', err) }
    }
    const checks = validateInvoice(fields, vendor)
    if (!allOk(checks) && pdfBytes) {
      // Spreadsheet layout not recognised → let Gemini read the PDF copy.
      const ai = await readInvoiceWithAi({ bytes: pdfBytes, mimeType: 'application/pdf' }, vendor)
      if (allOk(validateInvoice(ai.fields, vendor)) || !fields.invoice_number) { fields = ai.fields; method = `ai_pdf${ai.suffix}` }
    }
  } else if (ext === 'pdf' || isPdf(original)) {
    pdfBytes = original
    const ai = await readInvoiceWithAi({ bytes: original, mimeType: 'application/pdf' }, vendor)
    fields = ai.fields
    method = `ai_pdf${ai.suffix}`
  } else if (IMAGE_EXT.includes(ext)) {
    const ai = await readInvoiceWithAi({ bytes: original, mimeType: mimeFor(filename, 'image/jpeg') }, vendor)
    fields = ai.fields
    method = `ai_image${ai.suffix}`
  } else {
    throw new Error(`Unsupported file type ".${ext}" — upload a PDF, Excel file or Google Sheet link`)
  }

  // Store the PDF copy that will be emailed to Ryder.
  let pdfPath: string | null = null
  if (pdfBytes) {
    pdfPath = pdfBytes === original ? storagePath : sameFolder(storagePath!, 'invoice.pdf')
    if (pdfPath !== storagePath) await uploadStorage(admin, 'invoices', pdfPath!, pdfBytes, 'application/pdf')
  }

  const checks = validateInvoice(fields, vendor)
  const extracted = { ...fields, method, pdf_path: pdfPath }
  const base = { file_sha256: sha, extracted, checks, processed_at: new Date().toISOString() }

  if (!allOk(checks)) {
    // An existing invoice number is reported as duplicate even if other checks failed.
    if (fields.invoice_number) {
      const { data: existing } = await admin.from('invoices').select('id').eq('invoice_number', fields.invoice_number).maybeSingle()
      if (existing) {
        return await updateJob(admin, job.id, {
          ...base, status: 'duplicate', invoice_id: existing.id,
          status_reason: `Invoice ${fields.invoice_number} already exists in the portal`,
        })
      }
    }
    return await updateJob(admin, job.id, { ...base, status: 'needs_review', status_reason: failedSummary(checks) })
  }

  const result = await createInvoice(admin, {
    fields, clientId: job.client_id, storagePath, pdfPath, fileSha256: sha,
    source: 'process-document', actorId: actor.id, actorEmail: actor.email,
  })
  return await updateJob(admin, job.id, {
    ...base,
    status: result.outcome,
    invoice_id: result.invoiceId,
    status_reason: result.outcome === 'duplicate'
      ? `Invoice ${fields.invoice_number} already exists in the portal (status ${result.status})`
      : null,
  })
}

// ── Cheques ──────────────────────────────────────────────────

async function processCheque(admin: SupabaseClient, job: Job, actor: Actor): Promise<Job> {
  if (!job.storage_path) throw new Error('Upload has no file')
  const bytes = await downloadStorage(admin, 'cheques', job.storage_path)
  const sha = await sha256Hex(bytes)
  const dupFile = await findDuplicateFile(admin, 'cheque', sha, job.id)
  if (dupFile) {
    return await updateJob(admin, job.id, {
      file_sha256: sha, status: 'duplicate', cheque_id: dupFile.cheque_id ?? null,
      status_reason: 'This exact file was uploaded before', processed_at: new Date().toISOString(),
    })
  }

  const filename = job.original_filename ?? job.storage_path
  const mime = isPdf(bytes) ? 'application/pdf' : mimeFor(filename, job.mime_type ?? 'image/jpeg')
  const file = { bytes, mimeType: mime }

  // First read with the fast model; if the numbers don't add up, re-read with the stronger model.
  let fields = chequeFromAi(await geminiExtract<Record<string, unknown>>(CHEQUE_INSTRUCTIONS, file, CHEQUE_SCHEMA))
  let checks: Check[] = validateCheque(fields)
  let model = 'primary'
  if (!allOk(checks)) {
    try {
      const second = chequeFromAi(await geminiExtract<Record<string, unknown>>(CHEQUE_INSTRUCTIONS, file, CHEQUE_SCHEMA, fallbackModel()))
      const secondChecks = validateCheque(second)
      if (failures(secondChecks) < failures(checks)) { fields = second; checks = secondChecks; model = 'fallback' }
    } catch (err) {
      console.warn('fallback cheque read failed:', err)
    }
  }
  // Still off? Ryder pays each invoice in full, and the portal knows every invoice amount.
  // If using the portal amounts for the lines that differ makes the lines add up to the
  // cheque total to the cent, the photo was misread — use the portal amounts (and say so).
  let corrections: string[] = []
  if (!allOk(checks)) {
    const fixed = await reconcileWithPortal(admin, fields)
    if (fixed.corrections.length) {
      const fixedChecks = validateCheque(fixed.fields)
      if (allOk(fixedChecks)) {
        fields = fixed.fields
        corrections = fixed.corrections
        checks = [...fixedChecks, { name: 'Misread amounts corrected from portal', ok: true, detail: corrections.join(', ') }]
      }
    }
  }
  // Guard against misread invoice NUMBERS: a line's amount must match the portal amount of
  // the invoice it names, otherwise we could mark the wrong invoice Paid.
  checks = [...checks, await portalAmountCheck(admin, fields)]

  const base = { file_sha256: sha, extracted: { ...fields, model, corrections }, checks, processed_at: new Date().toISOString() }

  if (!allOk(checks)) {
    // A cheque number we already have is a duplicate, whatever else was misread.
    const dup = await findChequeByNumber(admin, fields.check_number)
    if (dup) {
      return await updateJob(admin, job.id, {
        ...base, status: 'duplicate', cheque_id: dup, status_reason: `Cheque ${fields.check_number} is already recorded`,
      })
    }
    return await updateJob(admin, job.id, { ...base, status: 'needs_review', status_reason: failedSummary(checks) })
  }

  const result = await ingestCheque(admin, {
    fields, storagePath: job.storage_path, fileSha256: sha,
    source: 'process-document', actorId: actor.id, actorEmail: actor.email,
  })
  if (result.outcome === 'duplicate') {
    return await updateJob(admin, job.id, {
      ...base, status: 'duplicate', cheque_id: result.chequeId,
      status_reason: `Cheque ${fields.check_number} is already recorded`,
    })
  }
  const notes = [
    result.missing.length ? `not in portal: ${result.missing.join(', ')}` : '',
    result.shortPaid.length ? `short-paid: ${result.shortPaid.join(', ')}` : '',
  ].filter(Boolean).join(' · ')
  return await updateJob(admin, job.id, {
    ...base, status: 'added', cheque_id: result.chequeId,
    status_reason: `Matched ${result.matched.length} invoice(s)${notes ? ` — ${notes}` : ''}`,
  })
}

// ── AI reading with a second opinion ─────────────────────────

const failures = (checks: Check[]) => checks.filter((c) => !c.ok).length

/** Reads an invoice with the fast model; if any check fails, re-reads with the stronger model and keeps the better read. */
async function readInvoiceWithAi(
  file: { bytes: Uint8Array; mimeType: string }, vendor: string | null,
): Promise<{ fields: InvoiceFields; suffix: string }> {
  const first = invoiceFromAi(await geminiExtract<Record<string, unknown>>(INVOICE_INSTRUCTIONS, file, INVOICE_SCHEMA))
  const firstChecks = validateInvoice(first, vendor)
  if (allOk(firstChecks)) return { fields: first, suffix: '' }
  try {
    const second = invoiceFromAi(await geminiExtract<Record<string, unknown>>(INVOICE_INSTRUCTIONS, file, INVOICE_SCHEMA, fallbackModel()))
    if (failures(validateInvoice(second, vendor)) < failures(firstChecks)) return { fields: second, suffix: '_fallback' }
  } catch (err) {
    console.warn('fallback invoice read failed:', err)
  }
  return { fields: first, suffix: '' }
}

/** Swaps misread line amounts for the portal's invoice amounts when that makes the cheque add up exactly. */
async function reconcileWithPortal(
  admin: SupabaseClient, f: ChequeFields,
): Promise<{ fields: ChequeFields; corrections: string[] }> {
  const none = { fields: f, corrections: [] as string[] }
  if (f.amount === null || !f.lines.length) return none
  const { data } = await admin.from('invoices').select('invoice_number, invoice_amount')
    .in('invoice_number', f.lines.map((l) => l.invoice_number))
  const portal = new Map((data ?? []).map((i) => [i.invoice_number, Number(i.invoice_amount)]))
  const corrections: string[] = []
  const lines = f.lines.map((l) => {
    const p = portal.get(l.invoice_number)
    if (p === undefined || (l.deduction ?? 0) !== 0 || l.amount_paid === null || l.amount_paid === undefined) return l
    if (Math.abs(p - l.amount_paid) < 0.005) return l
    corrections.push(`${l.invoice_number}: read ${l.amount_paid.toFixed(2)} → ${p.toFixed(2)}`)
    return { ...l, amount_paid: p, invoice_amount: p }
  })
  if (!corrections.length) return none
  const total = round2(lines.reduce((s, l) => s + (l.amount_paid ?? 0), 0))
  return Math.abs(total - f.amount) <= 0.009 ? { fields: { ...f, lines }, corrections } : none
}

/** Each line whose invoice is in the portal must pay that invoice's amount (minus any printed deduction). */
async function portalAmountCheck(admin: SupabaseClient, f: ChequeFields): Promise<Check> {
  const { data } = f.lines.length
    ? await admin.from('invoices').select('invoice_number, invoice_amount').in('invoice_number', f.lines.map((l) => l.invoice_number))
    : { data: [] as { invoice_number: string; invoice_amount: number }[] }
  const portal = new Map((data ?? []).map((i) => [i.invoice_number, Number(i.invoice_amount)]))
  const mismatches = f.lines
    .filter((l) => portal.has(l.invoice_number))
    .filter((l) => Math.abs(portal.get(l.invoice_number)! - ((l.amount_paid ?? 0) + (l.deduction ?? 0))) > 0.01)
    .map((l) => `${l.invoice_number} reads $${(l.amount_paid ?? 0).toFixed(2)} but portal has $${portal.get(l.invoice_number)!.toFixed(2)}`)
  return {
    name: 'Line amounts match portal invoices',
    ok: mismatches.length === 0,
    detail: mismatches.length ? mismatches.join('; ') : `${portal.size} of ${f.lines.length} line(s) found in portal, amounts match`,
  }
}

async function findChequeByNumber(admin: SupabaseClient, checkNumber: string | null): Promise<string | null> {
  const key = chequeKey(checkNumber)
  if (!key) return null
  const { data } = await admin.from('cheques').select('id, check_number').ilike('check_number', `%${key}`)
  return (data ?? []).find((c) => chequeKey(c.check_number) === key)?.id ?? null
}

// ── Duplicate file detection ─────────────────────────────────

async function findDuplicateFile(admin: SupabaseClient, kind: 'invoice' | 'cheque', sha: string, jobId: string) {
  const { data } = await admin
    .from('document_jobs')
    .select('id, invoice_id, cheque_id')
    .eq('kind', kind).eq('file_sha256', sha).eq('status', 'added').neq('id', jobId)
    .limit(1).maybeSingle()
  if (data) return data
  const table = kind === 'invoice' ? 'invoices' : 'cheques'
  const { data: row } = await admin.from(table).select('id').eq('file_sha256', sha).limit(1).maybeSingle()
  return row ? (kind === 'invoice' ? { invoice_id: row.id } : { cheque_id: row.id }) : null
}
