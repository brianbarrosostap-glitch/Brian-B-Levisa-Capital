/**
 * Edge Function: process-document
 *
 * Reads an uploaded invoice or cheque and saves it — replaces the n8n
 * "Invoices Drive to Supabase" and "Cheques to Supabase" workflows.
 *
 * Callers: customer (own invoices) or admin (invoices for any client + cheques).
 *
 * POST /functions/v1/process-document
 * Body (file already uploaded to Storage by the portal):
 *   { kind: 'invoice', storage_path, original_filename, client_id? }   bucket 'invoices', path '<client_id>/uploads/...'
 *   { kind: 'cheque',  storage_path, original_filename }               bucket 'cheques' (admin only)
 * Body (Google Sheet link):
 *   { kind: 'invoice', sheet_url, client_id? }
 *
 * Returns { job } — the document_jobs row in its final state:
 *   added | duplicate | needs_review | failed
 */

import { HttpError, json, preflight } from '../_shared/http.ts'
import { adminClient, requireRole } from '../_shared/auth.ts'
import { processJob } from '../_shared/documents.ts'
import { mimeFor } from '../_shared/files.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const admin = adminClient()
  try {
    const caller = await requireRole(req, admin, ['admin', 'customer'])
    const body = await req.json().catch(() => ({})) as {
      kind?: string; storage_path?: string; original_filename?: string; sheet_url?: string; client_id?: string
    }
    const kind = body.kind === 'cheque' ? 'cheque' : body.kind === 'invoice' ? 'invoice' : null
    if (!kind) throw new HttpError(400, "kind must be 'invoice' or 'cheque'")
    if (!body.storage_path && !body.sheet_url) throw new HttpError(400, 'storage_path or sheet_url is required')
    if (body.sheet_url && kind !== 'invoice') throw new HttpError(400, 'Google Sheet links are only for invoices')

    // ── Who owns this upload ────────────────────────────────
    let clientId: string | null = null
    if (kind === 'cheque') {
      if (caller.role !== 'admin') throw new HttpError(403, 'Only admins can upload cheques')
      if (body.storage_path && body.storage_path.startsWith('/')) throw new HttpError(400, 'bad storage_path')
    } else if (caller.role === 'customer') {
      const { data: client } = await admin.from('clients').select('id').eq('owner_id', caller.user.id).maybeSingle()
      if (!client) throw new HttpError(403, 'No client account is linked to this user')
      clientId = client.id
      if (body.storage_path && !body.storage_path.startsWith(`${clientId}/uploads/`)) {
        throw new HttpError(403, 'File is not in your upload folder')
      }
    } else {
      clientId = body.client_id ?? null
      if (!clientId) {
        const { data: first } = await admin.from('clients').select('id').order('created_at').limit(1).maybeSingle()
        clientId = first?.id ?? null
      }
      if (!clientId) throw new HttpError(400, 'client_id is required')
    }

    // ── Record the upload, then process it ──────────────────
    const filename = body.original_filename ?? body.storage_path?.split('/').pop() ?? null
    const { data: job, error } = await admin.from('document_jobs').insert({
      kind,
      source: body.sheet_url ? 'sheet_link' : 'upload',
      client_id: clientId,
      storage_bucket: body.storage_path ? (kind === 'cheque' ? 'cheques' : 'invoices') : null,
      storage_path: body.storage_path ?? null,
      original_filename: filename,
      mime_type: filename ? mimeFor(filename) : null,
      sheet_url: body.sheet_url ?? null,
      status: 'pending',
      created_by: caller.user.id,
    }).select('id').single()
    if (error) throw error

    const final = await processJob(admin, job.id, { id: caller.user.id, email: caller.user.email ?? null })
    return json({ job: final })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error('process-document error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, status)
  }
})
