/**
 * Edge Function: agree-advance
 *
 * Called by the CUSTOMER to agree to the 97% advance terms AFTER Brian
 * has approved their request. This is the extra two-stage step:
 *
 *   Payment Requested → (Brian approves) → Advance Confirmed
 *     → (customer agrees here) → Advance Agreed → (Brian pays) → Advance Paid
 *
 * If the customer never agrees, the invoice stays at 'Advance Confirmed'
 * and Brian does NOT pay it out.
 *
 * POST /functions/v1/agree-advance
 * Body: { invoice_ids: string[] }
 */

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Resolve the caller's client
    const { data: client } = await service.from('clients').select('id, name').eq('owner_id', user.id).single()
    if (!client) return json({ error: 'No client for this user' }, 403)

    const { invoice_ids } = await req.json()
    if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return json({ error: 'invoice_ids is required' }, 400)
    }

    // Only the customer's own invoices currently at 'Advance Confirmed' can be agreed
    const { data: invoices } = await service
      .from('invoices')
      .select('id, invoice_number, status, client_id')
      .in('id', invoice_ids)

    const eligible = (invoices || []).filter(
      (i: any) => i.client_id === client.id && i.status === 'Advance Confirmed'
    )
    if (eligible.length === 0) {
      return json({ error: 'No invoices are eligible to agree (must be Advance Confirmed and yours).' }, 422)
    }

    const now = new Date().toISOString()
    const ids = eligible.map((i: any) => i.id)

    const { error: upErr } = await service
      .from('invoices')
      .update({ status: 'Advance Agreed', customer_confirmed_at: now, updated_at: now })
      .in('id', ids)
    if (upErr) throw upErr

    // Notify ADMIN that the customer agreed to the 97% (role-targeted).
    await service.from('notifications').insert(
      eligible.map((i: any) => ({
        invoice_id: i.id,
        client_id: client.id,
        audience: 'admin',
        new_status: 'Advance Agreed',
        title: `${client.name} agreed to advance — ${i.invoice_number}`,
        body: `Customer accepted the 97% advance for ${i.invoice_number}. Ready for you to pay out.`,
      }))
    )

    // Audit
    await service.from('audit_logs').insert({
      table_name: 'invoices',
      action: 'status_change',
      actor_id: user.id,
      actor_email: user.email,
      new_status: 'Advance Agreed',
      summary: `Customer agreed to 97% advance for ${eligible.length} invoice(s): ${eligible.map((i: any) => i.invoice_number).join(', ')}`,
      source: 'agree-advance',
    })

    return json({ success: true, agreed: ids.length })
  } catch (err) {
    console.error('agree-advance error:', err)
    return json({ error: String(err) }, 500)
  }
})
