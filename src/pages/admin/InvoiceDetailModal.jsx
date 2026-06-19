import React, { useState, useEffect } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { C } from '../../tokens'
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!inv?.id) return
    fetchDetail()
  }, [inv?.id])

  const fetchDetail = async () => {
    setLoading(true)
    const [{ data: invData }, { data: tl }, { data: chk }] = await Promise.all([
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
    ])
    if (invData) setDetail(invData)
    if (tl)     setTimeline(tl)
    if (chk)    setChecks(chk.map(r => r.cheque).filter(Boolean))
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

  // Build timeline steps from DB rows + fill remaining steps
  const STEPS = ['Payment Requested','Advance Confirmed','Advance Agreed','Advance Paid','Submitted to Ryder','Acknowledged','Paid']
  const doneSet = new Set(timeline.map(t => t.status))
  const currentIdx = STEPS.findIndex(s => !doneSet.has(s))

  const tlSteps = STEPS.map((label, i) => {
    const hit = timeline.find(t => t.status === label)
    return {
      label,
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
            <Badge status={d.status} />
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
