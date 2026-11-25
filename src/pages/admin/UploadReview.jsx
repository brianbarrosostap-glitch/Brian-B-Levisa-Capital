import React, { useState, useEffect } from 'react'
import { Check, X, RotateCcw, Plus, Trash2, FileText, Receipt, AlertTriangle } from 'lucide-react'
import { C, TONE, FONT_MONO, shadow } from '../../tokens'
import { Card, Btn, Tabs, SearchBar, FilterChip, DataList, Modal, ModalBody, useViewportWidth } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import { usePersistentState } from '../../hooks/usePersistentState'
import FileLink from '../../components/FileLink'
import StatusPill from '../../components/StatusPill'
import { jobFileRef } from '../../lib/files'
import { errorMessage } from '../../lib/errors'
import {
  ADMIN_JOB_STATUS, REVIEW_JOB_STATUSES, adminJobStatus,
  fmtMoney, fmtDateTime, jobFileName,
} from '../../lib/documentJobs'

const KIND_LABEL = { invoice: 'Invoice', cheque: 'Cheque' }
const STATUS_OPTIONS = Object.values(ADMIN_JOB_STATUS).map(s => s.label)
const labelToStatus = Object.fromEntries(Object.entries(ADMIN_JOB_STATUS).map(([k, v]) => [v.label, k]))

// Inputs get className="lc-select" for the hover / green focus ring (index.css).
const inputStyle = {
  width: '100%', boxSizing: 'border-box', height: 38, padding: '0 11px', borderRadius: 8,
  border: `1px solid ${C.borderMd}`, fontSize: 14.5, color: C.text,
  background: C.card, fontFamily: 'inherit', boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
}
const sectionLabel = { fontSize: 12, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }
const countPill = { height: 20, padding: '0 8px', borderRadius: 9999, fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: 'none', display: 'inline-flex', alignItems: 'center' }

// "1,234.50" / "$1234.5" → 1234.5 ; '' → null ; junk → NaN
const parseAmount = (v) => {
  if (v == null || String(v).trim() === '') return null
  return Number(String(v).replace(/[$,\s]/g, ''))
}
// Any readable date → 'YYYY-MM-DD' (local), else ''
const toISODate = (v) => {
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10)
  const d = new Date(v)
  if (isNaN(d)) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const str = (v) => (v == null ? '' : String(v))

function initForm(job) {
  const ex = job?.extracted || {}
  if (job?.kind === 'cheque') {
    return {
      check_number: str(ex.check_number),
      check_date: toISODate(ex.check_date),
      amount: str(ex.amount),
      lines: (Array.isArray(ex.lines) ? ex.lines : []).map(l => ({
        invoice_number: str(l.invoice_number),
        amount_paid: str(l.amount_paid),
        invoice_amount: l.invoice_amount,
        deduction: l.deduction,
      })),
    }
  }
  return {
    invoice_number: str(ex.invoice_number),
    po_number: str(ex.po_number),
    unit_number: str(ex.unit_number),
    invoice_date: toISODate(ex.invoice_date),
    invoice_amount: str(ex.invoice_amount),
  }
}

/* Build the `fields` payload for review-document approve; returns { fields } or { error }. */
function buildFields(kind, f) {
  if (kind === 'cheque') {
    if (!f.check_number.trim()) return { error: 'Cheque # is required.' }
    const amount = parseAmount(f.amount)
    if (amount == null || isNaN(amount)) return { error: 'Cheque amount must be a number.' }
    const lines = []
    for (const [i, l] of f.lines.entries()) {
      if (!l.invoice_number.trim() && !String(l.amount_paid).trim()) continue   // blank row
      if (!l.invoice_number.trim()) return { error: `Line ${i + 1}: invoice # is required.` }
      const paid = parseAmount(l.amount_paid)
      if (paid == null || isNaN(paid)) return { error: `Line ${i + 1}: amount paid must be a number.` }
      lines.push({ invoice_number: l.invoice_number.trim(), amount_paid: paid })
    }
    return { fields: { check_number: f.check_number.trim(), check_date: f.check_date || null, amount, lines } }
  }
  if (!f.invoice_number.trim()) return { error: 'Invoice # is required.' }
  const amount = parseAmount(f.invoice_amount)
  if (amount == null || isNaN(amount) || amount <= 0) return { error: 'Invoice amount must be a number above 0.' }
  return {
    fields: {
      invoice_number: f.invoice_number.trim(),
      po_number: f.po_number.trim() || null,
      unit_number: f.unit_number.trim() || null,
      invoice_date: f.invoice_date || null,
      invoice_amount: amount,
    },
  }
}

const FieldInput = ({ label, value, onChange, type = 'text', mono, disabled, placeholder }) => (
  <label style={{ display: 'block' }}>
    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.textSm, marginBottom: 6 }}>{label}</span>
    <input type={type} value={value} disabled={disabled} placeholder={placeholder} className="lc-select"
      inputMode={label.toLowerCase().includes('amount') ? 'decimal' : undefined}
      onChange={e => onChange(e.target.value)}
      style={{ ...inputStyle, fontFamily: mono ? FONT_MONO : 'inherit', fontSize: mono ? 14 : 14.5, background: disabled ? C.panel : C.card }} />
  </label>
)

/* ── One upload: details, checks, editable fields, actions ──
   `framed` = rendered as a stand-alone review card (header band + action
   footer band). Inside the All-uploads modal it's rendered plain. */
function ReviewPanel({ job, names, onDone, framed }) {
  const [form, setForm]     = useState(() => initForm(job))
  const [busy, setBusy]     = useState('')       // '' | 'approve' | 'retry' | 'reject'
  const [error, setError]   = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote]     = useState('')
  const narrow = useViewportWidth() < 640

  useEffect(() => { setForm(initForm(job)); setError(''); setRejecting(false); setNote('') }, [job.id, job.updated_at])

  const editable = REVIEW_JOB_STATUSES.includes(job.status)
  const isCheque = job.kind === 'cheque'
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }))
  const setLine = (i, k, v) => setForm(f => ({ ...f, lines: f.lines.map((l, n) => n === i ? { ...l, [k]: v } : l) }))
  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { invoice_number: '', amount_paid: '' }] }))
  const removeLine = (i) => setForm(f => ({ ...f, lines: f.lines.filter((_, n) => n !== i) }))

  const run = async (action, extra) => {
    setBusy(action); setError('')
    try {
      const res = await callFunction('review-document', { job_id: job.id, action, ...extra })
      onDone(res?.job || null, job)
    } catch (e) {
      console.error('review-document failed:', e)
      setError(await errorMessage(e, 'Action failed'))
    }
    setBusy('')
  }

  const approve = () => {
    const { fields, error: err } = buildFields(job.kind, form)
    if (err) { setError(err); return }
    run('approve', { fields })
  }
  const reject = () => {
    if (!note.trim()) { setError('Add a short note — the customer sees it as the reason.'); return }
    run('reject', { note: note.trim() })
  }

  const s = adminJobStatus(job.status)
  const checks = Array.isArray(job.checks) ? job.checks : []
  const passed = checks.filter(c => c.ok).length
  const failed = checks.length - passed
  const linesTotal = isCheque ? form.lines.reduce((t, l) => t + (Number(parseAmount(l.amount_paid)) || 0), 0) : 0
  const chequeAmt = isCheque ? parseAmount(form.amount) : null
  const linesMismatch = isCheque && form.lines.length > 0 && chequeAmt != null && !isNaN(chequeAmt) && Math.abs(linesTotal - chequeAmt) >= 0.01

  const meta = [
    KIND_LABEL[job.kind] || job.kind,
    job.client?.name,
    `uploaded by ${names[job.created_by] || 'system'}`,
    fmtDateTime(job.created_at),
    job.source && job.source !== 'upload' ? `via ${job.source.replace('_', ' ')}` : null,
  ].filter(Boolean)

  const th = (align) => ({
    height: 38, padding: '0 12px', fontSize: 12.5, fontWeight: 600, color: C.textLbl, textAlign: align,
    background: C.panel, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
  })
  const amountCell = { padding: '6px 12px', fontSize: 14.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const dash = <span style={{ color: C.borderMd }}>—</span>

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        ...(framed
          ? { padding: '14px 20px', background: C.panel, borderBottom: `1px solid ${C.borderLt}` }
          : { marginBottom: 16 }),
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, background: C.primLt, flexShrink: 0,
          boxShadow: 'inset 0 0 0 1px rgba(0,121,83,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {isCheque ? <Receipt size={18} color={C.primary} /> : <FileText size={18} color={C.primary} />}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: C.textB, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{jobFileName(job)}</span>
            <FileLink variant="button" fileRef={jobFileRef(job)} label={job.storage_path ? 'View file' : 'Open link'} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 7px', fontSize: 13, color: C.textSm, marginTop: 4 }}>
            {meta.map((m, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span aria-hidden style={{ color: C.borderMd, fontSize: 11 }}>•</span>}
                <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{m}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
        <StatusPill label={s.label} tone={s.tone} />
      </div>

      <div style={framed ? { padding: '16px 20px 18px' } : undefined}>
        {job.status_reason && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', background: C.amberLt, border: '1px solid #fde68a',
            borderRadius: 10, padding: '10px 14px', fontSize: 14, lineHeight: 1.5, color: C.amber, marginBottom: 18,
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ overflowWrap: 'anywhere' }}>{job.status_reason}</span>
          </div>
        )}

        {checks.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...sectionLabel, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              Checks
              <span style={{ ...countPill, background: C.primLt, color: C.primary }}>{passed} passed</span>
              {failed > 0 && <span style={{ ...countPill, background: C.redLt, color: C.red }}>{failed} failed</span>}
            </div>
            <div style={{ border: `1px solid ${C.borderLt}`, borderRadius: 10, overflow: 'hidden' }}>
              {checks.map((c, i) => (
                <div key={i} style={{
                  display: 'grid', alignItems: 'start', columnGap: 10, rowGap: 2, padding: '9px 14px',
                  gridTemplateColumns: narrow ? '20px minmax(0, 1fr)' : '20px minmax(140px, 230px) minmax(0, 1fr)',
                  background: c.ok ? C.card : '#fff8f8',
                  borderTop: i ? `1px solid ${C.borderLt}` : 'none',
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%', marginTop: 1,
                    background: c.ok ? C.primLt : C.redLt,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {c.ok
                      ? <Check size={12} color={C.primary} strokeWidth={3} />
                      : <X size={12} color={C.red} strokeWidth={3} />}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45, color: c.ok ? C.textB : C.red }}>{c.name}</span>
                  {c.detail
                    ? <span style={{ fontSize: 14, lineHeight: 1.45, color: c.ok ? C.textSm : '#b91c1c', overflowWrap: 'anywhere', gridColumn: narrow ? '2' : undefined }}>{c.detail}</span>
                    : !narrow && <span />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Editable fields */}
        <div style={sectionLabel}>{editable ? 'Fields (edit before approving)' : 'Fields read'}</div>
        {isCheque ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, maxWidth: 720 }}>
              <FieldInput label="Cheque #" value={form.check_number} onChange={set('check_number')} mono disabled={!editable} />
              <FieldInput label="Cheque date" type="date" value={form.check_date} onChange={set('check_date')} disabled={!editable} />
              <FieldInput label="Cheque amount" value={form.amount} onChange={set('amount')} disabled={!editable} placeholder="0.00" />
            </div>
            <div style={{ marginTop: 16, border: `1px solid ${C.border}`, borderRadius: 10, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead>
                  <tr>
                    <th style={th('left')}>Invoice #</th>
                    <th style={th('right')}>Invoice amt</th>
                    <th style={th('right')}>Deduction</th>
                    <th style={{ ...th('right'), width: 170 }}>Amount paid</th>
                    <th style={{ ...th('right'), width: 52 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {form.lines.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '16px 12px', fontSize: 14, color: C.textMut, textAlign: 'center' }}>No invoice lines read from this cheque.</td></tr>
                  )}
                  {form.lines.map((l, i) => (
                    <tr key={i} className="lc-trow" style={{ background: C.card, borderTop: i ? `1px solid ${C.borderLt}` : 'none' }}>
                      <td style={{ padding: '6px 8px 6px 12px' }}>
                        <input value={l.invoice_number} disabled={!editable} onChange={e => setLine(i, 'invoice_number', e.target.value)}
                          aria-label={`Line ${i + 1} invoice #`} className="lc-select"
                          style={{ ...inputStyle, height: 36, minWidth: 118, maxWidth: 260, fontFamily: FONT_MONO, fontSize: 14, background: editable ? C.card : C.panel }} />
                      </td>
                      <td style={{ ...amountCell, color: C.text, fontWeight: 500 }}>{l.invoice_amount != null ? fmtMoney(l.invoice_amount) : dash}</td>
                      <td style={{ ...amountCell, color: C.textSm }}>{l.deduction != null ? fmtMoney(l.deduction) : dash}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <input value={l.amount_paid} disabled={!editable} inputMode="decimal" onChange={e => setLine(i, 'amount_paid', e.target.value)}
                          aria-label={`Line ${i + 1} amount paid`} className="lc-select"
                          style={{ ...inputStyle, height: 36, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', background: editable ? C.card : C.panel }} />
                      </td>
                      <td style={{ padding: '6px 12px 6px 4px', textAlign: 'right' }}>
                        {editable && (
                          <button type="button" onClick={() => removeLine(i)} title="Remove line" aria-label={`Remove line ${i + 1}`}
                            className="lc-del lc-focus" style={{
                            width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card,
                            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                          }}><Trash2 size={14} color={C.red} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <div>{editable && <Btn variant="subtle" size="sm" onClick={addLine}><Plus size={14} /> Add line</Btn>}</div>
              {form.lines.length > 0 && (
                <span style={{
                  fontSize: 14, fontVariantNumeric: 'tabular-nums', padding: '5px 12px', borderRadius: 8,
                  color: linesMismatch ? C.red : C.textSm, fontWeight: linesMismatch ? 600 : 500,
                  background: linesMismatch ? C.redLt : C.panel, border: `1px solid ${linesMismatch ? '#fecaca' : C.borderLt}`,
                }}>
                  Lines total <strong style={{ color: linesMismatch ? C.red : C.textB }}>{fmtMoney(linesTotal)}</strong>
                  {linesMismatch ? ` — differs from cheque amount ${fmtMoney(chequeAmt)}` : ''}
                </span>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            <FieldInput label="Invoice #" value={form.invoice_number} onChange={set('invoice_number')} mono disabled={!editable} />
            <FieldInput label="PO #" value={form.po_number} onChange={set('po_number')} mono disabled={!editable} />
            <FieldInput label="Unit #" value={form.unit_number} onChange={set('unit_number')} mono disabled={!editable} />
            <FieldInput label="Invoice date" type="date" value={form.invoice_date} onChange={set('invoice_date')} disabled={!editable} />
            <FieldInput label="Invoice amount" value={form.invoice_amount} onChange={set('invoice_amount')} disabled={!editable} placeholder="0.00" />
          </div>
        )}

        {(job.reviewed_at || job.review_note) && (
          <div style={{ fontSize: 13.5, color: C.textSm, marginTop: 14 }}>
            Reviewed{job.reviewed_by ? ` by ${names[job.reviewed_by] || 'admin'}` : ''}{job.reviewed_at ? ` · ${fmtDateTime(job.reviewed_at)}` : ''}
            {job.review_note ? <> — <em>{job.review_note}</em></> : null}
          </div>
        )}
      </div>

      {/* Actions */}
      {editable && (
        <div style={framed
          ? { padding: '12px 20px', background: C.panel, borderTop: `1px solid ${C.borderLt}` }
          : { marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          {rejecting ? (
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.textSm, marginBottom: 6 }}>
                Reason for rejecting {job.kind === 'invoice' ? '(shown to the customer)' : ''}
              </label>
              <textarea value={note} onChange={e => { setNote(e.target.value); setError('') }} rows={2} autoFocus
                placeholder="e.g. Not a Ryder invoice / unreadable copy — please re-upload" className="lc-select"
                style={{ ...inputStyle, height: 'auto', padding: '9px 11px', resize: 'vertical', lineHeight: 1.45 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Btn variant="danger" onClick={reject} disabled={!!busy}>{busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}</Btn>
                <Btn variant="secondary" onClick={() => { setRejecting(false); setError('') }} disabled={!!busy}>Cancel</Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Btn onClick={approve} disabled={!!busy}><Check size={15} strokeWidth={2.6} /> {busy === 'approve' ? 'Saving…' : 'Approve & save'}</Btn>
              <Btn variant="secondary" onClick={() => run('retry')} disabled={!!busy}><RotateCcw size={14} /> {busy === 'retry' ? 'Reading again…' : 'Retry reading'}</Btn>
              <Btn variant="ghost" className="lc-btn-redghost" style={{ color: C.red }} onClick={() => { setRejecting(true); setError('') }} disabled={!!busy}><X size={14} /> Reject</Btn>
            </div>
          )}
          {error && (
            <div style={{ fontSize: 14, color: C.red, background: C.redLt, border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginTop: 10 }}>{error}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function UploadReview({ onChanged }) {
  const [jobs, setJobs]       = useState([])
  const [names, setNames]     = useState({})     // profile id → full name
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [notice, setNotice]   = useState(null)   // { tone, text }
  const [openJob, setOpenJob] = useState(null)
  const [tab, setTab]         = usePersistentState('admin.review.tab', 'review')
  const [search, setSearch]   = usePersistentState('admin.review.search', '')
  const [statusFilter, setStatusFilter] = usePersistentState('admin.review.status', '')
  const [kindFilter, setKindFilter]     = usePersistentState('admin.review.kind', '')

  const fetchJobs = async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error: err } = await supabase
      .from('document_jobs')
      .select('*, client:clients(name)')
      .order('created_at', { ascending: false })
      .limit(500)
    if (err) {
      console.error('UploadReview load failed:', err)
      setError(err.code === '42P01' || err.code === 'PGRST205'
        ? 'Uploads table not set up yet — run migration 20261124000004_documents_storage.sql.'
        : 'Could not load uploads.')
    } else {
      setError('')
      setJobs(data || [])
      // Uploader / reviewer names — separate query so a profile error never blanks the list.
      const ids = [...new Set((data || []).flatMap(j => [j.created_by, j.reviewed_by]).filter(Boolean))]
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        setNames(Object.fromEntries((profs || []).map(p => [p.id, p.full_name || 'user'])))
      }
    }
    if (!silent) setLoading(false)
  }

  useEffect(() => { fetchJobs() }, [])

  // Keep the modal's job in sync after reloads.
  useEffect(() => {
    if (openJob) setOpenJob(j => jobs.find(x => x.id === j.id) || j)
  }, [jobs])   // eslint-disable-line react-hooks/exhaustive-deps

  const handleDone = (newJob, oldJob) => {
    if (newJob) {
      const s = adminJobStatus(newJob.status)
      const what = newJob.kind === 'cheque'
        ? (newJob.extracted?.check_number ? `Cheque ${newJob.extracted.check_number}` : jobFileName(newJob))
        : (newJob.extracted?.invoice_number ? `Invoice ${newJob.extracted.invoice_number}` : jobFileName(newJob))
      setNotice({ tone: s.tone, text: `${what} → ${s.label}${newJob.status_reason ? ` — ${newJob.status_reason}` : ''}` })
      setJobs(prev => prev.map(j => j.id === newJob.id ? { ...j, ...newJob } : j))
    } else {
      setNotice({ tone: 'info', text: `${jobFileName(oldJob)} updated.` })
    }
    fetchJobs(true)
    onChanged?.()
  }

  const reviewList = jobs.filter(j => REVIEW_JOB_STATUSES.includes(j.status))
  const q = search.trim().toLowerCase()
  const matchesSearch = (j) => !q
    || jobFileName(j).toLowerCase().includes(q)
    || String(j.extracted?.invoice_number || '').toLowerCase().includes(q)
    || String(j.extracted?.check_number || '').toLowerCase().includes(q)
    || String(j.status_reason || '').toLowerCase().includes(q)
    || String(j.client?.name || '').toLowerCase().includes(q)
  const statusKey = labelToStatus[statusFilter]
  const kindKey = kindFilter === 'Cheque' ? 'cheque' : kindFilter === 'Invoice' ? 'invoice' : ''
  const allList = jobs.filter(j =>
    matchesSearch(j)
    && (!statusKey || j.status === statusKey)
    && (!kindKey || j.kind === kindKey))
  const shownReview = reviewList.filter(j => matchesSearch(j) && (!kindKey || j.kind === kindKey))

  const columns = [
    { key: 'created_at', label: 'Uploaded', render: j => <span style={{ color: C.textSm, whiteSpace: 'nowrap' }}>{fmtDateTime(j.created_at)}</span> },
    { key: 'kind', label: 'Kind', render: j => KIND_LABEL[j.kind] || j.kind },
    {
      key: 'file', label: 'File',
      render: j => (
        <span title={jobFileName(j)} style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
          {jobFileName(j)}
        </span>
      ),
    },
    { key: 'client', label: 'Client', render: j => j.client?.name || '—' },
    { key: 'ref', label: 'Invoice / Cheque #', mono: true, render: j => (j.kind === 'cheque' ? j.extracted?.check_number : j.extracted?.invoice_number) || '—' },
    { key: 'amount', label: 'Amount', align: 'right', render: j => fmtMoney(j.kind === 'cheque' ? j.extracted?.amount : j.extracted?.invoice_amount) },
    { key: 'by', label: 'By', render: j => names[j.created_by] || '—' },
    {
      key: 'status', label: 'Status',
      render: j => {
        const s = adminJobStatus(j.status)
        return (
          <div>
            <StatusPill label={s.label} tone={s.tone} />
            {j.status_reason && (
              <div title={j.status_reason} style={{ fontSize: 12.5, color: C.textMut, marginTop: 3, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.status_reason}
              </div>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div>
      {notice && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '11px 16px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.05)',
          background: (TONE[notice.tone] || TONE.info).bg, color: (TONE[notice.tone] || TONE.info).text,
          fontSize: 14.5, fontWeight: 600,
        }}>
          <span style={{ flex: 1 }}>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }}><X size={14} /></button>
        </div>
      )}

      <Card noPad>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'review', label: 'Needs review', count: reviewList.length },
            { key: 'all',    label: 'All uploads',  count: jobs.length },
          ]} />
        </div>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search file, invoice #, cheque #, client, reason…" value={search} onChange={setSearch} />
          <FilterChip label="Kind" options={['Invoice', 'Cheque']} value={kindFilter} onChange={setKindFilter} />
          {tab === 'all' && <FilterChip label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />}
          {(search || kindFilter || (tab === 'all' && statusFilter)) && (
            <Btn variant="ghost" onClick={() => { setSearch(''); setKindFilter(''); setStatusFilter('') }}>
              <X size={14} /> Clear filters
            </Btn>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 14.5, color: C.textMut }}>Loading uploads…</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 14.5, color: C.red }}>{error}</div>
        ) : tab === 'review' ? (
          shownReview.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 14.5, color: C.textMut }}>
              {reviewList.length === 0 ? 'Nothing to review — every upload was read cleanly.' : 'No uploads match your filters.'}
            </div>
          ) : (
            /* Light-grey well so each white review card stands apart */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, background: C.panel }}>
              {shownReview.map(j => (
                <div key={j.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: C.card, boxShadow: shadow, overflow: 'hidden' }}>
                  <ReviewPanel job={j} names={names} onDone={handleDone} framed />
                </div>
              ))}
            </div>
          )
        ) : (
          <DataList columns={columns} rows={allList} onRowClick={setOpenJob}
            emptyText={jobs.length === 0 ? 'No uploads yet.' : 'No uploads match your filters.'} />
        )}
      </Card>

      {openJob && (
        <Modal onClose={() => setOpenJob(null)} width={760}
          title={`${KIND_LABEL[openJob.kind] || 'Upload'} upload`}
          subtitle={jobFileName(openJob)} accentHeader>
          <ModalBody>
            <ReviewPanel job={openJob} names={names}
              onDone={(nj, oj) => { handleDone(nj, oj); if (nj) setOpenJob(o => ({ ...o, ...nj })) }} />
          </ModalBody>
        </Modal>
      )}
    </div>
  )
}
