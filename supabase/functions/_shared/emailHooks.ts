// What happens in the database once a queued email has actually been sent.
// (n8n did the same: send the email first, then update the records.)
//
// A hook failing does NOT mark the email as failed — it was sent, and
// resending would duplicate it. The error is recorded on the outbox row
// and the admin gets a notification instead.

import type { SupabaseClient } from '@supabase/supabase-js'

// deno-lint-ignore no-explicit-any
type OutboxRow = Record<string, any>
type Hook = (admin: SupabaseClient, row: OutboxRow) => Promise<void>

/** payment_request sent to RZR → invoices Advance Confirmed, batch Approved (n8n behaviour: no manual approval). */
const paymentRequestSent: Hook = async (admin, row) => {
  const now = new Date().toISOString()
  const ids: string[] = row.related_invoice_ids ?? []
  if (!ids.length) return

  const { data: changed, error } = await admin
    .from('invoices')
    .update({ status: 'Advance Confirmed', confirmed_at: now })
    .in('id', ids)
    .eq('status', 'Payment Requested') // never move an invoice that already progressed
    .select('id, invoice_number, client_id')
  if (error) throw error

  let batch: { id: string; request_number: string; client_id: string } | null = null
  if (row.related_batch_id) {
    const { data } = await admin
      .from('batches')
      .update({ status: 'Approved', reviewed_at: now })
      .eq('id', row.related_batch_id)
      .eq('status', 'Pending')
      .select('id, request_number, client_id')
      .maybeSingle()
    batch = data
  }

  const numbers = (changed ?? []).map((i) => i.invoice_number)
  await admin.from('audit_logs').insert({
    table_name: 'batches',
    record_id: row.related_batch_id ?? null,
    action: 'status_change',
    old_status: 'Pending',
    new_status: 'Approved',
    summary: `Payment-request email sent to ${row.to_emails.join(', ')} — `
      + `${numbers.length} invoice(s) → Advance Confirmed${numbers.length ? ` (${numbers.join(', ')})` : ''}`,
    source: 'send-emails',
  })

  const clientId = batch?.client_id ?? changed?.[0]?.client_id
  if (clientId && numbers.length) {
    await admin.from('notifications').insert({
      client_id: clientId,
      audience: 'customer',
      new_status: 'Advance Confirmed',
      title: `Advance approved${batch ? ` — ${batch.request_number}` : ''}`,
      body: `${numbers.length} invoice(s) approved. Reply "Approved" or "Accepted" to the email to agree to the 97% advance.`,
    })
  }
}

/** First submission to Ryder sent → Submitted to Ryder (n8n: status + ryder_submitted_at after the Gmail send). */
const ryderSubmitSent: Hook = async (admin, row) => {
  const id = row.related_invoice_ids?.[0]
  if (!id) return
  const now = new Date().toISOString()
  const { data: changed, error } = await admin.from('invoices')
    .update({ status: 'Submitted to Ryder', ryder_submitted_at: now })
    .eq('id', id).in('status', ['Advance Paid', 'Resubmitted'])
    .select('invoice_number')
  if (error) throw error
  if (changed?.length) {
    await admin.from('audit_logs').insert({
      table_name: 'invoices', record_id: id, action: 'status_change',
      invoice_number: changed[0].invoice_number, new_status: 'Submitted to Ryder',
      summary: `Invoice ${changed[0].invoice_number} emailed to Ryder AP (${row.to_emails.join(', ')}) → Submitted to Ryder`,
      source: 'send-emails',
    })
  }
}

/** Resubmission sent → resubmit_count + 1, last_resubmitted_at (status Resubmitted → Submitted to Ryder, as n8n did). */
const ryderResubmitSent: Hook = async (admin, row) => {
  const id = row.related_invoice_ids?.[0]
  if (!id) return
  const attempt = Number(String(row.dedupe_key ?? '').split(':').pop())
  const { data: inv } = await admin.from('invoices')
    .select('invoice_number, status, resubmit_count, ryder_submitted_at').eq('id', id).single()
  if (!inv) return
  if (Number.isFinite(attempt) && attempt > 0 && (inv.resubmit_count ?? 0) >= attempt) return // already counted
  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    resubmit_count: Number.isFinite(attempt) && attempt > 0 ? attempt : (inv.resubmit_count ?? 0) + 1,
    last_resubmitted_at: now,
  }
  if (inv.status === 'Resubmitted' || inv.status === 'Advance Paid') update.status = 'Submitted to Ryder'
  if (!inv.ryder_submitted_at) update.ryder_submitted_at = now
  const { error } = await admin.from('invoices').update(update).eq('id', id)
  if (error) throw error
  await admin.from('audit_logs').insert({
    table_name: 'invoices', record_id: id, action: update.status ? 'status_change' : 'update',
    invoice_number: inv.invoice_number, old_status: inv.status, new_status: (update.status as string) ?? inv.status,
    summary: `Invoice ${inv.invoice_number} re-sent to Ryder (attempt ${update.resubmit_count})`,
    source: 'send-emails',
  })
}

const HOOKS: Record<string, Hook> = {
  payment_request: paymentRequestSent,
  ryder_submit: ryderSubmitSent,
  ryder_resubmit: ryderResubmitSent,
}

export async function runAfterSendHook(admin: SupabaseClient, row: OutboxRow): Promise<string | null> {
  const hook = HOOKS[row.kind]
  if (!hook) return null
  try {
    await hook(admin, row)
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`after-send hook "${row.kind}" failed for ${row.id}:`, message)
    await admin.from('notifications').insert({
      audience: 'admin',
      title: `Email sent but follow-up update failed (${row.kind})`,
      body: `"${row.subject}" — ${message}`.slice(0, 1000),
    })
    return message
  }
}
