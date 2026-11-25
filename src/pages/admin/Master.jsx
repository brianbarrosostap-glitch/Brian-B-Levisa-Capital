import React, { useState, useEffect, useRef } from 'react'
import { Check, X, Upload } from 'lucide-react'
import { C, ROW_BG, adminStatus, ADMIN_STATUS_LABEL, FONT_MONO } from '../../tokens'
import { Card, Btn, Badge, Tabs, SearchBar, FilterChip, KebabMenu, TH, TD, Modal, ModalBody, ModalFooter, Pager, useIsMobile } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import InvoiceDetailModal from './InvoiceDetailModal'
import { usePersistentState } from '../../hooks/usePersistentState'
import { useDebounced } from '../../hooks/useDebounced'
import UploadDocumentModal from '../../components/UploadDocumentModal'
import { STATUS_GROUPS } from '../../lib/masterFilters'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtAdv = n => n == null ? '—' : 'ADV-' + String(n).padStart(4, '0')
// "ADV-12", "adv 0012", "ADV#12" → 12 (exact advance-number search)
const parseAdvQuery = q => { const m = q.trim().match(/^adv[\s\-#]*0*(\d+)$/i); return m ? Number(m[1]) : null }

// Void + Cancelled are one "Cancelled" bucket (both are dead invoices).
const DEAD = ['Void', 'Cancelled']
const ACTIVE_STATUSES = Object.keys(ADMIN_STATUS_LABEL).filter(s => !DEAD.includes(s))
const PAGE_SIZES = [25, 50, 100]
const INVOICE_COLS = 'id, invoice_number, po_number, unit_number, invoice_date, due_date, invoice_amount, advance_amount, status, batch_id, advance_number, resubmit_count, ryder_conf_number, client:clients(name)'

const Dash = () => <span style={{ color: C.borderMd }}>—</span>
const NOWRAP = { whiteSpace: 'nowrap' }
// Row-actions column stays pinned to the right edge when the table scrolls sideways.
const STICKY_RIGHT = { position: 'sticky', right: 0, zIndex: 1, boxShadow: '-8px 0 8px -8px rgba(16,24,40,0.12)' }

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
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
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
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14.5 }}>{inv.invoice_number}</span>
                <span style={{ fontSize: 13, color: C.textSm, marginLeft: 8 }}>Unit {inv.unit_number}</span>
              </div>
              <div style={{ fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.invoice_amount)}</div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>→ {fmt(inv.advance_amount)}</div>
            </div>
          )
        })}
        <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: '#f0faf5', border: '1px solid #b6e8d0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div style={{ textAlign: 'center', borderRight: `1px solid ${C.border}`, paddingRight: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Selected</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.textB }}>{active.length}</div>
          </div>
          <div style={{ textAlign: 'center', borderRight: `1px solid ${C.border}`, padding: '0 12px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Invoice Total</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.textB, fontVariantNumeric: 'tabular-nums' }}>{fmt(total)}</div>
          </div>
          <div style={{ textAlign: 'center', paddingLeft: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Advance @97%</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(adv)}</div>
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
              <div style={{ fontSize: 14.5, color: C.textSm, marginBottom: needsConf ? 16 : 0 }}>
                New status: <strong style={{ color: C.text }}>{label}</strong>
              </div>
              {needsConf && (
                <>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.textSm, marginBottom: 6 }}>
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
                      fontSize: 15.5, fontFamily: 'monospace', color: C.text, outline: 'none',
                    }}
                    onKeyDown={e => e.key === 'Enter' && goConfirm()}
                  />
                  {error && <div style={{ fontSize: 13, color: C.red, marginTop: 5 }}>{error}</div>}
                  <div style={{ fontSize: 12.5, color: C.textMut, marginTop: 6 }}>
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
              <div style={{ fontSize: 14.5, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>Are you sure?</div>
              <div style={{ fontSize: 14.5, color: C.textSm, lineHeight: 1.6 }}>
                This will move invoice <strong style={{ color: C.text, fontFamily: 'monospace' }}>{inv.invoice_number}</strong> to:
              </div>
              <div style={{ fontSize: 16.5, fontWeight: 800, color: C.primary, margin: '10px 0' }}>{label}</div>
              {needsConf && (
                <div style={{ fontSize: 14, color: C.textSm }}>
                  Conf #: <strong style={{ fontFamily: 'monospace', color: C.text }}>{confNumber}</strong>
                </div>
              )}
              <div style={{ fontSize: 12.5, color: C.textMut, marginTop: 8 }}>This action cannot be undone from the portal.</div>
            </div>
            {error && <div style={{ fontSize: 13, color: C.red, marginTop: 10 }}>{error}</div>}
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
  const [tab, setTab]           = usePersistentState('admin.master.tab', 'active')
  const [search, setSearch]     = usePersistentState('admin.master.search', '')
  const [statusFilter, setStatusFilter] = usePersistentState('admin.master.status', '')
  const [pageSize, setPageSize] = usePersistentState('admin.master.pageSize', 50)
  const [invoices, setInvoices] = useState([])          // the CURRENT PAGE only
  const [total, setTotal]       = useState(0)           // rows matching the filters in this tab
  const [counts, setCounts]     = useState({ active: 0, cancelled: 0 })        // filtered tab counts
  const [allCounts, setAllCounts] = useState(null)      // unfiltered tab counts (only fetched when filtering)
  const [advInfo, setAdvInfo]   = useState(null)        // { adv, count, invoiceTotal, advanceTotal } for an ADV search
  const [pendingBatches, setPendingBatches] = useState([])
  const [activeBatch, setActiveBatch] = useState(null)   // the batch being reviewed
  const [detailModal, setDetailModal] = useState(null)
  const [statusAction, setStatusAction] = useState(null) // { inv, action }
  const [loadError, setLoadError] = useState('')
  const [chequesByInvoice, setChequesByInvoice] = useState({})
  const [uploadOpen, setUploadOpen] = useState(false)
  const [clients, setClients]   = useState([])   // for the upload client picker

  const debouncedSearch = useDebounced(search, 300)
  const seqRef = useRef(0)

  // The page number belongs to the current filters: change any filter and
  // you're back on page 1 (no reset effect needed).
  const filterKey = JSON.stringify([tab, debouncedSearch, statusFilter, pageSize])
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 })
  const page = pageState.key === filterKey ? pageState.page : 1
  const setPage = (p) => setPageState({ key: filterKey, page: p })
  // Which request the rows on screen belong to. null = nothing loaded yet
  // (spinner); a different key = new page loading (old rows shown dimmed).
  const requestKey = `${filterKey}|${page}`
  const [loadedKey, setLoadedKey] = useState(null)
  const loading = loadedKey === null
  const stale = !loading && loadedKey !== requestKey

  const openUpload = async () => {
    setUploadOpen(true)
    if (clients.length) return
    const { data, error } = await supabase.from('clients').select('id, name').order('name')
    if (error) console.error('Master clients load failed:', error)
    if (data) setClients(data)
  }

  // Search text → server filter. "ADV-33" always means an advance; a bare
  // 1–4 digit number does too when that advance exists (invoice/PO numbers are
  // much longer). Otherwise match invoice #, PO, unit, or a cheque number.
  const resolveSearch = async (raw) => {
    const text = (raw || '').trim()
    if (!text) return { adv: null, or: null }
    let adv = parseAdvQuery(text)
    if (adv == null && /^\d{1,4}$/.test(text)) {
      const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('advance_number', Number(text))
      if (count) adv = Number(text)
    }
    if (adv != null) return { adv, or: null }

    const q = text.replace(/[,()"'\\*%]/g, ' ').trim()   // characters that would break an or=() filter
    if (!q) return { adv: null, or: null }
    const ors = [`invoice_number.ilike.*${q}*`, `po_number.ilike.*${q}*`, `unit_number.ilike.*${q}*`]
    // Cheque numbers live in `cheques` — find the invoices they pay.
    const { data: chq } = await supabase.from('cheques')
      .select('invoice_id, cheque_invoices(invoice_id)').ilike('check_number', `%${q}%`).limit(300)
    const ids = new Set()
    for (const c of chq || []) {
      if (c.invoice_id) ids.add(c.invoice_id)
      for (const ci of c.cheque_invoices || []) if (ci.invoice_id) ids.add(ci.invoice_id)
    }
    if (ids.size) ors.push(`id.in.(${[...ids].join(',')})`)
    return { adv: null, or: ors.join(',') }
  }

  // Apply tab + search + status to a query. An ADV search ignores the status
  // filter so its totals cover the WHOLE advance (the expected bank transfer).
  const applyFilters = (qb, tabKey, s, withStatus = true) => {
    qb = tabKey === 'active' ? qb.not('status', 'in', `(${DEAD.join(',')})`) : qb.in('status', DEAD)
    const ors = []
    if (s.adv != null) qb = qb.eq('advance_number', s.adv)
    else if (s.or) ors.push(s.or)
    if (withStatus && s.adv == null && statusFilter) {
      const group = STATUS_GROUPS[statusFilter]
      qb = group ? group(qb, ors) : qb.eq('status', statusFilter)
    }
    if (ors.length === 1) qb = qb.or(ors[0])
    else if (ors.length > 1) qb = qb.or(`and(${ors.map(o => `or(${o})`).join(',')})`)
    return qb
  }

  // Loads the current page. Rows already on screen stay until the new ones
  // arrive, so background refreshes (focus) never blank the table.
  const fetchInvoices = async () => {
    const seq = ++seqRef.current
    const key = requestKey
    {
      const s = await resolveSearch(debouncedSearch)
      if (seq !== seqRef.current) return
      const from = (page - 1) * pageSize
      const other = tab === 'active' ? 'cancelled' : 'active'
      const filtered = !!(s.adv != null || s.or || statusFilter)
      const none = { adv: null, or: null }
      const [rowsRes, otherRes, advRes, allA, allC] = await Promise.all([
        applyFilters(supabase.from('invoices').select(INVOICE_COLS, { count: 'exact' }), tab, s)
          .order('invoice_date', { ascending: false }).order('id').range(from, from + pageSize - 1),
        applyFilters(supabase.from('invoices').select('id', { count: 'exact', head: true }), other, s),
        s.adv != null ? applyFilters(supabase.from('invoices').select('invoice_amount, advance_amount'), tab, s) : null,
        filtered ? applyFilters(supabase.from('invoices').select('id', { count: 'exact', head: true }), 'active', none, false) : null,
        filtered ? applyFilters(supabase.from('invoices').select('id', { count: 'exact', head: true }), 'cancelled', none, false) : null,
      ])
      if (seq !== seqRef.current) return

      if (rowsRes.error) {
        // Page past the end (rows were removed elsewhere) → back to page 1.
        if (rowsRes.error.code === 'PGRST103' && page > 1) { setPage(1); return }
        console.error('Master fetchInvoices failed:', rowsRes.error)
        setLoadError('Could not load invoices — retrying when you come back to this tab.')
        return   // keep the rows already on screen
      }
      setLoadError('')
      const rows = rowsRes.data || []
      const count = rowsRes.count ?? rows.length
      if (!rows.length && page > 1 && count > 0) { setPage(Math.ceil(count / pageSize)); return }
      setInvoices(rows)
      setTotal(count)
      setCounts({ [tab]: count, [other]: otherRes.count ?? 0 })
      setAllCounts(filtered ? { active: allA?.count ?? 0, cancelled: allC?.count ?? 0 } : null)
      setAdvInfo(s.adv != null ? {
        adv: s.adv,
        count: (advRes?.data || []).length,
        invoiceTotal: (advRes?.data || []).reduce((t, i) => t + Number(i.invoice_amount), 0),
        advanceTotal: (advRes?.data || []).reduce((t, i) => t + Number(i.advance_amount), 0),
      } : null)
      setLoadedKey(key)
      fetchCheques(rows.map(r => r.id), seq)
    }
  }

  // invoice_id → [cheque numbers], for the invoices on this page only.
  // Links via cheques.invoice_id + cheque_invoices. Separate queries so a
  // cheque error can never blank the invoice table.
  const fetchCheques = async (ids, seq) => {
    if (!ids.length) { setChequesByInvoice({}); return }
    const [direct, viaJoin] = await Promise.all([
      supabase.from('cheques').select('check_number, invoice_id').in('invoice_id', ids),
      supabase.from('cheque_invoices').select('invoice_id, cheque:cheques(check_number)').in('invoice_id', ids),
    ])
    if (seq !== seqRef.current) return
    if (direct.error) console.error('Master cheques failed:', direct.error)
    if (viaJoin.error) console.error('Master cheque_invoices failed:', viaJoin.error)
    const map = {}
    const add = (id, n) => {
      if (!id || !n) return
      const list = (map[id] ||= [])
      if (!list.includes(n)) list.push(n)   // de-dupe re-ingested cheques
    }
    for (const c of direct.data || []) add(c.invoice_id, c.check_number)
    for (const ci of viaJoin.data || []) add(ci.invoice_id, ci.cheque?.check_number)
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

  // Load the page whenever the filters or the page change.
  useEffect(() => { fetchInvoices() }, [requestKey])   // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the list in sync with changes made elsewhere (customer submits,
  // email/automation, etc.) — background refresh when the window regains focus.
  const fetchRef = useRef(fetchInvoices)
  useEffect(() => { fetchRef.current = fetchInvoices })
  useEffect(() => {
    fetchPendingBatch()
    const refresh = () => { fetchRef.current(); fetchPendingBatch() }
    const onVis = () => { if (!document.hidden) refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const list = invoices
  const pages = Math.max(1, Math.ceil(total / pageSize))

  // Footer totals = the rows on this page (whole result when it fits on one page).
  const listTotalInvoice = list.reduce((s, i) => s + Number(i.invoice_amount), 0)
  const listTotalAdvance = list.reduce((s, i) => s + Number(i.advance_amount), 0)
  const statuses = tab === 'active' ? ACTIVE_STATUSES : DEAD

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
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search invoice #, PO, unit, cheque #, or advance # (e.g. 33)…" value={search} onChange={setSearch} />
          <FilterChip label="Status" options={statuses} value={statusFilter} onChange={setStatusFilter} />
          {(search || statusFilter) && (
            <button type="button" onClick={() => { setSearch(''); setStatusFilter('') }}
              title="Clear search and filters" className="lc-focus"
              onMouseEnter={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = C.redLt; e.currentTarget.style.color = C.red }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, height: 36, boxSizing: 'border-box', padding: '0 12px',
                borderRadius: 8, border: `1px solid ${C.red}`, background: C.redLt, color: C.red,
                fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif', transition: 'background .15s, color .15s',
              }}>
              <X size={13} strokeWidth={2.5} /> Clear filters
            </button>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <Btn onClick={openUpload}><Upload size={13} /> Upload invoice</Btn>
          </div>
        </div>
        {advInfo && (
          /* ── Advance summary — reconcile against the bank transfer ── */
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: '#f0faf5', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advance</div>
              <div style={{ fontSize: 17.5, fontWeight: 800, fontFamily: FONT_MONO, color: C.text }}>{fmtAdv(advInfo.adv)}</div>
            </div>
            {advInfo.count === 0 ? (
              <div style={{ fontSize: 14.5, color: C.textMut }}>No invoices found for this advance{tab === 'cancelled' ? ' in Cancelled' : ''}.</div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoices</div>
                  <div style={{ fontSize: 17.5, fontWeight: 800, color: C.text }}>{advInfo.count}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoice Total</div>
                  <div style={{ fontSize: 17.5, fontWeight: 800, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmt(advInfo.invoiceTotal)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advance Total (RZR) — expected transfer</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.primary, fontVariantNumeric: 'tabular-nums' }}>{fmt(advInfo.advanceTotal)}</div>
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'active',    label: 'Active',    count: counts.active },
            { key: 'cancelled', label: 'Cancelled', count: counts.cancelled },
          ]} />
          {allCounts && (
            <span style={{ fontSize: 13, color: C.textMut }}>
              filtered — of {allCounts.active} active · {allCounts.cancelled} cancelled
            </span>
          )}
        </div>
        {loadError && (
          <div style={{ padding: '8px 16px', background: C.redLt, color: C.red, fontSize: 14, borderBottom: `1px solid ${C.border}` }}>{loadError}</div>
        )}

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 14.5, color: C.textMut }}>Loading invoices…</div>
        ) : isMobile ? (
          /* ── Mobile: stacked cards so no column is hidden ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, opacity: stale ? 0.55 : 1 }} aria-busy={stale}>
            {list.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 14.5, color: C.textMut }}>No invoices.</div>
            )}
            {list.map(inv => (
              <div key={inv.id} onClick={() => setDetailModal(inv)} style={{
                border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px',
                background: ROW_BG[inv.status] || '#fff', cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15.5 }}>{inv.invoice_number}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {inv.resubmit_count > 0 && (
                      <span style={{ background: inv.resubmit_count >= 3 ? C.redLt : '#fef3c7', color: inv.resubmit_count >= 3 ? C.red : '#92400e', borderRadius: 9999, fontSize: 11, fontWeight: 700, padding: '1px 7px' }}>↻ {inv.resubmit_count}×</span>
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
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 14 }}>
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
              <div style={{ borderTop: `2px solid ${C.primary}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 14.5, fontWeight: 700, color: C.primary }}>
                <span>{pages > 1 ? `Page total (${list.length} of ${total})` : `Total (${list.length})`}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(listTotalInvoice)} · {fmt(listTotalAdvance)}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', opacity: stale ? 0.55 : 1, transition: 'opacity .15s' }} aria-busy={stale}>
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
                <TH style={{ width: 120 }}>Cheque #</TH>
                <TH>Conf #</TH>
                <TH>Status</TH>
                <TH style={{ width: 42, ...STICKY_RIGHT, background: C.panel }} />
              </tr>
            </thead>
            <tbody>
              {list.map(inv => (
                <tr key={inv.id} className="lc-trow"
                  style={{ background: ROW_BG[inv.status] || '#fff', cursor: 'pointer' }}
                  onClick={() => setDetailModal(inv)}
                >
                  <TD muted style={NOWRAP}>{new Date(inv.invoice_date).toLocaleDateString()}</TD>
                  <TD mono style={{ ...NOWRAP, fontWeight: 600, color: C.textB }}>{inv.invoice_number}</TD>
                  <TD mono muted style={NOWRAP}>{inv.po_number || <Dash />}</TD>
                  <TD muted style={NOWRAP}>{inv.unit_number || <Dash />}</TD>
                  <TD style={{ ...NOWRAP, textAlign: 'right', fontWeight: 500 }}>{fmt(inv.invoice_amount)}</TD>
                  <TD accent style={{ ...NOWRAP, textAlign: 'right', fontWeight: 700 }}>{fmt(inv.advance_amount)}</TD>
                  <TD mono style={NOWRAP}>
                    {inv.advance_number != null ? (
                      <button type="button" title="Show all invoices in this advance" className="lc-link lc-focus"
                        onClick={e => { e.stopPropagation(); setSearch(fmtAdv(inv.advance_number)) }}
                        style={{
                          padding: 0, border: 'none', background: 'none', font: 'inherit', fontWeight: 700,
                          color: C.primary, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3,
                        }}>
                        {fmtAdv(inv.advance_number)}
                      </button>
                    ) : <Dash />}
                  </TD>
                  <TD mono muted>
                    <div title={(chequesByInvoice[inv.id] || []).join(', ')} style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(chequesByInvoice[inv.id] || []).join(', ') || <Dash />}
                    </div>
                  </TD>
                  <TD mono muted style={NOWRAP}>{inv.ryder_conf_number || <Dash />}</TD>
                  <TD style={NOWRAP}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Badge status={inv.status} label={adminStatus(inv.status)} />
                      {inv.resubmit_count > 0 && (
                        <span title={`Re-sent to Ryder ${inv.resubmit_count} time(s)`} style={{
                          background: inv.resubmit_count >= 3 ? C.redLt : '#fef3c7', color: inv.resubmit_count >= 3 ? C.red : '#92400e',
                          boxShadow: `inset 0 0 0 1px ${inv.resubmit_count >= 3 ? '#dc26261f' : '#92400e1f'}`,
                          height: 22, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', gap: 3,
                          borderRadius: 9999, fontSize: 12, fontWeight: 700, padding: '0 8px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                        }}>↻ {inv.resubmit_count}×</span>
                      )}
                    </div>
                  </TD>
                  <TD style={{ padding: '0 12px 0 6px', width: 42, ...STICKY_RIGHT, background: 'inherit' }} onClick={e => e.stopPropagation()}>
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
              {list.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: '36px 16px', textAlign: 'center', fontSize: 14.5, color: C.textMut }}>
                    {search || statusFilter ? 'No invoices match these filters.' : 'No invoices.'}
                  </td>
                </tr>
              )}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f0faf5', borderTop: `2px solid ${C.primary}` }}>
                  {/* Same side padding as the body cells (12px) so totals sit under their columns */}
                  <td colSpan={4} style={{ padding: '12px 12px', fontSize: 12, fontWeight: 700, color: C.primary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {pages > 1 ? `Page total (${list.length} of ${total})` : `Total (${list.length} shown)`}
                  </td>
                  <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 15, fontWeight: 700, color: C.primary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(listTotalInvoice)}</td>
                  <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 15, fontWeight: 700, color: C.primary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(listTotalAdvance)}</td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        )}
        {!loading && total > 0 && (
          <Pager page={page} pages={pages} pageSize={pageSize} total={total} rowsShown={list.length}
            onPage={setPage} onPageSize={setPageSize} sizes={PAGE_SIZES} compact={isMobile} />
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

      {uploadOpen && (
        <UploadDocumentModal kind="invoice" role="admin" clients={clients}
          onClose={() => setUploadOpen(false)}
          onDone={() => fetchInvoices()} />
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
