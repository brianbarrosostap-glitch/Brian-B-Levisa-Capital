import React, { useState, useEffect } from 'react'
import { Upload } from 'lucide-react'
import { C } from '../../tokens'
import { Card, Btn, SearchBar, TH, TD, useIsMobile } from '../../components/ui'
import FileLink from '../../components/FileLink'
import UploadDocumentModal from '../../components/UploadDocumentModal'
import { chequeFileRef } from '../../lib/files'
import { supabase } from '../../lib/supabase'
import { usePersistentState } from '../../hooks/usePersistentState'

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

export default function Checks() {
  const isMobile = useIsMobile()
  const [checks, setChecks]   = useState([])
  const [search, setSearch]   = usePersistentState('admin.cheques.search', '')
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => { fetchChecks() }, [])

  const fetchChecks = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('v_cheques')
      .select('*')
      .order('received_at', { ascending: false })
    if (error) console.error('Failed to load cheques:', error)
    if (data) {
      // v_cheques was created with c.* before cheques.storage_path existed,
      // so read the Storage path straight from the table and merge it in.
      // A failure here only means older (Drive) links are shown.
      const { data: paths, error: pErr } = await supabase
        .from('cheques').select('id, storage_path').not('storage_path', 'is', null)
      if (pErr) console.warn('cheques.storage_path not available:', pErr.message)
      const byId = Object.fromEntries((paths || []).map(p => [p.id, p.storage_path]))
      setChecks(data.map(c => ({ ...c, storage_path: c.storage_path || byId[c.id] || null })))
    }
    setLoading(false)
  }

  // Simple records list — no status tabs/filters. Unmatched cheques are
  // handled by an email alert to the admin (raised in ingest-check), so
  // this screen just shows the raw cheque records, searchable.
  const list = checks.filter(c => {
    const q = search.toLowerCase()
    return !q
      || c.check_number?.toLowerCase().includes(q)
      || c.ryder_conf_number?.toLowerCase().includes(q)
      || c.invoice_numbers?.toLowerCase().includes(q)
      || c.invoice_number?.toLowerCase().includes(q)
  })

  return (
    <div>
      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search cheque #, conf #, invoice #…" value={search} onChange={setSearch} />
          <div style={{ marginLeft: 'auto' }}>
            <Btn onClick={() => setUploadOpen(true)}><Upload size={13} /> Upload cheque</Btn>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading cheques…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>
            No cheques yet. Use “Upload cheque” to add one.
          </div>
        ) : isMobile ? (
          /* ── Mobile: stacked cards ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10 }}>
            {list.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: C.textMut }}>No records.</div>
            )}
            {list.map(c => (
              <div key={c.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{c.check_number || '—'}</span>
                  <CheckBadge status={c.status} />
                </div>
                {[
                  ['Received', c.received_at ? new Date(c.received_at).toLocaleDateString() : '—'],
                  ['Invoice #', (c.invoice_numbers || c.invoice_number) || 'unmatched'],
                  ['Ryder Conf #', c.ryder_conf_number || '—'],
                  ['Amount', fmt(c.amount)],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12.5 }}>
                    <span style={{ color: C.textMut, fontWeight: 600 }}>{k}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: C.text }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                  <FileLink fileRef={chequeFileRef(c)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead>
              <tr>
                <TH>Received</TH>
                <TH>Cheque #</TH>
                <TH>Invoice #</TH>
                <TH>Ryder Conf #</TH>
                <TH style={{ textAlign: 'right' }}>Amount</TH>
                <TH style={{ textAlign: 'center' }}>Status</TH>
                <TH style={{ width: 70, textAlign: 'center' }}>File</TH>
              </tr>
            </thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id}>
                  <TD muted>{c.received_at ? new Date(c.received_at).toLocaleDateString() : '—'}</TD>
                  <TD mono>{c.check_number || '—'}</TD>
                  <TD mono>
                    {(c.invoice_numbers || c.invoice_number)
                      ? <span style={{ fontWeight: 600, color: C.primary }}>{c.invoice_numbers || c.invoice_number}</span>
                      : <span style={{ color: C.textMut, fontStyle: 'italic' }}>unmatched</span>}
                  </TD>
                  <TD mono>{c.ryder_conf_number || '—'}</TD>
                  <TD style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.amount)}</TD>
                  <TD style={{ textAlign: 'center' }}><CheckBadge status={c.status} /></TD>
                  <TD style={{ textAlign: 'center' }}><FileLink fileRef={chequeFileRef(c)} /></TD>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {uploadOpen && (
        <UploadDocumentModal kind="cheque" role="admin"
          onClose={() => setUploadOpen(false)}
          onDone={fetchChecks} />
      )}
    </div>
  )
}
