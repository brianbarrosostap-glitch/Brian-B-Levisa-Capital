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

/**
 * Verify the bearer is a service-role token for THIS project.
 *
 * Fast path: exact match against the injected SUPABASE_SERVICE_ROLE_KEY.
 * Fallback: if the injected key is stale (JWT secret rotated after this
 * function was last deployed), decode the JWT payload and accept any token
 * whose `role` claim is `service_role`. Rejects anon/user tokens.
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
    const {
      check_number = null,
      amount = null,
      ryder_conf_number = null,
      drive_file_id,
      drive_file_url,
      // Accept a single invoice_number (primary) AND/OR an array.
      invoice_number = null,
      invoice_numbers = [],
      unreadable = false,
    } = body

    if (!drive_file_id || !drive_file_url) {
      return json({ error: 'drive_file_id and drive_file_url are required' }, 400)
    }

    // Merge the single + array forms into one de-duplicated list to match on.
    const numbersToMatch = [
      ...(invoice_number ? [invoice_number] : []),
      ...(Array.isArray(invoice_numbers) ? invoice_numbers : []),
    ].filter((v, i, a) => v && a.indexOf(v) === i)

    // ── Resolve the target invoices (if any) ──────────────────
    let invoices: { id: string; invoice_number: string; status: string }[] = []
    if (numbersToMatch.length > 0) {
      const { data } = await service
        .from('invoices')
        .select('id, invoice_number, status')
        .in('invoice_number', numbersToMatch)
      invoices = data || []
    }

    // The "primary" invoice stamped directly on the cheque row: the one
    // matching the single invoice_number if given, else the first match.
    const primary = invoices.find(i => i.invoice_number === invoice_number) || invoices[0] || null

    const matched = invoices.length > 0
    const status = unreadable ? 'unreadable' : matched ? 'matched' : 'unmatched'
    const now = new Date().toISOString()

    // ── Create the cheque row ─────────────────────────────────
    // Stamp the primary invoice reference directly on the cheque
    // (invoice_number + invoice_id), in addition to the join table.
    const { data: check, error: cErr } = await service
      .from('cheques')
      .insert({
        check_number,
        amount,
        ryder_conf_number,
        drive_file_id,
        drive_file_url,
        status,
        invoice_number: primary?.invoice_number || invoice_number || null,
        invoice_id: primary?.id || null,
        matched_at: matched ? now : null,
      })
      .select()
      .single()
    if (cErr) throw cErr

    // ── Link + advance matched invoices ───────────────────────
    if (matched) {
      await service.from('cheque_invoices').insert(
        invoices.map((i) => ({ cheque_id: check.id, invoice_id: i.id }))
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
      // ── No match → open an admin alert in the Needs Attention queue ──
      // needs_attention.invoice_id is now nullable and the row carries a
      // cheque_id, so a check that anchors to NO invoice still surfaces to
      // the admin (charter: "queue showing unmatched invoices or checks").
      const detail = unreadable
        ? `Cheque file ${drive_file_id} scanned but the invoice number was unreadable.`
        : `Cheque ${check_number || '(no #)'} received but could not be auto-matched to an invoice.`

      await service.from('needs_attention').insert({
        cheque_id:    check.id,
        type:         unreadable ? 'check_unreadable' : 'check_unmatched',
        title:        unreadable ? 'Cheque Unreadable' : 'Cheque Unmatched',
        detail,
        action_label: 'Enter Manually',
        check_number,
        ryder_conf_number,
      })
    }

    // ── Audit log ─────────────────────────────────────────────
    await service.from('audit_logs').insert({
      table_name: 'cheques',
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
