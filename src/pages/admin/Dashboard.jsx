import React, { useState, useEffect } from 'react'
import { AlertTriangle, AlertCircle } from 'lucide-react'
import { C } from '../../tokens'
import { Card, Grid, useIsMobile } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useDateRange, PRESETS } from '../../hooks/useDateRange'
import { VolumeChart, PipelineChart } from './DashboardCharts'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = n => Number(n || 0).toLocaleString('en-US')
// Whole days only — no decimals (round to nearest, min 0).
const days = n => (n == null ? '—' : `${Math.max(0, Math.round(Number(n)))} ${Math.round(Number(n)) === 1 ? 'day' : 'days'}`)

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

// `amount` renders a BOLD $ line under the value (used by pipeline stages).
// `sub` is the small muted caption.
const KpiCard = ({ label, value, count, amount, sub, party, borderColor, alert, valueColor, big }) => (
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
    {amount != null && <div style={{ fontSize: 14, fontWeight: 800, color: alert ? C.red : C.text, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{amount}</div>}
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

/* ── Global date-range filter (responsive) ── */
function DateRangeBar({ preset, custom, applyPreset, applyCustom }) {
  const isMobile = useIsMobile()
  const inputStyle = (active) => ({
    padding: '8px 10px', borderRadius: 7, fontSize: 13, height: 36, boxSizing: 'border-box',
    border: `1px solid ${active ? C.primary : C.border}`, fontFamily: 'inherit', color: C.text, background: '#fff',
    flex: isMobile ? 1 : undefined, minWidth: 0,
  })
  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      padding: isMobile ? '12px' : '10px 14px', marginBottom: 16,
      display: 'flex', flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 10 : 8, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date Range</span>

      {/* Presets — wrap into a tidy grid on mobile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map(p => {
          const on = preset === p.key
          return (
            <button key={p.key} onClick={() => applyPreset(p.key)} style={{
              padding: isMobile ? '8px 12px' : '6px 12px', height: 36, boxSizing: 'border-box',
              borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${on ? C.primary : C.border}`,
              background: on ? C.primary : '#fff', color: on ? '#fff' : C.textSm,
              fontFamily: 'inherit', whiteSpace: 'nowrap',
              flex: isMobile ? '1 1 auto' : undefined,
            }}>{p.label}</button>
          )
        })}
      </div>

      {!isMobile && <div style={{ width: 1, height: 22, background: C.border, margin: '0 2px' }} />}

      {/* Custom range — labelled so the empty native date boxes are clear.
          (iOS date inputs don't render placeholder text, hence the labels.) */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, width: isMobile ? '100%' : undefined }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: isMobile ? 1 : undefined, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em' }}>From</span>
          <input type="date" value={custom.start} max={custom.end || undefined}
            onChange={e => applyCustom(e.target.value, custom.end || e.target.value)}
            style={inputStyle(preset === 'custom')} />
        </label>
        <span style={{ fontSize: 13, color: C.textMut, flexShrink: 0, paddingBottom: 8 }}>→</span>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: isMobile ? 1 : undefined, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em' }}>To</span>
          <input type="date" value={custom.end} min={custom.start || undefined}
            onChange={e => applyCustom(custom.start || e.target.value, e.target.value)}
            style={inputStyle(preset === 'custom')} />
        </label>
        {preset === 'custom' && (
          <button onClick={() => applyPreset('all')} title="Clear custom range" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 36, boxSizing: 'border-box',
            padding: '0 12px', borderRadius: 7, border: `1px solid ${C.border}`, background: '#fff',
            color: C.red, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap',
          }}>✕</button>
        )}
      </div>
    </div>
  )
}


export default function Dashboard() {
  const { preset, custom, range, grain, applyPreset, applyCustom } = useDateRange('all')

  const [metrics, setMetrics] = useState(null)
  const [volume, setVolume]   = useState([])
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [alerts, setAlerts]     = useState([])
  const [overdueAlerts, setOverdueAlerts] = useState([])

  // Metrics + charts re-fetch whenever the shared date range changes,
  // so nothing can drift out of sync.
  useEffect(() => {
    let cancelled = false
    setMetricsLoading(true)
    Promise.all([
      supabase.rpc('dashboard_metrics', { p_start: range.start, p_end: range.end }),
      supabase.rpc('dashboard_volume',  { p_start: range.start, p_end: range.end, p_grain: grain }),
    ]).then(([mRes, vRes]) => {
      if (cancelled) return
      if (mRes.error) console.error('dashboard_metrics:', mRes.error)
      if (vRes.error) console.error('dashboard_volume:', vRes.error)
      setMetrics(mRes.data || null)
      setVolume(vRes.data || [])
      setMetricsLoading(false)
    })
    return () => { cancelled = true }
  }, [range.start, range.end, grain])

  useEffect(() => { fetchAlerts() }, [])

  const fetchAlerts = async () => {
    // Primary query includes cheque_id (added in migration 20260617000005).
    // If that migration hasn't been run yet the column is missing and
    // PostgREST returns 400 — fall back to a query without it so the
    // dashboard still works instead of silently breaking.
    const FULL = `
        id, type, title, detail, action_label,
        ryder_conf_number, ryder_amount, check_number, resolved, cheque_id,
        invoice:invoices(id, invoice_number, unit_number, status)`
    const FALLBACK = `
        id, type, title, detail, action_label,
        ryder_conf_number, ryder_amount, check_number, resolved,
        invoice:invoices(id, invoice_number, unit_number, status)`

    let { data, error } = await supabase
      .from('needs_attention')
      .select(FULL)
      .eq('resolved', false)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('needs_attention (full) failed, retrying without cheque_id:', error)
      ;({ data, error } = await supabase
        .from('needs_attention')
        .select(FALLBACK)
        .eq('resolved', false)
        .order('created_at', { ascending: true }))
      if (error) { console.error('needs_attention fallback also failed:', error); return }
    }

    if (data) {
      setAlerts(data.map(a => ({
        ...a,
        invoice_id:     a.invoice?.id,
        invoice_number: a.invoice?.invoice_number,
        unit_number:    a.invoice?.unit_number,
      })))
    }

    // ── Overdue with Ryder — computed live, shown in Needs Attention so
    //    the admin can follow up. Acknowledged + due_date already passed. ──
    const today = new Date().toISOString().slice(0, 10)
    const { data: od } = await supabase
      .from('invoices')
      .select('id, invoice_number, unit_number, status, due_date, advance_amount')
      .eq('status', 'Acknowledged')
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .order('due_date', { ascending: true })
    setOverdueAlerts((od || []).map(i => ({
      id: `overdue-${i.id}`,
      type: 'overdue',
      title: 'Overdue with Ryder',
      detail: `Invoice ${i.invoice_number} (Unit ${i.unit_number || '—'}) — due ${i.due_date}, Ryder hasn't paid. Follow up.`,
      invoice_id: i.invoice_number,
      action_label: null,
    })))
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

      {/* ── RZR side — the customer journey (upload → we pay them 97%) ── */}
      <SectionHeader title="RZR — Customer Side" hint="invoices RZR uploads, through to us paying their 97% advance" />
      <Grid cols={5} tabletCols={3} mobileCols={2} gap={11}>
        <KpiCard label="Total RZR Uploaded" party="RZR" borderColor={C.primary}
          value={metricsLoading ? loadingTile : num(m.total_invoices_count)} amount={metricsLoading ? null : fmt(m.total_invoices_value)} sub="all invoices" />
        <KpiCard label="Pending — Not Yet Requested" party="RZR" borderColor="#0369a1"
          value={metricsLoading ? loadingTile : num(m.pending_count)} amount={metricsLoading ? null : fmt(m.pending_value)} sub="uploaded, no advance asked" />
        <KpiCard label="RZR Requested / Email Sent" party="RZR" borderColor="#7c3aed"
          value={metricsLoading ? loadingTile : num(m.open_payment_count)} amount={metricsLoading ? null : fmt(m.open_payment_value)} sub="confirmation email sent — awaiting RZR reply" />
        <KpiCard label="RZR Agreed to 97%" party="RZR" borderColor="#b45309"
          value={metricsLoading ? loadingTile : num(m.awaiting_conf_count)} amount={metricsLoading ? null : fmt(m.awaiting_conf_value)} sub="RZR approved — not yet paid" />
        <KpiCard label="Advance Paid to RZR" party="RZR" borderColor="#0e7490"
          value={metricsLoading ? loadingTile : num(m.advance_paid_count)} amount={metricsLoading ? null : fmt(m.advance_paid_value)} sub="97% wired to RZR" />
      </Grid>

      {/* ── Ryder side — the debtor journey (we send → they pay us) ── */}
      <SectionHeader title="Ryder — Debtor Side" hint="invoice sent to Ryder, through to Ryder paying us back" />
      <Grid cols={4} tabletCols={2} mobileCols={1} gap={11}>
        <KpiCard label="Submitted to Ryder" party="Ryder" borderColor="#b45309"
          value={metricsLoading ? loadingTile : num(m.pending_ryder_count)} amount={metricsLoading ? null : fmt(m.pending_ryder_value)} sub="sent — no acknowledgement yet" />
        <KpiCard label="Acknowledged — Awaiting Cheque" party="Ryder" borderColor="#7c3aed"
          value={metricsLoading ? loadingTile : num(m.acknowledged_unpaid_count)} amount={metricsLoading ? null : fmt(m.acknowledged_unpaid_value)} sub="Ryder confirmed receipt, cheque not received" />
        <KpiCard label="Overdue with Ryder" party="Ryder" borderColor={C.red} alert valueColor={C.red}
          value={metricsLoading ? loadingTile : num(m.overdue_60_count)} amount={metricsLoading ? null : fmt(m.overdue_60_value)} sub="acknowledged, due date passed — follow up" />
        <KpiCard label="Ryder Paid to Us" party="Ryder" borderColor="#059669"
          value={metricsLoading ? loadingTile : num(m.collected_ryder_count)} amount={metricsLoading ? null : fmt(m.collected_ryder_value)} sub="cheque received — cycle complete" />
      </Grid>

      {/* ── Section 2: Financial Summary ── */}
      <SectionHeader title="Financial Summary" hint={`all $ figures respect the date range · margin = ${ratePct}%`} />
      <Grid cols={3} tabletCols={3} mobileCols={1} gap={11}>
        <KpiCard label="Total Advanced to RZR" party="RZR" borderColor="#0369a1" big
          value={metricsLoading ? loadingTile : fmt(m.total_advance_value)} sub={metricsLoading ? '' : `${num(m.total_advance_count)} invoices wired`} />
        <KpiCard label="Discount Revenue" party="Lavisa" borderColor="#059669" big
          value={metricsLoading ? loadingTile : fmt(m.discount_revenue)} sub={`${ratePct}% factoring fees`} />
        <KpiCard label="Total Profit" party="Lavisa" borderColor="#047857" big
          value={metricsLoading ? loadingTile : fmt(m.total_profit)} sub={`${ratePct}% × closed (Ryder-paid)`} />
      </Grid>

      {/* ── Section 3: Charts ── */}
      <SectionHeader title="Charts" hint="all series pull live from the selected range" />
      {metricsLoading ? (
        <Card><div style={{ padding: 40, textAlign: 'center', color: C.textMut, fontSize: 13 }}>Loading charts…</div></Card>
      ) : (
        <Grid cols={2} tabletCols={1} mobileCols={1} gap={14}>
          <VolumeChart data={volume} />
          <PipelineChart metrics={m} />
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

      {/* Needs Attention — ONLY overdue-with-Ryder invoices (due payments). */}
      {(() => { const allAlerts = overdueAlerts; return (
      <Card noPad>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Needs Attention</span>
            {allAlerts.length > 0 && (
              <span style={{ background: '#fee2e2', color: C.red, borderRadius: 9999, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                {allAlerts.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: C.textMut }}>Overdue invoices with Ryder — due payment, follow up</span>
        </div>

        {allAlerts.length === 0 ? (
          <div style={{ padding: '24px 18px', textAlign: 'center', fontSize: 13, color: C.textMut }}>
            No overdue payments right now.
          </div>
        ) : (
          allAlerts.map((item, i) => {
            const isAmber = item.type === 'conf_match'
            const isOverdue = item.type === 'overdue'
            return (
              <div key={item.id} style={{
                padding: '14px 18px',
                background: isAmber ? '#fffdf5' : '#fff8f8',
                borderBottom: i < allAlerts.length - 1 ? `1px solid ${C.border}` : undefined,
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
                {isOverdue && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.red, background: C.redLt, borderRadius: 9999, padding: '3px 10px', whiteSpace: 'nowrap' }}>OVERDUE</span>
                )}
              </div>
            )
          })
        )}
      </Card>
      ) })()}
    </div>
  )
}
