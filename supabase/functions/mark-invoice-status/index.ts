/**
 * Edge Function: mark-invoice-status
 *
 * General-purpose admin action to move an invoice to a target status.
 * Handles the following actions from the Admin UI:
 *   - mark_paid_override   → status = "Paid"
 *   - set_void             → status = "Void"
 *   - mark_ryder_paid      → status = "Paid", sets ryder_paid_at
 *   - resubmit             → status = "Resubmitted"
 *   - mark_advance_paid    → status = "Advance Paid", sets advance_paid_at
 *
 * POST /functions/v1/mark-invoice-status
 * Body: {
 *   invoice_id: string,
 *   action: "mark_paid_override" | "set_void" | "mark_ryder_paid" | "resubmit" | "mark_advance_paid"
 *   note?: string
 * }
 */

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VALID_ACTIONS = [
  'mark_paid_override',
  'set_void',
  'mark_ryder_paid',
  'resubmit',
  'mark_advance_paid',
] as const

type Action = typeof VALID_ACTIONS[number]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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

    const { data: profile } = await service.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden — admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { invoice_id, action, note } = await req.json()

    if (!invoice_id || !action || !VALID_ACTIONS.includes(action)) {
      return new Response(
        JSON.stringify({ error: `invoice_id and action (${VALID_ACTIONS.join('|')}) required` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Fetch current invoice ─────────────────────────────────
    const { data: inv, error: invErr } = await service
      .from('invoices')
      .select('id, status')
      .eq('id', invoice_id)
      .single()

    if (invErr || !inv) {
      return new Response(JSON.stringify({ error: 'Invoice not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const now = new Date().toISOString()
    const update: Record<string, any> = { updated_at: now }

    switch (action as Action) {
      case 'mark_paid_override':
        update.status   = 'Paid'
        update.paid_at  = now
        update.due_date = null   // settled — clear the due date
        break

      case 'set_void':
        if (inv.status === 'Paid') {
          return new Response(JSON.stringify({ error: 'Cannot void a paid invoice' }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        update.status    = 'Void'
        update.voided_at = now
        break

      case 'mark_ryder_paid':
        update.status        = 'Paid'
        update.ryder_paid_at = now
        update.paid_at       = now
        update.due_date      = null   // settled — clear the due date
        break

      case 'resubmit':
        update.status = 'Resubmitted'
        break

      case 'mark_advance_paid':
        update.status          = 'Advance Paid'
        update.advance_paid_at = now
        break
    }

    const { data: updated, error: updateErr } = await service
      .from('invoices')
      .update(update)
      .eq('id', invoice_id)
      .select()
      .single()

    if (updateErr) throw updateErr

    // ── Log to timeline with optional note ────────────────────
    if (note) {
      await service.from('invoice_timeline').insert({
        invoice_id,
        status: updated.status,
        actor_id: user.id,
        note,
      })
    }

    // ── Rich audit log entry (real human actor) ───────────────
    await service.from('audit_logs').insert({
      table_name: 'invoices',
      record_id: invoice_id,
      action: inv.status === updated.status ? 'update' : 'status_change',
      actor_id: user.id,
      actor_email: user.email,
      invoice_number: updated.invoice_number,
      old_status: inv.status,
      new_status: updated.status,
      summary: `Admin action "${action}" → invoice ${updated.invoice_number}: ${inv.status} → ${updated.status}`
        + (note ? ` (note: ${note})` : ''),
      source: 'mark-invoice-status',
    })

    return new Response(
      JSON.stringify({ success: true, invoice: updated }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('mark-invoice-status error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
