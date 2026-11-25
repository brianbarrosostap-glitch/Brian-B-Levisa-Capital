import React, { useState, useEffect } from 'react'
import {
  Mail, Sparkles, Inbox, FolderOpen, Sheet, FileDown, FileCog, Timer, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, HelpCircle, ChevronDown, Wrench,
} from 'lucide-react'
import { C, shadow } from '../../tokens'
import { Card, Btn, Spinner, useIsMobile } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import { fmtDateTime } from '../../lib/documentJobs'

// Live health of every outside service. Rows come from public.connection_status,
// written by the check-connections edge function (hourly + "Check now").

const META = {
  smtp: {
    icon: Mail, used: 'Sends every email: payment requests to RZR, “paid” emails, invoices to Ryder, alerts.',
    fix: [
      'Usually the Gmail App Password was revoked or the Google password changed.',
      'Google Account (brianbarroso.stap@gmail.com) → Security → 2-Step Verification → App passwords → create a new one.',
      'Give it to your developer to update the SMTP_PASS secret in Supabase (Edge Functions → Secrets).',
      'Nothing is lost meanwhile: emails wait in Automation → Emails and go out once it works again.',
    ],
  },
  gemini: {
    icon: Sparkles, used: 'Reads uploaded invoice PDFs/photos and cheque photos.',
    fix: [
      'If the key expired or is not valid: aistudio.google.com → Get API key → create a new key.',
      'Give it to your developer to update the GEMINI_API_KEY secret in Supabase.',
      'If it says quota / rate limit: wait, or enable billing on the Google project.',
      'Uploads that failed meanwhile are in Upload Review — press “Retry reading” once it works.',
    ],
  },
  composio_gmail: {
    icon: Inbox, used: 'Reads RZR replies and Ryder confirmations from the mailbox, and marks them read.',
    fix: [
      'The Google sign-in behind Composio needs re-authorising.',
      'Composio dashboard → Connected accounts → Gmail → Reconnect, signing in as brianbarroso.stap@gmail.com.',
      'Nothing is lost: once reconnected, unread replies/confirmations from the last 7 days are picked up.',
    ],
  },
  composio_drive: {
    icon: FolderOpen, used: 'Opens Google Sheet / Drive links that RZR uploads.',
    fix: [
      'Composio dashboard → Connected accounts → Google Drive → Reconnect.',
      'Until then, ask RZR to upload the invoice as a PDF or Excel file instead of a link.',
    ],
  },
  composio_sheets: {
    icon: Sheet, used: 'Reads Google Sheet invoices that RZR uploads as a link.',
    fix: [
      'Composio dashboard → Connected accounts → Google Sheets → Reconnect.',
      'Until then, ask RZR to upload the invoice as a PDF or Excel file instead of a link.',
    ],
  },
  doc_downloader: {
    icon: FileDown, used: 'Opens the “View Invoice” link in Ryder’s Docufree confirmation emails to read the invoice number.',
    fix: [
      'The PDF downloader server is down — it needs restarting (ask your developer / server admin).',
      'Ryder confirmations are retried; any that still fail show in Alerts → Mailbox.',
    ],
  },
  doc_converter: {
    icon: FileCog, used: 'Turns Excel / Google Sheet invoices into the PDF that is emailed to Ryder.',
    fix: [
      'The converter server is down — it needs restarting (ask your developer / server admin).',
      'Invoices are still saved; the PDF is created later, before the invoice is emailed to Ryder.',
    ],
  },
  cron: {
    icon: Timer, used: 'The timers that run everything automatically: emails (2 min), mailbox (5 min), scheduled jobs (10 min).',
    fix: [
      'Nothing automatic happens while the timers are stopped — tell your developer.',
      'They check Supabase → Database → Cron Jobs, and the Vault secrets project_url / internal_secret.',
    ],
  },
}
const ORDER = ['smtp', 'gemini', 'composio_gmail', 'composio_drive', 'composio_sheets', 'doc_downloader', 'doc_converter', 'cron']

const STATE = {
  ok:      { label: 'Connected',        bg: '#f0fdf4', text: '#15803d', ring: '#bbf7d0', Icon: CheckCircle2 },
  warning: { label: 'Needs attention',  bg: '#fffbeb', text: '#b45309', ring: '#fde68a', Icon: AlertTriangle },
  error:   { label: 'Broken',           bg: '#fef2f2', text: '#b91c1c', ring: '#fecaca', Icon: XCircle },
  unknown: { label: 'Not checked yet',  bg: '#f1f5f9', text: '#475569', ring: '#e2e8f0', Icon: HelpCircle },
}

const ago = (ts) => {
  if (!ts) return 'never'
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

const Pill = ({ status }) => {
  const s = STATE[status] || STATE.unknown
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', borderRadius: 99, background: s.bg, color: s.text, boxShadow: `inset 0 0 0 1px ${s.ring}`, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <s.Icon size={13} /> {s.label}
    </span>
  )
}

function ConnectionCard({ row, keyName }) {
  const meta = META[keyName] || { icon: HelpCircle, used: '', fix: [] }
  const status = row?.status || 'unknown'
  const broken = status === 'error' || status === 'warning'
  const [open, setOpen] = useState(false)
  const showFix = broken || open
  const Icon = meta.icon
  return (
    <div style={{
      background: '#fff', border: `1px solid ${broken ? STATE[status].ring : C.border}`, borderRadius: 12, boxShadow: shadow,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: '15px 16px 12px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: broken ? STATE[status].bg : C.primLt, color: broken ? STATE[status].text : C.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={18} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15.5, fontWeight: 700, color: C.text }}>{row?.label || keyName}</span>
            <Pill status={status} />
          </div>
          <div style={{ fontSize: 13.5, color: C.textMut, marginTop: 3, lineHeight: 1.45 }}>{meta.used}</div>
        </div>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: broken ? STATE[status].text : C.textSm, background: broken ? STATE[status].bg : C.panel, border: `1px solid ${broken ? STATE[status].ring : C.borderLt}`, borderRadius: 8, padding: '8px 11px', overflowWrap: 'break-word' }}>
          {row?.message || 'Not checked yet — press “Check now”.'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8, fontSize: 12.5, color: C.textMut }}>
          <span title={row?.checked_at ? fmtDateTime(row.checked_at) : ''}>Checked {ago(row?.checked_at)}</span>
          {row?.last_ok_at && <span title={fmtDateTime(row.last_ok_at)}>Last OK {ago(row.last_ok_at)}</span>}
          {row?.last_error_at && <span title={fmtDateTime(row.last_error_at)} style={{ color: C.red }}>Last problem {ago(row.last_error_at)}</span>}
        </div>
      </div>
      <div style={{ marginTop: 'auto', borderTop: `1px solid ${C.borderLt}` }}>
        {!broken && (
          <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="lc-menu-item lc-focus" style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', border: 'none', background: 'transparent',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: C.textSm, cursor: 'pointer', textAlign: 'left',
          }}>
            <Wrench size={13} /> If this breaks <ChevronDown size={14} style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </button>
        )}
        {showFix && (
          <div style={{ padding: broken ? '11px 16px 13px' : '0 16px 13px', background: broken ? '#fffdf7' : 'transparent' }}>
            {broken && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700, color: C.text, marginBottom: 6 }}><Wrench size={13} /> How to fix</div>}
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {meta.fix.map((f, i) => <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: C.textSm }}>{f}</li>)}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Connections({ onChanged }) {
  const isMobile = useIsMobile()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [checking, setChecking] = useState(false)

  const load = () => supabase.from('connection_status').select('*').then(({ data, error: err }) => {
    if (err) setError(err.code === '42P01' || err.code === 'PGRST205' ? 'Not set up yet — run migration 20261125000001_connections.sql.' : 'Could not load connections.')
    else { setError(''); setRows(data || []) }
    setLoading(false)
  })
  useEffect(() => { load() }, [])

  const checkNow = async () => {
    setChecking(true); setError('')
    try { await callFunction('check-connections', {}); await load(); onChanged?.() }
    catch (e) { setError(await errorMessage(e, 'The check could not run.')) }
    setChecking(false)
  }

  const byKey = Object.fromEntries(rows.map(r => [r.key, r]))
  const keys = [...ORDER, ...rows.map(r => r.key).filter(k => !ORDER.includes(k))]
  const counts = { ok: 0, warning: 0, error: 0, unknown: 0 }
  keys.forEach(k => { counts[byKey[k]?.status || 'unknown']++ })
  const lastChecked = rows.reduce((m, r) => (r.checked_at && (!m || r.checked_at > m) ? r.checked_at : m), null)
  const allOk = counts.ok === keys.length

  return (
    <div style={{ maxWidth: 1320 }}>
      <Card noPad>
        <div style={{ padding: isMobile ? '16px' : '18px 22px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: allOk ? '#f0fdf4' : counts.error ? '#fef2f2' : '#fffbeb', color: allOk ? '#15803d' : counts.error ? '#b91c1c' : '#b45309' }}>
            {allOk ? <CheckCircle2 size={24} /> : counts.error ? <XCircle size={24} /> : <AlertTriangle size={24} />}
          </span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: C.textB, letterSpacing: '-0.01em' }}>
              {loading ? 'Loading…' : allOk ? 'All connections working' : `${counts.error + counts.warning} connection${counts.error + counts.warning === 1 ? '' : 's'} need${counts.error + counts.warning === 1 ? 's' : ''} attention`}
            </div>
            <div style={{ fontSize: 14, color: C.textMut, marginTop: 3 }}>
              {counts.ok} of {keys.length} OK · last checked {ago(lastChecked)} · checked automatically every hour; admins get a notification and an email when one breaks.
            </div>
          </div>
          <Btn onClick={checkNow} disabled={checking}>
            {checking ? <><Spinner /> Checking…</> : <><RefreshCw size={14} /> Check now</>}
          </Btn>
        </div>
        {error && <div role="alert" style={{ padding: '10px 22px', background: C.redLt, color: C.red, fontSize: 14, borderTop: `1px solid ${C.border}` }}>{error}</div>}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14, marginTop: 16, opacity: checking ? 0.6 : 1, transition: 'opacity .15s' }} aria-busy={checking}>
        {keys.map(k => <ConnectionCard key={k} keyName={k} row={byKey[k]} />)}
      </div>
    </div>
  )
}
