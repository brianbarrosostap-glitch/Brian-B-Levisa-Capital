import React, { useState, useEffect } from 'react'
import { AlertTriangle, AlertCircle, X, ArrowRight } from 'lucide-react'
import { C, R, shadow, FONT_MONO } from '../../tokens'
import { Card, Grid, PartyTag, useIsMobile, useViewportWidth } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useDateRange, PRESETS } from '../../hooks/useDateRange'
import { VolumeChart } from './DashboardCharts'
import AuditTodos from './AuditTodos'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = n => Number(n || 0).toLocaleString('en-US')
// Whole days only — no decimals (round to nearest, min 0).
const days = n => (n == null ? '—' : `${Math.max(0, Math.round(Number(n)))} ${Math.round(Number(n)) === 1 ? 'day' : 'days'}`)

// `amount` renders a BOLD $ line under the value (used by pipeline stages).
// `sub` is the small muted caption — pinned to the card bottom so every
// card in a row lines up regardless of content.
// `onClick` makes the tile open Master filtered to the invoices it counts.
const KpiCard = ({ label, value, count, amount, sub, party, borderColor, alert, valueColor, big, onClick }) => (
  <div className={onClick ? 'lc-card lc-tile' : 'lc-card'}
    {...(onClick ? {
      role: 'button', tabIndex: 0, onClick, title: 'Open these invoices in Master',
      onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } },
    } : {})}
    style={{
    height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    background: alert ? '#fff8f8' : '#fff',
    border: `1px solid ${alert ? '#f8d4d4' : C.border}`,
    borderLeft: `3px solid ${borderColor || C.primary}`,
    borderRadius: R.lg, padding: big ? '18px 20px' : '16px 18px',
    boxShadow: shadow,
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: big ? 12 : 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: alert ? C.red : C.textLbl, textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.35 }}>{label}</div>
      <PartyTag party={party} />
    </div>
    <div style={{
      // Big figures scale down on narrow screens so $368,085.46 never clips.
      fontSize: big ? 'clamp(23px, 1.6vw, 31px)' : 26.5, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.025em',
      color: valueColor || (alert ? C.red : C.textB), fontVariantNumeric: 'tabular-nums',
    }}>{value}</div>
    {amount != null && <div style={{ fontSize: 16.5, fontWeight: 700, color: alert ? C.red : C.text, marginTop: 6, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{amount}</div>}
    {count != null && <div style={{ fontSize: 12.5, color: C.textSm, marginTop: 3, fontWeight: 600 }}>{count} invoice{Number(count) === 1 ? '' : 's'}</div>}
    {(sub || onClick) && (
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
        <span style={{ fontSize: 12.5, lineHeight: 1.4, color: alert ? '#e35d5d' : C.textMut }}>{sub}</span>
        {onClick && <ArrowRight className="lc-tile-go" size={14} color={alert ? C.red : C.primary} style={{ flexShrink: 0, marginBottom: 1 }} />}
      </div>
    )}
  </div>
)

const SectionHeader = ({ title, hint }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 10px', margin: '28px 2px 12px' }}>
    <span style={{ fontSize: 14, fontWeight: 700, color: C.textB, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</span>
    {hint && <span style={{ fontSize: 13, color: C.textMut }}>{hint}</span>}
  </div>
)

/* ── Global date-range filter (responsive) ── */
function DateRangeBar({ preset, custom, applyPreset, applyCustom }) {
  const w = useViewportWidth()
  const isMobile = w < 760
  // Below ~1200px (laptops/tablets) one row can't fit all controls without
  // squashing the presets — stack them instead.
  const stacked = w < 1440
  const isCustom = preset === 'custom'

  const label = (text) => (
    <span style={{ fontSize: 11.5, fontWeight: 600, color: C.textLbl, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>{text}</span>
  )

  const dateInput = (value, onChange, extra) => (
    <input type="date" className="lc-date" value={value} onChange={onChange} {...extra} style={{
      height: 34, padding: '0 10px', boxSizing: 'border-box', minWidth: 0,
      borderRadius: R.md, fontSize: 14.5, fontFamily: 'inherit', color: value ? C.text : C.textSm, background: '#fff',
      border: `1px solid ${isCustom ? C.primary : C.border}`, fontVariantNumeric: 'tabular-nums',
      flex: isMobile ? 1 : '0 0 140px',
    }} />
  )

  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: R.lg,
      boxShadow: shadow, marginBottom: 4,
      padding: stacked ? 12 : '10px 14px 10px 18px',
      // Desktop: card spans 70% of the row so the segments stay compact.
      width: isMobile ? 'auto' : stacked ? 'min(100%, 760px)' : '70%',
      minWidth: stacked ? 0 : 'min(100%, 1120px)', boxSizing: 'border-box',
      display: 'flex', flexDirection: stacked ? 'column' : 'row',
      alignItems: stacked ? 'stretch' : 'center', gap: stacked ? 10 : 14,
    }}>
      {label('Date Range')}

      {/* Segmented control — equal-width segments that fill the row */}
      <div style={{
        flex: 1, minWidth: 0, padding: 3, borderRadius: 10, background: '#f1f5f9', border: `1px solid ${C.borderLt}`,
        display: 'grid', gap: 2,
        gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : `repeat(${PRESETS.length}, 1fr)`,
      }}>
        {PRESETS.map(p => {
          const on = preset === p.key
          return (
            <button key={p.key} type="button" onClick={() => applyPreset(p.key)}
              className={`lc-seg lc-focus${on ? ' is-on' : ''}`} aria-pressed={on} style={{
              height: 30, padding: '0 8px', border: 'none', borderRadius: 7, cursor: 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
              background: on ? C.primary : 'transparent', color: on ? '#fff' : C.textSm,
              boxShadow: on ? '0 1px 2px rgba(0,87,65,0.30), inset 0 1px 0 rgba(255,255,255,0.12)' : 'none',
            }}>{p.label}</button>
          )
        })}
      </div>

      {!stacked && <div style={{ width: 1, height: 24, background: C.border }} />}

      {/* Custom range — inline: CUSTOM [from] → [to] ✕ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {label('Custom')}
        {dateInput(custom.start, e => applyCustom(e.target.value, custom.end || e.target.value), { max: custom.end || undefined, 'aria-label': 'From date' })}
        <span style={{ fontSize: 14.5, color: C.textMut, flexShrink: 0 }}>→</span>
        {dateInput(custom.end, e => applyCustom(custom.start || e.target.value, e.target.value), { min: custom.start || undefined, 'aria-label': 'To date' })}
        {isCustom && (
          <button type="button" onClick={() => applyPreset('all')} title="Clear custom range" aria-label="Clear custom range"
            className="lc-icon-btn lc-focus" style={{
            width: 32, height: 32, flexShrink: 0, borderRadius: R.md, border: `1px solid ${C.border}`, background: '#fff',
            color: C.red, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><X size={14} strokeWidth={2.4} /></button>
        )}
      </div>
    </div>
  )
}

const fmtDue = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const daysPast = d => (d ? Math.max(0, Math.floor((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 86400000)) : null)

export default function Dashboard({ onOpenMaster }) {
  const isMobile = useIsMobile()
  // Chart + metrics side by side only when there's room for a readable chart.
  const stackCharts = useViewportWidth() < 1200
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
      // Structured copy of the same facts, for the scannable row layout.
      invoice_number: i.invoice_number,
      unit_number: i.unit_number,
      due_date: i.due_date,
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
  // Tile → Master with the matching status (or status group from Master's STATUS_GROUPS).
  const go = (status = '') => (onOpenMaster ? () => onOpenMaster({ tab: 'active', search: '', status }) : undefined)

  return (
    <div>
      {/* Audit checklist — not date-filtered, so nothing unverified hides */}
      <AuditTodos onOpenMaster={onOpenMaster} />

      {/* Global sticky date-range filter — controls every tile + chart */}
      <DateRangeBar preset={preset} custom={custom}
        applyPreset={applyPreset} applyCustom={applyCustom} />

      {/* ── RZR side — the customer journey (upload → we pay them 97%) ── */}
      <SectionHeader title="RZR — Customer Side" hint="invoices RZR uploads, through to us paying their 97% advance" />
      <Grid cols={5} tabletCols={3} mobileCols={2} gap={14}>
        <KpiCard label="Total RZR Uploaded" party="RZR" borderColor={C.primary} onClick={go('')}
          value={metricsLoading ? loadingTile : num(m.total_invoices_count)} amount={metricsLoading ? null : fmt(m.total_invoices_value)} sub="all invoices" />
        <KpiCard label="Pending — Not Yet Requested" party="RZR" borderColor="#0369a1" onClick={go('Not yet requested')}
          value={metricsLoading ? loadingTile : num(m.pending_count)} amount={metricsLoading ? null : fmt(m.pending_value)} sub="uploaded, no advance asked" />
        <KpiCard label="RZR Requested / Email Sent" party="RZR" borderColor="#7c3aed" onClick={go('Requested — awaiting RZR')}
          value={metricsLoading ? loadingTile : num(m.open_payment_count)} amount={metricsLoading ? null : fmt(m.open_payment_value)} sub="confirmation email sent — awaiting RZR reply" />
        <KpiCard label="RZR Agreed to 97%" party="RZR" borderColor="#b45309" onClick={go('Advance Agreed')}
          value={metricsLoading ? loadingTile : num(m.awaiting_conf_count)} amount={metricsLoading ? null : fmt(m.awaiting_conf_value)} sub="RZR approved — not yet paid" />
        <KpiCard label="Advance Paid to RZR" party="RZR" borderColor="#0e7490" onClick={go('Advance Paid')}
          value={metricsLoading ? loadingTile : num(m.advance_paid_count)} amount={metricsLoading ? null : fmt(m.advance_paid_value)} sub="97% wired to RZR" />
      </Grid>

      {/* ── Ryder side — the debtor journey (we send → they pay us) ── */}
      <SectionHeader title="Ryder — Debtor Side" hint="invoice sent to Ryder, through to Ryder paying us back" />
      <Grid cols={4} tabletCols={2} mobileCols={1} gap={14}>
        <KpiCard label="Submitted to Ryder" party="Ryder" borderColor="#b45309" onClick={go('With Ryder — not acknowledged')}
          value={metricsLoading ? loadingTile : num(m.pending_ryder_count)} amount={metricsLoading ? null : fmt(m.pending_ryder_value)} sub="sent — no acknowledgement yet" />
        <KpiCard label="Acknowledged — Awaiting Cheque" party="Ryder" borderColor="#7c3aed" onClick={go('Acknowledged — awaiting cheque')}
          value={metricsLoading ? loadingTile : num(m.acknowledged_unpaid_count)} amount={metricsLoading ? null : fmt(m.acknowledged_unpaid_value)} sub="Ryder confirmed receipt, cheque not received" />
        <KpiCard label="Overdue with Ryder" party="Ryder" borderColor={C.red} alert valueColor={C.red} onClick={go('Overdue with Ryder')}
          value={metricsLoading ? loadingTile : num(m.overdue_60_count)} amount={metricsLoading ? null : fmt(m.overdue_60_value)} sub="acknowledged, due date passed — follow up" />
        <KpiCard label="Ryder Paid to Us" party="Ryder" borderColor="#059669" onClick={go('Paid')}
          value={metricsLoading ? loadingTile : num(m.collected_ryder_count)} amount={metricsLoading ? null : fmt(m.collected_ryder_value)} sub="cheque received — cycle complete" />
      </Grid>

      {/* ── Section 2: Financial Summary ── */}
      <SectionHeader title="Financial Summary" hint={`all $ figures respect the date range · margin = ${ratePct}%`} />
      <Grid cols={3} tabletCols={3} mobileCols={1} gap={14}>
        <KpiCard label="Total Advanced to RZR" party="RZR" borderColor="#0369a1" big onClick={go('Advanced to RZR')}
          value={metricsLoading ? loadingTile : fmt(m.total_advance_value)} sub={metricsLoading ? '' : `${num(m.total_advance_count)} invoices wired`} />
        <KpiCard label="Discount Revenue" party="Lavisa" borderColor="#059669" big onClick={go('Paid')}
          value={metricsLoading ? loadingTile : fmt(m.discount_revenue)} sub={`${ratePct}% factoring fees`} />
        <KpiCard label="Total Profit" party="Lavisa" borderColor="#047857" big onClick={go('Paid')}
          value={metricsLoading ? loadingTile : fmt(m.total_profit)} sub={`${ratePct}% × closed (Ryder-paid)`} />
      </Grid>

      {/* ── Section 3: Volume chart (left) + Operational Metrics stacked (right) ── */}
      <SectionHeader title="Charts & Operational Metrics" hint="invoice volume · cycle timing — spot slow stages and slow payers" />
      <div style={{
        display: 'grid', gridTemplateColumns: stackCharts ? 'minmax(0, 1fr)' : 'minmax(0, 2fr) minmax(260px, 1fr)',
        gap: 14, marginBottom: 28, alignItems: 'stretch',
      }}>
        {metricsLoading ? (
          <Card><div style={{ padding: 40, textAlign: 'center', color: C.textMut, fontSize: 14.5 }}>Loading charts…</div></Card>
        ) : (
          <VolumeChart data={volume} />
        )}
        <div style={stackCharts && !isMobile
          ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }
          : { display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            <KpiCard key="adv" label="Avg Days to Advance" party="RZR" borderColor="#0369a1"
              value={metricsLoading ? loadingTile : days(m.avg_days_to_advance)} sub="RZR upload → advance paid" />,
            <KpiCard key="ryd" label="Avg Days to Ryder Payment" party="Ryder" borderColor="#7c3aed"
              value={metricsLoading ? loadingTile : days(m.avg_days_to_ryder_payment)} sub="submitted to Ryder → collected" />,
            <KpiCard key="open" label="Open / In-Pipeline Count" party="RZR" borderColor={C.primary} onClick={go('Open — not yet paid')}
              value={metricsLoading ? loadingTile : num(m.active_invoice_count)} sub="not yet closed — matches Open tile above" />,
          ].map(card => <div key={card.key} style={{ flex: 1, display: 'grid' }}>{card}</div>)}
        </div>
      </div>

      {/* Needs Attention — ONLY overdue-with-Ryder invoices (due payments). */}
      {(() => { const allAlerts = overdueAlerts; return (
      <Card noPad>
        <div style={{
          padding: isMobile ? '14px 16px' : '16px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.textB, letterSpacing: '-0.01em' }}>Needs Attention</span>
            {allAlerts.length > 0 && (
              <span style={{
                background: C.redLt, color: C.red, borderRadius: 9999, fontSize: 12, fontWeight: 700,
                minWidth: 22, height: 20, padding: '0 7px', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {allAlerts.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: 13, color: C.textMut }}>Overdue invoices with Ryder — due payment, follow up</span>
        </div>

        {allAlerts.length === 0 ? (
          <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 14.5, color: C.textMut }}>
            No overdue payments right now.
          </div>
        ) : (
          allAlerts.map((item, i) => {
            const isAmber = item.type === 'conf_match'
            const isOverdue = item.type === 'overdue'
            const late = isOverdue ? daysPast(item.due_date) : null
            return (
              <div key={item.id} className="lc-row-alert"
                {...(isOverdue && item.invoice_number && onOpenMaster ? {
                  role: 'button', tabIndex: 0, title: 'Open this invoice in Master',
                  onClick: () => onOpenMaster({ tab: 'active', search: item.invoice_number, status: '' }),
                  onKeyDown: e => { if (e.key === 'Enter') onOpenMaster({ tab: 'active', search: item.invoice_number, status: '' }) },
                } : {})}
                style={{ cursor: isOverdue && onOpenMaster ? 'pointer' : undefined,
                padding: isMobile ? '12px 16px' : '14px 20px',
                background: isAmber ? '#fffdf5' : '#fff9f9',
                borderBottom: i < allAlerts.length - 1 ? `1px solid ${C.borderLt}` : undefined,
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  background: isAmber ? '#fef9c3' : C.redLt,
                  boxShadow: `inset 0 0 0 1px ${isAmber ? '#fde68a' : '#fecaca'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isAmber
                    ? <AlertTriangle size={16} color="#b45309" />
                    : <AlertCircle size={16} color={C.red} strokeWidth={2.1} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: C.textB }}>{item.title}</div>
                  {isOverdue && item.invoice_number ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px', fontSize: 14, color: C.textSm, lineHeight: 1.45, marginTop: 3 }}>
                      <span>Invoice <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: C.text }}>{item.invoice_number}</span></span>
                      <span style={{ color: C.borderMd }}>•</span>
                      <span>Unit <span style={{ fontFamily: FONT_MONO, color: C.text }}>{item.unit_number || '—'}</span></span>
                      <span style={{ color: C.borderMd }}>•</span>
                      <span>Due <span style={{ fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtDue(item.due_date)}</span></span>
                      <span style={{ color: C.textMut }}>— Ryder hasn't paid. Follow up.</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, color: C.textSm, lineHeight: 1.45, marginTop: 3 }}>{item.detail}</div>
                  )}
                </div>
                {isOverdue && (
                  <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-end' : 'center', gap: isMobile ? 4 : 10, flexShrink: 0 }}>
                    {late != null && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.red, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {late} day{late === 1 ? '' : 's'} late
                      </span>
                    )}
                    <span style={{
                      fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', color: C.red, background: C.redLt,
                      border: '1px solid #fecaca', borderRadius: 9999, padding: '2px 9px', whiteSpace: 'nowrap',
                    }}>OVERDUE</span>
                  </div>
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
