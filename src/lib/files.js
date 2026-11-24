import { supabase } from './supabase'

// Files live in two places:
//   • New uploads → Supabase Storage (private buckets `invoices`, `cheques`)
//   • Older rows  → Google Drive (`drive_file_url`)
// A "file ref" describes both, so one link works for either.
//   { bucket, path, fallbackUrl }

const SIGNED_TTL = 3600               // seconds
const cache = new Map()               // `${bucket}/${path}` → { url, exp }

async function signedUrl(bucket, path) {
  const key = `${bucket}/${path}`
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return { url: hit.url }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL)
  if (error || !data?.signedUrl) return { error: error || new Error('Could not open the file') }
  // Re-use for 50 of the 60 minutes so a cached link never expires mid-click.
  cache.set(key, { url: data.signedUrl, exp: Date.now() + (SIGNED_TTL - 600) * 1000 })
  return { url: data.signedUrl }
}

/**
 * Signed URL for a Storage path, else the fallback URL, else null.
 * `altPath` (optional) is tried when `path` can't be signed — e.g. an
 * invoice's PDF copy is missing but the original upload exists.
 */
export async function getFileUrl({ bucket, path, altPath, fallbackUrl } = {}) {
  let lastError = null
  if (bucket) {
    for (const p of [path, altPath]) {
      if (!p) continue
      const { url, error } = await signedUrl(bucket, p)
      if (url) return url
      lastError = error
    }
  }
  if (fallbackUrl) return fallbackUrl
  if (lastError) throw lastError
  return null
}

export const hasFile = (ref) => !!(ref && ((ref.bucket && ref.path) || ref.fallbackUrl))

export const invoiceFileRef = (inv) => ({
  bucket: 'invoices',
  path: inv?.pdf_path || inv?.storage_path || null,
  altPath: inv?.pdf_path && inv?.storage_path && inv.storage_path !== inv.pdf_path ? inv.storage_path : null,
  fallbackUrl: inv?.drive_file_url || null,
})

export const chequeFileRef = (ch) => ({
  bucket: 'cheques',
  path: ch?.storage_path || null,
  fallbackUrl: ch?.drive_file_url || null,
})

export const jobFileRef = (job) => ({
  bucket: job?.storage_bucket || (job?.kind === 'cheque' ? 'cheques' : 'invoices'),
  path: job?.storage_path || null,
  fallbackUrl: job?.sheet_url || null,
})

/* ── Uploads ─────────────────────────────────────────────────── */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024   // matches the bucket limit

/** Keep letters, digits, dot, dash, underscore; everything else → "_". */
export const safeFileName = (name) => (name || 'file').replace(/[^A-Za-z0-9._-]/g, '_')

/** Storage location for a new upload (see backend contract). */
export function uploadTarget(kind, clientId, fileName) {
  const id = crypto.randomUUID()
  const safe = safeFileName(fileName)
  if (kind === 'cheque') {
    const d = new Date()
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { bucket: 'cheques', path: `uploads/${ym}/${id}/${safe}` }
  }
  return { bucket: 'invoices', path: `${clientId}/uploads/${id}/${safe}` }
}

/** Upload one file; returns { bucket, path }. Throws on failure. */
export async function uploadDocumentFile(kind, clientId, file) {
  const { bucket, path } = uploadTarget(kind, clientId, file.name)
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw error
  return { bucket, path }
}
