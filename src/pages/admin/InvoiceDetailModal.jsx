import React, { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { C, adminStatus, FONT_MONO } from '../../tokens'
import { Modal, ModalBody, ModalFooter, Btn, Badge, Field, TimelineStep, useIsMobile } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import FileLink from '../../components/FileLink'
import { invoiceFileRef, chequeFileRef } from '../../lib/files'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// dd/mm/yyyy HH:MM (24-hour). Used for every timeline / submission entry.
const dt = (v) => {
  if (!v) return ''
  const d = new Date(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Section heading used for every block in the modal.
const SectionTitle = ({ children, style }) => (
  <div style={{ fontSize: 12, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, lineHeight: 1.3, ...style }}>{children}</div>
)

// One label / amount line of the advance breakdown.
const BreakdownRow = ({ label, children }) => (
  <div style={{ padding: '0 16px', minHeight: 44, borderBottom: `1px solid ${C.borderLt}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 15 }}>
    <span style={{ color: C.textSm }}>{label}</span>
    {children}
  </div>
)

// "Awaiting" with a small neutral dot so it reads as a state, not a value.
const Awaiting = () => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: C.textSm }}>
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.borderMd, boxShadow: `0 0 0 3px ${C.borderLt}` }} />
    Awaiting
  </span>
)

export default function InvoiceDetailModal({ invoice: inv, onClose, onRefresh }) {
  const isMobile = useIsMobile()
  const [detail, setDetail]   = useState(null)
  const [timeline, setTimeline] = useState([])
  const [checks, setChecks]   = useState([])
  const [submissions, setSubmissions] = useState([])   // dated Ryder send history
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!inv?.id) return
    fetchDetail()
  }, [inv?.id])

  const fetchDetail = async () => {
    setLoading(true)
    const [{ data: invData }, { data: tl }, { data: chk }, { data: subs }] = await Promise.all([
      supabase
        .from('invoices')
        .select(`*, client:clients(name, debtor, contact_name, contact_email, factoring_rate, advance_rate)`)
        .eq('id', inv.id)
        .single(),
      supabase
        .from('invoice_timeline')
        .select('status, occurred_at, note')
        .eq('invoice_id', inv.id)
        .order('occurred_at', { ascending: true }),
      // Cheques linked to this invoice (payment proof from Ryder, via Drive)
      supabase
        .from('cheque_invoices')
        .select('cheque:cheques(id, check_number, ryder_conf_number, amount, status, drive_file_url, storage_path, received_at)')
        .eq('invoice_id', inv.id),
      // Dated history of each time the invoice was (re)sent to Ryder —
      // read straight from audit_logs. n8n writes one audit row per send
      // with source = 'ryder-submit' (or summary mentioning "sent to Ryder"),
      // so each row's created_at is that submission's date.
      supabase
        .from('audit_logs')
        .select('created_at, summary, source')
        .eq('record_id', inv.id)
        .or('source.eq.ryder-submit,summary.ilike.%sent to ryder%,summary.ilike.%submitted to ryder%')
        .order('created_at', { ascending: true }),
    ])
    if (invData) setDetail(invData)
    if (tl)     setTimeline(tl)
    if (chk)    setChecks(chk.map(r => r.cheque).filter(Boolean))
    // Map audit rows → submission entries with an attempt number.
    if (subs) setSubmissions(subs.map((r, i) => ({
      attempt: i + 1,
      sent_at: r.created_at,
      note: r.summary,
    })))
    setLoading(false)
  }

  // Two-step status update: idle → input (conf # if needed) → confirm → save
  const [footerStep, setFooterStep]   = useState('idle')    // 'idle' | 'input' | 'confirm'
  const [pendingStatus, setPendingStatus] = useState('')
  const [confNumber, setConfNumber]   = useState('')
  const [confError, setConfError]     = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const STATUS_LABELS_MODAL = {
    'Submitted to Ryder': 'Submitted to Ryder',
    'Acknowledged':        'Acknowledged by Ryder',
    'Resubmitted':         'Resubmitted to Ryder',
    'Paid':                'Paid — Cheque Received',
    'Cancelled':           'Cancel Invoice (void)',
  }

  const resetFooter = () => { setFooterStep('idle'); setPendingStatus(''); setConfNumber(''); setConfError('') }

  const handleSelect = (status) => {
    setPendingStatus(status)
    setConfNumber('')
    setConfError('')
    setFooterStep('input')
  }

  const goConfirm = () => {
    if (pendingStatus === 'Acknowledged' && !confNumber.trim()) { setConfError('Required'); return }
    setConfError('')
    setFooterStep('confirm')
  }

  const handleSave = async () => {
    setActionLoading(true)
    try {
      await callFunction('mark-invoice-status', {
        invoice_id: inv.id,
        action: 'set_status',
        status: pendingStatus,
        ...(pendingStatus === 'Acknowledged' && confNumber.trim()
          ? { conf_number: confNumber.trim(), note: `Conf #: ${confNumber.trim()}` }
          : {}),
      })
      resetFooter()
      fetchDetail()
      onRefresh?.()
    } catch (e) { console.error(e) }
    setActionLoading(false)
  }

  const d = detail || inv

  // The lifecycle, in order. `status` is the DB value (unchanged); `label`
  // is the friendly wording shown in the timeline.
  //   Payment Requested → Confirmation email sent for advance (Advance Confirmed)
  //   → Advance Agreed (RZR replied) → Advance Paid → Submitted to Ryder
  //   → Acknowledged (Ryder) → Paid (cheque received)
  const STEPS = [
    { status: 'Payment Requested',  label: 'Payment Requested' },
    { status: 'Advance Confirmed',  label: 'Confirmation Email Sent for Advance' },
    { status: 'Advance Agreed',     label: 'Advance Agreed (RZR Replied)' },
    { status: 'Advance Paid',       label: 'Advance Paid to RZR' },
    { status: 'Submitted to Ryder', label: 'Invoice Submitted to Ryder' },
    { status: 'Acknowledged',       label: 'Acknowledged by Ryder' },
    { status: 'Paid',               label: 'Paid — Cheque Received' },
  ]
  // If the invoice is currently Cancelled/Void, the lifecycle timeline no
  // longer applies — old history rows (e.g. a prior 'Paid') must NOT show as
  // the live state. We render a single "Cancelled" entry instead.
  const isTerminated = d.status === 'Cancelled' || d.status === 'Void'

  const doneSet = new Set(timeline.map(t => t.status))
  const currentIdx = STEPS.findIndex(s => !doneSet.has(s.status))

  const tlSteps = STEPS.map((step, i) => {
    const hit = timeline.find(t => t.status === step.status)
    return {
      label: step.label,
      date: hit ? dt(hit.occurred_at) : '',
      done: !!hit,
      current: !isTerminated && i === currentIdx,
      // Under the "Submitted to Ryder" step, list each (re)submission's
      // date+time (1st → last), pulled from the submission audit rows.
      extra: step.status === 'Submitted to Ryder' && submissions.length > 0
        ? submissions.map((s, n) => `${n === 0 ? '1st' : `#${n + 1}`} — ${dt(s.sent_at)}`)
        : null,
    }
  })

  // Fall back to the first audit-log submission row when ryder_submitted_at
  // is null (e.g. older invoices processed before the column was stamped).
  const ryderSubmittedAt = d.ryder_submitted_at
    || (submissions.length > 0 ? submissions[0].sent_at : null)

  const daysOut = d.ryder_days_out || (ryderSubmittedAt
    ? Math.floor((Date.now() - new Date(ryderSubmittedAt)) / 86400000)
    : null)

  return (
    <Modal onClose={onClose} width={940}
      title={`Invoice ${d.invoice_number}`}
      subtitle={`${d.client?.name || '—'} · Unit ${d.unit_number || '—'} · Invoiced ${d.invoice_date ? new Date(d.invoice_date).toLocaleDateString() : '—'}`}
      accentHeader
    >
      {loading ? (
        <ModalBody><div style={{ textAlign: 'center', padding: 32, color: C.textMut }}>Loading…</div></ModalBody>
      ) : (
        <ModalBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <Badge status={d.status} label={adminStatus(d.status)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '250px minmax(0, 1fr)', gap: 24 }}>
            {/* Left Column */}
            <div>
              <SectionTitle style={{ marginBottom: 14 }}>Status Timeline</SectionTitle>
              {isTerminated && (
                <div style={{ marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '10px 12px' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: C.red }}>This invoice was {d.status === 'Void' ? 'voided' : 'cancelled'}</div>
                  {d.voided_at && <div style={{ fontSize: 12.5, color: '#991b1b', marginTop: 2 }}>{dt(d.voided_at)}</div>}
                  <div style={{ fontSize: 12.5, color: C.textMut, marginTop: 4 }}>The steps below show the history up to cancellation.</div>
                </div>
              )}
              <div style={{ opacity: isTerminated ? 0.55 : 1 }}>
                {tlSteps.map((step, i) => (
                  <TimelineStep key={i} label={step.label} date={step.date} done={step.done} current={step.current} last={i === tlSteps.length - 1} extra={step.extra} />
                ))}
              </div>

              <div style={{ marginTop: 20, background: C.panel, border: `1px solid ${C.borderLt}`, borderRadius: 10, padding: '14px 16px' }}>
                <SectionTitle style={{ marginBottom: 8 }}>Customer</SectionTitle>
                <div style={{ fontWeight: 700, fontSize: 16.5, color: C.textB, letterSpacing: '-0.01em', marginBottom: 12, overflowWrap: 'anywhere' }}>{d.client?.name || '—'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '68px minmax(0, 1fr)', rowGap: 8, columnGap: 10, borderTop: `1px solid ${C.borderLt}`, paddingTop: 12 }}>
                  {[
                    ['Debtor',   d.client?.debtor],
                    ['Contact',  d.client?.contact_name],
                    ['Email',    d.client?.contact_email],
                    ['Discount', `${Math.round((d.client?.factoring_rate || 0.03) * 100)}%`],
                  ].map(([k,v]) => (
                    <React.Fragment key={k}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textLbl, lineHeight: 1.45 }}>{k}</span>
                      <span style={{ fontSize: 14, color: v ? C.text : C.borderMd, fontWeight: v ? 500 : 600, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{v || '—'}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
              {/* Invoice Details */}
              <div>
                <SectionTitle>Invoice Details</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                  <Field label="Invoice Amount" value={fmt(d.invoice_amount)} />
                  <Field label={`Advance @${Math.round((d.advance_rate || 0.97) * 100)}%`} value={fmt(d.advance_amount)} accent />
                  <Field label="Due Date" value={d.due_date ? new Date(d.due_date).toLocaleDateString() : '—'} />
                  <Field label="PO #" value={d.po_number || '—'} mono />
                  <Field label="Unit #" value={d.unit_number || '—'} mono />
                </div>
              </div>

              {/* Advance Breakdown */}
              <div>
                <SectionTitle>Advance Breakdown</SectionTitle>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <BreakdownRow label="Invoice face value">
                    <span style={{ fontWeight: 600, color: C.textB, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.invoice_amount)}</span>
                  </BreakdownRow>
                  <BreakdownRow label={`Factoring fee (${Math.round((d.client?.factoring_rate || 0.03) * 100)}%)`}>
                    <span style={{ fontWeight: 600, color: C.red, fontVariantNumeric: 'tabular-nums' }}>−{fmt(d.factoring_fee)}</span>
                  </BreakdownRow>
                  <div style={{ padding: '0 16px', minHeight: 52, background: '#f0faf5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: C.primDk, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Advance to customer ({Math.round((d.advance_rate || 0.97) * 100)}%)
                    </span>
                    <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.advance_amount)}</span>
                  </div>
                </div>
              </div>

              {/* Invoice File & Payment Proof (Google Drive) */}
              <div>
                <SectionTitle>Files &amp; Payment Proof</SectionTitle>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  {/* Invoice PDF */}
                  <div style={{ padding: '0 12px 0 16px', minHeight: 48, borderBottom: `1px solid ${C.borderLt}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 15 }}>
                    <span style={{ color: C.text, fontWeight: 500 }}>Invoice document</span>
                    <FileLink variant="button" fileRef={invoiceFileRef(d)} label="View Invoice" emptyLabel="Not uploaded" />
                  </div>
                  {/* Linked checks */}
                  {checks.length === 0 ? (
                    <div style={{ padding: '12px 16px', fontSize: 14, color: C.textMut, background: C.panel, lineHeight: 1.5 }}>
                      No checks linked yet — appears once Ryder’s payment lands in the Checks Drive folder.
                    </div>
                  ) : (
                    checks.map(c => (
                      <div key={c.id} style={{ padding: '0 12px 0 16px', minHeight: 48, borderTop: `1px solid ${C.borderLt}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 14.5, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, color: C.text }}>Check <span style={{ fontFamily: FONT_MONO }}>{c.check_number || '(no #)'}</span></span>
                          <span style={{ color: C.textMut }}>
                            {c.ryder_conf_number ? ` · conf ${c.ryder_conf_number}` : ''}
                            {c.amount != null ? ` · ${fmt(c.amount)}` : ''}
                          </span>
                        </div>
                        <FileLink variant="button" fileRef={chequeFileRef(c)} label="View Check" />
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Ryder Tracking */}
              <div>
                <SectionTitle>Ryder Tracking</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 10 }}>
                  <Field compact label="Submitted"  value={ryderSubmittedAt ? dt(ryderSubmittedAt) : '—'} />
                  <Field compact label="Conf. #"    value={d.ryder_conf_number || '—'} mono />
                  <Field compact label="Days Out"   value={daysOut != null ? `${daysOut}d` : '—'} red={daysOut >= 60} />
                  <Field compact label="Due Date"   value={d.due_date ? dt(d.due_date) : '—'} />
                </div>

                {daysOut >= 60 && (
                  <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 9, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={15} color={C.red} />
                    <span style={{ fontSize: 14.5, color: C.red, fontWeight: 600 }}>{daysOut}+ DAYS</span>
                    <span style={{ fontSize: 14, color: '#991b1b' }}>Awaiting payment — following up</span>
                  </div>
                )}

                {/* The per-submission dated history (1st → last) is now shown
                    inline under the "Invoice Submitted to Ryder" timeline step. */}
              </div>

              {/* Confirmations (email-driven, written by n8n) */}
              <div>
                <SectionTitle>Confirmations</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  <Field
                    label="Customer (RZR) Confirmed"
                    value={d.customer_confirmed_at ? dt(d.customer_confirmed_at) : <Awaiting />}
                    accent={!!d.customer_confirmed_at}
                  />
                  <Field
                    label="Ryder Confirmed"
                    value={d.ryder_confirmed_at ? dt(d.ryder_confirmed_at) : <Awaiting />}
                    accent={!!d.ryder_confirmed_at}
                  />
                </div>
              </div>
            </div>
          </div>
        </ModalBody>
      )}
      <ModalFooter>
        {footerStep === 'idle' && (
          <>
            <label htmlFor="admin-status-select" style={{ fontSize: 14, fontWeight: 600, color: C.textSm }}>Admin status</label>
            <select
              id="admin-status-select"
              className="lc-select"
              value=""
              onChange={e => { if (e.target.value) handleSelect(e.target.value) }}
              style={{
                height: 36, padding: '0 10px', borderRadius: 8, border: `1px solid ${C.borderMd}`,
                fontSize: 14.5, fontFamily: 'inherit', color: C.text, background: '#fff', cursor: 'pointer', minWidth: 260,
                boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
              }}
            >
              <option value="" disabled>Update status…</option>
              <option value="Submitted to Ryder">Submitted to Ryder</option>
              <option value="Acknowledged">Acknowledged by Ryder (enter conf #)</option>
              <option value="Resubmitted">Resubmitted to Ryder</option>
              <option value="Paid">Paid — Cheque Received</option>
              <option value="Cancelled">Cancel Invoice (void)</option>
            </select>
          </>
        )}

        {footerStep === 'input' && (
          <>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: C.textSm }}>
              → <span style={{ color: C.primary }}>{STATUS_LABELS_MODAL[pendingStatus]}</span>
            </span>
            {pendingStatus === 'Acknowledged' && (
              <>
                <label htmlFor="conf-number-input" style={{ fontSize: 13, fontWeight: 700, color: C.textSm }}>Conf #:</label>
                <input
                  id="conf-number-input"
                  autoFocus
                  value={confNumber}
                  onChange={e => { setConfNumber(e.target.value); setConfError('') }}
                  placeholder="e.g. 11158289"
                  onKeyDown={e => e.key === 'Enter' && goConfirm()}
                  className="lc-select"
                  style={{
                    flex: 1, height: 36, boxSizing: 'border-box', padding: '0 11px', borderRadius: 8,
                    border: `1px solid ${confError ? C.red : C.borderMd}`,
                    fontSize: 14.5, fontFamily: FONT_MONO, color: C.text,
                  }}
                />
                {confError && <span style={{ fontSize: 13, color: C.red }}>{confError}</span>}
              </>
            )}
            <Btn variant="secondary" onClick={resetFooter}>Cancel</Btn>
            <Btn onClick={goConfirm}>Next →</Btn>
          </>
        )}

        {footerStep === 'confirm' && (
          <>
            <div style={{ flex: 1, fontSize: 14.5, color: C.textSm }}>
              Confirm: move <strong style={{ fontFamily: FONT_MONO }}>{d.invoice_number}</strong> to{' '}
              <strong style={{ color: C.primary }}>{STATUS_LABELS_MODAL[pendingStatus]}</strong>
              {pendingStatus === 'Acknowledged' && confNumber && (
                <span style={{ color: C.textMut }}> · Conf # <strong style={{ fontFamily: FONT_MONO, color: C.text }}>{confNumber}</strong></span>
              )}
              ?
            </div>
            <Btn variant="secondary" onClick={() => setFooterStep('input')} disabled={actionLoading}>← Back</Btn>
            <Btn onClick={handleSave} disabled={actionLoading}>
              {actionLoading ? 'Saving…' : 'Yes, Update'}
            </Btn>
          </>
        )}
      </ModalFooter>
    </Modal>
  )
}
