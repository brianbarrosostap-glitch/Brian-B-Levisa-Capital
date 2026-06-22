/**
 * Edge Function: delete-invoice
 * Called by n8n. Do not add trigger logic here.
 *
 * Customer requests deletion of an invoice they own.
 * Only invoices in 'Uploaded' or 'Eligible' status can be deleted —
 * once an invoice is in the pipeline (Payment Requested or beyond)
 * it cannot be deleted from the customer portal.
 *
 * Flow:
 *   1. Verify caller is authenticated (customer JWT)
 *   2. Confirm invoice belongs to this customer's client
 *   3. Confirm status is Uploaded or Eligible
 *   4. Delete the invoice row from DB
 *   5. Fire n8n webhook (best-effort) with drive_file_url so n8n can
 *      move/trash the Drive file
 *
 * POST /functions/v1/delete-invoice
 * Body: { invoice_id: string }
 *
 * Webhook payload sent to WEBHOOK_URL:
 * {
 *   event: "invoice.deleted",
 *   invoice_id, invoice_number, invoice_amount,
 *   drive_file_id, drive_file_url,
 *   client_id, client_name,
 *   deleted_by, deleted_at
 * }
 */

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Statuses that are safe to delete — once in the pipeline it cannot be removed.
const DELETABLE_STATUSES = ['Uploaded', 'Eligible']

// n8n webhook — set this once you have the URL.
// Fires with the drive link so n8n can move the file to trash/archive.
const WEBHOOK_URL = 'https://n8n.srv1749674.hstgr.cloud/webhook/invoice-removal'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth: verify caller ───────────────────────────────────
    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user }, error: authErr } = await anon.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { invoice_id } = await req.json()
    if (!invoice_id) {
      return new Response(JSON.stringify({ error: 'invoice_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Fetch invoice + client ownership ────────────────────
    const { data: inv, error: invErr } = await service
      .from('invoices')
      .select('id, invoice_number, invoice_amount, status, drive_file_id, drive_file_url, client_id, client:clients(name, owner_id)')
      .eq('id', invoice_id)
      .single()

    if (invErr || !inv) {
      return new Response(JSON.stringify({ error: 'Invoice not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Supabase returns the joined row as an array for many-to-one joins.
    const clientRow = Array.isArray(inv.client) ? inv.client[0] : inv.client

    // ── Ownership check: invoice must belong to this customer ─
    if (clientRow?.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden — this invoice does not belong to your account' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Status guard: only Uploaded / Eligible can be deleted ─
    if (!DELETABLE_STATUSES.includes(inv.status)) {
      return new Response(JSON.stringify({
        error: `Cannot delete an invoice with status "${inv.status}". Only Uploaded or Eligible invoices can be removed.`,
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── Delete from DB ────────────────────────────────────────
    const { error: deleteErr } = await service
      .from('invoices')
      .delete()
      .eq('id', invoice_id)

    if (deleteErr) {
      console.error('Delete failed:', deleteErr)
      return new Response(JSON.stringify({ error: 'Failed to delete invoice' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Notify admin ─────────────────────────────────────────────
    await service.from('notifications').insert({
      client_id: inv.client_id,
      audience:  'admin',
      title:     `Invoice deleted by customer`,
      body:      `${clientRow?.name} removed invoice ${inv.invoice_number} (${inv.invoice_amount ? '$' + Number(inv.invoice_amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''}) from their portal.`,
    }).then(({ error }) => { if (error) console.error('Notification insert failed (non-fatal):', error) })

    // ── Webhook: notify n8n (best-effort, never fails the request) ──
    const now = new Date().toISOString()
    const payload = {
      event:          'invoice.deleted',
      invoice_id:     inv.id,
      invoice_number: inv.invoice_number,
      invoice_amount: inv.invoice_amount,
      drive_file_id:  inv.drive_file_id,
      drive_file_url: inv.drive_file_url,
      client_id:      inv.client_id,
      client_name:    clientRow?.name,
      deleted_by:     user.id,
      deleted_at:     now,
    }

    if (WEBHOOK_URL && WEBHOOK_URL !== 'REPLACE_WITH_YOUR_WEBHOOK_URL') {
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(err => console.error('Webhook fire failed (non-fatal):', err))
    } else {
      console.log('Webhook not configured — skipping. Payload:', JSON.stringify(payload))
    }

    return new Response(JSON.stringify({ ok: true, deleted: invoice_id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
