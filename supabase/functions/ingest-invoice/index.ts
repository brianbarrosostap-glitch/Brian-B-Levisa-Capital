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
    if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
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

    // ── Upsert the invoice (idempotent on invoice_number) ─────
    // If the same file is re-processed, we just refresh the Drive link.
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

    const { data: invoice, error: upErr } = await service
      .from('invoices')
      .upsert(row, { onConflict: 'invoice_number' })
      .select()
      .single()

    if (upErr) throw upErr

    // ── Audit log (machine ingest) ────────────────────────────
    await service.from('audit_logs').insert({
      table_name: 'invoices',
      record_id: invoice.id,
      action: 'insert',
      invoice_number: invoice.invoice_number,
      summary: `Invoice ${invoice.invoice_number} ingested from Drive (${drive_file_id})`,
      source: 'ingest-invoice',
    })

    return json({ success: true, invoice })
  } catch (err) {
    console.error('ingest-invoice error:', err)
    return json({ error: String(err) }, 500)
  }
})
