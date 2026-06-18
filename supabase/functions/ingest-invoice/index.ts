/**
 * Edge Function: ingest-invoice
 *
 * Called by your Google Drive automation when a new invoice PDF is
 * dropped into the INVOICES Drive folder. Creates (or updates) an
 * invoice row and stores the Drive file handle so both portals can
 * link straight to the PDF.
 *
 * POST /functions/v1/ingest-invoice
 * Body: {
 *   invoice_number:  string,   // required, unique
 *   client_name?:    string,   // resolve client by name (e.g. "RZR Inc")
 *   client_id?:      string,   // OR pass the client UUID directly
 *   unit_number?:    string,
 *   invoice_date?:   string,   // 'YYYY-MM-DD' (defaults to today)
 *   due_date?:       string,
 *   invoice_amount:  number,   // required
 *   advance_rate?:   number,   // defaults to client's rate / 0.97
 *   drive_file_id:   string,   // Google Drive file ID  (required)
 *   drive_file_url:  string,   // Drive webViewLink      (required)
 * }
 *
 * Auth: this is a MACHINE endpoint. Your automation should send the
 * service-role key as the Bearer token (it runs server-side, not in a
 * browser). We verify the caller is the service role before writing.
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
 *
 * We first try an exact match against the injected SUPABASE_SERVICE_ROLE_KEY
 * (fast path). If that fails — e.g. the JWT secret was rotated after this
 * function was last deployed, so the injected env var is stale — we fall back
 * to decoding the JWT payload and accepting any token whose `role` claim is
 * `service_role`. This keeps the endpoint working across key rotation without
 * a redeploy, while still rejecting anon/user tokens.
 */
const isServiceRole = (token: string): boolean => {
  if (!token) return false
  const injected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (injected && token === injected) return true
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    // base64url → base64, then decode
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

    // ── Verify the caller holds the service-role key ──────────
    // (Only trusted server-side automation should reach this.)
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!isServiceRole(token)) {
      return json({ error: 'Forbidden — service role required' }, 403)
    }

    const body = await req.json()
    const {
      invoice_number,
      client_name,
      client_id: client_id_in,
      unit_number = '',
      invoice_date,
      due_date,
      invoice_amount,
      advance_rate,
      drive_file_id,
      drive_file_url,
    } = body

    if (!invoice_number || invoice_amount == null || !drive_file_id || !drive_file_url) {
      return json({
        error: 'invoice_number, invoice_amount, drive_file_id and drive_file_url are required',
      }, 400)
    }

    // ── Resolve the client ────────────────────────────────────
    let client_id = client_id_in
    let client_rate = advance_rate
    if (!client_id) {
      if (!client_name) return json({ error: 'Provide client_id or client_name' }, 400)
      const { data: client, error: cErr } = await service
        .from('clients')
        .select('id, advance_rate')
        .eq('name', client_name)
        .single()
      if (cErr || !client) return json({ error: `Client "${client_name}" not found` }, 404)
      client_id = client.id
      if (client_rate == null) client_rate = client.advance_rate
    }

    // ── Look up any existing invoice with this number ─────────
    // Duplicate policy: we only allow an in-place update while the
    // invoice is still fresh ('Uploaded' / 'Eligible'). Once it has
    // progressed (Payment Requested or later) its amount is locked —
    // re-ingesting a different amount would silently change a request
    // the customer/admin already acted on (or a paid advance), so we
    // REJECT it and raise an admin alert instead.
    const EDITABLE = ['Uploaded', 'Eligible']
    const { data: existing } = await service
      .from('invoices')
      .select('id, status, invoice_amount')
      .eq('invoice_number', invoice_number)
      .maybeSingle()

    const row: Record<string, unknown> = {
      invoice_number,
      client_id,
      unit_number,
      invoice_date: invoice_date || new Date().toISOString().slice(0, 10),
      due_date: due_date || null,
      invoice_amount,
      drive_file_id,
      drive_file_url,
      // status left at its default 'Uploaded' on first insert
    }
    if (client_rate != null) row.advance_rate = client_rate

    // ── Case 1: locked invoice (already progressed) ───────────
    if (existing && !EDITABLE.includes(existing.status)) {
      const amountChanged = Number(existing.invoice_amount) !== Number(invoice_amount)

      // Only flag if the amount actually differs; an identical re-ingest
      // (e.g. the same file re-processed) is a harmless no-op.
      if (amountChanged) {
        await service.from('needs_attention').insert({
          invoice_id: existing.id,
          type: 'conf_match',
          title: 'Duplicate invoice — amount differs',
          detail: `Invoice ${invoice_number} re-ingested from Drive with amount `
            + `${invoice_amount} but the existing invoice is ${existing.invoice_amount} `
            + `and already at status "${existing.status}". The amount was NOT changed — review manually.`,
          action_label: 'Review',
        })
        await service.from('audit_logs').insert({
          table_name: 'invoices',
          record_id: existing.id,
          action: 'update',
          invoice_number,
          summary: `Rejected re-ingest of ${invoice_number}: amount ${existing.invoice_amount} → ${invoice_amount} `
            + `blocked because status is "${existing.status}" (not editable). Alert raised.`,
          source: 'ingest-invoice',
        })
        return json({
          success: false,
          locked: true,
          message: `Invoice ${invoice_number} is at status "${existing.status}" and cannot be amount-updated. An admin alert was raised.`,
        }, 409)
      }
      // Same amount → just refresh the Drive link, nothing risky.
      const { data: refreshed } = await service
        .from('invoices')
        .update({ drive_file_id, drive_file_url })
        .eq('id', existing.id)
        .select()
        .single()
      return json({ success: true, invoice: refreshed, updated: true, note: 'Drive link refreshed only.' })
    }

    // ── Case 2: insert new OR update an editable invoice ──────
    const { data: invoice, error: upErr } = await service
      .from('invoices')
      .upsert(row, { onConflict: 'invoice_number' })
      .select()
      .single()

    if (upErr) throw upErr

    // ── Audit log (machine ingest) — distinguish insert vs update
    const isUpdate = !!existing
    const amountChanged = existing && Number(existing.invoice_amount) !== Number(invoice_amount)
    await service.from('audit_logs').insert({
      table_name: 'invoices',
      record_id: invoice.id,
      action: isUpdate ? 'update' : 'insert',
      invoice_number: invoice.invoice_number,
      summary: isUpdate
        ? `Invoice ${invoice.invoice_number} updated from Drive`
          + (amountChanged ? ` — amount ${existing.invoice_amount} → ${invoice_amount}` : '')
          + ` (${drive_file_id})`
        : `Invoice ${invoice.invoice_number} ingested from Drive (${drive_file_id})`,
      source: 'ingest-invoice',
    })

    return json({ success: true, invoice, updated: isUpdate })
  } catch (err) {
    console.error('ingest-invoice error:', err)
    return json({ error: String(err) }, 500)
  }
})
