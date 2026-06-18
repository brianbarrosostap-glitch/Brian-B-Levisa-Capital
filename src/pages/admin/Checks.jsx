import React, { useState, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import { C } from '../../tokens'
import { Card, SearchBar, FilterChip, Tabs, TH, TD } from '../../components/ui'
import { supabase } from '../../lib/supabase'

const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* Colors for the check_status enum (unmatched | matched | unreadable) */
const CHECK_STATUS = {
  matched:    { bg: '#e7f6ef', text: '#0f7a4f', label: 'Matched' },
  unmatched:  { bg: '#fff4e5', text: '#b45309', label: 'Unmatched' },
  unreadable: { bg: '#fdeaea', text: '#b42318', label: 'Unreadable' },
}

const CheckBadge = ({ status }) => {
  const s = CHECK_STATUS[status] || { bg: '#f1f5f9', text: '#475569', label: status }
  return (
    <span style={{
      display: 'inline-block', background: s.bg, color: s.text,
      borderRadius: 9999, fontSize: 11, fontWeight: 600, padding: '2px 9px',
    }}>{s.label}</span>
  )
}

const DriveLink = ({ url }) => (
  <a
    href={url || '#'}
    target={url ? '_blank' : undefined}
    rel="noreferrer"
    onClick={!url ? e => e.preventDefault() : undefined}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: '#eff6ff', border: `1px solid ${C.border}`,
      borderRadius: 6, color: url ? '#1e40af' : C.textMut, fontSize: 11,
      padding: '2px 7px', textDecoration: 'none',
      cursor: url ? 'pointer' : 'default', opacity: url ? 1 : 0.5,
    }}
  >
    <ExternalLink size={9} /> View
  </a>
)

export default function Checks() {
  const [checks, setChecks]   = useState([])
  const [search, setSearch]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tab, setTab]         = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchChecks() }, [])

  const fetchChecks = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('v_cheques')
      .select('*')
      .order('received_at', { ascending: false })
    if (error) console.error('Failed to load cheques:', error)
    if (data) setChecks(data)
    setLoading(false)
  }

  const byTab = tab === 'all'
    ? checks
    : checks.filter(c => c.status === tab)

  const list = byTab.filter(c => {
    const q = search.toLowerCase()
    const matchQ = !q
      || c.check_number?.toLowerCase().includes(q)
      || c.ryder_conf_number?.toLowerCase().includes(q)
      || c.invoice_numbers?.toLowerCase().includes(q)
    const matchS = !statusFilter || c.status === statusFilter
    return matchQ && matchS
  })

  const counts = {
    all:        checks.length,
    matched:    checks.filter(c => c.status === 'matched').length,
    unmatched:  checks.filter(c => c.status === 'unmatched').length,
    unreadable: checks.filter(c => c.status === 'unreadable').length,
  }

  return (
    <div>
      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search cheque #, conf #, invoice #…" value={search} onChange={setSearch} />
          <FilterChip label="Status" options={['matched', 'unmatched', 'unreadable']} value={statusFilter} onChange={setStatusFilter} />
        </div>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'all',        label: 'All',        count: counts.all },
            { key: 'matched',    label: 'Matched',    count: counts.matched },
            { key: 'unmatched',  label: 'Unmatched',  count: counts.unmatched },
            { key: 'unreadable', label: 'Unreadable', count: counts.unreadable },
          ]} />
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading cheques…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>
            No cheques yet. They appear here as the Drive automation ingests them.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                <TH>Received</TH>
                <TH>Cheque #</TH>
                <TH>Ryder Conf #</TH>
                <TH>Invoice(s) Paid</TH>
                <TH style={{ textAlign: 'right' }}>Amount</TH>
                <TH>Status</TH>
                <TH style={{ width: 70 }}>File</TH>
              </tr>
            </thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id}>
                  <TD muted>{c.received_at ? new Date(c.received_at).toLocaleDateString() : '—'}</TD>
                  <TD mono>{c.check_number || '—'}</TD>
                  <TD mono>{c.ryder_conf_number || '—'}</TD>
                  <TD mono>{c.invoice_numbers || <span style={{ color: C.textMut }}>unmatched</span>}</TD>
                  <TD style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.amount)}</TD>
                  <TD><CheckBadge status={c.status} /></TD>
                  <TD><DriveLink url={c.drive_file_url} /></TD>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  )
}
