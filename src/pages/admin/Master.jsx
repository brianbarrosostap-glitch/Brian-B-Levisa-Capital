import React, { useState, useEffect } from 'react'
import { Check, X } from 'lucide-react'
import { C, ROW_BG } from '../../tokens'
import { Card, Btn, Badge, Tabs, SearchBar, FilterChip, KebabMenu, TH, TD, Modal, ModalBody, ModalFooter, useIsMobile } from '../../components/ui'
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
  const isMobile = useIsMobile()
  const [tab, setTab]           = useState('active')
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [invoices, setInvoices] = useState([])
  const [pendingBatches, setPendingBatches] = useState([])
  // Banners hidden via the × button — persisted so they stay dismissed on refresh.
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('master.dismissedBatches') || '[]')) }
    catch { return new Set() }
  })
  const [activeBatch, setActiveBatch] = useState(null)   // the batch being reviewed
  const [detailModal, setDetailModal] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetchInvoices()
    fetchPendingBatch()

    // Keep the admin list in sync with status changes made elsewhere
    // (customer submits, n8n/email ingest, etc.) — refresh when the
    // window/tab regains focus or becomes visible.
    const refresh = () => { fetchInvoices(true); fetchPendingBatch() }   // silent — don't blank the table
    const onVis = () => { if (!document.hidden) refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // `silent` = background refresh (focus/visibility) that must NOT blank the
  // table — otherwise statuses flash empty on every refocus. Only the first
  // load shows the spinner.
  const fetchInvoices = async (silent = false) => {
    if (!silent) setLoading(true)
    const { data, error } = await supabase
      .from('invoices')
      .select(`id, invoice_number, po_number, unit_number, invoice_date, invoice_amount, advance_amount, status, batch_id, resubmit_count, client:clients(name)`)
      .order('invoice_date', { ascending: false })
    if (error) console.error('Master fetchInvoices failed:', error)
    // Only overwrite when we actually got rows back — never wipe the table
    // (and the visible statuses) just because a background refetch errored.
    if (Array.isArray(data)) setInvoices(data)
    if (!silent) setLoading(false)
  }

  const fetchPendingBatch = async () => {
    const { data: batches } = await supabase
      .from('batches')
      .select(`id, request_number, submitted_at, status, client:clients(name), invoices:invoices(id, invoice_number, unit_number, invoice_amount, advance_amount)`)
      .eq('status', 'Pending')
      .order('submitted_at', { ascending: false })

    const list = batches || []
    setPendingBatches(list)

    // Prune dismissed ids that are no longer pending (reviewed/approved),
    // so the persisted set doesn't grow unbounded.
    setDismissed(prev => {
      const liveIds = new Set(list.map(b => b.id))
      const pruned = new Set([...prev].filter(id => liveIds.has(id)))
      if (pruned.size !== prev.size) {
        localStorage.setItem('master.dismissedBatches', JSON.stringify([...pruned]))
      }
      return pruned
    })
  }

  const active    = invoices.filter(i => !['Void','Cancelled'].includes(i.status))
  const voided    = invoices.filter(i => i.status === 'Void')
  const cancelled = invoices.filter(i => i.status === 'Cancelled')

  const list = (tab === 'active' ? active : tab === 'void' ? voided : cancelled).filter(i => {
    const q = search.toLowerCase()
    const matchQ = !q || i.invoice_number?.toLowerCase().includes(q) || i.unit_number?.includes(q) || i.po_number?.toLowerCase().includes(q)
    const matchS = !statusFilter || i.status === statusFilter
    return matchQ && matchS
  })

  // Footer totals the ENTIRE visible table (all rows currently shown after
  // tab/search/status filtering) — not just the Payment-Requested subset.
  const listTotalInvoice = list.reduce((s, i) => s + Number(i.invoice_amount), 0)
  const listTotalAdvance = list.reduce((s, i) => s + Number(i.advance_amount), 0)
  const statuses     = [...new Set(invoices.map(i => i.status))]

  const handleMarkStatus = async (inv, action) => {
    try {
      await callFunction('mark-invoice-status', { invoice_id: inv.id, action })
      fetchInvoices()
    } catch (e) { console.error(e) }
  }

  return (
    <div>
      {/* Pending Request Banners — one per pending advance request */}
      {pendingBatches.filter(b => !dismissed.has(b.id)).map(batch => {
        const invs = batch.invoices || []
        return (
          <div key={batch.id} style={{ background: '#fffdf5', border: '1px solid #fde68a', borderRadius: 9, padding: '11px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef9c3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.textB }}>
                New advance request — {invs.length > 0 ? invs.map(i => i.invoice_number).join(', ') : '—'}{' '}
              </span>
              <span style={{ fontSize: 12, color: C.textSm }}>
                {invs.length} invoice{invs.length !== 1 ? 's' : ''} · {fmt(invs.reduce((s,i)=>s+Number(i.invoice_amount),0))} · Submitted by {batch.client?.name} · {new Date(batch.submitted_at).toLocaleDateString()}
              </span>
            </div>
            <Btn size="sm" onClick={() => setActiveBatch(batch)}>Review Request</Btn>
            <button
              onClick={() => setDismissed(prev => {
                const next = new Set(prev).add(batch.id)
                localStorage.setItem('master.dismissedBatches', JSON.stringify([...next]))
                return next
              })}
              aria-label="Dismiss"
              title="Dismiss (request stays until reviewed)"
              style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #fde68a', background: '#fffdf5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <X size={13} color={C.textMut} />
            </button>
          </div>
        )
      })}

      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search invoice #, unit, amount…" value={search} onChange={setSearch} />
          <FilterChip label="Status" options={statuses} value={statusFilter} onChange={setStatusFilter} />
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
        ) : isMobile ? (
          /* ── Mobile: stacked cards so no column is hidden ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10 }}>
            {list.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: C.textMut }}>No invoices.</div>
            )}
            {list.map(inv => (
              <div key={inv.id} onClick={() => setDetailModal(inv)} style={{
                border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px',
                background: ROW_BG[inv.status] || '#fff', cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{inv.invoice_number}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {inv.resubmit_count > 0 && (
                      <span style={{ background: inv.resubmit_count >= 3 ? C.redLt : '#fef3c7', color: inv.resubmit_count >= 3 ? C.red : '#92400e', borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: '1px 7px' }}>↻ {inv.resubmit_count}×</span>
                    )}
                    <Badge status={inv.status} />
                  </div>
                </div>
                {[
                  ['Invoice Date', new Date(inv.invoice_date).toLocaleDateString()],
                  ['PO #', inv.po_number || '—'],
                  ['Unit #', inv.unit_number || '—'],
                  ['Resent to Ryder', `${inv.resubmit_count ?? 0}×`],
                  ['Invoice Amount', fmt(inv.invoice_amount)],
                  ['Advance @97%', fmt(inv.advance_amount)],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12.5 }}>
                    <span style={{ color: C.textMut, fontWeight: 600 }}>{k}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: k === 'Advance @97%' ? C.primary : C.text, fontWeight: k === 'Advance @97%' ? 700 : 400 }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8, display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                  <KebabMenu items={[
                    { label: 'View Detail', onClick: () => setDetailModal(inv) },
                    { label: 'Mark Advance Paid', onClick: () => handleMarkStatus(inv, 'mark_advance_paid') },
                    { label: 'Mark Ryder Paid',   onClick: () => handleMarkStatus(inv, 'mark_ryder_paid') },
                    { label: 'Mark Paid (override)', onClick: () => handleMarkStatus(inv, 'mark_paid_override') },
                    { label: 'Resubmit',  onClick: () => handleMarkStatus(inv, 'resubmit') },
                    { label: 'Void Invoice', danger: true, onClick: () => handleMarkStatus(inv, 'set_void') },
                  ]} />
                </div>
              </div>
            ))}
            {list.length > 0 && (
              <div style={{ borderTop: `2px solid ${C.primary}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: C.primary }}>
                <span>Total ({list.length})</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(listTotalInvoice)} · {fmt(listTotalAdvance)}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <TH>Invoice Date</TH>
                <TH>Invoice #</TH>
                <TH>PO #</TH>
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
                  <TD mono>{inv.po_number || '—'}</TD>
                  <TD muted>{inv.unit_number}</TD>
                  <TD style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.invoice_amount)}</TD>
                  <TD accent style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.advance_amount)}</TD>
                  <TD>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Badge status={inv.status} />
                      {inv.resubmit_count > 0 && (
                        <span title={`Re-sent to Ryder ${inv.resubmit_count} time(s)`} style={{
                          background: inv.resubmit_count >= 3 ? C.redLt : '#fef3c7', color: inv.resubmit_count >= 3 ? C.red : '#92400e',
                          borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: '1px 7px', whiteSpace: 'nowrap',
                        }}>↻ {inv.resubmit_count}×</span>
                      )}
                    </div>
                  </TD>
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
            {list.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f0faf5', borderTop: `2px solid ${C.primary}` }}>
                  <td colSpan={4} style={{ padding: '11px 13px', fontSize: 10.5, fontWeight: 700, color: C.primary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Total ({list.length} shown)
                  </td>
                  <td style={{ padding: '11px 13px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(listTotalInvoice)}</td>
                  <td style={{ padding: '11px 13px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(listTotalAdvance)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        )}
      </Card>

      {activeBatch && (
        <BatchModal
          batch={activeBatch}
          invoices={activeBatch.invoices || []}
          onClose={() => setActiveBatch(null)}
          onApproved={() => { fetchInvoices(); fetchPendingBatch(); setActiveBatch(null) }}
        />
      )}

      {detailModal && (
        <InvoiceDetailModal invoice={detailModal} onClose={() => setDetailModal(null)} onRefresh={fetchInvoices} />
      )}
    </div>
  )
}
