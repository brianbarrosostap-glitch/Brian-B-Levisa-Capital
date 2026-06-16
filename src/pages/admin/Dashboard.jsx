import React, { useState, useEffect } from 'react'
import { AlertTriangle, AlertCircle, Check } from 'lucide-react'
import { C } from '../../tokens'
import { Card, Btn, Modal, ModalBody, ModalFooter, Field } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const KpiCard = ({ label, value, sub, borderColor, alert, valueColor }) => (
  <div style={{
    background: alert ? '#fff8f8' : '#fff',
    border: `1px solid ${C.border}`,
    borderLeft: `4px solid ${borderColor || C.primary}`,
    borderRadius: 12, padding: '14px 16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
  }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.3, marginBottom: 8 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color: valueColor || (alert ? C.red : C.textB), letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {sub && <div style={{ fontSize: 10.5, color: alert ? '#f87171' : C.textMut, marginTop: 2 }}>{sub}</div>}
  </div>
)

/* ── Match Confirmation Modal ── */
function MatchModal({ item, onClose, onResolved }) {
  const [loading, setLoading]     = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await callFunction('match-confirmation', {
        attention_id: item.id,
        invoice_id:   item.invoice_id,
        conf_number:  item.ryder_conf_number,
      })
      setConfirmed(true)
      onResolved(item.id)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  if (confirmed) return (
    <Modal onClose={onClose} title="Confirmed" width={520}>
      <ModalBody>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <Check size={22} color={C.primary} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Match confirmed!</div>
          <div style={{ fontSize: 13, color: C.textSm }}>Conf. #{item.ryder_conf_number} linked and marked Matched.</div>
        </div>
      </ModalBody>
      <ModalFooter><Btn onClick={onClose}>Done</Btn></ModalFooter>
    </Modal>
  )

  return (
    <Modal onClose={onClose} title="Match Confirmation Number" width={520}>
      <ModalBody>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Received from Ryder</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Conf. # (from email)" value={item.ryder_conf_number} mono />
            <Field label="Amount" value={fmt(item.ryder_amount)} accent />
          </div>
        </div>
        <div style={{ margin: '18px 0 8px', fontSize: 11, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Proposed Match</div>
        <div style={{
          padding: '12px 14px', border: `1.5px solid ${C.primary}`, borderRadius: 10,
          background: '#f6fef9', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'monospace' }}>{item.invoice_number}</div>
            <div style={{ fontSize: 12, color: C.textSm, marginTop: 2 }}>Unit {item.unit_number}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.primary }}>{fmt(item.ryder_amount)}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.textSm, marginTop: 12 }}>
          Confirming links conf. <strong>#{item.ryder_conf_number}</strong> to invoice <strong>{item.invoice_number}</strong> and marks it Matched.
        </div>
      </ModalBody>
      <ModalFooter>
        <Btn variant="ghost" onClick={onClose}>Skip for now</Btn>
        <Btn onClick={handleConfirm} disabled={loading}>
          <Check size={13} /> {loading ? 'Saving…' : 'Confirm Match'}
        </Btn>
      </ModalFooter>
    </Modal>
  )
}

/* ── Cheque Entry Modal ── */
function ChequeModal({ item, onClose, onResolved }) {
  const [val, setVal]     = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    setLoading(true)
    try {
      await callFunction('match-confirmation', {
        attention_id: item.id,
        invoice_id:   item.invoice_id,
        check_number: val,
      })
      onResolved(item.id)
      onClose()
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  return (
    <Modal onClose={onClose} title="Enter Check Manually" subtitle={`Invoice ${item.invoice_number} — unreadable scan`} width={480}>
      <ModalBody>
        <div style={{ padding: '11px 13px', borderRadius: 9, border: '1px solid #fecaca', background: '#fff8f8', fontSize: 13, color: '#991b1b', marginBottom: 18 }}>
          Check #{item.check_number} was scanned but the invoice ID could not be read. Please enter the details manually.
        </div>
        <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSm, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Check / Invoice Number
        </label>
        <input
          value={val} onChange={e => setVal(e.target.value)}
          placeholder={`e.g. ${item.invoice_number}`}
          style={{ width: '100%', padding: '9px 13px', borderRadius: 8, border: `1px solid ${C.borderMd}`, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
      </ModalBody>
      <ModalFooter>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={handleSave} disabled={!val.trim() || loading}>
          {loading ? 'Saving…' : 'Save Entry'}
        </Btn>
      </ModalFooter>
    </Modal>
  )
}

export default function Dashboard() {
  const [kpi, setKpi]           = useState(null)
  const [alerts, setAlerts]     = useState([])
  const [matchModal, setMatchModal] = useState(null)
  const [chequeModal, setChequeModal] = useState(null)

  useEffect(() => {
    fetchKpi()
    fetchAlerts()
  }, [])

  const fetchKpi = async () => {
    const { data } = await supabase.from('v_kpi').select('*').single()
    if (data) setKpi(data)
  }

  const fetchAlerts = async () => {
    const { data } = await supabase
      .from('needs_attention')
      .select(`
        id, type, title, detail, action_label,
        ryder_conf_number, ryder_amount, check_number, resolved,
        invoice:invoices(id, invoice_number, unit_number, status)
      `)
      .eq('resolved', false)
      .order('created_at', { ascending: true })

    if (data) {
      setAlerts(data.map(a => ({
        ...a,
        invoice_id:     a.invoice?.id,
        invoice_number: a.invoice?.invoice_number,
        unit_number:    a.invoice?.unit_number,
      })))
    }
  }

  const handleResolved = (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  // fallback while loading
  const d = kpi || {}

  return (
    <div>
      {/* KPI Grid row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 11, marginBottom: 11 }}>
        <KpiCard label="Total Invoices"         value={d.total_invoices ?? '—'}       sub="all time"           borderColor={C.primary} />
        <KpiCard label="Pending Invoices"        value={d.pending_invoices ?? '—'}     sub="not yet submitted"  borderColor="#0369a1" />
        <KpiCard label="Awaiting Confirmation"   value={d.awaiting_confirmation ?? '—'} sub="customer must confirm" borderColor="#b45309" />
        <KpiCard label="Open Payment Requests"   value={d.open_payment_requests ?? '—'} sub="awaiting wires"    borderColor="#7c3aed" />
        <KpiCard label="Overdue 60+ Days"        value={d.overdue_60 ?? '—'}           sub="needs follow-up"    borderColor={C.red} alert valueColor={C.red} />
      </div>

      {/* KPI Grid row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 11, marginBottom: 26 }}>
        <KpiCard label="Total Face Value"        value={fmt(d.total_face_value)}      sub="across all invoices"  borderColor={C.primary} />
        <KpiCard label="Total Advanced"          value={fmt(d.total_advanced)}        sub="wired to clients"     borderColor="#0369a1" />
        <KpiCard label="Discount Revenue"        value={fmt(d.discount_revenue)}      sub="3% factoring fees"    borderColor="#059669" />
        <KpiCard label="Pending with Ryder"      value={fmt(d.pending_with_ryder)}    sub="out for collection"   borderColor="#b45309" />
        <KpiCard label="Collected from Ryder"    value={fmt(d.collected_from_ryder)}  sub="received back"        borderColor="#7c3aed" />
      </div>

      {/* Needs Attention */}
      <Card noPad>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Needs Attention</span>
            {alerts.length > 0 && (
              <span style={{ background: '#fef9c3', color: '#b45309', borderRadius: 9999, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                {alerts.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: C.textMut }}>Manual review required — items below couldn't be matched automatically</span>
        </div>

        {alerts.length === 0 ? (
          <div style={{ padding: '24px 18px', textAlign: 'center', fontSize: 13, color: C.textMut }}>
            No items need attention right now.
          </div>
        ) : (
          alerts.map((item, i) => {
            const isAmber = item.type === 'conf_match'
            return (
              <div key={item.id} style={{
                padding: '14px 18px',
                background: isAmber ? '#fffdf5' : '#fff8f8',
                borderBottom: i < alerts.length - 1 ? `1px solid ${C.border}` : undefined,
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  background: isAmber ? '#fef9c3' : '#fee2e2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isAmber
                    ? <AlertTriangle size={16} color="#b45309" />
                    : <AlertCircle size={16} color={C.red} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: C.textSm, lineHeight: 1.4, marginTop: 2 }}>{item.detail}</div>
                </div>
                <Btn variant="secondary" size="sm" onClick={() => {
                  if (isAmber) setMatchModal(item)
                  else setChequeModal(item)
                }}>
                  {item.action_label}
                </Btn>
              </div>
            )
          })
        )}
      </Card>

      {matchModal  && <MatchModal  item={matchModal}  onClose={() => setMatchModal(null)}  onResolved={handleResolved} />}
      {chequeModal && <ChequeModal item={chequeModal} onClose={() => setChequeModal(null)} onResolved={handleResolved} />}
    </div>
  )
}
