// Makes sure an invoice has a PDF in Storage (bucket 'invoices', invoices.pdf_path).
//   • portal upload that is already a PDF          → use it
//   • portal upload that is Excel                  → convert it
//   • legacy invoice whose file lives in Drive     → Composio download / export, then store
// Used by the Ryder submission jobs and the one-time Drive import.

import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadDriveFile } from './composio.ts'
import { convertToPdf, downloadStorage, extOf, isPdf, mimeFor, safeName, SPREADSHEET_EXT, uploadStorage } from './files.ts'

// deno-lint-ignore no-explicit-any
type Invoice = Record<string, any>

export interface InvoicePdf {
  bucket: 'invoices'
  path: string
  filename: string
}

export function ryderPdfName(invoiceNumber: string): string {
  return `Invoice - #${invoiceNumber}.pdf` // same file name the n8n flow sent
}

export async function ensureInvoicePdf(admin: SupabaseClient, inv: Invoice): Promise<InvoicePdf> {
  const filename = ryderPdfName(inv.invoice_number)
  if (inv.pdf_path) return { bucket: 'invoices', path: inv.pdf_path, filename }

  const folder = `${inv.client_id}/invoices/${inv.id}`
  let pdf: Uint8Array | null = null
  let original: { bytes: Uint8Array; name: string; mime: string } | null = null

  if (inv.storage_path) {
    const bytes = await downloadStorage(admin, 'invoices', inv.storage_path)
    if (isPdf(bytes)) {
      await setPdfPath(admin, inv.id, inv.storage_path)
      return { bucket: 'invoices', path: inv.storage_path, filename }
    }
    pdf = await convertToPdf(bytes, inv.storage_path.split('/').pop() ?? 'invoice.xlsx')
  } else if (inv.drive_file_id) {
    // Legacy (Drive-era) invoice. Google Sheets export straight to PDF; uploaded files come as-is.
    const file = await downloadDriveFile(inv.drive_file_id, 'application/pdf')
    if (isPdf(file.bytes)) {
      pdf = file.bytes
    } else {
      const name = file.name || `invoice-${inv.invoice_number}`
      original = { bytes: file.bytes, name, mime: file.mimeType || mimeFor(name) }
      const ext = extOf(name) || (/sheet|excel/i.test(file.mimeType) ? 'xlsx' : '')
      if (!SPREADSHEET_EXT.includes(ext) && !/sheet|excel|csv/i.test(file.mimeType)) {
        throw new Error(`Drive file for ${inv.invoice_number} is ${file.mimeType}, not a PDF or spreadsheet`)
      }
      pdf = await convertToPdf(file.bytes, ext && !name.toLowerCase().endsWith(`.${ext}`) ? `${name}.${ext}` : name)
    }
  } else {
    throw new Error(`Invoice ${inv.invoice_number} has no file (no upload and no Drive link)`)
  }

  if (original && !inv.storage_path) {
    const origPath = `${folder}/${safeName(original.name)}`
    await uploadStorage(admin, 'invoices', origPath, original.bytes, original.mime)
    await admin.from('invoices').update({ storage_path: origPath }).eq('id', inv.id)
  }
  const pdfPath = `${folder}/${safeName(`invoice-${inv.invoice_number}.pdf`)}`
  await uploadStorage(admin, 'invoices', pdfPath, pdf!, 'application/pdf')
  await setPdfPath(admin, inv.id, pdfPath)
  return { bucket: 'invoices', path: pdfPath, filename }
}

async function setPdfPath(admin: SupabaseClient, id: string, path: string) {
  const { error } = await admin.from('invoices').update({ pdf_path: path }).eq('id', id)
  if (error) throw error
}
