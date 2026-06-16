import React, { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { C, ROW_BG } from '../../tokens'
import { Card, Btn, Badge, Tabs, SearchBar, FilterChip, KebabMenu, TH, TD, Modal, ModalBody, ModalFooter, Field } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import InvoiceDetailModal from './InvoiceDetailModal'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* ── Batch Approval Modal ── */
function BatchModal({ batch, invoices, onClose, onApproved }) {
  const [excluded, setExcluded] = useState([])
  const [loading, setLoading]   = useState(false)

  const toggled = id => setExcluded(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id])
  const active  = invoices.filter(i => !excluded.includes(i.id))
  const total   = active.reduce((s, i) => s + Number(i.invoice_amount), 0)
  const adv     = active.reduce((s, i) => s + Number(i.advance_amount), 0)

  const handleApprove = async () => {
    setLoading(true)
    try {
      await callFunction('approve-batch', {
        batch_id: batch.id,
        approved_invoice_ids: active.map(i => i.id),
        action: 'approve',
      })
      onApproved()
      onClose()
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const handleReject = async () => {
    setLoading(true)
    try {
      await callFunction('approve-batch', {
        batch_id: batch.id,
        approved_invoice_ids: [],
        action: 'reject',
      })
      onApproved()
      onClose()
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  return (
    <Modal onClose={onClose} width={580}
      title={`Advance Request — ${batch.request_number}`}
      subtitle={`${batch.client?.name} · Submitted ${new Date(batch.submitted_at).toLocaleString()}`}
    >
      <ModalBody>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          Invoices in this request — toggle to exclude
        </div>
        {invoices.map(inv => {
          const on = !excluded.includes(inv.id)
          return (
            <div key={inv.id} onClick={() => toggled(inv.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 9, border: `1.5px solid ${on ? C.primary : C.border}`,
              background: on ? '#f6fef9' : '#fafafa',
              marginBottom: 8, cursor: 'pointer',
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 4,
                border: `2px solid ${on ? C.primary : C.borderMd}`,
                background: on ? C.primary : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {on && <Check size={11} color="#fff" strokeWidth={3} />}
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{inv.invoice_number}</span>
                <span style={{ fontSize: 12, color: C.textSm, marginLeft: 8 }}>Unit {inv.unit_number}</span>
              </div>
              <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.invoice_amount)}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>→ {fmt(inv.advance_amount)}</div>
            </div>
          )
        })}
        <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: '#f0faf5', border: '1px solid #b6e8d0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div style={{ textAlign: 'center', borderRight: `1px solid ${C.border}`, paddingRight: 12 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Selected</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.textB }}>{active.length}</div>
          </div>
          <div style={{ textAlign: 'center', borderRight: `1px solid ${C.border}`, padding: '0 12px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Invoice Total</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.textB, fontVariantNumeric: 'tabular-nums' }}>{fmt(total)}</div>
          </div>
          <div style={{ textAlign: 'center', paddingLeft: 12 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Advance @97%</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(adv)}</div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Btn variant="ghost" style={{ color: C.red }} onClick={handleReject} disabled={loading}>Reject Entire Batch</Btn>
        <Btn variant="secondary" onClick={onClose} disabled={loading}>Cancel</Btn>
        <Btn onClick={handleApprove} disabled={active.length === 0 || loading}>
          {loading ? 'Saving…' : `Approve ${active.length} Invoice${active.length !== 1 ? 's' : ''}`}
        </Btn>
      </ModalFooter>
    </Modal>
  )
}

export default function Master() {
  const [tab, setTab]           = useState('active')
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [invoices, setInvoices] = useState([])
  const [pendingBatch, setPendingBatch] = useState(null)
  const [batchInvoices, setBatchInvoices] = useState([])
  const [batchModal, setBatchModal]   = useState(false)
  const [detailModal, setDetailModal] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetchInvoices()
    fetchPendingBatch()
  }, [])

  const fetchInvoices = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('invoices')
      .select(`id, invoice_number, unit_number, invoice_date, invoice_amount, advance_amount, status, batch_id, client:clients(name)`)
      .order('invoice_date', { ascending: false })
    if (data) setInvoices(data)
    setLoading(false)
  }

  const fetchPendingBatch = async () => {
    const { data: batches } = await supabase
      .from('batches')
      .select(`id, request_number, submitted_at, status, client:clients(name), invoices:invoices(id, invoice_number, unit_number, invoice_amount, advance_amount)`)
      .eq('status', 'Pending')
      .order('submitted_at', { ascending: false })
      .limit(1)

    if (batches && batches.length > 0) {
      setPendingBatch(batches[0])
      setBatchInvoices(batches[0].invoices || [])
    }
  }

  const active    = invoices.filter(i => !['Void','Cancelled'].includes(i.status))
  const voided    = invoices.filter(i => i.status === 'Void')
  const cancelled = invoices.filter(i => i.status === 'Cancelled')

  const list = (tab === 'active' ? active : tab === 'void' ? voided : cancelled).filter(i => {
    const q = search.toLowerCase()
    const matchQ = !q || i.invoice_number?.toLowerCase().includes(q) || i.unit_number?.includes(q)
    const matchS = !statusFilter || i.status === statusFilter
    return matchQ && matchS
  })

  const pending      = active.filter(i => i.status === 'Payment Requested')
  const totalPending = pending.reduce((s, i) => s + Number(i.invoice_amount), 0)
  const totalAdvPend = pending.reduce((s, i) => s + Number(i.advance_amount), 0)
  const statuses     = [...new Set(invoices.map(i => i.status))]

  const handleMarkStatus = async (inv, action) => {
    try {
      await callFunction('mark-invoice-status', { invoice_id: inv.id, action })
      fetchInvoices()
    } catch (e) { console.error(e) }
  }

  return (
    <div>
      {/* Pending Request Banner */}
      {pendingBatch && (
        <div style={{ background: '#fffdf5', border: '1px solid #fde68a', borderRadius: 9, padding: '11px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef9c3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.textB }}>New advance request — {pendingBatch.request_number} </span>
            <span style={{ fontSize: 12, color: C.textSm }}>
              {batchInvoices.length} invoices · {fmt(batchInvoices.reduce((s,i)=>s+Number(i.invoice_amount),0))} · Submitted by {pendingBatch.client?.name} · {new Date(pendingBatch.submitted_at).toLocaleDateString()}
            </span>
          </div>
          <Btn size="sm" onClick={() => setBatchModal(true)}>Review Request</Btn>
        </div>
      )}

      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search invoice #, unit, amount…" value={search} onChange={setSearch} />
          <FilterChip label="Status" options={statuses} value={statusFilter} onChange={setStatusFilter} />
          <FilterChip label="Date Range" options={['Last 30 days','Last 90 days','This year','All time']} value="" onChange={() => {}} />
        </div>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'active',    label: 'Active',    count: active.length },
            { key: 'void',      label: 'Void',      count: voided.length },
            { key: 'cancelled', label: 'Cancelled', count: cancelled.length },
          ]} />
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: C.textMut }}>Loading invoices…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <TH>Invoice Date</TH>
                <TH>Invoice #</TH>
                <TH>Unit #</TH>
                <TH style={{ textAlign: 'right' }}>Invoice Amount</TH>
                <TH style={{ textAlign: 'right' }}>Advance @97%</TH>
                <TH>Status</TH>
                <TH style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {list.map(inv => (
                <tr key={inv.id}
                  style={{ background: ROW_BG[inv.status] || 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f1faf5'}
                  onMouseLeave={e => e.currentTarget.style.background = ROW_BG[inv.status] || 'transparent'}
                  onClick={() => setDetailModal(inv)}
                >
                  <TD muted>{new Date(inv.invoice_date).toLocaleDateString()}</TD>
                  <TD mono>{inv.invoice_number}</TD>
                  <TD muted>{inv.unit_number}</TD>
                  <TD style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.invoice_amount)}</TD>
                  <TD accent style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.advance_amount)}</TD>
                  <TD><Badge status={inv.status} /></TD>
                  <TD style={{ padding: '6px 8px' }} onClick={e => e.stopPropagation()}>
                    <KebabMenu items={[
                      { label: 'View Detail', onClick: () => setDetailModal(inv) },
                      { label: 'Mark Advance Paid', onClick: () => handleMarkStatus(inv, 'mark_advance_paid') },
                      { label: 'Mark Ryder Paid',   onClick: () => handleMarkStatus(inv, 'mark_ryder_paid') },
                      { label: 'Mark Paid (override)', onClick: () => handleMarkStatus(inv, 'mark_paid_override') },
                      { label: 'Resubmit',  onClick: () => handleMarkStatus(inv, 'resubmit') },
                      { label: 'Void Invoice', danger: true, onClick: () => handleMarkStatus(inv, 'set_void') },
                    ]} />
                  </TD>
                </tr>
              ))}
            </tbody>
            {tab === 'active' && (
              <tfoot>
                <tr style={{ background: '#f0faf5', borderTop: `2px solid ${C.primary}` }}>
                  <td colSpan={3} style={{ padding: '11px 13px', fontSize: 10.5, fontWeight: 700, color: C.primary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Total Pending ({pending.length})
                  </td>
                  <td style={{ padding: '11px 13px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalPending)}</td>
                  <td style={{ padding: '11px 13px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalAdvPend)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </Card>

      {batchModal && pendingBatch && (
        <BatchModal
          batch={pendingBatch}
          invoices={batchInvoices}
          onClose={() => setBatchModal(false)}
          onApproved={() => { fetchInvoices(); fetchPendingBatch(); setPendingBatch(null) }}
        />
      )}

      {detailModal && (
        <InvoiceDetailModal invoice={detailModal} onClose={() => setDetailModal(null)} onRefresh={fetchInvoices} />
      )}
    </div>
  )
}
