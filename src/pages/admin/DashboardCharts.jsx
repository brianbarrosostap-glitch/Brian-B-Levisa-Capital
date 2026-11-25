import React from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { C, shadow } from '../../tokens'

const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const monthLabel = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// Compact axis money: $100,000 → $100k, $1,250,000 → $1.3M (tooltips keep full values).
const moneyAxis = n => {
  const v = Number(n || 0)
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1) + 'M'
  if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'k'
  return '$' + v
}

// Shared chart styling — quiet axes, light grid, readable labels.
const GRID_STROKE = '#edf1f5'
const tick = { fontSize: 12.5, fill: C.textMut }
const axis = { tick, axisLine: false, tickLine: false, tickMargin: 8 }
const tooltipProps = {
  cursor: { fill: 'rgba(0,121,83,0.05)' },
  contentStyle: {
    borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 6px 20px rgba(16,24,40,0.10)',
    padding: '8px 12px', fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif',
  },
  labelStyle: { fontWeight: 700, color: C.text, marginBottom: 4 },
  itemStyle: { padding: '1px 0', fontVariantNumeric: 'tabular-nums' },
}
const legendProps = {
  iconType: 'circle', iconSize: 8,
  wrapperStyle: { fontSize: 13, paddingTop: 10 },
  formatter: (value) => <span style={{ color: C.textSm, fontWeight: 500, marginLeft: 2 }}>{value}</span>,
}

const ChartCard = ({ title, subtitle, children }) => (
  <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px 14px', boxShadow: shadow, minWidth: 0 }}>
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.textB, letterSpacing: '-0.01em' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: C.textMut, marginTop: 3 }}>{subtitle}</div>}
    </div>
    {children}
  </div>
)

const Empty = () => (
  <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: C.textMut }}>
    No data in the selected range.
  </div>
)

/* ── 1. Invoice Volume Over Time (RZR uploads) ── */
export function VolumeChart({ data }) {
  const rows = (data || []).map(d => ({ ...d, label: monthLabel(d.period) }))
  return (
    <ChartCard title="Invoice Volume Over Time" subtitle="RZR invoices uploaded — count & face value per period">
      {rows.length === 0 ? <Empty /> : (
        <ResponsiveContainer width="100%" height={268}>
          <BarChart data={rows} margin={{ top: 6, right: 4, left: -6, bottom: 0 }} barGap={4} barCategoryGap="22%">
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis yAxisId="left" {...axis} width={40} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={moneyAxis} {...axis} width={52} />
            <Tooltip {...tooltipProps} formatter={(v, name) => name === 'Face Value (RZR)' ? money(v) : v} />
            <Legend {...legendProps} />
            <Bar yAxisId="left"  dataKey="invoice_count" name="Invoice Count" fill={C.primary} radius={[4, 4, 0, 0]} maxBarSize={44} />
            <Bar yAxisId="right" dataKey="invoice_value" name="Face Value (RZR)" fill="#93c5fd" radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

/* ── 2. Pipeline Breakdown (where the money sits) ── */
const PIPE_COLORS = ['#0369a1', '#b45309', '#7c3aed', '#0e7490', '#059669']
export function PipelineChart({ metrics }) {
  const m = metrics || {}
  const data = [
    { name: 'Pending (RZR uploaded)',     value: Number(m.pending_value || 0) },
    { name: 'Awaiting Confirmation (RZR)', value: Number(m.awaiting_conf_value || 0) },
    { name: 'Open Payment (owed RZR)',    value: Number(m.open_payment_value || 0) },
    { name: 'Pending with Ryder',         value: Number(m.pending_ryder_value || 0) },
    { name: 'Collected from Ryder',       value: Number(m.collected_ryder_value || 0) },
  ].filter(d => d.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <ChartCard title="Pipeline Breakdown" subtitle="Where money currently sits, by $ value">
      {total === 0 ? <Empty /> : (
        <ResponsiveContainer width="100%" height={268}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={PIPE_COLORS[i % PIPE_COLORS.length]} />)}
            </Pie>
            <Tooltip {...tooltipProps} formatter={money} />
            <Legend {...legendProps} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

/* ── 3. Profit Trend (Lavisa earnings on closed cycles) ── */
export function ProfitTrendChart({ data, rate }) {
  const rows = (data || []).map(d => ({ ...d, label: monthLabel(d.period), profit: Number(d.profit || 0) }))
  return (
    <ChartCard title="Profit Trend" subtitle={`Lavisa earnings (${Math.round((rate || 0.03) * 100)}% margin) on Ryder-paid invoices`}>
      {rows.length === 0 ? <Empty /> : (
        <ResponsiveContainer width="100%" height={268}>
          <LineChart data={rows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis tickFormatter={money} {...axis} />
            <Tooltip {...tooltipProps} formatter={(v) => money(v)} />
            <Line type="monotone" dataKey="profit" name="Profit (Lavisa)" stroke={C.primary} strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

/* ── 4. Overdue Aging Buckets (Ryder slow payers) ── */
export function OverdueAgingChart({ buckets }) {
  const data = buckets || []
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <ChartCard title="Overdue Aging — with Ryder" subtitle="Outstanding advance $ by days since submitted to Ryder">
      {total === 0 ? <Empty /> : (
        <ResponsiveContainer width="100%" height={268}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis tickFormatter={money} {...axis} />
            <Tooltip {...tooltipProps} formatter={money} />
            <Bar dataKey="value" name="Outstanding (Ryder)" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.bucket === '60+' ? C.red : d.bucket === '31-60' ? '#b45309' : '#0369a1'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
