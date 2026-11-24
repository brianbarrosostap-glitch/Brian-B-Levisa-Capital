/**
 * Edge Function: submit-advance-request
 *
 * Called by a customer to create a new advance request (batch) from
 * a list of their eligible invoices.
 *
 * POST /functions/v1/submit-advance-request
 * Body: {
 *   invoice_ids: string[]   // UUIDs of invoices to include
 * }
 *
 * What it does:
 *  - Verifies caller is a customer
 *  - Verifies all invoice_ids belong to this customer's client
 *  - Verifies all invoices are in status Uploaded or Eligible
 *  - Generates a REQ-YYYY-NNN request number
 *  - Creates the batch row
 *  - Updates all invoice statuses to "Payment Requested"
 *  - Links invoices to the batch
 *  - Queues the payment-request email to RZR (app_settings.rzr_email).
 *    When it is sent: invoices → Advance Confirmed, batch → Approved
 *    (n8n behaviour — no manual admin approval step).
 *  - Returns the new batch record
 */

import { createClient } from '@supabase/supabase-js'
import { getSettings } from '../_shared/settings.ts'
import { kickOutbox, queueEmail } from '../_shared/outbox.ts'
import { paymentRequestEmail, paymentRequestSubject } from '../_shared/templates.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth ──────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify role = customer
    const { data: profile } = await service.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'customer') {
      return new Response(JSON.stringify({ error: 'Forbidden — customer only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Parse body ────────────────────────────────────────────
    const { invoice_ids } = await req.json()
    if (!invoice_ids || !Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'invoice_ids array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Find this customer's client ───────────────────────────
    const { data: client, error: clientErr } = await service
      .from('clients')
      .select('id, name')
      .eq('owner_id', user.id)
      .single()

    if (clientErr || !client) {
      return new Response(JSON.stringify({ error: 'No client record found for this user' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Verify invoices belong to this client and are eligible ─
    const { data: invoices, error: invErr } = await service
      .from('invoices')
      .select('id, invoice_number, status, client_id')
      .in('id', invoice_ids)

    if (invErr) throw invErr

    const ineligible = invoices?.filter(
      (i: any) => i.client_id !== client.id || !['Uploaded', 'Eligible'].includes(i.status)
    )

    if (ineligible && ineligible.length > 0) {
      return new Response(
        JSON.stringify({
          error: 'Some invoices are not eligible or do not belong to this client',
          ineligible: ineligible.map((i: any) => ({ id: i.id, number: i.invoice_number, status: i.status })),
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Generate request number REQ-YYYY-NNN ──────────────────
    const year = new Date().getFullYear()
    const { count } = await service
      .from('batches')
      .select('*', { count: 'exact', head: true })
      .like('request_number', `REQ-${year}-%`)

    const seq = String((count || 0) + 1).padStart(3, '0')
    const requestNumber = `REQ-${year}-${seq}`

    // ── Create batch ──────────────────────────────────────────
    const { data: batch, error: batchErr } = await service
      .from('batches')
      .insert({ request_number: requestNumber, client_id: client.id, status: 'Pending' })
      .select()
      .single()

    if (batchErr) throw batchErr

    // ── Update invoices: link to batch + status ───────────────
    const { error: updateErr } = await service
      .from('invoices')
      .update({
        status: 'Payment Requested',
        batch_id: batch.id,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', invoice_ids)

    if (updateErr) throw updateErr

    // ── Audit log: customer submitted an advance request ──────
    await service.from('audit_logs').insert({
      table_name: 'batches',
      record_id: batch.id,
      action: 'insert',
      actor_id: user.id,
      actor_email: user.email,
      summary: `Advance request ${requestNumber} submitted with ${invoice_ids.length} invoice(s)`,
      source: 'submit-advance-request',
    })

    // ── Notify ADMIN of the new advance request (role-targeted) ──
    // .insert() returns { error } instead of throwing — log it so a
    // notification failure is visible in the function logs.
    const { error: notifErr } = await service.from('notifications').insert({
      client_id: client.id,
      audience: 'admin',
      new_status: 'Payment Requested',
      title: `New advance request — ${requestNumber}`,
      body: `${client.name || 'A customer'} submitted ${invoice_ids.length} invoice(s) for advance.`,
    })
    if (notifErr) console.error('submit-advance-request: notification insert failed:', notifErr)

    // ── Email RZR the payment request (replaces the n8n webhook) ──
    // Same as n8n: one email listing every invoice with its 97% advance,
    // asking RZR to reply "Approved"/"Accepted". Once it is actually SENT,
    // the after-send hook moves the invoices to Advance Confirmed and the
    // batch to Approved (see _shared/emailHooks.ts). The batch already exists
    // at this point, so a queueing failure does not fail the request — the
    // admin is notified instead.
    let emailQueued = false
    try {
      const { data: emailRows, error: rowsErr } = await service
        .from('invoices')
        .select('invoice_number, po_number, invoice_amount, advance_amount')
        .in('id', invoice_ids)
        .order('invoice_number')
      if (rowsErr) throw rowsErr

      const settings = await getSettings(service)
      const rzrEmail = String(settings.rzr_email ?? '')
      if (!rzrEmail) throw new Error('app_settings.rzr_email is not configured')
      const phrase = String(settings.payment_request_subject ?? 'Payment Request for')
      const numbers = (emailRows ?? []).map((r) => r.invoice_number)
      const { html, text } = paymentRequestEmail(emailRows ?? [])

      const queued = await queueEmail(service, {
        kind: 'payment_request',
        to: [rzrEmail],
        subject: paymentRequestSubject(phrase, numbers),
        html,
        text,
        relatedInvoiceIds: invoice_ids,
        relatedBatchId: batch.id,
        dedupeKey: `payment_request:${batch.id}`,
        createdBy: user.id,
      })
      emailQueued = !queued.duplicate
      kickOutbox(service) // send now; the 2-minute cron retries if this attempt fails
    } catch (mailErr) {
      console.error('submit-advance-request: could not queue RZR email:', mailErr)
      await service.from('notifications').insert({
        client_id: client.id,
        audience: 'admin',
        title: `RZR email NOT queued — ${requestNumber}`,
        body: `The advance request was saved but the payment-request email could not be queued: ${String(mailErr)}`.slice(0, 1000),
      })
    }

    return new Response(
      JSON.stringify({ success: true, batch, email_queued: emailQueued }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('submit-advance-request error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
