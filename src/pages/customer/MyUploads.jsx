import React, { useState, useEffect, useRef } from 'react'
import { Upload, X } from 'lucide-react'
import { C } from '../../tokens'
import { Card, Btn, SearchBar, FilterChip, DataList } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { usePersistentState } from '../../hooks/usePersistentState'
import FileLink from '../../components/FileLink'
import StatusPill from '../../components/StatusPill'
import UploadDocumentModal from '../../components/UploadDocumentModal'
import { jobFileRef } from '../../lib/files'
import {
  ACTIVE_JOB_STATUSES, CUSTOMER_JOB_LABELS, customerJobStatus,
  fmtMoney, fmtDateTime, jobFileName,
} from '../../lib/documentJobs'

// Customer's own invoice uploads. Shows friendly words only — never the
// internal status_reason, validation checks, or anything about Ryder.
const COLUMNS = 'id, kind, source, storage_bucket, storage_path, original_filename, sheet_url, status, extracted, review_note, created_at'

export default function MyUploads() {
  const [jobs, setJobs]         = useState([])
  const [clientId, setClientId] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [search, setSearch]     = usePersistentState('customer.uploads.search', '')
  const [statusFilter, setStatusFilter] = usePersistentState('customer.uploads.status', '')
  const clientRef = useRef(null)

  const fetchJobs = async (silent = false) => {
    if (!silent) setLoading(true)
    let cid = clientRef.current
    if (!cid) {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: client } = await supabase.from('clients').select('id').eq('owner_id', user?.id).maybeSingle()
      cid = client?.id || null
      clientRef.current = cid
      setClientId(cid)
    }
    if (!cid) { setLoading(false); return }

    const { data, error: err } = await supabase
      .from('document_jobs')
      .select(COLUMNS)
      .eq('client_id', cid)
      .eq('kind', 'invoice')
      .order('created_at', { ascending: false })
      .limit(500)
    if (err) {
      console.error('MyUploads load failed:', err)
      if (!silent) setError('Could not load your uploads. Please refresh the page.')
    } else {
      setError('')
      setJobs(data || [])
    }
    if (!silent) setLoading(false)
  }

  useEffect(() => { fetchJobs() }, [])

  // While anything is still being read, refresh every 10 s.
  const hasActive = jobs.some(j => ACTIVE_JOB_STATUSES.includes(j.status))
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(() => fetchJobs(true), 10000)
    return () => clearInterval(t)
  }, [hasActive])

  const q = search.trim().toLowerCase()
  const list = jobs.filter(j => {
    const s = customerJobStatus(j)
    const matchS = !statusFilter || s.label === statusFilter
    const matchQ = !q
      || jobFileName(j).toLowerCase().includes(q)
      || String(j.extracted?.invoice_number || '').toLowerCase().includes(q)
    return matchS && matchQ
  })

  const columns = [
    {
      key: 'file', label: 'File',
      render: j => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span title={jobFileName(j)} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
            {jobFileName(j)}
          </span>
          <FileLink fileRef={jobFileRef(j)} label={j.storage_path ? 'View' : 'Open link'} />
        </div>
      ),
    },
    { key: 'created_at', label: 'Uploaded', render: j => <span style={{ color: C.textSm, whiteSpace: 'nowrap' }}>{fmtDateTime(j.created_at)}</span> },
    { key: 'invoice_number', label: 'Invoice #', mono: true, render: j => j.extracted?.invoice_number || '—' },
    { key: 'amount', label: 'Amount', align: 'right', render: j => fmtMoney(j.extracted?.invoice_amount) },
    {
      key: 'status', label: 'Status',
      render: j => {
        const s = customerJobStatus(j)
        return (
          <div>
            <StatusPill label={s.label} tone={s.tone} />
            {s.note && <div style={{ fontSize: 11.5, color: C.textMut, marginTop: 3, maxWidth: 260 }}>{s.note}</div>}
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search file name or invoice #…" value={search} onChange={setSearch} />
          <FilterChip label="Status" options={CUSTOMER_JOB_LABELS} value={statusFilter} onChange={setStatusFilter} />
          {(search || statusFilter) && (
            <Btn variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter('') }}>
              <X size={12} /> Clear filters
            </Btn>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <Btn onClick={() => setUploadOpen(true)}><Upload size={13} /> Upload invoice</Btn>
          </div>
        </div>

        {hasActive && (
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, background: C.infoLt, color: C.info, fontSize: 12 }}>
            Some files are still being read — this list refreshes automatically.
          </div>
        )}

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading uploads…</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.red }}>{error}</div>
        ) : !clientId ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>
            Your account is not linked to a company yet. Please contact Levisa Capital.
          </div>
        ) : (
          <DataList columns={columns} rows={list}
            emptyText={jobs.length === 0 ? 'No uploads yet. Use “Upload invoice” to add your first invoice.' : 'No uploads match your filters.'} />
        )}
      </Card>

      {uploadOpen && (
        <UploadDocumentModal kind="invoice" role="customer" clientId={clientId}
          onClose={() => setUploadOpen(false)}
          onDone={() => fetchJobs(true)} />
      )}
    </div>
  )
}
