import React, { useState, useEffect } from 'react'
import { AlertTriangle, AlertCircle, Check } from 'lucide-react'
import { C } from '../../tokens'
import { Card, Btn, Modal, ModalBody, ModalFooter, Field, Grid } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import { useDateRange, PRESETS } from '../../hooks/useDateRange'
import { VolumeChart, PipelineChart, ProfitTrendChart, OverdueAgingChart } from './DashboardCharts'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = n => Number(n || 0).toLocaleString('en-US')
const days = n => (n == null ? '—' : `${Number(n).toFixed(1)} days`)

// party: 'RZR' (customer we advance to) | 'Ryder' (debtor who pays us) | 'Lavisa' | null
const PARTY_STYLE = {
  RZR:    { bg: '#eff6ff', text: '#1e40af' },
  Ryder:  { bg: '#f5f3ff', text: '#6d28d9' },
  Lavisa: { bg: '#ecfdf5', text: '#047857' },
}
const PartyTag = ({ party }) => {
  if (!party) return null
  const s = PARTY_STYLE[party] || { bg: '#f1f5f9', text: '#475569' }
  return <span style={{ background: s.bg, color: s.text, borderRadius: 5, fontSize: 9, fontWeight: 700, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{party}</span>
}

const KpiCard = ({ label, value, count, sub, party, borderColor, alert, valueColor, big }) => (
  <div style={{
    background: alert ? '#fff8f8' : '#fff',
    border: `1px solid ${C.border}`,
    borderLeft: `4px solid ${borderColor || C.primary}`,
    borderRadius: 12, padding: big ? '16px 18px' : '14px 16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.3 }}>{label}</div>
      <PartyTag party={party} />
    </div>
    <div style={{ fontSize: big ? 26 : 22, fontWeight: 800, color: valueColor || (alert ? C.red : C.textB), letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {count != null && <div style={{ fontSize: 11.5, color: C.textSm, marginTop: 2, fontWeight: 600 }}>{count} invoice{Number(count) === 1 ? '' : 's'}</div>}
    {sub && <div style={{ fontSize: 10.5, color: alert ? '#f87171' : C.textMut, marginTop: 2 }}>{sub}</div>}
  </div>
)

const SectionHeader = ({ title, hint }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '22px 2px 12px' }}>
    <span style={{ fontSize: 13, fontWeight: 800, color: C.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
    {hint && <span style={{ fontSize: 11.5, color: C.textMut }}>{hint}</span>}
  </div>
)

/* ── Sticky global date-range filter ── */
function DateRangeBar({ preset, custom, applyPreset, applyCustom }) {
  const inputStyle = (active) => ({
    padding: '6px 9px', borderRadius: 7, fontSize: 12, height: 30, boxSizing: 'border-box',
    border: `1px solid ${active ? C.primary : C.border}`, fontFamily: 'inherit', color: C.text, background: '#fff',
  })
  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      padding: '10px 14px', marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: 4 }}>Date Range</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map(p => {
          const on = preset === p.key
          return (
            <button key={p.key} onClick={() => applyPreset(p.key)} style={{
              padding: '6px 12px', height: 30, boxSizing: 'border-box', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${on ? C.primary : C.border}`,
              background: on ? C.primary : '#fff', color: on ? '#fff' : C.textSm,
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>{p.label}</button>
          )
        })}
      </div>
      <div style={{ width: 1, height: 22, background: C.border, margin: '0 2px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="date" value={custom.start} max={custom.end || undefined}
          onChange={e => applyCustom(e.target.value, custom.end || e.target.value)}
          style={inputStyle(preset === 'custom')} />
        <span style={{ fontSize: 12, color: C.textMut }}>→</span>
        <input type="date" value={custom.end} min={custom.start || undefined}
          onChange={e => applyCustom(custom.start || e.target.value, e.target.value)}
          style={inputStyle(preset === 'custom')} />
        {preset === 'custom' && (
          <button onClick={() => applyPreset('all')} title="Clear custom range" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, height: 30, boxSizing: 'border-box',
            padding: '0 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff',
            color: C.red, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>✕ Clear</button>
        )}
      </div>
    </div>
  )
}

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
    <Modal onClose={onClose} title="Enter Check Manually" subtitle={item.invoice_number ? `Invoice ${item.invoice_number} — unreadable scan` : `Cheque ${item.check_number || '(no #)'} — no matched invoice`} width={480}>
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
  const { preset, custom, range, grain, applyPreset, applyCustom } = useDateRange('all')

  const [metrics, setMetrics] = useState(null)
  const [volume, setVolume]   = useState([])
  const [profit, setProfit]   = useState([])
  const [overdue, setOverdue] = useState([])
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [alerts, setAlerts]     = useState([])
  const [matchModal, setMatchModal] = useState(null)
  const [chequeModal, setChequeModal] = useState(null)

  // All metrics + charts re-fetch whenever the shared date range changes,
  // so nothing can drift out of sync.
  useEffect(() => {
    let cancelled = false
    setMetricsLoading(true)
    Promise.all([
      supabase.rpc('dashboard_metrics',      { p_start: range.start, p_end: range.end }),
      supabase.rpc('dashboard_volume',       { p_start: range.start, p_end: range.end, p_grain: grain }),
      supabase.rpc('dashboard_profit_trend', { p_start: range.start, p_end: range.end, p_grain: grain }),
      fetchOverdueBuckets(range.start, range.end),
    ]).then(([mRes, vRes, pRes, buckets]) => {
      if (cancelled) return
      if (mRes.error) console.error('dashboard_metrics:', mRes.error)
      if (vRes.error) console.error('dashboard_volume:', vRes.error)
      if (pRes.error) console.error('dashboard_profit_trend:', pRes.error)
      setMetrics(mRes.data || null)
      setVolume(vRes.data || [])
      setProfit(pRes.data || [])
      setOverdue(buckets)
      setMetricsLoading(false)
    })
    return () => { cancelled = true }
  }, [range.start, range.end, grain])

  useEffect(() => { fetchAlerts() }, [])

  // Overdue aging buckets — computed live from invoices still out with Ryder.
  const fetchOverdueBuckets = async (start, end) => {
    const { data } = await supabase
      .from('invoices')
      .select('advance_amount, ryder_submitted_at, status, invoice_date')
      .in('status', ['Submitted to Ryder', 'Acknowledged', 'Resubmitted'])
      .not('ryder_submitted_at', 'is', null)
      .gte('invoice_date', start)
      .lte('invoice_date', end)
    const now = Date.now()
    const acc = { '0-30': 0, '31-60': 0, '60+': 0 }
    for (const r of data || []) {
      const days = Math.floor((now - new Date(r.ryder_submitted_at)) / 86400000)
      const b = days <= 30 ? '0-30' : days <= 60 ? '31-60' : '60+'
      acc[b] += Number(r.advance_amount || 0)
    }
    return [
      { bucket: '0-30',  label: '0–30 days',  value: acc['0-30'] },
      { bucket: '31-60', label: '31–60 days', value: acc['31-60'] },
      { bucket: '60+',   label: '60+ days',   value: acc['60+'] },
    ]
  }

  const fetchAlerts = async () => {
    const { data } = await supabase
      .from('needs_attention')
      .select(`
        id, type, title, detail, action_label,
        ryder_conf_number, ryder_amount, check_number, resolved, cheque_id,
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

  const m = metrics || {}
  const ratePct = Math.round((Number(m.factoring_rate) || 0.03) * 100)
  const loadingTile = '…'

  return (
    <div>
      {/* Global sticky date-range filter — controls every tile + chart */}
      <DateRangeBar preset={preset} custom={custom} applyPreset={applyPreset} applyCustom={applyCustom} />

      {/* ── Section 1: Pipeline Status ──
          The 6 STAGE tiles are mutually exclusive & exhaustive — each invoice
          is in exactly one. They sum to Total. The rollup strip below
          (Overdue / Open / Closed) OVERLAPS the stages and must NOT be added. */}
      <SectionHeader title="Pipeline Status — Stages"
        hint="each invoice is in exactly one stage — RZR = customer we advance · Ryder = debtor who pays" />
      <Grid cols={6} tabletCols={3} mobileCols={2} gap={11}>
        <KpiCard label="1 · Pending — RZR Uploaded" party="RZR" borderColor="#0369a1"
          value={metricsLoading ? loadingTile : num(m.pending_count)} sub={metricsLoading ? 'not yet submitted' : `${fmt(m.pending_value)} · not yet submitted`} />
        <KpiCard label="2 · Awaiting Confirmation" party="RZR" borderColor="#b45309"
          value={metricsLoading ? loadingTile : num(m.awaiting_conf_count)} sub={metricsLoading ? 'RZR must confirm' : `${fmt(m.awaiting_conf_value)} · RZR must confirm`} />
        <KpiCard label="3 · Open Payment — Owed RZR" party="RZR" borderColor="#7c3aed"
          value={metricsLoading ? loadingTile : num(m.open_payment_count)} sub={metricsLoading ? 'awaiting wire to RZR' : `${fmt(m.open_payment_value)} · awaiting wire`} />
        <KpiCard label="4 · Advance Paid — Awaiting Ryder" party="RZR" borderColor="#0e7490"
          value={metricsLoading ? loadingTile : num(m.advance_paid_count)} sub={metricsLoading ? 'wired to RZR' : `${fmt(m.advance_paid_value)} · wired, not sent to Ryder`} />
        <KpiCard label="5 · Pending with Ryder" party="Ryder" borderColor="#b45309"
          value={metricsLoading ? loadingTile : num(m.pending_ryder_count)} sub={metricsLoading ? 'awaiting Ryder' : `${fmt(m.pending_ryder_value)} · submitted, awaiting Ryder`} />
        <KpiCard label="6 · Collected from Ryder" party="Ryder" borderColor="#059669"
          value={metricsLoading ? loadingTile : num(m.collected_ryder_count)} sub={metricsLoading ? 'cycle closed' : `${fmt(m.collected_ryder_value)} · received back`} />
      </Grid>

      {/* Rollups & alerts — these OVERLAP the stages above (subsets / sums),
          so they are deliberately separated and NOT meant to be added. */}
      <SectionHeader title="Rollups & Alerts" hint="summary views of the stages above — these OVERLAP, do not add them" />
      <Grid cols={4} tabletCols={2} mobileCols={2} gap={11}>
        <KpiCard label="Total Invoices (incl. closed)" party="RZR" borderColor={C.primary} big
          value={metricsLoading ? loadingTile : num(m.total_invoices_count)} sub={metricsLoading ? 'open + closed' : `${fmt(m.total_invoices_value)} · all stages`} />
        <KpiCard label="Open / In-Pipeline" party="RZR" borderColor={C.primary}
          value={metricsLoading ? loadingTile : num(m.active_invoice_count)} sub="stages 1–5 — live exposure" />
        <KpiCard label="Closed (Paid)" party="Ryder" borderColor="#059669"
          value={metricsLoading ? loadingTile : num(m.closed_count)} sub="stage 6 — cycle complete" />
        <KpiCard label="Overdue 60+ — with Ryder" party="Ryder" borderColor={C.red} alert valueColor={C.red}
          value={metricsLoading ? loadingTile : num(m.overdue_60_count)} sub={metricsLoading ? 'subset of stage 5' : `${fmt(m.overdue_60_value)} · subset of stage 5`} />
      </Grid>

      {/* ── Section 2: Financial Summary ── */}
      <SectionHeader title="Financial Summary" hint={`all $ figures respect the date range · margin = ${ratePct}%`} />
      <Grid cols={5} tabletCols={3} mobileCols={2} gap={11}>
        <KpiCard label="Total Face Value" party="RZR" borderColor={C.primary} big
          value={metricsLoading ? loadingTile : fmt(m.total_face_value)} sub="gross invoice value" />
        <KpiCard label="Total Advanced to RZR" party="RZR" borderColor="#0369a1" big
          value={metricsLoading ? loadingTile : fmt(m.total_advance_value)} sub={metricsLoading ? '' : `${num(m.total_advance_count)} invoices wired`} />
        <KpiCard label="Discount Revenue" party="Lavisa" borderColor="#059669" big
          value={metricsLoading ? loadingTile : fmt(m.discount_revenue)} sub={`${ratePct}% factoring fees`} />
        <KpiCard label="Total Profit" party="Lavisa" borderColor="#047857" big
          value={metricsLoading ? loadingTile : fmt(m.total_profit)} sub={`${ratePct}% × closed (Ryder-paid)`} />
        <KpiCard label="Collected from Ryder" party="Ryder" borderColor="#7c3aed" big
          value={metricsLoading ? loadingTile : fmt(m.collected_ryder_value)} sub="returned to Lavisa" />
      </Grid>

      {/* ── Section 3: Charts ── */}
      <SectionHeader title="Charts" hint="all series pull live from the selected range" />
      {metricsLoading ? (
        <Card><div style={{ padding: 40, textAlign: 'center', color: C.textMut, fontSize: 13 }}>Loading charts…</div></Card>
      ) : (
        <Grid cols={2} tabletCols={1} mobileCols={1} gap={14}>
          <VolumeChart data={volume} />
          <PipelineChart metrics={m} />
          <ProfitTrendChart data={profit} rate={Number(m.factoring_rate) || 0.03} />
          <OverdueAgingChart buckets={overdue} />
        </Grid>
      )}

      {/* ── Section 4: Operational Metrics ── */}
      <SectionHeader title="Operational Metrics" hint="cycle timing — spot slow stages and slow payers" />
      <Grid cols={3} tabletCols={3} mobileCols={1} gap={11} style={{ marginBottom: 26 }}>
        <KpiCard label="Avg Days to Advance" party="RZR" borderColor="#0369a1"
          value={metricsLoading ? loadingTile : days(m.avg_days_to_advance)} sub="RZR upload → advance paid" />
        <KpiCard label="Avg Days to Ryder Payment" party="Ryder" borderColor="#7c3aed"
          value={metricsLoading ? loadingTile : days(m.avg_days_to_ryder_payment)} sub="submitted to Ryder → collected" />
        <KpiCard label="Open / In-Pipeline Count" party="RZR" borderColor={C.primary}
          value={metricsLoading ? loadingTile : num(m.active_invoice_count)} sub="not yet closed — matches Open tile above" />
      </Grid>

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
