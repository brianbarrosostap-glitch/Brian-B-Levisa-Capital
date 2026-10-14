/**
 * Edge Function: toggle-audit-todo
 *
 * Admin checks off (or re-opens) an audit to-do on the Dashboard:
 *   - cheque  to-do → cheque amount verified against the bank deposit
 *   - advance to-do → advance total verified against the bank transfer
 * The to-dos themselves are created by DB triggers (see migration
 * 20261013000002_audit_todos.sql) — this function only flips `done`.
 *
 * POST /functions/v1/toggle-audit-todo
 * Body: { todo_id: string, done: boolean, note?: string }
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

    const { data: profile } = await service.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return json({ error: 'Forbidden — admin only' }, 403)

    const { todo_id, invoice_id, done, note } = await req.json()
    if ((!todo_id && !invoice_id) || typeof done !== 'boolean') {
      return json({ error: '(todo_id or invoice_id) and done (boolean) required' }, 400)
    }

    const now = new Date().toISOString()
    const update: Record<string, unknown> = done
      ? { done: true, done_at: now, done_by: user.id }
      : { done: false, done_at: null, done_by: null }
    if (note !== undefined) update.note = note

    // Cheque / advance to-dos already exist (DB triggers) → update by id.
    // "No Ryder confirmation" items are computed live in the UI, so their
    // row is created on first tick → upsert by invoice_id.
    const { data: todo, error: upErr } = todo_id
      ? await service.from('audit_todos').update(update).eq('id', todo_id).select().single()
      : await service.from('audit_todos')
          .upsert({ kind: 'unconfirmed', invoice_id, ...update }, { onConflict: 'invoice_id' })
          .select().single()
    if (upErr || !todo) return json({ error: upErr?.message || 'To-do not found' }, 404)

    let subject = ''
    if (todo.kind === 'cheque') subject = `cheque #${todo.check_number || todo.cheque_id}`
    else if (todo.kind === 'advance') subject = `advance ADV-${String(todo.advance_number).padStart(4, '0')}`
    else {
      const { data: inv } = await service.from('invoices').select('invoice_number').eq('id', todo.invoice_id).single()
      subject = `unconfirmed invoice ${inv?.invoice_number || todo.invoice_id} (Ryder follow-up)`
    }

    await service.from('audit_logs').insert({
      table_name: 'audit_todos',
      record_id: todo.id,
      action: 'update',
      actor_id: user.id,
      actor_email: user.email,
      summary: `${done ? (todo.kind === 'unconfirmed' ? 'Investigated' : 'Verified') : 'Re-opened'} ${subject}${todo.kind === 'unconfirmed' ? '' : ' against bank'}`
        + (note ? ` (note: ${note})` : ''),
      source: 'toggle-audit-todo',
    })

    return json({ success: true, todo })
  } catch (err) {
    console.error('toggle-audit-todo error:', err)
    return json({ error: String(err) }, 500)
  }
})
