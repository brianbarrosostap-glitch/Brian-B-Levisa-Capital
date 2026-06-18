import React, { useState, useEffect } from 'react'
import { C } from '../../tokens'
import { Card, Badge, SearchBar, TH, TD } from '../../components/ui'
import { supabase } from '../../lib/supabase'

const ACTION_COLOUR = {
  insert:        { bg: '#dcfce7', text: '#15803d' },
  update:        { bg: '#dbeafe', text: '#1e40af' },
  delete:        { bg: '#fee2e2', text: '#991b1b' },
  status_change: { bg: '#ede9fe', text: '#5b21b6' },
}

const ActionPill = ({ action }) => {
  const c = ACTION_COLOUR[action] || { bg: '#f1f5f9', text: '#475569' }
  return (
    <span style={{ background: c.bg, color: c.text, borderRadius: 9999, fontSize: 10.5, fontWeight: 600, padding: '2px 9px', whiteSpace: 'nowrap' }}>
      {action}
    </span>
  )
}

export default function AuditLogs() {
  const [logs, setLogs]       = useState([])
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchLogs() }, [])

  const fetchLogs = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('v_audit_logs')
      .select('*')
      .limit(300)
    if (error) console.error('Failed to load audit logs:', error)
    if (data) setLogs(data)
    setLoading(false)
  }

  const list = logs.filter(l => {
    const q = search.toLowerCase()
    return !q
      || l.summary?.toLowerCase().includes(q)
      || l.invoice_number?.toLowerCase().includes(q)
      || l.actor_name?.toLowerCase().includes(q)
      || l.table_name?.toLowerCase().includes(q)
      || l.source?.toLowerCase().includes(q)
  })

  return (
    <div>
      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search action, invoice #, actor, table…" value={search} onChange={setSearch} />
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading audit log…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>No audit entries.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Table</TH>
                  <TH>Invoice #</TH>
                  <TH>Status</TH>
                  <TH>Summary</TH>
                  <TH>Actor</TH>
                  <TH>Source</TH>
                </tr>
              </thead>
              <tbody>
                {list.map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <TD muted style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</TD>
                    <TD><ActionPill action={l.action} /></TD>
                    <TD muted>{l.table_name}</TD>
                    <TD mono>{l.invoice_number || '—'}</TD>
                    <TD>{l.new_status ? <Badge status={l.new_status} /> : <span style={{ color: C.textMut }}>—</span>}</TD>
                    <TD style={{ fontSize: 12.5, maxWidth: 320 }}>{l.summary}</TD>
                    <TD muted style={{ fontSize: 12 }}>{l.actor_name || 'System'}</TD>
                    <TD muted style={{ fontSize: 11.5 }}>{l.source || '—'}</TD>
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
