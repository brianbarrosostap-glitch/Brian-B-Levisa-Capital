import React, { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { C, adminStatus } from '../../tokens'
import { Card, Btn, Badge, Tabs, SearchBar, FilterChip, DataList } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { usePersistentState } from '../../hooks/usePersistentState'
import FileLink from '../../components/FileLink'
import InvoiceDetailModal from './InvoiceDetailModal'
import { invoiceFileRef } from '../../lib/files'
import { fmtMoney } from '../../lib/documentJobs'

const PAST_STATUSES = ['Paid', 'Void', 'Cancelled']
const PAGE_SIZE = 50
const SOURCE_DRIVE  = 'Drive-era'
const SOURCE_PORTAL = 'Portal uploads'
const fmtAdv  = n => n == null ? '—' : 'ADV-' + String(n).padStart(4, '0')
const fmtDate = d => d ? new Date(d).toLocaleDateString() : '—'

export default function PastInvoices() {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [detail, setDetail]     = useState(null)
  const [page, setPage]         = useState(0)
  const [tab, setTab]           = usePersistentState('admin.past.tab', 'all')        // all | paid | void
  const [source, setSource]     = usePersistentState('admin.past.source', '')
  const [search, setSearch]     = usePersistentState('admin.past.search', '')

  const fetchInvoices = async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error: err } = await supabase
      .from('invoices')
      .select('id, invoice_number, po_number, unit_number, advance_number, invoice_amount, invoice_date, status, paid_at, storage_path, pdf_path, drive_file_url, client:clients(name)')
      .in('status', PAST_STATUSES)
      .order('invoice_date', { ascending: false })
    if (err) {
      console.error('PastInvoices load failed:', err)
      setError('Could not load past invoices.')
    } else {
      setError('')
      setInvoices(data || [])
    }
    if (!silent) setLoading(false)
  }

  useEffect(() => { fetchInvoices() }, [])

  // Any filter change → back to page 1.
  useEffect(() => { setPage(0) }, [tab, source, search])

  const q = search.trim().toLowerCase()
  const inTab = (i) => tab === 'paid' ? i.status === 'Paid'
    : tab === 'void' ? (i.status === 'Void' || i.status === 'Cancelled')
    : true
  const inSource = (i) => source === SOURCE_DRIVE ? !i.storage_path
    : source === SOURCE_PORTAL ? !!i.storage_path
    : true
  const list = invoices.filter(i => inTab(i) && inSource(i) && (!q
    || String(i.invoice_number || '').toLowerCase().includes(q)
    || String(i.po_number || '').toLowerCase().includes(q)))

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const cur   = Math.min(page, pages - 1)
  const rows  = list.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE)
  const total = list.reduce((s, i) => s + Number(i.invoice_amount || 0), 0)

  const counts = {
    all:  invoices.length,
    paid: invoices.filter(i => i.status === 'Paid').length,
    void: invoices.filter(i => i.status === 'Void' || i.status === 'Cancelled').length,
  }

  const columns = [
    { key: 'invoice_number', label: 'Invoice #', mono: true },
    { key: 'po_number', label: 'PO #', mono: true, render: i => i.po_number || '—' },
    { key: 'advance_number', label: 'Advance #', mono: true, render: i => fmtAdv(i.advance_number) },
    { key: 'invoice_amount', label: 'Amount', align: 'right', render: i => fmtMoney(i.invoice_amount) },
    { key: 'invoice_date', label: 'Invoice Date', render: i => <span style={{ color: C.textSm }}>{fmtDate(i.invoice_date)}</span> },
    { key: 'status', label: 'Status', render: i => <Badge status={i.status} label={adminStatus(i.status)} /> },
    { key: 'paid_at', label: 'Paid On', render: i => <span style={{ color: C.textSm }}>{fmtDate(i.paid_at)}</span> },
    { key: 'file', label: 'File', render: i => <span onClick={e => e.stopPropagation()}><FileLink fileRef={invoiceFileRef(i)} emptyLabel="None" /></span> },
  ]

  return (
    <div>
      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search invoice # or PO #…" value={search} onChange={setSearch} />
          <FilterChip label="Source" options={[SOURCE_DRIVE, SOURCE_PORTAL]} value={source} onChange={setSource} />
          {(search || source) && (
            <Btn variant="ghost" size="sm" onClick={() => { setSearch(''); setSource('') }}>
              <X size={12} /> Clear filters
            </Btn>
          )}
        </div>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'all',  label: 'All past',         count: counts.all },
            { key: 'paid', label: 'Paid',             count: counts.paid },
            { key: 'void', label: 'Void & Cancelled', count: counts.void },
          ]} />
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading past invoices…</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.red }}>{error}</div>
        ) : (
          <>
            <DataList columns={columns} rows={rows} onRowClick={setDetail}
              emptyText={invoices.length === 0 ? 'No paid or cancelled invoices yet.' : 'No invoices match your filters.'} />
            {list.length > 0 && (
              <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: C.textSm }}>
                <span>
                  {cur * PAGE_SIZE + 1}–{Math.min((cur + 1) * PAGE_SIZE, list.length)} of {list.length}
                  {' · '}total <strong style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(total)}</strong>
                </span>
                {pages > 1 && (
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Btn variant="secondary" size="sm" onClick={() => setPage(cur - 1)} disabled={cur === 0}><ChevronLeft size={12} /> Prev</Btn>
                    <span>Page {cur + 1} / {pages}</span>
                    <Btn variant="secondary" size="sm" onClick={() => setPage(cur + 1)} disabled={cur >= pages - 1}>Next <ChevronRight size={12} /></Btn>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {detail && (
        <InvoiceDetailModal invoice={detail} onClose={() => setDetail(null)} onRefresh={() => fetchInvoices(true)} />
      )}
    </div>
  )
}
