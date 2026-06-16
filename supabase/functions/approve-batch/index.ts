/**
 * Edge Function: approve-batch
 *
 * Called by admin to approve (or partially approve / reject) an advance request.
 *
 * POST /functions/v1/approve-batch
 * Body: {
 *   batch_id: string,           // UUID of the batch
 *   approved_invoice_ids: string[],  // UUIDs of invoices to approve (subset or all)
 *   action: "approve" | "reject"     // "reject" ignores approved_invoice_ids
 * }
 *
 * What it does:
 *  - Verifies caller is admin
 *  - If action=approve:
 *      • Updates included invoice statuses to "Advance Confirmed"
 *      • Updates excluded invoices back to "Eligible"
 *      • Sets batch status = Approved or Partially Approved
 *      • Inserts timeline rows for each changed invoice
 *  - If action=reject:
 *      • All batch invoices revert to "Eligible"
 *      • Batch status = Rejected
 */

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth: only admins may call this ──────────────────────
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

    // Use service role client for writes (bypasses RLS so trigger fires cleanly)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify role = admin
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profErr || profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden — admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Parse body ────────────────────────────────────────────
    const { batch_id, approved_invoice_ids = [], action } = await req.json()

    if (!batch_id || !['approve', 'reject'].includes(action)) {
      return new Response(JSON.stringify({ error: 'batch_id and action (approve|reject) required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Fetch batch + its invoices ────────────────────────────
    const { data: batch, error: batchErr } = await admin
      .from('batches')
      .select('id, status, client_id, invoices:invoices(id, invoice_number, status)')
      .eq('id', batch_id)
      .single()

    if (batchErr || !batch) {
      return new Response(JSON.stringify({ error: 'Batch not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (batch.status !== 'Pending') {
      return new Response(JSON.stringify({ error: `Batch already ${batch.status}` }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const allInvoiceIds = (batch.invoices as any[]).map((i: any) => i.id)

    if (action === 'reject') {
      // Revert all invoices to Eligible, mark batch Rejected
      await admin
        .from('invoices')
        .update({ status: 'Eligible', batch_id: null, updated_at: new Date().toISOString() })
        .in('id', allInvoiceIds)

      await admin
        .from('batches')
        .update({ status: 'Rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
        .eq('id', batch_id)

      await admin.from('audit_logs').insert({
        table_name: 'batches',
        record_id: batch_id,
        action: 'status_change',
        actor_id: user.id,
        actor_email: user.email,
        old_status: 'Pending',
        new_status: 'Rejected',
        summary: `Batch rejected — ${allInvoiceIds.length} invoice(s) reverted to Eligible`,
        source: 'approve-batch',
      })

      return new Response(JSON.stringify({ success: true, batch_status: 'Rejected' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // action === 'approve'
    if (approved_invoice_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'approved_invoice_ids cannot be empty for approve action' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const rejectedIds = allInvoiceIds.filter((id: string) => !approved_invoice_ids.includes(id))

    // Approve selected invoices
    await admin
      .from('invoices')
      .update({
        status: 'Advance Confirmed',
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', approved_invoice_ids)

    // Revert excluded invoices
    if (rejectedIds.length > 0) {
      await admin
        .from('invoices')
        .update({ status: 'Eligible', batch_id: null, updated_at: new Date().toISOString() })
        .in('id', rejectedIds)
    }

    const batchStatus = rejectedIds.length > 0 ? 'Partially Approved' : 'Approved'

    await admin
      .from('batches')
      .update({
        status: batchStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq('id', batch_id)

    await admin.from('audit_logs').insert({
      table_name: 'batches',
      record_id: batch_id,
      action: 'status_change',
      actor_id: user.id,
      actor_email: user.email,
      old_status: 'Pending',
      new_status: batchStatus,
      summary: `Batch ${batchStatus.toLowerCase()} — `
        + `${approved_invoice_ids.length} approved (Advance Confirmed), ${rejectedIds.length} reverted to Eligible`,
      source: 'approve-batch',
    })

    return new Response(
      JSON.stringify({
        success: true,
        batch_status: batchStatus,
        approved_count: approved_invoice_ids.length,
        rejected_count: rejectedIds.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('approve-batch error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
