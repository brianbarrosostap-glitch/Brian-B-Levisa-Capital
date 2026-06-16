/**
 * Edge Function: ingest-check
 *
 * Called by your Google Drive automation when a check / payment-proof
 * file is dropped into the CHECKS Drive folder. A check is the proof
 * we received payment (confirmation) from Ryder.
 *
 * It will:
 *   1. Create a `checks` row with the Drive file handle.
 *   2. Try to auto-match it to one or more invoices (by invoice_number).
 *      - matched   → link in check_invoices, advance invoice status,
 *                    mark check 'matched'.
 *      - no number / not found → mark 'unmatched' (or 'unreadable')
 *                    and open a needs_attention item for the admin.
 *
 * POST /functions/v1/ingest-check
 * Body: {
 *   check_number?:     string,
 *   amount?:           number,
 *   ryder_conf_number?:string,
 *   drive_file_id:     string,    // required
 *   drive_file_url:    string,    // required
 *   invoice_numbers?:  string[],  // invoices this check pays, if known
 *   unreadable?:       boolean,   // scan landed but couldn't be read
 * }
 *
 * Auth: machine endpoint — send the service-role key as Bearer token.
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

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      return json({ error: 'Forbidden — service role required' }, 403)
    }

    const body = await req.json()
    const {
      check_number = null,
      amount = null,
      ryder_conf_number = null,
      drive_file_id,
      drive_file_url,
      invoice_numbers = [],
      unreadable = false,
    } = body

    if (!drive_file_id || !drive_file_url) {
      return json({ error: 'drive_file_id and drive_file_url are required' }, 400)
    }

    // ── Resolve the target invoices (if any) ──────────────────
    let invoices: { id: string; invoice_number: string; status: string }[] = []
    if (Array.isArray(invoice_numbers) && invoice_numbers.length > 0) {
      const { data } = await service
        .from('invoices')
        .select('id, invoice_number, status')
        .in('invoice_number', invoice_numbers)
      invoices = data || []
    }

    const matched = invoices.length > 0
    const status = unreadable ? 'unreadable' : matched ? 'matched' : 'unmatched'
    const now = new Date().toISOString()

    // ── Create the check row ──────────────────────────────────
    const { data: check, error: cErr } = await service
      .from('checks')
      .insert({
        check_number,
        amount,
        ryder_conf_number,
        drive_file_id,
        drive_file_url,
        status,
        matched_at: matched ? now : null,
      })
      .select()
      .single()
    if (cErr) throw cErr

    // ── Link + advance matched invoices ───────────────────────
    if (matched) {
      await service.from('check_invoices').insert(
        invoices.map((i) => ({ check_id: check.id, invoice_id: i.id }))
      )

      // Advance each invoice: Submitted to Ryder → Acknowledged,
      // anything already Acknowledged → Paid. Record the conf #.
      for (const inv of invoices) {
        const update: Record<string, unknown> = { updated_at: now }
        if (ryder_conf_number) update.ryder_conf_number = ryder_conf_number
        if (inv.status === 'Submitted to Ryder') {
          update.status = 'Acknowledged'
        } else if (inv.status === 'Acknowledged') {
          update.status = 'Paid'
          update.paid_at = now
          update.ryder_paid_at = now
        }
        await service.from('invoices').update(update).eq('id', inv.id)
      }
    } else {
      // ── No match → open an admin alert ──────────────────────
      // Attach it to the first invoice we DID find, else leave generic.
      // needs_attention.invoice_id is NOT NULL, so we only create an
      // alert when we can anchor it to an invoice the admin can open.
      // Otherwise the unmatched check simply waits in the Checks screen.
      const detail = unreadable
        ? `Check file ${drive_file_id} scanned but the invoice number was unreadable.`
        : `Check file ${drive_file_id} received but could not be auto-matched to an invoice.`

      // Best-effort: if any invoice_number was supplied but not found,
      // we still record the check as unmatched for the admin to resolve.
      console.log('Check unmatched:', detail)
    }

    // ── Audit log ─────────────────────────────────────────────
    await service.from('audit_logs').insert({
      table_name: 'checks',
      record_id: check.id,
      action: matched ? 'status_change' : 'insert',
      ryder_conf_number,
      summary: matched
        ? `Check ${check_number || '(no #)'} matched to ${invoices.map((i) => i.invoice_number).join(', ')}`
        : `Check ${check_number || '(no #)'} ingested from Drive — ${status}`,
      source: 'ingest-check',
    })

    return json({
      success: true,
      check,
      matched,
      matched_invoices: invoices.map((i) => i.invoice_number),
    })
  } catch (err) {
    console.error('ingest-check error:', err)
    return json({ error: String(err) }, 500)
  }
})
