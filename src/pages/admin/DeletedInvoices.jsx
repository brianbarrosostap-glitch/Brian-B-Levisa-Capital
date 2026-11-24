import React, { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { C, adminStatus } from '../../tokens'
import { Card, Btn, Badge, SearchBar, DataList, Modal, ModalBody, ModalFooter } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import { usePersistentState } from '../../hooks/usePersistentState'
import FileLink from '../../components/FileLink'
import { errorMessage } from '../../lib/errors'
import { fmtMoney, fmtDateTime } from '../../lib/documentJobs'

const deletedFileRef = (d) => ({
  bucket: 'invoices',
  path: d.storage_path || null,
  fallbackUrl: d.drive_file_url || null,
})

function RestoreModal({ row, onClose, onRestored }) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  const restore = async () => {
    setBusy(true); setError('')
    try {
      await callFunction('restore-invoice', { deleted_id: row.id })
      onRestored()
      onClose()
    } catch (e) {
      console.error('restore-invoice failed:', e)
      setError(await errorMessage(e, 'Could not restore the invoice'))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} width={440} title="Restore invoice?" subtitle={`Invoice ${row.invoice_number || '—'}`}>
      <ModalBody>
        <div style={{ fontSize: 13, color: C.textSm, lineHeight: 1.6 }}>
          This puts invoice <strong style={{ color: C.text, fontFamily: 'monospace' }}>{row.invoice_number || '—'}</strong>
          {row.invoice_amount != null ? <> ({fmtMoney(row.invoice_amount)})</> : null} back into the portal
          {row.status_at_delete ? <> with its status at deletion: <strong style={{ color: C.text }}>{adminStatus(row.status_at_delete)}</strong></> : null}.
        </div>
        {error && <div style={{ marginTop: 12, background: C.redLt, borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: C.red }}>{error}</div>}
      </ModalBody>
      <ModalFooter>
        <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn onClick={restore} disabled={busy}><RotateCcw size={13} /> {busy ? 'Restoring…' : 'Yes, restore'}</Btn>
      </ModalFooter>
    </Modal>
  )
}

export default function DeletedInvoices() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [restoring, setRestoring] = useState(null)
  const [search, setSearch]   = usePersistentState('admin.deleted.search', '')

  const fetchRows = async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error: err } = await supabase
      .from('deleted_invoices')
      .select('id, invoice_id, invoice_number, invoice_amount, status_at_delete, client_id, drive_file_url, storage_path, deleted_by_email, deleted_at, restored_at, client:clients(name)')
      .order('deleted_at', { ascending: false })
    if (err) {
      console.error('deleted_invoices load failed:', err)
      setError(err.code === '42P01' || err.code === 'PGRST205'
        ? 'Deleted-invoices archive not set up yet — run migration 20261124000003_deleted_invoices.sql.'
        : 'Could not load deleted invoices.')
    } else {
      setError('')
      setRows(data || [])
    }
    if (!silent) setLoading(false)
  }

  useEffect(() => { fetchRows() }, [])

  const q = search.trim().toLowerCase()
  const list = rows.filter(r => !q
    || String(r.invoice_number || '').toLowerCase().includes(q)
    || String(r.deleted_by_email || '').toLowerCase().includes(q)
    || String(r.client?.name || '').toLowerCase().includes(q))

  const columns = [
    { key: 'invoice_number', label: 'Invoice #', mono: true, render: r => r.invoice_number || '—' },
    { key: 'client', label: 'Client', render: r => r.client?.name || '—' },
    { key: 'invoice_amount', label: 'Amount', align: 'right', render: r => fmtMoney(r.invoice_amount) },
    { key: 'status_at_delete', label: 'Status When Deleted', render: r => r.status_at_delete ? <Badge status={r.status_at_delete} label={adminStatus(r.status_at_delete)} /> : '—' },
    { key: 'deleted_by_email', label: 'Deleted By', render: r => <span style={{ color: C.textSm }}>{r.deleted_by_email || '—'}</span> },
    { key: 'deleted_at', label: 'Deleted At', render: r => <span style={{ color: C.textSm, whiteSpace: 'nowrap' }}>{fmtDateTime(r.deleted_at)}</span> },
    { key: 'file', label: 'File', render: r => <FileLink fileRef={deletedFileRef(r)} emptyLabel="None" /> },
    {
      key: 'restore', label: '',
      render: r => r.restored_at
        ? <span style={{ fontSize: 12, color: C.primary, fontWeight: 600, whiteSpace: 'nowrap' }}>Restored {new Date(r.restored_at).toLocaleDateString()}</span>
        : <Btn size="sm" variant="outline" onClick={() => setRestoring(r)}><RotateCcw size={12} /> Restore</Btn>,
    },
  ]

  return (
    <div>
      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search invoice #, client, deleted by…" value={search} onChange={setSearch} />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textMut }}>
            Invoices deleted from the portal. Restoring puts the invoice back exactly as it was.
          </span>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.red }}>{error}</div>
        ) : (
          <DataList columns={columns} rows={list}
            emptyText={rows.length === 0 ? 'No deleted invoices.' : 'No deleted invoices match your search.'} />
        )}
      </Card>

      {restoring && (
        <RestoreModal row={restoring} onClose={() => setRestoring(null)} onRestored={() => fetchRows(true)} />
      )}
    </div>
  )
}
