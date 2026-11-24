// Email templates. Layout and wording match the n8n emails RZR/Ryder already know.

export interface PaymentRequestRow {
  invoice_number: string
  po_number: string | null
  invoice_amount: number | string | null
  advance_amount: number | string | null
}

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function money(n: unknown): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '0'))
  return (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "Invoice :- X is Paid." — the n8n email to RZR after the advance is paid (one email per run). */
export function advancePaidEmail(invoiceNumbers: string[]): { subject: string; text: string; html: string } {
  const lines = invoiceNumbers.map((n) => `Invoice :- ${n} is Paid.`)
  return {
    subject: `#${invoiceNumbers.join(', ')}`,
    text: lines.join('\n'),
    html: lines.map((l) => `<p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:14px;">${esc(l)}</p>`).join(''),
  }
}

/** Invoice submission to Ryder AP (Docufree): subject "#<invoice>", empty body, PDF attached — as n8n sent it. */
export function ryderSubmissionEmail(invoiceNumber: string): { subject: string; text: string } {
  return { subject: `#${invoiceNumber}`, text: '' }
}

/** Alert to Brian when RZR replies without "Approved"/"Accepted" (n8n: "Invoice Number :- X is not Approved."). */
export function notApprovedEmail(originalSubject: string, invoiceNumbers: string[], fromEmail: string, replyText: string) {
  const nums = invoiceNumbers.join(', ') || '(none found)'
  const text = `Invoice Number :- ${nums} is not Approved.\n\nReply from ${fromEmail}:\n${replyText.slice(0, 2000)}`
  return {
    subject: `Not approved: ${originalSubject || `invoice ${nums}`}`,
    text,
    html: `<p style="font-family:Arial,sans-serif;font-size:14px;">Invoice Number :- <b>${esc(nums)}</b> is not Approved.</p>`
      + `<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">Reply from ${esc(fromEmail)}:</p>`
      + `<pre style="font-family:Arial,sans-serif;font-size:12px;color:#333;white-space:pre-wrap;">${esc(replyText.slice(0, 2000))}</pre>`,
  }
}

/** Subject used for the RZR approval email; RZR replies are matched on the same phrase. */
export function paymentRequestSubject(phrase: string, invoiceNumbers: string[]): string {
  return `${phrase} #${invoiceNumbers.join(', ')}`
}

/** "Advance Amount Approval Request" — same content as the n8n email. */
export function paymentRequestEmail(rows: PaymentRequestRow[]): { html: string; text: string } {
  const rowsHtml = rows.map((item, index) => `
<tr style="background:${index % 2 === 0 ? '#ffffff' : '#f7f9fc'};">
  <td style="padding:12px 14px;font-size:14px;color:#333;border-bottom:1px solid #e0e0e0;">${esc(item.invoice_number)}</td>
  <td style="padding:12px 14px;font-size:14px;color:#333;border-bottom:1px solid #e0e0e0;">${esc(item.po_number ?? '')}</td>
  <td style="padding:12px 14px;font-size:14px;color:#555;font-weight:500;text-align:right;border-bottom:1px solid #e0e0e0;">$${money(item.invoice_amount)}</td>
  <td style="padding:12px 14px;font-size:14px;color:#1a7a4a;font-weight:600;text-align:right;border-bottom:1px solid #e0e0e0;">$${money(item.advance_amount)}</td>
</tr>`).join('')

  const totalInvoice = rows.reduce((s, i) => s + (parseFloat(String(i.invoice_amount ?? 0)) || 0), 0)
  const totalAdvance = rows.reduce((s, i) => s + (parseFloat(String(i.advance_amount ?? 0)) || 0), 0)

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:30px 0;"><tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><tr><td style="background:#1a3c5e;padding:24px 30px;border-radius:10px 10px 0 0;"><p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Levisa Capital</p><p style="margin:4px 0 0;color:#a8c4e0;font-size:13px;">Advance Amount Approval Request</p></td></tr><tr><td style="padding:28px 30px;"><p style="margin:0 0 8px;color:#333;font-size:15px;">Hello <strong>RZR</strong>,</p><p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6;">We have generated the advance amounts for the following invoices and require your approval before proceeding.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e0e0e0;"><thead><tr style="background:#1a3c5e;"><th style="padding:12px 14px;color:#ffffff;text-align:left;font-size:13px;">Invoice Number</th><th style="padding:12px 14px;color:#ffffff;text-align:left;font-size:13px;">PO Number</th><th style="padding:12px 14px;color:#ffffff;text-align:right;font-size:13px;">Requested Amount</th><th style="padding:12px 14px;color:#ffffff;text-align:right;font-size:13px;">Approved Advance</th></tr></thead><tbody>${rowsHtml}</tbody><tfoot><tr style="background:#f0f4f8;"><td colspan="2" style="padding:12px 14px;font-weight:700;font-size:14px;color:#1a3c5e;">TOTAL</td><td style="padding:12px 14px;font-weight:700;text-align:right;color:#555;font-size:14px;">$${money(totalInvoice)}</td><td style="padding:12px 14px;font-weight:700;text-align:right;color:#1a7a4a;font-size:14px;">$${money(totalAdvance)}</td></tr></tfoot></table><table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#fff8e1;border-left:4px solid #f5a623;"><tr><td style="padding:14px 16px;color:#7a5800;font-size:14px;line-height:1.6;">Please review the details above and reply with <strong>Approved</strong> or <strong>Accepted</strong> to confirm.</td></tr></table></td></tr><tr><td style="background:#f7f9fc;padding:16px 30px;border-top:1px solid #e8e8e8;border-radius:0 0 10px 10px;"><p style="margin:0;color:#888;font-size:12px;">Regards,<br><strong style="color:#1a3c5e;">Levisa Capital Team</strong></p></td></tr></table></td></tr></table></body></html>`

  const text = [
    'Hello RZR,',
    '',
    'We have generated the advance amounts for the following invoices and require your approval before proceeding.',
    '',
    ...rows.map((r) => `Invoice ${r.invoice_number} | PO ${r.po_number ?? '-'} | Requested $${money(r.invoice_amount)} | Advance $${money(r.advance_amount)}`),
    `TOTAL: Requested $${money(totalInvoice)} | Advance $${money(totalAdvance)}`,
    '',
    'Please review the details above and reply with "Approved" or "Accepted" to confirm.',
    '',
    'Regards,',
    'Levisa Capital Team',
  ].join('\n')

  return { html, text }
}
