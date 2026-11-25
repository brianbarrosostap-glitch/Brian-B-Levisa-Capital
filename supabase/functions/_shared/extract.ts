// Reading + validating invoices and cheques.
//
// An upload is saved automatically ONLY when every check passes; otherwise it
// goes to the admin Upload Review queue. The arithmetic check (charges + parts
// = total before taxes, + taxes = grand total) is what lets us trust the read.

import * as XLSX from 'npm:xlsx@0.18.5'

export interface Check {
  name: string
  ok: boolean
  detail: string
}

export interface InvoiceFields {
  invoice_number: string | null
  po_number: string | null
  unit_number: string | null
  invoice_date: string | null
  invoice_amount: number | null
  ryder_vendor_number?: string | null
  customer_location?: string | null
  parts_total?: number | null
  charges?: { label: string; amount: number }[]
  total_before_taxes?: number | null
  taxes?: number | null
  grand_total?: number | null
}

export interface ChequeLine {
  invoice_number: string
  invoice_date?: string | null
  invoice_amount?: number | null
  deduction?: number | null
  amount_paid?: number | null
  /** What the photo said when the line was re-matched to a different invoice (or left unmatched). */
  read_as?: string | null
}

export interface ChequeFields {
  payer?: string | null
  check_number: string | null
  micr_check_number?: string | null
  check_date: string | null
  batch_number?: string | null
  amount: number | null
  lines: ChequeLine[]
}

// ── Normalisers ──────────────────────────────────────────────

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return null
  return Number(s)
}

export const round2 = (n: number) => Math.round(n * 100) / 100
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol

/** "#1232314" → "1232314". Keeps digits, letters and dashes only. */
export function normalizeInvoiceNumber(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(typeof v === 'number' ? Math.trunc(v) : v).replace(/[#\s]/g, '').replace(/[^A-Za-z0-9-]/g, '')
  return s || null
}

/** PO numbers are numeric; PDF text often renders the leading 0 as the letter O. */
export function normalizePo(v: unknown): string | null {
  if (v === null || v === undefined) return null
  let s = String(typeof v === 'number' ? v.toFixed(0) : v).trim().toUpperCase().replace(/\s/g, '')
  if (!s) return null
  const fixed = s.replace(/O/g, '0').replace(/[IL]/g, '1')
  if (/^\d+$/.test(fixed)) s = fixed
  return s
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Accepts: 2026-06-21 · June 21, 2026 · 21 June 2026 · 06/21/2026 · 6-21-26 ·
 * 09192026 (MMDDYYYY, Ryder remittance) · Excel serial numbers (46199 → 2026-06-26).
 */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const serial = Number(v)
    if (serial > 20000 && serial < 80000) {
      // Excel epoch is 1899-12-30 (accounts for Excel's 1900 leap-year bug). No extra -1.
      const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000
      return new Date(ms).toISOString().slice(0, 10)
    }
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(y, +m[1], +m[2]) }
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/)
  if (m) return iso(+m[3], +m[1], +m[2])
  const month = (name: string) => MONTHS[name.slice(0, 4).toLowerCase()] ?? MONTHS[name.slice(0, 3).toLowerCase()]
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (m && month(m[1])) return iso(+m[3], month(m[1]), +m[2])
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/)
  if (m && month(m[2])) return iso(+m[3], month(m[2]), +m[1])
  return null
}

// ── Excel / Google Sheet ─────────────────────────────────────

type Cell = string | number | boolean | Date | null | undefined

const norm = (c: Cell) => String(c ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

function nextValue(row: Cell[], from: number): Cell {
  for (let j = from + 1; j < row.length; j++) {
    if (row[j] !== null && row[j] !== undefined && String(row[j]).trim() !== '') return row[j]
  }
  return null
}

function lastNumber(row: Cell[]): number | null {
  for (let j = row.length - 1; j >= 0; j--) {
    const n = toNumber(row[j])
    if (n !== null) return n
  }
  return null
}

/** Reads the RZR invoice template from spreadsheet rows (label → value to its right). */
export function invoiceFromRows(rows: Cell[][]): InvoiceFields {
  const f: InvoiceFields = {
    invoice_number: null, po_number: null, unit_number: null, invoice_date: null, invoice_amount: null,
    ryder_vendor_number: null, customer_location: null, parts_total: null, charges: [],
    total_before_taxes: null, taxes: null, grand_total: null,
  }
  let inCharges = false
  for (const row of rows) {
    for (let j = 0; j < row.length; j++) {
      const label = norm(row[j])
      if (!label) continue
      if ((label === 'INVOICE #' || label === 'INVOICE#') && !f.invoice_number) f.invoice_number = normalizeInvoiceNumber(nextValue(row, j))
      else if ((label === 'ESTIMATE #' || label === 'ESTIMATE#') && !f.invoice_number) f.invoice_number = normalizeInvoiceNumber(nextValue(row, j))
      else if ((label === 'PO#' || label === 'PO #') && !f.po_number) f.po_number = normalizePo(nextValue(row, j))
      else if ((label === 'UNIT #' || label === 'UNIT#') && !f.unit_number) f.unit_number = String(nextValue(row, j) ?? '').trim() || null
      else if (label === 'DATE:' && !f.invoice_date) f.invoice_date = parseDate(nextValue(row, j))
      else if (label === 'RYDER VENDOR #' && !f.ryder_vendor_number) f.ryder_vendor_number = String(nextValue(row, j) ?? '').trim() || null
      else if (label === 'CUSTOMER:' && !f.customer_location) f.customer_location = String(nextValue(row, j) ?? '').trim() || null
    }
    const rowText = row.map(norm).join(' | ')
    if (rowText.includes('HOURS < TOTAL> PARTS') || rowText.includes('HOURS <TOTAL> PARTS')) f.parts_total = lastNumber(row)
    if (rowText.includes('GRAND TOTAL')) f.grand_total = lastNumber(row)
    else if (rowText.includes('TOTAL BEFORE TAXES')) { f.total_before_taxes = lastNumber(row); inCharges = false }
    else if (rowText.includes('ESTIMATED TAXES')) f.taxes = lastNumber(row)
    if (rowText.includes('LABOR - BODY')) inCharges = true
    if (inCharges) {
      // Summary-box labels are short and printed in capitals ("LABOR - REFINISH"); the
      // disclaimer sentence that shares these rows is mixed case — skip it.
      const isLabel = (c: Cell) => {
        const raw = String(c ?? '').trim()
        return raw.length > 2 && raw.length <= 40 && raw === raw.toUpperCase() && toNumber(c) === null
          && /^[A-Z][A-Z /&-]+$/.test(norm(c))
          && /LABOR|FREIGHT|TOWING|PAINT|SHOP|EPA|DISPOSAL|AFTER HOURS|ROAD CALL|SUBLET|STORAGE|MATERIAL|MISC|FEE|DIAG|MILEAGE/.test(norm(c))
      }
      let idx = -1
      row.forEach((c, k) => { if (isLabel(c)) idx = k })
      const amount = lastNumber(row)
      if (idx >= 0 && amount !== null) f.charges!.push({ label: String(row[idx]).trim(), amount })
    }
  }
  f.invoice_amount = f.grand_total ?? null
  return f
}

/** Parses xlsx / xls / csv / ods bytes → rows of the "Invoice" sheet (or the first sheet). */
export function rowsFromSpreadsheet(bytes: Uint8Array): Cell[][] {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: false })
  const name = wb.SheetNames.find((n: string) => n.trim().toLowerCase() === 'invoice') ?? wb.SheetNames[0]
  if (!name) return []
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) as Cell[][]
}

/** Normalises the raw object Gemini returns for an invoice. */
export function invoiceFromAi(raw: Record<string, unknown>): InvoiceFields {
  const charges = Array.isArray(raw.charges)
    ? (raw.charges as { label?: unknown; amount?: unknown }[])
      .map((c) => ({ label: String(c.label ?? ''), amount: toNumber(c.amount) ?? 0 }))
    : []
  const grand = toNumber(raw.grand_total)
  return {
    invoice_number: normalizeInvoiceNumber(raw.invoice_number),
    po_number: normalizePo(raw.po_number),
    unit_number: raw.unit_number ? String(raw.unit_number).trim() : null,
    invoice_date: parseDate(raw.invoice_date),
    invoice_amount: grand,
    ryder_vendor_number: raw.ryder_vendor_number ? String(raw.ryder_vendor_number).trim() : null,
    customer_location: raw.customer_location ? String(raw.customer_location).trim() : null,
    parts_total: toNumber(raw.parts_total),
    charges,
    total_before_taxes: toNumber(raw.total_before_taxes),
    taxes: toNumber(raw.taxes),
    grand_total: grand,
  }
}

export function validateInvoice(f: InvoiceFields, expectedVendor: string | null): Check[] {
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

  add('Invoice number', !!f.invoice_number && /^[0-9A-Za-z-]{4,}$/.test(f.invoice_number),
    f.invoice_number ? `Read "${f.invoice_number}"` : 'Not found on the document')
  add('Amount', f.invoice_amount !== null && f.invoice_amount > 0,
    f.invoice_amount !== null ? `GRAND TOTAL $${f.invoice_amount.toFixed(2)}` : 'GRAND TOTAL not found')

  const today = new Date()
  const d = f.invoice_date ? new Date(f.invoice_date + 'T00:00:00Z') : null
  const dateOk = !!d && d.getUTCFullYear() >= 2020 && d.getTime() <= today.getTime() + 7 * 86400000
  add('Invoice date', dateOk, f.invoice_date ? `Read ${f.invoice_date}` : 'Date not found')

  add('PO number', !!f.po_number && /^\d{6,}$/.test(f.po_number),
    f.po_number ? `Read "${f.po_number}"` : 'PO# not found')

  if (expectedVendor) {
    const v = (f.ryder_vendor_number ?? '').replace(/\D/g, '')
    add('Ryder vendor #', v === expectedVendor.replace(/\D/g, ''),
      v ? `Read ${v} (expected ${expectedVendor})` : `Not found (expected ${expectedVendor})`)
  }

  // Arithmetic: charges + parts = total before taxes; + taxes = grand total.
  const charges = f.charges ?? []
  if (f.total_before_taxes !== null && f.total_before_taxes !== undefined && charges.length > 0) {
    const sum = round2(charges.reduce((s, c) => s + (c.amount || 0), 0) + (f.parts_total ?? 0))
    add('Line items add up', near(sum, f.total_before_taxes),
      `Charges ${charges.map((c) => `${c.label} ${c.amount}`).join(' + ')} + parts ${f.parts_total ?? 0} = ${sum.toFixed(2)} vs total before taxes ${f.total_before_taxes.toFixed(2)}`)
  } else {
    add('Line items add up', false, 'Could not read the charge lines / total before taxes to verify')
  }
  if (f.grand_total !== null && f.grand_total !== undefined && f.total_before_taxes !== null && f.total_before_taxes !== undefined) {
    const expected = round2(f.total_before_taxes + (f.taxes ?? 0))
    add('Grand total = total before taxes + taxes', near(expected, f.grand_total),
      `${f.total_before_taxes.toFixed(2)} + ${(f.taxes ?? 0).toFixed(2)} = ${expected.toFixed(2)} vs grand total ${f.grand_total.toFixed(2)}`)
  }
  return checks
}

/** Strips leading zeros for comparing cheque numbers (prod has both "0006508024" and "6508024"). */
export const chequeKey = (n: string | null | undefined) => (n ?? '').replace(/\D/g, '').replace(/^0+/, '')

export function chequeFromAi(raw: Record<string, unknown>): ChequeFields {
  const lines = Array.isArray(raw.lines) ? (raw.lines as Record<string, unknown>[]) : []
  return {
    payer: raw.payer ? String(raw.payer) : null,
    check_number: raw.check_number ? String(raw.check_number).replace(/\s/g, '') : null,
    micr_check_number: raw.micr_check_number ? String(raw.micr_check_number).replace(/\D/g, '') : null,
    check_date: parseDate(raw.check_date),
    batch_number: raw.batch_number ? String(raw.batch_number).trim() : null,
    amount: toNumber(raw.amount),
    lines: lines
      .map((l) => ({
        invoice_number: normalizeInvoiceNumber(l.invoice_number) ?? '',
        invoice_date: l.invoice_date ? String(l.invoice_date) : null,
        invoice_amount: toNumber(l.invoice_amount),
        deduction: toNumber(l.deduction),
        amount_paid: toNumber(l.amount_paid) ?? toNumber(l.invoice_amount),
      }))
      .filter((l) => l.invoice_number),
  }
}

export function validateCheque(f: ChequeFields): Check[] {
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
  add('Cheque number', !!chequeKey(f.check_number), f.check_number ? `Read ${f.check_number}` : 'Not found')
  if (f.micr_check_number) {
    add('Matches MICR line', chequeKey(f.micr_check_number) === chequeKey(f.check_number),
      `Printed ${f.check_number ?? '?'} / MICR ${f.micr_check_number}`)
  }
  add('Amount', f.amount !== null && f.amount > 0, f.amount !== null ? `$${f.amount.toFixed(2)}` : 'Amount not found')
  add('Remittance lines', f.lines.length > 0, `${f.lines.length} invoice line(s)`)
  if (f.lines.length && f.amount !== null) {
    const sum = round2(f.lines.reduce((s, l) => s + (l.amount_paid ?? 0), 0))
    add('Lines add up to cheque amount', near(sum, f.amount), `Lines total ${sum.toFixed(2)} vs cheque ${f.amount.toFixed(2)}`)
  }
  add('Cheque date', !!f.check_date, f.check_date ? `Read ${f.check_date}` : 'Not found')
  return checks
}

export const allOk = (checks: Check[]) => checks.every((c) => c.ok)
export const failedSummary = (checks: Check[]) =>
  checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(' · ')
