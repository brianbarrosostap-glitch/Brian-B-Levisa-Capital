/**
 * Edge Function: import-drive-files   (admin, or internal)
 *
 * One-time migration of the Google Drive files into Supabase Storage, so the
 * portal no longer depends on Drive:
 *   invoices → PDF in bucket 'invoices' (pdf_path; spreadsheets also keep the original)
 *   cheques  → image/PDF in bucket 'cheques' (storage_path)
 * Old drive_file_url values are kept (nothing is deleted from Drive).
 *
 * Runs in small batches — call repeatedly until remaining = 0.
 * Invoices still in the Ryder pipeline are imported first (their PDF is needed
 * for resubmission emails).
 *
 * POST /functions/v1/import-drive-files   { kind?: 'invoices'|'cheques', limit?: number }
 * Returns { imported, failed, remaining }.
 */

import { HttpError, json, preflight } from '../_shared/http.ts'
import { adminClient, isInternalCall, requireRole } from '../_shared/auth.ts'
import { ensureInvoicePdf } from '../_shared/invoicePdf.ts'
import { downloadDriveFile } from '../_shared/composio.ts'
import { mimeFor, safeName, uploadStorage } from '../_shared/files.ts'

const PIPELINE_FIRST = ['Advance Paid', 'Submitted to Ryder', 'Resubmitted', 'Acknowledged', 'Advance Agreed', 'Advance Confirmed']

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const admin = adminClient()
  try {
    if (!isInternalCall(req)) await requireRole(req, admin, ['admin'])
    const body = await req.json().catch(() => ({})) as { kind?: string; limit?: number }
    const kind = body.kind === 'cheques' ? 'cheques' : 'invoices'
    const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 15)
    const imported: string[] = []
    const failed: { id: string; ref: string; error: string }[] = []

    if (kind === 'invoices') {
      const { data: rows, error } = await admin.from('invoices')
        .select('*').not('drive_file_id', 'is', null).is('pdf_path', null).limit(500)
      if (error) throw error
      const ordered = (rows ?? []).sort((a, b) =>
        (PIPELINE_FIRST.includes(a.status) ? 0 : 1) - (PIPELINE_FIRST.includes(b.status) ? 0 : 1))
      for (const inv of ordered.slice(0, limit)) {
        try {
          await ensureInvoicePdf(admin, inv)
          imported.push(inv.invoice_number)
        } catch (err) {
          failed.push({ id: inv.id, ref: inv.invoice_number, error: String(err).slice(0, 300) })
        }
      }
      const { count } = await admin.from('invoices').select('id', { count: 'exact', head: true })
        .not('drive_file_id', 'is', null).is('pdf_path', null)
      return json({ kind, imported, failed, remaining: count ?? 0 })
    }

    // cheques — several rows can share one Drive file (n8n stored one row per invoice line)
    const { data: rows, error } = await admin.from('cheques')
      .select('id, check_number, drive_file_id').not('drive_file_id', 'is', null).is('storage_path', null).limit(500)
    if (error) throw error
    const byFile = new Map<string, { id: string; check_number: string | null }[]>()
    for (const r of rows ?? []) byFile.set(r.drive_file_id, [...(byFile.get(r.drive_file_id) ?? []), r])

    for (const [fileId, group] of [...byFile.entries()].slice(0, limit)) {
      try {
        const file = await downloadDriveFile(fileId)
        const name = safeName(file.name || `${fileId}.jpg`)
        const path = `drive-import/${fileId}/${name}`
        await uploadStorage(admin, 'cheques', path, file.bytes, file.mimeType || mimeFor(name, 'image/jpeg'))
        await admin.from('cheques').update({ storage_path: path }).in('id', group.map((g) => g.id))
        imported.push(group[0].check_number ?? fileId)
      } catch (err) {
        failed.push({ id: group[0].id, ref: group[0].check_number ?? fileId, error: String(err).slice(0, 300) })
      }
    }
    const remainingFiles = new Set((rows ?? []).map((r) => r.drive_file_id)).size - imported.length
    return json({ kind, imported, failed, remaining: Math.max(0, remainingFiles) })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    if (status === 500) console.error('import-drive-files error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, status)
  }
})
