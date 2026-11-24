// File helpers: hashing, Storage, the Office→PDF converter, the Docufree
// downloader, and PDF text extraction.
//
// Secrets: DOC_CONVERT_URL (Office → PDF), DOC_DOWNLOADER_URL (Docufree viewer → PDF)

import type { SupabaseClient } from '@supabase/supabase-js'
import { encodeHex } from 'jsr:@std/encoding@1/hex'
import { extractText, getDocumentProxy } from 'npm:unpdf@2.2.1'

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return encodeHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
}

export function safeName(name: string): string {
  return (name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120)
}

export function extOf(name: string | null | undefined): string {
  const m = (name ?? '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)
  return m ? m[1] : ''
}

export const SPREADSHEET_EXT = ['xlsx', 'xls', 'xlsm', 'csv', 'ods']
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tif', 'tiff']

export function mimeFor(name: string, fallback = 'application/octet-stream'): string {
  const ext = extOf(name)
  return ({
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  } as Record<string, string>)[ext] ?? fallback
}

export async function downloadStorage(admin: SupabaseClient, bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(bucket).download(path)
  if (error || !data) throw new Error(`Storage download ${bucket}/${path}: ${error?.message ?? 'not found'}`)
  return new Uint8Array(await data.arrayBuffer())
}

export async function uploadStorage(
  admin: SupabaseClient, bucket: string, path: string, bytes: Uint8Array, contentType: string,
): Promise<void> {
  const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: true })
  if (error) throw new Error(`Storage upload ${bucket}/${path}: ${error.message}`)
}

/** Office file (xlsx/xls/csv/ods/docx) → PDF via the converter service. */
export async function convertToPdf(bytes: Uint8Array, filename: string): Promise<Uint8Array> {
  const url = Deno.env.get('DOC_CONVERT_URL')
  if (!url) throw new Error('DOC_CONVERT_URL is not set')
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeFor(filename) }), safeName(filename))
  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`PDF converter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const out = new Uint8Array(await res.arrayBuffer())
  if (!isPdf(out)) throw new Error('PDF converter did not return a PDF')
  return out
}

/** Docufree "Click Here to View Invoice" link → PDF bytes (headless-Chrome service). */
export async function downloadViewerPdf(viewerUrl: string): Promise<Uint8Array> {
  const url = Deno.env.get('DOC_DOWNLOADER_URL')
  if (!url) throw new Error('DOC_DOWNLOADER_URL is not set')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: viewerUrl }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`PDF downloader HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const out = new Uint8Array(await res.arrayBuffer())
  if (!isPdf(out)) throw new Error('PDF downloader did not return a PDF')
  return out
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // %PDF
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: true })
  return Array.isArray(text) ? text.join('\n') : String(text)
}
