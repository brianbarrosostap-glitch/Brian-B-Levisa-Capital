// Database writes shared by uploads, admin review and the mailbox reader.
// Behaviour matches the old ingest-invoice / ingest-check / ingest-confirmation
// functions (which n8n called), so every DB trigger fires exactly as before.

import type { SupabaseClient } from '@supabase/supabase-js'
import { chequeKey, type ChequeFields, type InvoiceFields } from './extract.ts'

const TERMINAL = ['Paid', 'Void', 'Cancelled']

// ── Invoices ─────────────────────────────────────────────────

export interface CreateInvoiceInput {
  fields: InvoiceFields
  clientId: string
  storagePath: string | null
  pdfPath: string | null
  fileSha256: string | null
  source: string            // audit source, e.g. 'process-document' / 'review-document'
  actorId?: string | null
  actorEmail?: string | null
}

export type CreateInvoiceResult =
  | { outcome: 'added'; invoiceId: string }
  | { outcome: 'duplicate'; invoiceId: string; status: string }

/** New invoice → status Uploaded. An existing invoice number is a duplicate (never overwritten). */
export async function createInvoice(admin: SupabaseClient, input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const f = input.fields
  if (!f.invoice_number) throw new Error('invoice_number is required')
  if (f.invoice_amount === null || f.invoice_amount === undefined) throw new Error('invoice_amount is required')

  const { data: existing } = await admin
    .from('invoices').select('id, status').eq('invoice_number', f.invoice_number).maybeSingle()
  if (existing) return { outcome: 'duplicate', invoiceId: existing.id, status: existing.status }

  const { data: client, error: cErr } = await admin
    .from('clients').select('id, advance_rate').eq('id', input.clientId).single()
  if (cErr || !client) throw new Error(`Client ${input.clientId} not found`)

  const row: Record<string, unknown> = {
    invoice_number: f.invoice_number,
    client_id: client.id,
    unit_number: f.unit_number ?? '',
    po_number: f.po_number,
    invoice_date: f.invoice_date ?? new Date().toISOString().slice(0, 10),
    invoice_amount: f.invoice_amount,
    storage_path: input.storagePath,
    pdf_path: input.pdfPath,
    file_sha256: input.fileSha256,
  }
  if (client.advance_rate != null) row.advance_rate = client.advance_rate

  const { data: inv, error } = await admin.from('invoices').insert(row).select('id').single()
  if (error) {
    if (error.code === '23505') { // raced with another upload of the same number
      const { data: dup } = await admin.from('invoices').select('id, status').eq('invoice_number', f.invoice_number).single()
      return { outcome: 'duplicate', invoiceId: dup!.id, status: dup!.status }
    }
    throw error
  }

  await admin.from('audit_logs').insert({
    table_name: 'invoices',
    record_id: inv.id,
    action: 'insert',
    actor_id: input.actorId ?? null,
    actor_email: input.actorEmail ?? null,
    invoice_number: f.invoice_number,
    summary: `Invoice ${f.invoice_number} added from portal upload — $${Number(f.invoice_amount).toFixed(2)}`
      + (f.po_number ? `, PO ${f.po_number}` : ''),
    source: input.source,
  })
  return { outcome: 'added', invoiceId: inv.id }
}

// ── Cheques ──────────────────────────────────────────────────

export interface IngestChequeInput {
  fields: ChequeFields
  storagePath: string | null
  fileSha256: string | null
  source: string
  actorId?: string | null
  actorEmail?: string | null
}

export type IngestChequeResult =
  | { outcome: 'added'; chequeId: string; matched: string[]; missing: string[]; shortPaid: string[] }
  | { outcome: 'duplicate'; chequeId: string }

/**
 * One cheque row per physical cheque + one cheque_invoices row per remittance
 * line (with the amount paid). Matched invoices → Paid (same as ingest-check).
 */
export async function ingestCheque(admin: SupabaseClient, input: IngestChequeInput): Promise<IngestChequeResult> {
  const f = input.fields
  const key = chequeKey(f.check_number)

  if (key) {
    // Same physical cheque already recorded? (prod stores numbers with and without leading zeros)
    const { data: candidates } = await admin
      .from('cheques').select('id, check_number').ilike('check_number', `%${key}`)
    const dup = (candidates ?? []).find((c) => chequeKey(c.check_number) === key)
    if (dup) return { outcome: 'duplicate', chequeId: dup.id }
  }

  const numbers = [...new Set(f.lines.map((l) => l.invoice_number).filter(Boolean))]
  const { data: invoices } = numbers.length
    ? await admin.from('invoices').select('id, invoice_number, status, invoice_amount').in('invoice_number', numbers)
    : { data: [] as { id: string; invoice_number: string; status: string; invoice_amount: number }[] }
  const byNumber = new Map((invoices ?? []).map((i) => [i.invoice_number, i]))
  const matched = numbers.filter((n) => byNumber.has(n))
  const missing = numbers.filter((n) => !byNumber.has(n))
  const now = new Date().toISOString()
  const primary = matched.length ? byNumber.get(matched[0])! : null

  const { data: cheque, error } = await admin.from('cheques').insert({
    check_number: f.check_number,
    amount: f.amount,
    check_date: f.check_date,
    batch_number: f.batch_number ?? null,
    storage_path: input.storagePath,
    file_sha256: input.fileSha256,
    status: matched.length ? 'matched' : 'unmatched',
    invoice_number: primary?.invoice_number ?? numbers[0] ?? null,
    invoice_id: primary?.id ?? null,
    matched_at: matched.length ? now : null,
    note: missing.length ? `Not found in portal: ${missing.join(', ')}` : null,
  }).select('id').single()
  if (error) throw error

  const shortPaid: string[] = []
  if (matched.length) {
    const links = f.lines
      .filter((l) => byNumber.has(l.invoice_number))
      .map((l) => ({
        cheque_id: cheque.id,
        invoice_id: byNumber.get(l.invoice_number)!.id,
        amount: l.amount_paid ?? null,
        invoice_amount_on_cheque: l.invoice_amount ?? null,
        deduction: l.deduction ?? null,
      }))
    // one row per invoice (PK cheque_id+invoice_id)
    const unique = [...new Map(links.map((l) => [l.invoice_id, l])).values()]
    const { error: linkErr } = await admin.from('cheque_invoices').insert(unique)
    if (linkErr) throw linkErr

    for (const n of matched) {
      const inv = byNumber.get(n)!
      const line = f.lines.find((l) => l.invoice_number === n)
      if (line?.amount_paid != null && Number(inv.invoice_amount) - line.amount_paid > 0.01) shortPaid.push(n)
      if (!TERMINAL.includes(inv.status)) {
        await admin.from('invoices').update({
          status: 'Paid', paid_at: now, ryder_paid_at: now, due_date: null,
        }).eq('id', inv.id)
      }
    }
  }

  if (!matched.length || missing.length || shortPaid.length) {
    const parts = [
      !matched.length ? `none of its invoices (${numbers.join(', ') || 'none read'}) are in the portal` : '',
      matched.length && missing.length ? `not found in portal: ${missing.join(', ')}` : '',
      shortPaid.length ? `paid less than the invoice amount: ${shortPaid.join(', ')}` : '',
    ].filter(Boolean)
    await admin.from('needs_attention').insert({
      cheque_id: cheque.id,
      invoice_id: primary?.id ?? null,
      type: 'check_unmatched',
      title: !matched.length ? 'Cheque Unmatched' : shortPaid.length ? 'Cheque short-paid' : 'Cheque partly unmatched',
      detail: `Cheque ${f.check_number ?? '(no #)'} $${(f.amount ?? 0).toFixed(2)} — ${parts.join('; ')}.`,
      action_label: 'Review',
      check_number: f.check_number,
    })
  }

  await admin.from('audit_logs').insert({
    table_name: 'cheques',
    record_id: cheque.id,
    action: matched.length ? 'status_change' : 'insert',
    actor_id: input.actorId ?? null,
    actor_email: input.actorEmail ?? null,
    summary: matched.length
      ? `Cheque ${f.check_number ?? '(no #)'} $${(f.amount ?? 0).toFixed(2)} uploaded → ${matched.join(', ')} marked Paid`
        + (missing.length ? `; not found: ${missing.join(', ')}` : '')
      : `Cheque ${f.check_number ?? '(no #)'} uploaded — no matching invoices`,
    source: input.source,
  })

  return { outcome: 'added', chequeId: cheque.id, matched, missing, shortPaid }
}

// ── Confirmations (mailbox) ──────────────────────────────────

/** Ryder/Docufree confirmed receipt → Acknowledged + conf # + 60-day due date (same as ingest-confirmation). */
export async function applyRyderConfirmation(
  admin: SupabaseClient,
  invoiceNumber: string,
  confNumber: string | null,
  source: string,
): Promise<{ found: boolean; already?: boolean; invoiceId?: string; status?: string }> {
  const { data: inv } = await admin
    .from('invoices').select('id, invoice_number, status, ryder_submitted_at, ryder_confirmed_at')
    .eq('invoice_number', invoiceNumber).maybeSingle()
  if (!inv) return { found: false }

  // Already acknowledged (Ryder often confirms each resubmission, and n8n handled
  // older emails): don't touch it — re-stamping would push the 60-day due date out.
  if (inv.ryder_confirmed_at) return { found: true, already: true, invoiceId: inv.id, status: inv.status }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { ryder_confirmed_at: now }
  if (confNumber) update.ryder_conf_number = confNumber
  if (!TERMINAL.includes(inv.status)) {
    update.status = 'Acknowledged'
    if (!inv.ryder_submitted_at) update.ryder_submitted_at = now
    const due = new Date(now)
    due.setDate(due.getDate() + 60)
    update.due_date = due.toISOString().slice(0, 10)
  }
  const { error } = await admin.from('invoices').update(update).eq('id', inv.id)
  if (error) throw error

  await admin.from('audit_logs').insert({
    table_name: 'invoices',
    record_id: inv.id,
    action: update.status ? 'status_change' : 'update',
    invoice_number: inv.invoice_number,
    old_status: inv.status,
    new_status: (update.status as string) ?? inv.status,
    summary: `Ryder confirmed invoice ${inv.invoice_number}${confNumber ? ` (conf #${confNumber})` : ''}`
      + (update.status ? ` → Acknowledged, due ${update.due_date}` : ` (status ${inv.status} unchanged — terminal)`),
    source,
  })
  return { found: true, invoiceId: inv.id, status: (update.status as string) ?? inv.status }
}

/** RZR replied "Approved"/"Accepted" → Advance Agreed (stamps advance_agreed_at via DB trigger). */
export async function markAdvanceAgreed(
  admin: SupabaseClient,
  invoiceNumbers: string[],
  meta: { fromEmail: string; messageId: string; source: string },
): Promise<{ agreed: string[]; skipped: { invoice_number: string; reason: string }[] }> {
  const agreed: string[] = []
  const skipped: { invoice_number: string; reason: string }[] = []
  if (!invoiceNumbers.length) return { agreed, skipped }

  const { data: rows } = await admin
    .from('invoices').select('id, invoice_number, status').in('invoice_number', invoiceNumbers)
  const found = new Map((rows ?? []).map((r) => [r.invoice_number, r]))
  const now = new Date().toISOString()

  for (const n of invoiceNumbers) {
    const inv = found.get(n)
    if (!inv) { skipped.push({ invoice_number: n, reason: 'not found' }); continue }
    if (!['Advance Confirmed', 'Payment Requested'].includes(inv.status)) {
      skipped.push({ invoice_number: n, reason: `status is ${inv.status}` })
      continue
    }
    const { data: upd } = await admin.from('invoices').update({
      status: 'Advance Agreed',
      customer_confirmed_at: now,
      customer_conf_email: meta.messageId,
    }).eq('id', inv.id).eq('status', inv.status).select('id')
    if (upd?.length) agreed.push(n)
    else skipped.push({ invoice_number: n, reason: 'changed concurrently' })
  }

  if (agreed.length) {
    await admin.from('audit_logs').insert({
      table_name: 'invoices',
      action: 'status_change',
      new_status: 'Advance Agreed',
      actor_email: meta.fromEmail,
      summary: `RZR replied "Approved/Accepted" (${meta.fromEmail}) → Advance Agreed: ${agreed.join(', ')}`,
      source: meta.source,
    })
  }
  return { agreed, skipped }
}
