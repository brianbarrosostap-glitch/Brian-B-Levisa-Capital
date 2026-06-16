/**
 * Edge Function: match-confirmation
 *
 * Called by admin to link a Ryder confirmation number to an invoice.
 *
 * POST /functions/v1/match-confirmation
 * Body: {
 *   attention_id: string,     // UUID of the needs_attention row
 *   invoice_id:   string,     // UUID of the invoice to match to
 *   conf_number:  string,     // Ryder confirmation number (e.g. "11042301")
 * }
 *
 * OR for entering a check number manually:
 * Body: {
 *   attention_id: string,
 *   invoice_id:   string,
 *   check_number: string,     // Manual check number
 * }
 *
 * What it does:
 *  - Verifies caller is admin
 *  - Updates invoice: sets ryder_conf_number (or check note), advances status
 *  - Marks the needs_attention row as resolved
 *  - Returns updated invoice
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    const { attention_id, invoice_id, conf_number, check_number } = await req.json()

    if (!attention_id || !invoice_id || (!conf_number && !check_number)) {
      return new Response(
        JSON.stringify({ error: 'attention_id, invoice_id, and either conf_number or check_number are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Fetch the attention item ──────────────────────────────
    const { data: attn, error: attnErr } = await service
      .from('needs_attention')
      .select('id, type, invoice_id, resolved')
      .eq('id', attention_id)
      .single()

    if (attnErr || !attn) {
      return new Response(JSON.stringify({ error: 'Attention item not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (attn.resolved) {
      return new Response(JSON.stringify({ error: 'Already resolved' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const now = new Date().toISOString()

    // ── Update the invoice ────────────────────────────────────
    const invoiceUpdate: Record<string, any> = { updated_at: now }

    if (conf_number) {
      // Confirmation number match: set conf, advance status to Acknowledged if currently Submitted to Ryder
      invoiceUpdate.ryder_conf_number = conf_number
      invoiceUpdate.ryder_submitted_at = invoiceUpdate.ryder_submitted_at || now

      // Auto-advance status if eligible
      const { data: inv } = await service.from('invoices').select('status').eq('id', invoice_id).single()
      if (inv?.status === 'Submitted to Ryder') {
        invoiceUpdate.status = 'Acknowledged'
      }
    }

    if (check_number) {
      // Check entry: record the check number, advance to Paid if in Acknowledged or later
      invoiceUpdate.ryder_conf_number = check_number
      invoiceUpdate.ryder_paid_at = now

      const { data: inv } = await service.from('invoices').select('status').eq('id', invoice_id).single()
      if (['Acknowledged', 'Submitted to Ryder'].includes(inv?.status)) {
        invoiceUpdate.status = 'Paid'
        invoiceUpdate.paid_at = now
      }
    }

    const { data: updatedInvoice, error: invUpdateErr } = await service
      .from('invoices')
      .update(invoiceUpdate)
      .eq('id', invoice_id)
      .select()
      .single()

    if (invUpdateErr) throw invUpdateErr

    // ── Resolve the attention item ────────────────────────────
    await service
      .from('needs_attention')
      .update({ resolved: true, resolved_at: now, resolved_by: user.id })
      .eq('id', attention_id)

    return new Response(
      JSON.stringify({ success: true, invoice: updatedInvoice }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('match-confirmation error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
