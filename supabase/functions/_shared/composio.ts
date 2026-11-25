// Composio tool calls (Gmail read for the inbound mailbox, Drive/Sheets for
// Google Sheet links and the one-time Drive import). Composio refreshes the
// Google tokens itself, so there is no OAuth expiry to manage here.
//
// Secrets: COMPOSIO_API_KEY, COMPOSIO_USER_ID, COMPOSIO_GMAIL_ACCOUNT_ID,
//          COMPOSIO_DRIVE_ACCOUNT_ID, COMPOSIO_SHEETS_ACCOUNT_ID

const BASE = 'https://backend.composio.dev/api/v3.1/tools/execute'

type Account = 'gmail' | 'drive' | 'sheets'

function accountId(kind: Account): string {
  const key = {
    gmail: 'COMPOSIO_GMAIL_ACCOUNT_ID',
    drive: 'COMPOSIO_DRIVE_ACCOUNT_ID',
    sheets: 'COMPOSIO_SHEETS_ACCOUNT_ID',
  }[kind]
  const v = Deno.env.get(key)
  if (!v) throw new Error(`${key} is not set`)
  return v
}

// deno-lint-ignore no-explicit-any
export async function composioExecute(tool: string, account: Account, args: Record<string, unknown>): Promise<any> {
  const apiKey = Deno.env.get('COMPOSIO_API_KEY')
  const userId = Deno.env.get('COMPOSIO_USER_ID')
  if (!apiKey || !userId) throw new Error('COMPOSIO_API_KEY / COMPOSIO_USER_ID are not set')

  const res = await fetch(`${BASE}/${tool}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      connected_account_id: accountId(account),
      version: 'latest',
      arguments: args,
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.message ?? JSON.stringify(body)?.slice(0, 300)
    throw new Error(`Composio ${tool} HTTP ${res.status}: ${msg}`)
  }
  if (!body?.successful) throw new Error(`Composio ${tool} failed: ${body?.error ?? 'unknown error'}`)
  let data = body.data
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { /* plain string */ }
  }
  return data
}

// ── Gmail ────────────────────────────────────────────────────

export interface GmailMessage {
  id: string
  threadId: string | null
  fromEmail: string
  fromRaw: string
  subject: string
  html: string
  timestamp: string | null
  labelIds: string[]
}

function senderEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/)
  return (m ? m[1] : raw).trim().toLowerCase()
}

/** Gmail search (read-only). Pages until `limit` messages or no more pages. */
export async function fetchEmails(query: string, limit = 50): Promise<GmailMessage[]> {
  const out: GmailMessage[] = []
  let pageToken: string | undefined
  do {
    const data = await composioExecute('GMAIL_FETCH_EMAILS', 'gmail', {
      query,
      max_results: Math.min(50, limit - out.length),
      include_payload: true,
      verbose: true,
      ...(pageToken ? { page_token: pageToken } : {}),
    })
    // deno-lint-ignore no-explicit-any
    for (const m of (data?.messages ?? []) as any[]) {
      const fromRaw = String(m.sender ?? m.from ?? '')
      out.push({
        id: String(m.messageId ?? m.id),
        threadId: m.threadId ?? null,
        fromEmail: senderEmail(fromRaw),
        fromRaw,
        subject: String(m.subject ?? m.preview?.subject ?? ''),
        html: String(m.messageText ?? m.preview?.body ?? ''),
        timestamp: m.messageTimestamp ?? null,
        labelIds: m.labelIds ?? [],
      })
    }
    pageToken = data?.nextPageToken || undefined
  } while (pageToken && out.length < limit)
  return out
}

/** Marks a message as read (removes Gmail's UNREAD label) — what n8n did after handling an email. */
export async function markEmailRead(messageId: string): Promise<void> {
  await composioExecute('GMAIL_ADD_LABEL_TO_EMAIL', 'gmail', {
    message_id: messageId,
    add_label_ids: [],
    remove_label_ids: ['UNREAD'],
  })
}

// ── Drive ────────────────────────────────────────────────────

export function driveFileIdFromUrl(url: string): string | null {
  const m = url.match(/\/d\/([A-Za-z0-9_-]{15,})/) ?? url.match(/[?&]id=([A-Za-z0-9_-]{15,})/)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{15,}$/.test(url.trim()) ? url.trim() : null
}

export interface DownloadedFile {
  bytes: Uint8Array
  mimeType: string
  name: string
}

/**
 * Downloads a Drive file. For Google-native files (Sheets) pass `exportMime`
 * (e.g. application/pdf or the xlsx MIME) — Composio exports them.
 */
export async function downloadDriveFile(fileId: string, exportMime?: string): Promise<DownloadedFile> {
  const args: Record<string, unknown> = { fileId, ...(exportMime ? { mime_type: exportMime } : {}) }
  // deno-lint-ignore no-explicit-any
  let data: any
  try {
    data = await composioExecute('GOOGLEDRIVE_DOWNLOAD_FILE', 'drive', args)
  } catch (err) {
    // Older tool versions used snake_case file_id.
    if (!/file_?id|fileId|argument|param/i.test(String(err))) throw err
    data = await composioExecute('GOOGLEDRIVE_DOWNLOAD_FILE', 'drive',
      { file_id: fileId, ...(exportMime ? { mime_type: exportMime } : {}) })
  }
  const content = data?.downloaded_file_content ?? data?.file ?? data
  const url: string | undefined = content?.s3url ?? content?.s3_url ?? content?.url
  if (!url) throw new Error(`Composio download returned no file URL (${JSON.stringify(data)?.slice(0, 200)})`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Downloading Drive file content failed: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return {
    bytes,
    mimeType: String(content?.mimetype ?? content?.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream'),
    name: String(content?.name ?? content?.file_name ?? fileId),
  }
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
