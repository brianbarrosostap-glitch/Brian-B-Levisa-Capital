import React, { useState, useEffect } from 'react'
import { Check, X } from 'lucide-react'
import { C, ROW_BG, adminStatus } from '../../tokens'
import { Card, Btn, Badge, Tabs, SearchBar, FilterChip, KebabMenu, TH, TD, Modal, ModalBody, ModalFooter, useIsMobile } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import InvoiceDetailModal from './InvoiceDetailModal'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtAdv = n => n == null ? '—' : 'ADV-' + String(n).padStart(4, '0')
// "ADV-12", "adv 0012", "ADV#12" → 12 (exact advance-number search)
const parseAdvQuery = q => { const m = q.trim().match(/^adv[\s\-#]*0*(\d+)$/i); return m ? Number(m[1]) : null }

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

/* ── Status Action Modal — two-step: input → confirm → save ── */
const STATUS_LABELS = {
  'Submitted to Ryder': 'Submitted to Ryder',
  'Acknowledged':        'Acknowledged by Ryder',
  'Resubmitted':         'Resubmitted to Ryder',
  'Paid':                'Paid — Cheque Received',
}

function StatusActionModal({ inv, action, onClose, onDone }) {
  const [step, setStep]           = useState('input')   // 'input' | 'confirm'
  const [confNumber, setConfNumber] = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const needsConf = action === 'Acknowledged'
  const label     = STATUS_LABELS[action] || action

  const goConfirm = () => {
    if (needsConf && !confNumber.trim()) { setError('Confirmation number is required'); return }
    setError('')
    setStep('confirm')
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      await callFunction('mark-invoice-status', {
        invoice_id: inv.id,
        action: 'set_status',
        status: action,
        ...(needsConf ? { conf_number: confNumber.trim(), note: `Conf #: ${confNumber.trim()}` } : {}),
      })
      onDone()
      onClose()
    } catch (e) { setError(String(e)); setStep('input'); setLoading(false) }
  }

  return (
    <Modal onClose={onClose} width={420} title={`Update Status`} subtitle={`Invoice ${inv.invoice_number}`}>
      {step === 'input' ? (
        <>
          <ModalBody>
            <div style={{ marginBottom: needsConf ? 16 : 0 }}>
              <div style={{ fontSize: 13, color: C.textSm, marginBottom: needsConf ? 16 : 0 }}>
                New status: <strong style={{ color: C.text }}>{label}</strong>
              </div>
              {needsConf && (
                <>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.textSm, marginBottom: 6 }}>
                    Ryder Confirmation Number <span style={{ color: C.red }}>*</span>
                  </label>
                  <input
                    autoFocus
                    value={confNumber}
                    onChange={e => { setConfNumber(e.target.value); setError('') }}
                    placeholder="e.g. 11158289"
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                      borderRadius: 8, border: `1.5px solid ${error ? C.red : C.borderMd}`,
                      fontSize: 14, fontFamily: 'monospace', color: C.text, outline: 'none',
                    }}
                    onKeyDown={e => e.key === 'Enter' && goConfirm()}
                  />
                  {error && <div style={{ fontSize: 12, color: C.red, marginTop: 5 }}>{error}</div>}
                  <div style={{ fontSize: 11.5, color: C.textMut, marginTop: 6 }}>
                    Found in the subject line of Ryder's acknowledgement email.
                  </div>
                </>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
            <Btn onClick={goConfirm}>Next →</Btn>
          </ModalFooter>
        </>
      ) : (
        <>
          <ModalBody>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>Are you sure?</div>
              <div style={{ fontSize: 13, color: C.textSm, lineHeight: 1.6 }}>
                This will move invoice <strong style={{ color: C.text, fontFamily: 'monospace' }}>{inv.invoice_number}</strong> to:
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.primary, margin: '10px 0' }}>{label}</div>
              {needsConf && (
                <div style={{ fontSize: 12.5, color: C.textSm }}>
                  Conf #: <strong style={{ fontFamily: 'monospace', color: C.text }}>{confNumber}</strong>
                </div>
              )}
              <div style={{ fontSize: 11.5, color: C.textMut, marginTop: 8 }}>This action cannot be undone from the portal.</div>
            </div>
            {error && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>{error}</div>}
          </ModalBody>
          <ModalFooter>
            <Btn variant="secondary" onClick={() => setStep('input')} disabled={loading}>← Back</Btn>
            <Btn onClick={handleSave} disabled={loading}>
              {loading ? 'Saving…' : 'Yes, Update Status'}
            </Btn>
          </ModalFooter>
        </>
      )}
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
  const [activeBatch, setActiveBatch] = useState(null)   // the batch being reviewed
  const [detailModal, setDetailModal] = useState(null)
  const [statusAction, setStatusAction] = useState(null) // { inv, action }
  const [loading, setLoading]   = useState(true)
  const [chequesByInvoice, setChequesByInvoice] = useState({})

  useEffect(() => {
    fetchInvoices()
    fetchCheques()
    fetchPendingBatch()

    // Keep the admin list in sync with status changes made elsewhere
    // (customer submits, n8n/email ingest, etc.) — refresh when the
    // window/tab regains focus or becomes visible.
    const refresh = () => { fetchInvoices(true); fetchCheques(); fetchPendingBatch() }   // silent — don't blank the table
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
      .select(`id, invoice_number, po_number, unit_number, invoice_date, invoice_amount, advance_amount, status, batch_id, advance_number, resubmit_count, ryder_conf_number, client:clients(name)`)
      .order('invoice_date', { ascending: false })
    if (error) console.error('Master fetchInvoices failed:', error)
    // Only overwrite when we actually got rows back — never wipe the table
    // (and the visible statuses) just because a background refetch errored.
    if (Array.isArray(data)) setInvoices(data)
    if (!silent) setLoading(false)
  }

  // invoice_id → [cheque numbers] — separate query so a cheque error can
  // never blank the invoice table. Links via cheque_invoices + cheques.invoice_id.
  const fetchCheques = async () => {
    const { data, error } = await supabase
      .from('cheques')
      .select('check_number, invoice_id, cheque_invoices(invoice_id)')
    if (error) { console.error('Master fetchCheques failed:', error); return }
    const map = {}
    for (const c of data || []) {
      if (!c.check_number) continue
      const ids = new Set([c.invoice_id, ...(c.cheque_invoices || []).map(ci => ci.invoice_id)].filter(Boolean))
      for (const id of ids) {
        const list = (map[id] ||= [])
        if (!list.includes(c.check_number)) list.push(c.check_number)   // de-dupe re-ingested cheques
      }
    }
    setChequesByInvoice(map)
  }

  const fetchPendingBatch = async () => {
    const { data: batches } = await supabase
      .from('batches')
      .select(`id, request_number, submitted_at, status, client:clients(name), invoices:invoices(id, invoice_number, unit_number, invoice_amount, advance_amount)`)
      .eq('status', 'Pending')
      .order('submitted_at', { ascending: false })

    setPendingBatches(batches || [])
  }

  const active    = invoices.filter(i => !['Void','Cancelled'].includes(i.status))
  // Void + Cancelled are merged into one "Cancelled" bucket (both are dead invoices).
  const cancelled = invoices.filter(i => ['Void','Cancelled'].includes(i.status))

  const advQuery = parseAdvQuery(search)
  const list = (tab === 'active' ? active : cancelled).filter(i => {
    const q = search.toLowerCase()
    const matchQ = advQuery != null
      ? i.advance_number === advQuery
      : !q || i.invoice_number?.toLowerCase().includes(q) || i.unit_number?.includes(q) || i.po_number?.toLowerCase().includes(q)
        || (chequesByInvoice[i.id] || []).some(n => n.toLowerCase().includes(q))
    // An ADV-search totals the WHOLE advance (expected bank transfer), so the
    // status filter is ignored there — otherwise the total looks short.
    const matchS = advQuery != null || !statusFilter || i.status === statusFilter
    return matchQ && matchS
  })

  // Footer totals the ENTIRE visible table (all rows currently shown after
  // tab/search/status filtering) — not just the Payment-Requested subset.
  const listTotalInvoice = list.reduce((s, i) => s + Number(i.invoice_amount), 0)
  const listTotalAdvance = list.reduce((s, i) => s + Number(i.advance_amount), 0)
  const statuses     = [...new Set(invoices.map(i => i.status))]

  const handleMarkStatus = async (inv, action, status) => {
    try {
      await callFunction('mark-invoice-status', { invoice_id: inv.id, action, status })
      fetchInvoices()
    } catch (e) { console.error(e) }
  }

  // Open the status-action modal for the 4 new manual status transitions.
  const openStatusAction = (inv, targetStatus) => setStatusAction({ inv, action: targetStatus })

  return (
    <div>

      <Card noPad>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search invoice #, PO, unit, cheque #, or ADV-12…" value={search} onChange={setSearch} />
          <FilterChip label="Status" options={statuses} value={statusFilter} onChange={setStatusFilter} />
          {(search || statusFilter) && (
            <button type="button" onClick={() => { setSearch(''); setStatusFilter('') }}
              title="Clear search and filters"
              onMouseEnter={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = C.redLt; e.currentTarget.style.color = C.red }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                borderRadius: 8, border: `1px solid ${C.red}`, background: C.redLt, color: C.red,
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif', transition: 'background .15s, color .15s',
              }}>
              <X size={13} strokeWidth={2.5} /> Clear filters
            </button>
          )}
        </div>
        {advQuery != null && (
          /* ── Advance summary — reconcile against the bank transfer ── */
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, background: '#f0faf5', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advance</div>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: C.text }}>{fmtAdv(advQuery)}</div>
            </div>
            {list.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textMut }}>No invoices found for this advance{tab === 'cancelled' ? ' in Cancelled' : ''}.</div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoices</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{list.length}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoice Total</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(listTotalInvoice)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advance Total (RZR) — expected transfer</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(listTotalAdvance)}</div>
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'active',    label: 'Active',    count: active.length },
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
                    <Badge status={inv.status} label={adminStatus(inv.status)} />
                  </div>
                </div>
                {[
                  ['Invoice Date', new Date(inv.invoice_date).toLocaleDateString()],
                  ['PO #', inv.po_number || '—'],
                  ['Unit #', inv.unit_number || '—'],
                  ['Resent to Ryder', `${inv.resubmit_count ?? 0}×`],
                  ['Invoice Amount', fmt(inv.invoice_amount)],
                  ['Advance @97%', fmt(inv.advance_amount)],
                  ['Advance #', fmtAdv(inv.advance_number)],
                  ['Cheque #', (chequesByInvoice[inv.id] || []).join(', ') || '—'],
                  ['Conf #', inv.ryder_conf_number || '—'],
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
                    { label: 'Submitted to Ryder', onClick: () => openStatusAction(inv, 'Submitted to Ryder') },
                    { label: 'Acknowledged by Ryder', onClick: () => openStatusAction(inv, 'Acknowledged') },
                    { label: 'Resubmitted to Ryder', onClick: () => openStatusAction(inv, 'Resubmitted') },
                    { label: 'Mark Paid — Cheque Received', onClick: () => openStatusAction(inv, 'Paid') },
                    { label: 'Mark Ryder Paid',   onClick: () => handleMarkStatus(inv, 'mark_ryder_paid') },
                    { label: 'Mark Paid (override)', onClick: () => handleMarkStatus(inv, 'mark_paid_override') },
                    { label: 'Cancel Invoice', danger: true, onClick: () => handleMarkStatus(inv, 'set_status', 'Cancelled') },
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
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040 }}>
            <thead>
              <tr>
                <TH>Invoice Date</TH>
                <TH>Invoice #</TH>
                <TH>PO #</TH>
                <TH>Unit #</TH>
                <TH style={{ textAlign: 'right' }}>Invoice Amount</TH>
                <TH style={{ textAlign: 'right' }}>Advance @97%</TH>
                <TH>Advance #</TH>
                <TH style={{ width: 140 }}>Cheque #</TH>
                <TH>Conf #</TH>
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
                  <TD mono>
                    {inv.advance_number != null ? (
                      <span title="Show all invoices in this advance"
                        onClick={e => { e.stopPropagation(); setSearch(fmtAdv(inv.advance_number)) }}
                        style={{ color: C.primary, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
                        {fmtAdv(inv.advance_number)}
                      </span>
                    ) : '—'}
                  </TD>
                  <TD mono muted>
                    <div title={(chequesByInvoice[inv.id] || []).join(', ')} style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(chequesByInvoice[inv.id] || []).join(', ') || '—'}
                    </div>
                  </TD>
                  <TD mono muted>{inv.ryder_conf_number || '—'}</TD>
                  <TD>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Badge status={inv.status} label={adminStatus(inv.status)} />
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
                      { label: 'Cancel Invoice', danger: true, onClick: () => handleMarkStatus(inv, 'set_status', 'Cancelled') },
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
                  <td colSpan={5} />
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

      {statusAction && (
        <StatusActionModal
          inv={statusAction.inv}
          action={statusAction.action}
          onClose={() => setStatusAction(null)}
          onDone={fetchInvoices}
        />
      )}
    </div>
  )
}
