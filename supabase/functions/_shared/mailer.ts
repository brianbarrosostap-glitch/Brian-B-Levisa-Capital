// SMTP sender (Gmail App Password by default).
//
// Supabase Edge Functions block outbound ports 25 and 587, so this uses
// port 465 (implicit TLS). Secrets:
//   SMTP_USER          the Gmail address (also the default From)
//   SMTP_PASS          16-char Google App Password (not the account password)
//   SMTP_HOST          default smtp.gmail.com
//   SMTP_PORT          default 465
//   SMTP_FROM          optional From header, e.g. "Levisa Capital <x@gmail.com>"
//
// DEV safety net (never set these on prod):
//   EMAIL_ALLOWED_DOMAINS  comma list, e.g. "growwstacks.com". Recipients on
//                          these domains receive mail normally; any other
//                          recipient is replaced by EMAIL_REDIRECT_TO (or
//                          dropped if that is unset).
//   EMAIL_REDIRECT_TO      catch-all address. Without EMAIL_ALLOWED_DOMAINS,
//                          EVERY email goes here. Redirected subjects are
//                          tagged "[DEV → original recipients]".

import nodemailer from 'npm:nodemailer@6.9.16'
import { Buffer } from 'node:buffer'

export interface MailAttachment {
  filename: string
  content: Uint8Array
  contentType?: string
}

export interface MailInput {
  to: string[]
  cc?: string[]
  subject: string
  html?: string | null
  text?: string | null
  replyTo?: string
  attachments?: MailAttachment[]
}

export interface MailResult {
  messageId: string | null
  redirectedTo: string | null
}

// deno-lint-ignore no-explicit-any
let transporter: any = null

function getTransport() {
  if (transporter) return transporter
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS secrets are not set')
  const port = Number(Deno.env.get('SMTP_PORT') ?? 465)
  if (port === 25 || port === 587) {
    throw new Error(`SMTP_PORT ${port} is blocked on Supabase Edge Functions — use 465`)
  }
  transporter = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
  })
  return transporter
}

/** Connects and logs in to the SMTP server without sending anything (Connections tab health check). */
export async function verifySmtp(): Promise<{ user: string; host: string; port: number }> {
  await getTransport().verify()
  return {
    user: Deno.env.get('SMTP_USER') ?? '',
    host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com',
    port: Number(Deno.env.get('SMTP_PORT') ?? 465),
  }
}

/** Applies EMAIL_ALLOWED_DOMAINS / EMAIL_REDIRECT_TO (dev safety net). */
export function applyRedirect(input: MailInput): MailInput & { redirectedTo: string | null } {
  const redirect = (Deno.env.get('EMAIL_REDIRECT_TO') ?? '').trim()
  const domains = (Deno.env.get('EMAIL_ALLOWED_DOMAINS') ?? '')
    .split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)

  if (!redirect && !domains.length) return { ...input, redirectedTo: null } // production

  const allowed = (addr: string) =>
    domains.length > 0 && domains.includes(addr.split('@').pop()!.trim().toLowerCase())

  const blocked = [...input.to, ...(input.cc ?? [])].filter((a) => !allowed(a))
  if (!blocked.length) return { ...input, redirectedTo: null } // all recipients are test addresses

  const keepTo = input.to.filter(allowed)
  const keepCc = (input.cc ?? []).filter(allowed)
  if (redirect && !keepTo.includes(redirect)) keepTo.push(redirect)
  if (!keepTo.length) {
    throw new Error(`Blocked by EMAIL_ALLOWED_DOMAINS (${blocked.join(', ')}) and no EMAIL_REDIRECT_TO set`)
  }
  return {
    ...input,
    to: keepTo,
    cc: keepCc,
    subject: `[DEV → ${blocked.join(', ')}] ${input.subject}`,
    redirectedTo: redirect || null,
  }
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (!input.to?.length) throw new Error('sendMail: no recipients')
  const mail = applyRedirect(input)
  const from = Deno.env.get('SMTP_FROM') ?? Deno.env.get('SMTP_USER')!
  const info = await getTransport().sendMail({
    from,
    to: mail.to.join(', '),
    cc: mail.cc?.length ? mail.cc.join(', ') : undefined,
    replyTo: mail.replyTo,
    subject: mail.subject,
    html: mail.html ?? undefined,
    text: mail.text ?? undefined,
    attachments: (mail.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content),
      contentType: a.contentType,
    })),
  })
  return { messageId: info?.messageId ?? null, redirectedTo: mail.redirectedTo }
}
