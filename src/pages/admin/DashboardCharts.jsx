import React from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { C } from '../../tokens'

const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const monthLabel = (d) => {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

const ChartCard = ({ title, subtitle, children }) => (
  <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: C.textMut, marginTop: 1 }}>{subtitle}</div>}
    </div>
    {children}
  </div>
)

const Empty = () => (
  <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, color: C.textMut }}>
    No data in the selected range.
  </div>
)

/* ── 1. Invoice Volume Over Time (RZR uploads) ── */
export function VolumeChart({ data }) {
  const rows = (data || []).map(d => ({ ...d, label: monthLabel(d.period) }))
  return (
    <ChartCard title="Invoice Volume Over Time" subtitle="RZR invoices uploaded — count & face value per period">
      {rows.length === 0 ? <Empty /> : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.textSm }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: C.textSm }} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={money} tick={{ fontSize: 11, fill: C.textSm }} />
            <Tooltip formatter={(v, name) => name === 'Face Value (RZR)' ? money(v) : v} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left"  dataKey="invoice_count" name="Invoice Count" fill={C.primary} radius={[3, 3, 0, 0]} />
            <Bar yAxisId="right" dataKey="invoice_value" name="Face Value (RZR)" fill="#93c5fd" radius={[3, 3, 0, 0]} />
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
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={PIPE_COLORS[i % PIPE_COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={money} />
            <Legend wrapperStyle={{ fontSize: 10.5 }} />
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
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={rows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.textSm }} />
            <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: C.textSm }} />
            <Tooltip formatter={(v) => money(v)} />
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
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.textSm }} />
            <YAxis tickFormatter={money} tick={{ fontSize: 11, fill: C.textSm }} />
            <Tooltip formatter={money} />
            <Bar dataKey="value" name="Outstanding (Ryder)" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.bucket === '60+' ? C.red : d.bucket === '31-60' ? '#b45309' : '#0369a1'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
