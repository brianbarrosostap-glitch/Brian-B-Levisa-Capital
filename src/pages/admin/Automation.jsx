import React, { useState, useEffect } from 'react'
import { Save, Send, RefreshCw, Mail } from 'lucide-react'
import { C, TONE } from '../../tokens'
import { Card, Btn, SearchBar, DataList } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import { usePersistentState } from '../../hooks/usePersistentState'
import StatusPill from '../../components/StatusPill'
import { errorMessage } from '../../lib/errors'
import { fmtDateTime } from '../../lib/documentJobs'

// Scheduled jobs + email sending are run by edge functions / pg_cron; this
// screen only switches them and shows what they did.

const SWITCHES = [
  { key: 'send_emails',       label: 'Send emails',          desc: 'Send queued emails from the outbox.' },
  { key: 'auto_advance_paid', label: 'Auto Advance Paid',    desc: 'Advance Agreed → Advance Paid after N hours (auto_paid_hours) + email RZR.' },
  { key: 'submit_to_ryder',   label: 'Submit to Ryder',      desc: 'Email the invoice PDF to Ryder N days (ryder_wait_days) after Advance Paid.' },
  { key: 'ryder_resubmit',    label: 'Ryder resubmit',       desc: 'Resend to Ryder every N hours (resubmit_hours) until acknowledged.' },
  { key: 'poll_mailbox',      label: 'Poll mailbox',         desc: 'Read RZR replies + Ryder confirmations from the mailbox.' },
]
const MODES = [
  { value: 'off',     label: 'Off' },
  { value: 'dry_run', label: 'Dry run (log only)' },
  { value: 'live',    label: 'Live' },
]
const MODE_TONE  = { off: 'muted', dry_run: 'warn', live: 'success' }
const MODE_SHORT = { off: 'Off', dry_run: 'Dry run', live: 'Live' }

const SETTINGS = [
  { key: 'rzr_email',         label: 'RZR email',                 type: 'string', hint: 'Receives payment-request and “paid” emails' },
  { key: 'rzr_reply_senders', label: 'RZR reply senders',         type: 'array',  hint: 'Comma-separated — replies from these addresses can approve an advance' },
  { key: 'admin_alert_email', label: 'Admin alert email',         type: 'string', hint: 'Receives “not approved” and failure alerts' },
  { key: 'ryder_ap_email',    label: 'Ryder AP email',            type: 'string', hint: 'Invoices are submitted here' },
  { key: 'auto_paid_hours',   label: 'Auto-paid after (hours)',   type: 'number', hint: 'Advance Agreed → Advance Paid' },
  { key: 'ryder_wait_days',   label: 'Send to Ryder after (days)', type: 'number', hint: 'Days after Advance Paid' },
  { key: 'resubmit_hours',    label: 'Resubmit every (hours)',    type: 'number', hint: 'Until Ryder acknowledges' },
]

const EMAIL_TONE = { pending: 'info', sending: 'info', sent: 'success', failed: 'danger', cancelled: 'muted' }
const RUN_TONE   = { running: 'info', ok: 'success', error: 'danger' }

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 8,
  border: `1.5px solid ${C.borderMd}`, fontSize: 13, color: C.text, outline: 'none',
  background: C.card, fontFamily: 'inherit',
}

const str = (v) => (v == null ? '' : String(v))
const toDraft = (type, v) => type === 'array' ? (Array.isArray(v) ? v.join(', ') : str(v)) : str(v)
const fromDraft = (type, s) => {
  if (type === 'array')  return s.split(',').map(x => x.trim()).filter(Boolean)
  if (type === 'number') return s.trim() === '' ? null : Number(s)
  return s.trim()
}
const compact = (v) => { try { return v == null ? '' : JSON.stringify(v) } catch { return String(v) } }

const SectionHead = ({ title, subtitle, children }) => (
  <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.textB }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: C.textMut, marginTop: 2 }}>{subtitle}</div>}
    </div>
    {children}
  </div>
)

const Msg = ({ msg }) => msg ? (
  <div style={{ fontSize: 12.5, fontWeight: 600, color: (TONE[msg.tone] || TONE.info).text }}>{msg.text}</div>
) : null

const Trunc = ({ text, max = 260, mono }) => (
  <span title={text || ''} style={{
    display: 'inline-block', maxWidth: max, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    verticalAlign: 'middle', fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11.5 : undefined,
  }}>{text || '—'}</span>
)

const LoadState = ({ loading, error, children }) => loading
  ? <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading…</div>
  : error
    ? <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: C.red }}>{error}</div>
    : children

function useTable(load) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const reload = async () => {
    const { data, error: err } = await load()
    if (err) { console.error(err); setError(err.code === '42P01' || err.code === 'PGRST205' ? 'Table not set up yet — run the 20261124 migrations.' : 'Could not load.') }
    else { setError(''); setRows(data || []) }
    setLoading(false)
  }
  useEffect(() => { reload() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, loading, error, reload }
}

/* ── (a) + (b) settings ── */
function SettingsCards() {
  const [values, setValues]   = useState({})     // key → stored jsonb value
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [modes, setModes]     = useState({})
  const [draft, setDraft]     = useState({})
  const [savingA, setSavingA] = useState(false)
  const [savingB, setSavingB] = useState(false)
  const [msgA, setMsgA]       = useState(null)
  const [msgB, setMsgB]       = useState(null)

  const load = async () => {
    const { data, error: err } = await supabase.from('app_settings').select('key, value')
    if (err) {
      console.error('app_settings load failed:', err)
      setError(err.code === '42P01' || err.code === 'PGRST205' ? 'Settings table not set up yet — run migration 20261124000001_email_outbox.sql.' : 'Could not load settings.')
      setLoading(false)
      return
    }
    const v = Object.fromEntries((data || []).map(r => [r.key, r.value]))
    setValues(v)
    setModes({ ...(v.automation || {}) })
    setDraft(Object.fromEntries(SETTINGS.map(s => [s.key, toDraft(s.type, v[s.key])])))
    setError('')
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const modesChanged = SWITCHES.some(s => (modes[s.key] || 'off') !== ((values.automation || {})[s.key] || 'off'))
  const changedKeys = SETTINGS.filter(s => compact(fromDraft(s.type, draft[s.key] ?? '')) !== compact(values[s.key] ?? (s.type === 'array' ? [] : s.type === 'number' ? null : '')))

  const saveModes = async () => {
    setSavingA(true); setMsgA(null)
    const value = { ...(values.automation || {}), ...Object.fromEntries(SWITCHES.map(s => [s.key, modes[s.key] || 'off'])) }
    const { error: err } = await supabase.from('app_settings')
      .upsert({ key: 'automation', value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (err) { console.error(err); setMsgA({ tone: 'danger', text: `Could not save: ${err.message}` }) }
    else { setMsgA({ tone: 'success', text: 'Automation switches saved.' }); setValues(v => ({ ...v, automation: value })) }
    setSavingA(false)
  }

  const saveSettings = async () => {
    setMsgB(null)
    for (const s of changedKeys) {
      const v = fromDraft(s.type, draft[s.key] ?? '')
      if (s.type === 'number' && (v == null || isNaN(v) || v < 0)) { setMsgB({ tone: 'danger', text: `${s.label} must be a number (0 or more).` }); return }
      if (s.type === 'string' && v && !/^\S+@\S+\.\S+$/.test(v)) { setMsgB({ tone: 'danger', text: `${s.label} doesn’t look like an email address.` }); return }
      if (s.type === 'array' && v.some(x => !/^\S+@\S+\.\S+$/.test(x))) { setMsgB({ tone: 'danger', text: `${s.label}: every entry must be an email address.` }); return }
    }
    setSavingB(true)
    const now = new Date().toISOString()
    const results = await Promise.all(changedKeys.map(s =>
      supabase.from('app_settings')
        .upsert({ key: s.key, value: fromDraft(s.type, draft[s.key] ?? ''), updated_at: now }, { onConflict: 'key' })
        .then(r => ({ key: s.key, error: r.error }))))
    const failed = results.filter(r => r.error)
    if (failed.length) {
      console.error(failed)
      setMsgB({ tone: 'danger', text: `Could not save: ${failed.map(f => f.key).join(', ')}` })
    } else {
      setMsgB({ tone: 'success', text: `Saved ${results.length} setting${results.length === 1 ? '' : 's'}.` })
    }
    await load()
    setSavingB(false)
  }

  return (
    <>
      <Card noPad>
        <SectionHead title="Automation switches" subtitle="Off = never runs · Dry run = logs what it would do, changes nothing · Live = runs for real">
          <Msg msg={msgA} />
          <Btn onClick={saveModes} disabled={!modesChanged || savingA || loading}><Save size={13} /> {savingA ? 'Saving…' : 'Save switches'}</Btn>
        </SectionHead>
        <LoadState loading={loading} error={error}>
          <div>
            {SWITCHES.map((s, i) => {
              const mode = modes[s.key] || 'off'
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: i ? `1px solid ${C.border}` : 'none', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.label}</span>
                      <code style={{ fontSize: 11, color: C.textMut }}>{s.key}</code>
                    </div>
                    <div style={{ fontSize: 12, color: C.textSm, marginTop: 2 }}>{s.desc}</div>
                  </div>
                  <StatusPill label={MODE_SHORT[mode] || mode} tone={MODE_TONE[mode] || 'muted'} small />
                  <select value={mode} onChange={e => { setModes(m => ({ ...m, [s.key]: e.target.value })); setMsgA(null) }}
                    style={{ ...inputStyle, width: 190, cursor: 'pointer' }}>
                    {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        </LoadState>
      </Card>

      <Card noPad style={{ marginTop: 16 }}>
        <SectionHead title="Settings" subtitle="Recipients and timings used by the automation">
          <Msg msg={msgB} />
          <Btn onClick={saveSettings} disabled={changedKeys.length === 0 || savingB || loading}><Save size={13} /> {savingB ? 'Saving…' : 'Save settings'}</Btn>
        </SectionHead>
        <LoadState loading={loading} error={error}>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {SETTINGS.map(s => (
              <label key={s.key} style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.textSm, marginBottom: 5 }}>
                  {s.label}
                  {changedKeys.some(c => c.key === s.key) && <span style={{ color: C.amber, fontWeight: 600 }}> · changed</span>}
                </span>
                <input value={draft[s.key] ?? ''} inputMode={s.type === 'number' ? 'numeric' : undefined}
                  type={s.type === 'number' ? 'number' : 'text'} min={s.type === 'number' ? 0 : undefined}
                  onChange={e => { const v = e.target.value; setDraft(d => ({ ...d, [s.key]: v })); setMsgB(null) }}
                  style={inputStyle} />
                <span style={{ display: 'block', fontSize: 11, color: C.textMut, marginTop: 4 }}>{s.hint}</span>
              </label>
            ))}
          </div>
        </LoadState>
      </Card>
    </>
  )
}

/* ── (c) emails ── */
function EmailsCard() {
  const t = useTable(() => supabase.from('email_outbox')
    .select('id, kind, to_emails, cc_emails, subject, status, attempts, max_attempts, next_attempt_at, last_error, sent_at, redirected_to, created_at')
    .order('created_at', { ascending: false }).limit(100))
  const [search, setSearch] = usePersistentState('admin.automation.emails.search', '')
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy]     = useState('')   // '' | 'queue' | 'test'
  const [result, setResult] = useState(null) // { tone, text, errors? }

  const send = async (kind) => {
    if (kind === 'test' && !/^\S+@\S+\.\S+$/.test(testTo.trim())) { setResult({ tone: 'danger', text: 'Enter a valid email address for the test.' }); return }
    setBusy(kind); setResult(null)
    try {
      const r = await callFunction('send-emails', kind === 'test' ? { test_to: testTo.trim() } : {}) || {}
      const errs = Array.isArray(r.errors) ? r.errors : r.errors ? [r.errors] : []
      const parts = [
        r.mode && `mode ${r.mode}`,
        r.claimed != null && `claimed ${r.claimed}`,
        r.sent != null && `sent ${r.sent}`,
        r.retrying != null && `retrying ${r.retrying}`,
        r.failed != null && `failed ${r.failed}`,
      ].filter(Boolean)
      setResult({
        tone: errs.length || r.failed ? 'warn' : 'success',
        text: (kind === 'test' ? `Test email to ${testTo.trim()}: ` : 'Send queued: ') + (parts.join(' · ') || 'done'),
        errors: errs.map(e => typeof e === 'string' ? e : compact(e)),
      })
      t.reload()
    } catch (e) {
      console.error('send-emails failed:', e)
      setResult({ tone: 'danger', text: await errorMessage(e, 'send-emails failed') })
    }
    setBusy('')
  }

  const q = search.trim().toLowerCase()
  const rows = t.rows.filter(r => !q || [r.kind, r.subject, r.status, r.last_error, r.redirected_to, ...(r.to_emails || [])]
    .some(v => String(v || '').toLowerCase().includes(q)))

  const columns = [
    { key: 'created_at', label: 'Created', render: r => <span style={{ color: C.textSm, whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</span> },
    { key: 'kind', label: 'Kind', render: r => <code style={{ fontSize: 11.5 }}>{r.kind || '—'}</code> },
    {
      key: 'to', label: 'To',
      render: r => (
        <div>
          <Trunc text={(r.to_emails || []).join(', ')} max={200} />
          {r.redirected_to && <div style={{ fontSize: 11, color: C.amber }}>dev → {r.redirected_to}</div>}
        </div>
      ),
    },
    { key: 'subject', label: 'Subject', render: r => <Trunc text={r.subject} max={260} /> },
    { key: 'status', label: 'Status', render: r => <StatusPill label={r.status} tone={EMAIL_TONE[r.status] || 'muted'} small /> },
    { key: 'attempts', label: 'Attempts', align: 'right', render: r => `${r.attempts ?? 0}${r.max_attempts ? ` / ${r.max_attempts}` : ''}` },
    { key: 'sent_at', label: 'Sent', render: r => <span style={{ color: C.textSm, whiteSpace: 'nowrap' }}>{r.sent_at ? fmtDateTime(r.sent_at) : '—'}</span> },
    { key: 'last_error', label: 'Last Error', render: r => r.last_error ? <span style={{ color: C.red }}><Trunc text={r.last_error} max={220} /></span> : '—' },
  ]

  return (
    <Card noPad style={{ marginTop: 16 }}>
      <SectionHead title="Emails" subtitle="Last 100 emails in the outbox">
        <Btn variant="ghost" size="sm" onClick={t.reload}><RefreshCw size={12} /> Refresh</Btn>
        <Btn size="sm" onClick={() => send('queue')} disabled={!!busy}><Send size={12} /> {busy === 'queue' ? 'Sending…' : 'Send queued now'}</Btn>
      </SectionHead>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SearchBar placeholder="Search kind, recipient, subject, status…" value={search} onChange={setSearch} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="test@example.com"
            onKeyDown={e => e.key === 'Enter' && send('test')}
            style={{ ...inputStyle, width: 210, padding: '6px 10px', fontSize: 12.5 }} />
          <Btn variant="secondary" size="sm" onClick={() => send('test')} disabled={!!busy}><Mail size={12} /> {busy === 'test' ? 'Sending…' : 'Send test email'}</Btn>
        </div>
      </div>
      {result && (
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: (TONE[result.tone] || TONE.info).bg, color: (TONE[result.tone] || TONE.info).text, fontSize: 12.5 }}>
          <div style={{ fontWeight: 600 }}>{result.text}</div>
          {result.errors?.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {result.errors.slice(0, 10).map((e, i) => <li key={i} style={{ wordBreak: 'break-word' }}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
      <LoadState loading={t.loading} error={t.error}>
        <DataList columns={columns} rows={rows} emptyText={t.rows.length ? 'No emails match your search.' : 'No emails yet.'} />
      </LoadState>
    </Card>
  )
}

/* ── (d) job runs ── */
function JobRunsCard() {
  const t = useTable(() => supabase.from('job_runs')
    .select('id, job, mode, status, summary, error, started_at, finished_at')
    .order('started_at', { ascending: false }).limit(50))
  const [search, setSearch] = usePersistentState('admin.automation.jobs.search', '')

  const q = search.trim().toLowerCase()
  const rows = t.rows.filter(r => !q || [r.job, r.mode, r.status, r.error, compact(r.summary)]
    .some(v => String(v || '').toLowerCase().includes(q)))

  const duration = (r) => {
    if (!r.finished_at) return r.status === 'running' ? 'running…' : '—'
    const ms = new Date(r.finished_at) - new Date(r.started_at)
    return ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`
  }

  const columns = [
    { key: 'job', label: 'Job', render: r => <code style={{ fontSize: 11.5 }}>{r.job}</code> },
    { key: 'mode', label: 'Mode', render: r => <StatusPill label={r.mode} tone={MODE_TONE[r.mode] || 'muted'} small /> },
    { key: 'status', label: 'Status', render: r => <StatusPill label={r.status} tone={RUN_TONE[r.status] || 'muted'} small /> },
    { key: 'started_at', label: 'Started', render: r => <span style={{ color: C.textSm, whiteSpace: 'nowrap' }}>{fmtDateTime(r.started_at)}</span> },
    { key: 'duration', label: 'Duration', align: 'right', render: duration },
    {
      key: 'summary', label: 'Summary',
      render: r => r.error
        ? <span style={{ color: C.red }}><Trunc text={r.error} max={320} /></span>
        : <Trunc text={compact(r.summary)} max={320} mono />,
    },
  ]

  return (
    <Card noPad style={{ marginTop: 16 }}>
      <SectionHead title="Scheduled job runs" subtitle="Last 50 runs">
        <SearchBar placeholder="Search job, status, summary…" value={search} onChange={setSearch} />
        <Btn variant="ghost" size="sm" onClick={t.reload}><RefreshCw size={12} /> Refresh</Btn>
      </SectionHead>
      <LoadState loading={t.loading} error={t.error}>
        <DataList columns={columns} rows={rows} emptyText={t.rows.length ? 'No runs match your search.' : 'No job runs yet.'} />
      </LoadState>
    </Card>
  )
}

/* ── (e) mailbox ── */
function MailboxCard() {
  const t = useTable(() => supabase.from('processed_emails')
    .select('message_id, thread_id, kind, from_email, subject, received_at, result, invoice_numbers, processed_at')
    .order('processed_at', { ascending: false }).limit(100))
  const [search, setSearch] = usePersistentState('admin.automation.mailbox.search', '')

  const q = search.trim().toLowerCase()
  const rows = t.rows
    .map(r => ({ ...r, id: r.message_id }))
    .filter(r => !q || [r.kind, r.from_email, r.subject, r.result, ...(r.invoice_numbers || [])]
      .some(v => String(v || '').toLowerCase().includes(q)))

  const columns = [
    { key: 'processed_at', label: 'Processed', render: r => <span style={{ color: C.textSm, whiteSpace: 'nowrap' }}>{fmtDateTime(r.processed_at)}</span> },
    { key: 'kind', label: 'Kind', render: r => <code style={{ fontSize: 11.5 }}>{r.kind}</code> },
    { key: 'from_email', label: 'From', render: r => <Trunc text={r.from_email} max={200} /> },
    { key: 'subject', label: 'Subject', render: r => <Trunc text={r.subject} max={260} /> },
    {
      key: 'result', label: 'Result',
      render: r => <StatusPill label={r.result} small
        tone={['approved', 'acknowledged'].includes(r.result) ? 'success' : ['error', 'not_approved'].includes(r.result) ? 'danger' : r.result === 'dry_run' ? 'warn' : 'muted'} />,
    },
    { key: 'invoice_numbers', label: 'Invoices', mono: true, render: r => <Trunc text={(r.invoice_numbers || []).join(', ')} max={200} /> },
  ]

  return (
    <Card noPad style={{ marginTop: 16 }}>
      <SectionHead title="Mailbox" subtitle="Last 100 emails read from the inbound mailbox">
        <SearchBar placeholder="Search sender, subject, result, invoice #…" value={search} onChange={setSearch} />
        <Btn variant="ghost" size="sm" onClick={t.reload}><RefreshCw size={12} /> Refresh</Btn>
      </SectionHead>
      <LoadState loading={t.loading} error={t.error}>
        <DataList columns={columns} rows={rows} emptyText={t.rows.length ? 'No emails match your search.' : 'No mailbox activity yet.'} />
      </LoadState>
    </Card>
  )
}

export default function Automation() {
  return (
    <div>
      <SettingsCards />
      <EmailsCard />
      <JobRunsCard />
      <MailboxCard />
    </div>
  )
}
