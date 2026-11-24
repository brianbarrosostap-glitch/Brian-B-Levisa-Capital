/**
 * Edge Function: restore-invoice   (admin only)
 *
 * Restores an invoice the customer deleted (from public.deleted_invoices).
 *
 * POST /functions/v1/restore-invoice   { deleted_id }
 * Returns { invoice }.
 */

import { HttpError, json, preflight } from '../_shared/http.ts'
import { adminClient, requireRole } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const admin = adminClient()
  try {
    const caller = await requireRole(req, admin, ['admin'])
    const { deleted_id } = await req.json().catch(() => ({})) as { deleted_id?: string }
    if (!deleted_id) throw new HttpError(400, 'deleted_id is required')

    const { data: invoiceId, error } = await admin.rpc('restore_deleted_invoice', {
      p_deleted_id: deleted_id, p_actor: caller.user.id,
    })
    if (error) throw new HttpError(409, error.message)

    const { data: invoice } = await admin.from('invoices').select('*').eq('id', invoiceId).single()

    await admin.from('audit_logs').insert({
      table_name: 'invoices',
      record_id: invoiceId,
      action: 'insert',
      actor_id: caller.user.id,
      actor_email: caller.user.email,
      invoice_number: invoice?.invoice_number,
      new_status: invoice?.status,
      summary: `Admin restored deleted invoice ${invoice?.invoice_number}`,
      source: 'restore-invoice',
    })
    if (invoice?.client_id) {
      await admin.from('notifications').insert({
        client_id: invoice.client_id,
        audience: 'customer',
        title: `Invoice ${invoice.invoice_number} restored`,
        body: `Invoice ${invoice.invoice_number} was restored to your portal by Levisa Capital.`,
      })
    }
    return json({ invoice })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error('restore-invoice error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, status)
  }
})
