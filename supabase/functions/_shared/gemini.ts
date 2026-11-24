// Google Gemini (API key — no OAuth). Used to read invoice PDFs and cheque photos.
// Secrets: GEMINI_API_KEY, GEMINI_MODEL (default gemini-2.5-flash)

import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

export interface GeminiFile {
  bytes: Uint8Array
  mimeType: string
}

/** Model used for the second read when the first read fails its arithmetic checks. */
export const fallbackModel = () => Deno.env.get('GEMINI_MODEL_FALLBACK') ?? 'gemini-2.5-pro'

/** Sends one file + instructions and returns the JSON object Gemini produced (schema-constrained). */
export async function geminiExtract<T>(
  instructions: string, file: GeminiFile, responseSchema: unknown, modelOverride?: string,
): Promise<T> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  const model = modelOverride ?? Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
  if (file.bytes.length > 19 * 1024 * 1024) throw new Error('File is too large for automatic reading (max ~19 MB)')

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: file.mimeType, data: encodeBase64(file.bytes) } },
          { text: instructions },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema,
      },
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${body?.error?.message ?? JSON.stringify(body)?.slice(0, 300)}`)
  }
  const text: string | undefined = body?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? '').join('')
  if (!text) {
    throw new Error(`Gemini returned no content (${body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason ?? 'unknown'})`)
  }
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()) as T
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`)
  }
}

// ── Schemas ──────────────────────────────────────────────────

export const INVOICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    invoice_number:      { type: 'STRING', nullable: true, description: 'Value next to "Invoice #" (or "Estimate #" if there is no Invoice #). Digits only.' },
    po_number:           { type: 'STRING', nullable: true, description: 'Value next to "PO#". It is numeric: a leading character that looks like the letter O is the digit 0.' },
    unit_number:         { type: 'STRING', nullable: true, description: 'Value next to "Unit #"' },
    invoice_date:        { type: 'STRING', nullable: true, description: 'Value next to "Date:", formatted YYYY-MM-DD' },
    ryder_vendor_number: { type: 'STRING', nullable: true, description: 'Value next to "Ryder Vendor #"' },
    customer_location:   { type: 'STRING', nullable: true, description: 'Value next to "Customer:" (a Ryder location)' },
    parts_total:         { type: 'NUMBER', nullable: true, description: 'Amount in the "HOURS < TOTAL> PARTS" box (total of the parts column)' },
    charges: {
      type: 'ARRAY',
      description: 'Every line of the summary box from "LABOR - BODY" down to the line just above "TOTAL BEFORE TAXES" (e.g. LABOR - BODY, LABOR - REFINISH, FREIGHT / TOWING, AFTER HOURS, PAINT MATERIALS, SHOP MATERIALS, ROAD CALL, EPA DISPOSAL), including $0.00 lines',
      items: {
        type: 'OBJECT',
        properties: { label: { type: 'STRING' }, amount: { type: 'NUMBER' } },
        required: ['label', 'amount'],
      },
    },
    total_before_taxes:  { type: 'NUMBER', nullable: true, description: '"TOTAL BEFORE TAXES" amount' },
    taxes:               { type: 'NUMBER', nullable: true, description: '"ESTIMATED TAXES" amount (not the percentage)' },
    grand_total:         { type: 'NUMBER', nullable: true, description: '"GRAND TOTAL" amount — may be on page 2' },
  },
  required: ['invoice_number', 'grand_total'],
}

export const INVOICE_INSTRUCTIONS = `You are reading an RZR Inc repair invoice (it may span 2 pages; GRAND TOTAL can be alone on page 2; ignore any table of Ryder locations).
Extract the fields exactly as printed. Money as plain numbers (no $ or commas).
Do NOT use "Total Estimate for Parts & Labor" as a total. If a field is absent, return null.`

export const CHEQUE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    payer:        { type: 'STRING', nullable: true, description: 'Who issued the cheque, e.g. Ryder System, Inc.' },
    check_number: { type: 'STRING', nullable: true, description: '"Check Number" exactly as printed, keep leading zeros' },
    micr_check_number: { type: 'STRING', nullable: true, description: 'The cheque number in the MICR line at the very bottom (first group of digits), keep leading zeros' },
    check_date:   { type: 'STRING', nullable: true, description: '"Check Date" as YYYY-MM-DD' },
    batch_number: { type: 'STRING', nullable: true, description: '"Batch Number" if printed' },
    amount:       { type: 'NUMBER', nullable: true, description: 'The cheque amount (the $ amount box)' },
    lines: {
      type: 'ARRAY',
      description: 'Every row of the remittance table (INVOICE NUMBER / INV DATE / INVOICE AMOUNT / DEDUCT/DISCOUNT / AMOUNT PAID)',
      items: {
        type: 'OBJECT',
        properties: {
          invoice_number: { type: 'STRING' },
          invoice_date:   { type: 'STRING', nullable: true, description: 'as printed, e.g. 09192026' },
          invoice_amount: { type: 'NUMBER', nullable: true },
          deduction:      { type: 'NUMBER', nullable: true },
          amount_paid:    { type: 'NUMBER', nullable: true },
        },
        required: ['invoice_number'],
      },
    },
  },
  required: ['check_number', 'amount', 'lines'],
}

export const CHEQUE_INSTRUCTIONS = `This is a photo of a Ryder remittance advice with the attached cheque (it may be skewed or partly shadowed).
Read the cheque number, date, batch number, the cheque amount, and every row of the remittance table.
Numbers as plain numbers. Keep leading zeros in the cheque number. If something is unreadable, return null for it.`
