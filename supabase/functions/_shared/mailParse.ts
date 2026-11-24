// Parsing helpers for inbound emails (RZR replies, Docufree confirmations).

export function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
}

export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/** The part of a reply the sender actually wrote (the quoted original — which itself says
 *  "reply with Approved or Accepted" — is removed). */
export function newReplyText(html: string): string {
  let h = html
  for (const marker of [/<div[^>]+class="?gmail_quote/i, /<blockquote/i, /<div[^>]+id="?divRplyFwdMsg/i, /<hr[^>]*>/i]) {
    const i = h.search(marker)
    if (i > 0) h = h.slice(0, i)
  }
  let t = /<[a-z][\s\S]*>/i.test(h) ? htmlToText(h) : h
  for (const marker of [/^\s*On .{0,300}wrote:\s*$/im, /^-{2,}\s*Original Message\s*-{2,}/im, /^\s*From:\s.+$/im, /^>/m]) {
    const i = t.search(marker)
    if (i > 0) t = t.slice(0, i)
  }
  return t.trim()
}

/** "Approved" / "Accepted" (any case), but not "not approved", "rejected", … */
export function isApproval(text: string): boolean {
  if (!/\b(approved?|accepted?)\b/i.test(text)) return false
  return !/\b(not|isn'?t|aren'?t|don'?t|do not|cannot|can'?t|never|no longer)\b[^.\n]{0,25}\b(approv|accept)/i.test(text)
    && !/\b(reject(ed)?|decline(d)?|denied)\b/i.test(text)
}

/** Invoice numbers listed after the "#" in "Re: Payment Request for #1232314, 7388901". */
export function invoiceNumbersFromSubject(subject: string): string[] {
  const i = subject.indexOf('#')
  const tail = i >= 0 ? subject.slice(i) : subject
  return [...new Set(tail.match(/\d{5,}/g) ?? [])]
}

/** The Docufree "Click Here to View Invoice" link. */
export function viewerLink(html: string): string | null {
  const anchors = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  const view = anchors.find((a) => /view\s+invoice/i.test(a[2].replace(/<[^>]+>/g, '')))
    ?? anchors.find((a) => /docufree\.com\/docuview/i.test(a[1]))
  return view ? decodeEntities(view[1]) : null
}

export function invoiceNumberFromPdfText(text: string): string | null {
  const m = text.match(/Invoice\s*#\s*:?\s*([0-9]{4,})/i) ?? text.match(/Estimate\s*#\s*:?\s*([0-9]{4,})/i)
  return m ? m[1] : null
}
