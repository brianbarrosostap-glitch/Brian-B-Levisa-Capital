import React, { useState, useEffect } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { C, adminStatus } from '../../tokens'
import { Modal, ModalBody, ModalFooter, Btn, Badge, Field, TimelineStep, useIsMobile } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const DriveLink = ({ url, label = 'View' }) => (
  <a
    href={url || '#'}
    target={url ? '_blank' : undefined}
    rel="noreferrer"
    onClick={!url ? e => e.preventDefault() : undefined}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: '#eff6ff', border: `1px solid ${C.border}`,
      borderRadius: 6, color: url ? '#1e40af' : C.textMut, fontSize: 12,
      padding: '4px 10px', textDecoration: 'none', fontWeight: 600,
      cursor: url ? 'pointer' : 'default', opacity: url ? 1 : 0.5,
    }}
  >
    <ExternalLink size={11} /> {label}
  </a>
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
        .select('cheque:cheques(id, check_number, ryder_conf_number, amount, status, drive_file_url, received_at)')
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

  const handleAction = async (action) => {
    try {
      await callFunction('mark-invoice-status', { invoice_id: inv.id, action })
      fetchDetail()
      onRefresh?.()
    } catch (e) { console.error(e) }
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
  const doneSet = new Set(timeline.map(t => t.status))
  const currentIdx = STEPS.findIndex(s => !doneSet.has(s.status))

  const tlSteps = STEPS.map((step, i) => {
    const hit = timeline.find(t => t.status === step.status)
    return {
      label: step.label,
      date: hit ? new Date(hit.occurred_at).toLocaleDateString() : '',
      done: !!hit,
      current: i === currentIdx,
    }
  })

  const daysOut = d.ryder_days_out || (d.ryder_submitted_at
    ? Math.floor((Date.now() - new Date(d.ryder_submitted_at)) / 86400000)
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Badge status={d.status} label={adminStatus(d.status)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '250px 1fr', gap: 22 }}>
            {/* Left Column */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                Status Timeline
              </div>
              {tlSteps.map((step, i) => (
                <TimelineStep key={i} label={step.label} date={step.date} done={step.done} current={step.current} last={i === tlSteps.length - 1} />
              ))}

              <div style={{ marginTop: 18, background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Customer</div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: C.textB, marginBottom: 8 }}>{d.client?.name}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[
                    ['Debtor',   d.client?.debtor],
                    ['Contact',  d.client?.contact_name],
                    ['Email',    d.client?.contact_email],
                    ['Discount', `${Math.round((d.client?.factoring_rate || 0.03) * 100)}%`],
                  ].map(([k,v]) => (
                    <div key={k} style={{ fontSize: 12, color: C.textSm }}>
                      <span style={{ color: C.textMut, fontWeight: 600, fontSize: 11 }}>{k}</span><br />{v || '—'}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Invoice Details */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Invoice Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 8 }}>
                  <Field label="Invoice Amount" value={fmt(d.invoice_amount)} />
                  <Field label={`Advance @${Math.round((d.advance_rate || 0.97) * 100)}%`} value={fmt(d.advance_amount)} accent />
                  <Field label="Due Date" value={d.due_date ? new Date(d.due_date).toLocaleDateString() : '—'} />
                  <Field label="PO #" value={d.po_number || '—'} mono />
                  <Field label="Unit #" value={d.unit_number || '—'} mono />
                </div>
              </div>

              {/* Advance Breakdown */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Advance Breakdown</div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: C.textSm }}>Invoice face value</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(d.invoice_amount)}</span>
                  </div>
                  <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: C.textSm }}>Factoring fee ({Math.round((d.client?.factoring_rate || 0.03) * 100)}%)</span>
                    <span style={{ color: C.red, fontVariantNumeric: 'tabular-nums' }}>−{fmt(d.factoring_fee)}</span>
                  </div>
                  <div style={{ padding: '12px 14px', background: '#f0faf5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Advance to customer ({Math.round((d.advance_rate || 0.97) * 100)}%)
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 800, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.advance_amount)}</span>
                  </div>
                </div>
              </div>

              {/* Invoice File & Payment Proof (Google Drive) */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Files &amp; Payment Proof</div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  {/* Invoice PDF */}
                  <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: C.textSm }}>Invoice document</span>
                    <DriveLink url={d.drive_file_url} label={d.drive_file_url ? 'View Invoice' : 'Not uploaded'} />
                  </div>
                  {/* Linked checks */}
                  {checks.length === 0 ? (
                    <div style={{ padding: '10px 14px', fontSize: 12.5, color: C.textMut }}>
                      No checks linked yet — appears once Ryder’s payment lands in the Checks Drive folder.
                    </div>
                  ) : (
                    checks.map(c => (
                      <div key={c.id} style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 12.5 }}>
                          <span style={{ fontWeight: 600, color: C.text }}>Check {c.check_number || '(no #)'}</span>
                          <span style={{ color: C.textMut }}>
                            {c.ryder_conf_number ? ` · conf ${c.ryder_conf_number}` : ''}
                            {c.amount != null ? ` · ${fmt(c.amount)}` : ''}
                          </span>
                        </div>
                        <DriveLink url={c.drive_file_url} label="View Check" />
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Ryder Tracking */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Ryder Tracking</div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
                  <Field label="Submitted"  value={d.ryder_submitted_at ? new Date(d.ryder_submitted_at).toLocaleDateString() : '—'} />
                  <Field label="Conf. #"    value={d.ryder_conf_number || '—'} mono />
                  <Field label="Days Out"   value={daysOut != null ? `${daysOut}d` : '—'} red={daysOut >= 60} />
                  <Field label="Due Date"   value={d.due_date ? new Date(d.due_date).toLocaleDateString() : '—'} />
                  <Field label="Resent to Ryder"
                    value={`${d.resubmit_count ?? 0}×`}
                    red={(d.resubmit_count ?? 0) >= 3}
                    accent={(d.resubmit_count ?? 0) > 0} />
                  <Field label="Last Resent"
                    value={d.last_resubmitted_at ? new Date(d.last_resubmitted_at).toLocaleDateString() : '—'} />
                </div>

                {daysOut >= 60 && (
                  <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 9, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={15} color={C.red} />
                    <span style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>{daysOut}+ DAYS</span>
                    <span style={{ fontSize: 12.5, color: '#991b1b' }}>Awaiting payment — following up</span>
                  </div>
                )}

                {/* Dated history of each time we (re)sent the invoice to Ryder.
                    Primary source = per-send audit_logs rows (one per send).
                    Fallback = the resubmit_count + last_resubmitted_at columns
                    that n8n updates, so we always show at least the count + last date. */}
                {submissions.length === 0 && (d.resubmit_count ?? 0) > 0 && (
                  <div style={{ marginTop: 12, border: `1px solid ${C.border}`, borderRadius: 9, padding: '10px 12px', background: '#fffbeb' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Ryder Submission Log</div>
                    <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600 }}>
                      Submitted to Ryder {d.resubmit_count}× {d.resubmit_count > 1 ? '(incl. resends)' : ''}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.textMut, marginTop: 2 }}>
                      Last sent: {d.last_resubmitted_at ? new Date(d.last_resubmitted_at).toLocaleString() : '—'}
                    </div>
                  </div>
                )}

                {submissions.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      Ryder Submission Log ({submissions.length})
                    </div>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden' }}>
                      {submissions.map((s, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                          borderTop: i > 0 ? `1px solid ${C.border}` : undefined,
                          background: s.attempt > 1 ? '#fffbeb' : '#fff',
                        }}>
                          <span style={{
                            flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                            background: s.attempt > 1 ? '#fef3c7' : C.primLt, color: s.attempt > 1 ? '#92400e' : C.primary,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
                          }}>{s.attempt}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>
                              {s.attempt === 1 ? 'First submission' : `Resubmission #${s.attempt - 1}`}
                            </div>
                            <div style={{ fontSize: 11, color: C.textMut }}>{s.note || ''}</div>
                          </div>
                          <span style={{ fontSize: 12, color: C.textSm, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {s.sent_at ? new Date(s.sent_at).toLocaleDateString() + ' ' + new Date(s.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Confirmations (email-driven, written by n8n) */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSm, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Confirmations</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <Field
                    label="Customer (RZR) Confirmed"
                    value={d.customer_confirmed_at ? new Date(d.customer_confirmed_at).toLocaleString() : 'Awaiting'}
                    accent={!!d.customer_confirmed_at}
                  />
                  <Field
                    label="Ryder Confirmed"
                    value={d.ryder_confirmed_at ? new Date(d.ryder_confirmed_at).toLocaleString() : 'Awaiting'}
                    accent={!!d.ryder_confirmed_at}
                  />
                </div>
              </div>
            </div>
          </div>
        </ModalBody>
      )}
      <ModalFooter>
        {/* Primary owner action: moves ONLY to 'Advance Paid' (no jump to Paid). */}
        <Btn size="sm" onClick={() => handleAction('mark_advance_paid')}>Mark Advance Paid</Btn>
        <Btn variant="outline" size="sm" onClick={() => handleAction('resubmit')}>Resubmit</Btn>
        <Btn variant="subtle"  size="sm" onClick={() => handleAction('mark_ryder_paid')}>Mark Ryder Paid</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" size="sm" style={{ color: C.red }} onClick={() => handleAction('set_void')}>Set to Void</Btn>
        <Btn variant="secondary" size="sm" onClick={() => handleAction('mark_paid_override')}>Mark Paid (override)</Btn>
      </ModalFooter>
    </Modal>
  )
}
