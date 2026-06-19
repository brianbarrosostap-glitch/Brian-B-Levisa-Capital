/**
 * Edge Function: ingest-confirmation
 *
 * MACHINE endpoint — called by the n8n automation when it parses a
 * confirmation EMAIL. There are two confirmation kinds in the flow,
 * selected by the `kind` field:
 *
 *   kind = "customer"  → RZR confirmed (after admin approval) that they
 *                        want the advance. Stamps customer_confirmed_at.
 *
 *   kind = "ryder"     → Ryder confirmed payment after we emailed them the
 *                        invoice. Their reply contains the invoice id; we
 *                        match by invoice_number, stamp ryder_confirmed_at +
 *                        ryder_conf_number, and advance the invoice status
 *                        (Submitted to Ryder → Acknowledged).
 *
 * POST /functions/v1/ingest-confirmation
 * Body: {
 *   kind:           "customer" | "ryder",   // required
 *   invoice_number: string,                  // required — matched against invoices.invoice_number
 *   conf_number?:   string,                  // Ryder confirmation number (kind=ryder)
 *   conf_email?:    string,                  // source email / message id (audit trail)
 *   confirmed_at?:  string,                  // ISO timestamp; defaults to now
 * }
 *
 * Auth: send the service-role key as the Bearer token (n8n runs server-side).
 */

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

/**
 * Verify the bearer is a service-role token for THIS project.
 * Fast path: exact match against injected SUPABASE_SERVICE_ROLE_KEY.
 * Fallback (key rotated since deploy): decode JWT and accept role=service_role.
 */
const isServiceRole = (token: string): boolean => {
  if (!token) return false
  const injected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (injected && token === injected) return true
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(b64))
    return claims.role === 'service_role'
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!isServiceRole(token)) {
      return json({ error: 'Forbidden — service role required' }, 403)
    }

    const body = await req.json()
    const { kind, invoice_number, conf_number, conf_email, confirmed_at } = body

    if (!kind || !['customer', 'ryder'].includes(kind)) {
      return json({ error: 'kind must be "customer" or "ryder"' }, 400)
    }
    if (!invoice_number) {
      return json({ error: 'invoice_number is required' }, 400)
    }

    // ── Find the invoice by its number ────────────────────────
    const { data: inv, error: findErr } = await service
      .from('invoices')
      .select('id, invoice_number, status')
      .eq('invoice_number', invoice_number)
      .single()

    if (findErr || !inv) {
      return json({ error: `Invoice "${invoice_number}" not found` }, 404)
    }

    const now = confirmed_at || new Date().toISOString()
    const update: Record<string, unknown> = { updated_at: now }
    let summary = ''

    if (kind === 'customer') {
      // RZR confirmed they want the advance (post-approval).
      update.customer_confirmed_at = now
      if (conf_email) update.customer_conf_email = conf_email
      summary = `Customer (RZR) confirmed advance for invoice ${inv.invoice_number} (email parsed by n8n)`
    } else {
      // Ryder confirmed payment — stamp conf + advance status.
      update.ryder_confirmed_at = now
      if (conf_number) update.ryder_conf_number = conf_number
      if (inv.status === 'Submitted to Ryder') {
        update.status = 'Acknowledged'
        // Ryder pays within 60 days of acknowledgement → set the due date
        // to confirmation date + 60 days. This is what the overdue-60 logic
        // and the dashboard "Overdue with Ryder" tile track against.
        const dueDate = new Date(now)
        dueDate.setDate(dueDate.getDate() + 60)
        update.due_date = dueDate.toISOString().slice(0, 10)   // 'YYYY-MM-DD'
      }
      summary = `Ryder confirmed invoice ${inv.invoice_number}`
        + (conf_number ? ` (conf #${conf_number})` : '')
        + (update.status ? ` → Acknowledged, due ${update.due_date}` : '')
    }

    const { data: updated, error: upErr } = await service
      .from('invoices')
      .update(update)
      .eq('id', inv.id)
      .select()
      .single()

    if (upErr) throw upErr

    // ── Audit log (machine ingest) ────────────────────────────
    await service.from('audit_logs').insert({
      table_name: 'invoices',
      record_id: inv.id,
      action: update.status ? 'status_change' : 'update',
      invoice_number: inv.invoice_number,
      new_status: updated.status,
      summary,
      source: 'ingest-confirmation',
    })

    return json({ success: true, invoice: updated })
  } catch (err) {
    console.error('ingest-confirmation error:', err)
    return json({ error: String(err) }, 500)
  }
})
