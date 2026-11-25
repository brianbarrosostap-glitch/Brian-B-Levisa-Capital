import React, { useState, useEffect, useRef } from 'react'
import { Check, Landmark, Banknote, ChevronDown, ChevronUp, MailWarning, Upload } from 'lucide-react'
import { C, R, shadow, FONT_MONO } from '../../tokens'
import { useIsMobile, PartyTag } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'
import InvoiceDetailModal from './InvoiceDetailModal'
import { usePersistentState } from '../../hooks/usePersistentState'
import FileLink from '../../components/FileLink'
import UploadDocumentModal from '../../components/UploadDocumentModal'
import { hasFile, invoiceFileRef, chequeFileRef } from '../../lib/files'

const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtAdv = n => 'ADV-' + String(n).padStart(4, '0')
const fmtDate = d => d ? new Date(d).toLocaleDateString() : '—'

// "No Ryder confirmation" rule — an invoice still waiting on Ryder is
// flagged once n8n has resent it this many times OR it has waited this long.
// (n8n resends every 48h and increments invoices.resubmit_count.)
const UNCONF_MIN_ATTEMPTS = 3
const UNCONF_MIN_DAYS     = 7
// 'Advance Paid' = RZR was paid but the invoice was never marked sent to Ryder
// (no ryder_submitted_at) — it can sit unnoticed, so it counts as waiting too.
const AWAITING_RYDER      = ['Advance Paid', 'Submitted to Ryder', 'Resubmitted']
const daysSince = d => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null

// One item per physical cheque: merge cheque to-dos sharing a check_number.
// (The DB already does this after migration 20261014000001 — this is a
// safety net so duplicates never show, e.g. before that migration runs.)
// n8n repeats the full cheque amount on each row, so the amount is taken once.
function groupCheques(todos) {
  const out = []
  const byNumber = new Map()
  for (const t of todos) {
    if (t.kind !== 'cheque' || !t.check_number) { out.push(t); continue }
    const g = byNumber.get(t.check_number)
    if (!g) {
      const item = { ...t, members: [t] }
      byNumber.set(t.check_number, item)
      out.push(item)
      continue
    }
    g.members.push(t)
    g.done = g.members.every(m => m.done)
    g.cheque_amount = Math.max(Number(g.cheque_amount || 0), Number(t.cheque_amount || 0)) || g.cheque_amount
    const nums = new Set(g.members.flatMap(m => (m.cheque_invoice_numbers || '').split(', ').filter(Boolean)))
    g.cheque_invoice_numbers = [...nums].join(', ')
    if (!t.cheque_lines) g.cheque_line_count = Math.max(g.cheque_line_count || 0, nums.size)
  }
  return out
}

// Invoices a cheque pays → [{ n, amt? }]. Uses the per-invoice lines
// ("22156749: $1,234.56, …") when the view provides them, else bare numbers.
function chequeInvoices(todo) {
  if (todo.cheque_lines) {
    return todo.cheque_lines.split(', ').map(l => {
      const [n, amt] = l.split(': ')
      return { n, amt }
    })
  }
  return (todo.cheque_invoice_numbers || '').split(', ').filter(Boolean).map(n => ({ n }))
}

// v_audit_todos only exposes the Drive link; the Storage path (portal
// uploads) is merged in by load() as `cheque_storage_path`.
const chequeTodoFileRef = (todo) => chequeFileRef({ storage_path: todo.cheque_storage_path, drive_file_url: todo.cheque_drive_url })

const metaText = { fontSize: 12.5, color: C.textSm, whiteSpace: 'nowrap', lineHeight: 1.5 }
const Dot = () => <span aria-hidden style={{ color: C.borderMd, fontSize: 11 }}>•</span>

// Invoice number that opens the invoice detail modal.
const InvLink = ({ n, onOpen, style }) => (
  <button type="button" onClick={() => onOpen({ number: n })} title="Open invoice"
    className="lc-link lc-focus"
    style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT_MONO, fontWeight: 600,
      color: C.primary, textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 'inherit', ...style }}>
    {n}
  </button>
)

// ADV number → opens Master filtered to that advance (with its totals summary).
const AdvLink = ({ n, onOpenMaster, style, children }) => onOpenMaster ? (
  <button type="button" title="Open this advance in Master" className="lc-link lc-focus"
    onClick={() => onOpenMaster({ tab: 'active', search: fmtAdv(n), status: '' })}
    style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', font: 'inherit',
      color: C.primary, textDecoration: 'underline', textUnderlineOffset: 3, ...style }}>
    {children ?? fmtAdv(n)}
  </button>
) : <span style={style}>{children ?? fmtAdv(n)}</span>

/* ── One checkable row ── */
function TodoRow({ todo, selected, busy, onSelect, onOpenInvoice, onOpenMaster }) {
  const [open, setOpen] = useState(false)
  const isCheque  = todo.kind === 'cheque'
  const isUnconf  = todo.kind === 'unconfirmed'
  const title     = isUnconf ? `Inv ${todo.invoice_number}`
    : isCheque ? `Cheque #${todo.check_number || '(unreadable)'}` : fmtAdv(todo.advance_number)
  const amount    = isUnconf ? todo.invoice_amount : isCheque ? todo.cheque_amount : todo.advance_total
  const compareTo = isCheque ? 'bank deposit' : 'bank transfer to RZR'

  const invoices = isCheque ? chequeInvoices(todo) : []
  const hasTotal = isCheque && todo.cheque_lines && todo.cheque_invoice_total != null
  const mismatch = hasTotal && todo.cheque_amount != null
    && Math.abs(Number(todo.cheque_amount) - Number(todo.cheque_invoice_total)) >= 0.01

  return (
    <div className={`lc-row${selected ? ' is-sel' : ''}`} style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
      borderBottom: `1px solid ${C.borderLt}`, opacity: busy ? 0.6 : 1,
      background: selected ? '#f0faf5' : todo.done ? '#fafbfc' : '#fff',
      boxShadow: selected ? `inset 3px 0 0 ${C.primary}` : 'none',
    }}>
      {/* Checkbox only SELECTS — nothing is saved until "Submit" in the action bar */}
      <button type="button" onClick={() => onSelect(todo)} disabled={busy}
        title={selected ? 'Unselect' : todo.done ? 'Select to re-open' : isUnconf ? 'Select as investigated' : `Select — verified against ${compareTo}`}
        className="lc-focus" aria-pressed={selected}
        style={{
          width: 18, height: 18, marginTop: 1, borderRadius: 5, flexShrink: 0, padding: 0, boxSizing: 'border-box',
          border: `1.5px solid ${selected ? C.primary : C.borderMd}`,
          background: selected ? C.primary : '#fff', cursor: busy ? 'wait' : 'pointer',
          boxShadow: selected ? '0 1px 2px rgba(0,87,65,0.25)' : '0 1px 1px rgba(16,24,40,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .12s, border-color .12s',
        }}>
        {selected && <Check size={11} color="#fff" strokeWidth={3.2} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Line 1 — identifier + amount */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 20 }}>
          {isUnconf ? (
            <button type="button" onClick={() => onOpenInvoice({ id: todo.invoice_id })} title="Open invoice"
              className={todo.done ? 'lc-focus' : 'lc-link lc-focus'} style={{
              padding: 0, border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: FONT_MONO, fontWeight: 700, fontSize: 14.5, color: C.primary,
              textDecoration: todo.done ? 'line-through' : 'underline', textUnderlineOffset: 3,
            }}>{title}</button>
          ) : (
            !isCheque && todo.advance_number != null && onOpenMaster ? (
              <AdvLink n={todo.advance_number} onOpenMaster={onOpenMaster} style={{
                fontFamily: FONT_MONO, fontWeight: 700, fontSize: 14.5,
                textDecoration: todo.done ? 'line-through' : 'underline',
              }} />
            ) : (
              <span style={{
                fontFamily: FONT_MONO, fontWeight: 700, fontSize: 14.5, color: C.textB,
                textDecoration: todo.done ? 'line-through' : 'none',
              }}>{title}</span>
            )
          )}
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em', color: todo.done ? C.textMut : C.primary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fmt(amount)}
          </span>
        </div>

        {/* Line 2 — compact meta */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3px 7px', marginTop: 5 }}>
          {isUnconf ? (
            <>
              <span style={metaText}>
                {todo.status === 'Advance Paid' ? 'Advance paid' : 'Sent'} {todo.waited_days != null ? `${todo.waited_days} days ago` : '—'}
              </span>
              {todo.status === 'Advance Paid' && <><Dot /><span style={{ ...metaText, color: C.red, fontWeight: 600 }}>Not sent to Ryder</span></>}
              <Dot />
              <span style={{ ...metaText, color: todo.resubmit_count >= UNCONF_MIN_ATTEMPTS ? C.red : C.textSm, fontWeight: 600 }}>
                Resent {todo.resubmit_count || 0}×
              </span>
              {todo.po_number && <><Dot /><span style={metaText}>PO <span style={{ fontFamily: FONT_MONO, color: C.text }}>{todo.po_number}</span></span></>}
              {todo.advance_number != null && <><Dot /><span style={metaText}><AdvLink n={todo.advance_number} onOpenMaster={onOpenMaster} style={{ fontWeight: 600 }} /></span></>}
              {hasFile(invoiceFileRef(todo)) && (
                <>
                  <Dot />
                  <FileLink variant="text" fileRef={invoiceFileRef(todo)} label="View invoice" />
                </>
              )}
            </>
          ) : isCheque ? (
            <>
              <span style={metaText}>Received {fmtDate(todo.cheque_received_at)}</span>
              <Dot />
              {invoices.length === 0 ? (
                <span style={{ ...metaText, color: C.amber, fontWeight: 600 }}>No invoice matched</span>
              ) : invoices.length === 1 ? (
                <span style={metaText}>Inv <InvLink n={invoices[0].n} onOpen={onOpenInvoice} /></span>
              ) : (
                <button type="button" onClick={() => setOpen(o => !o)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px',
                  borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${mismatch ? C.red : C.border}`,
                  background: mismatch ? C.redLt : '#f1f5f9', color: mismatch ? C.red : C.textSm,
                }}>
                  {mismatch && '⚠ '}{invoices.length} invoices
                  {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              {hasFile(chequeTodoFileRef(todo)) && (
                <>
                  <Dot />
                  <FileLink variant="text" fileRef={chequeTodoFileRef(todo)} label="View cheque" />
                </>
              )}
            </>
          ) : (
            <>
              <span style={metaText}>
                <AdvLink n={todo.advance_number} onOpenMaster={onOpenMaster} style={{ fontWeight: 600 }}>
                  {todo.advance_invoice_count || 0} invoice{todo.advance_invoice_count === 1 ? '' : 's'}
                </AdvLink>
              </span>
              {todo.advance_client_name && <><Dot /><span style={metaText}>{todo.advance_client_name}</span></>}
              <Dot />
              {todo.advance_paid_count > 0
                ? <span style={metaText}>Paid {fmtDate(todo.advance_paid_at)}</span>
                : <span style={{ ...metaText, color: C.amber, fontWeight: 600 }}>Not marked paid yet</span>}
            </>
          )}
        </div>

        {/* Expanded invoice list (multi-invoice cheques) */}
        {open && invoices.length > 1 && (
          <div style={{ marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 8, background: '#f8fafb', overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '2px 14px', padding: '8px 10px', maxHeight: 150, overflowY: 'auto',
            }}>
              {invoices.map(({ n, amt }) => (
                <div key={n} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12.5, padding: '2px 0' }}>
                  <InvLink n={n} onOpen={onOpenInvoice} />
                  {amt && <span style={{ color: C.textSm, fontVariantNumeric: 'tabular-nums' }}>{amt}</span>}
                </div>
              ))}
            </div>
            {hasTotal && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', padding: '6px 10px', fontSize: 12.5, fontWeight: 700,
                borderTop: `1px solid ${C.border}`, background: mismatch ? C.redLt : '#f0faf5', color: mismatch ? C.red : C.primary,
              }}>
                <span>Invoices total {mismatch ? '— differs from cheque' : '✓ matches cheque'}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(todo.cheque_invoice_total)}</span>
              </div>
            )}
          </div>
        )}

        {todo.done && (
          <div style={{ fontSize: 12, color: C.primary, marginTop: 4, fontWeight: 600 }}>
            ✓ {isUnconf ? 'Investigated' : 'Verified'} {fmtDate(todo.done_at)}{todo.done_by_name ? ` by ${todo.done_by_name}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── One column (cheques / advances / unconfirmed) ── */
function TodoColumn({ icon: Icon, title, party, hint, items, selected, busy, onSelect, onSelectAll, onOpenInvoice, onOpenMaster, emptyText, action }) {
  const allOn  = items.length > 0 && items.every(t => selected.has(t.id))
  const someOn = !allOn && items.some(t => selected.has(t.id))
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: R.lg - 2, overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46, padding: '8px 12px', background: C.panel, borderBottom: `1px solid ${C.borderLt}` }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: C.primLt, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={14} color={C.primary} strokeWidth={2} />
        </span>
        <span title={title} style={{ fontSize: 14.5, fontWeight: 600, color: C.textB, lineHeight: 1.3, minWidth: 0 }}>{title}</span>
        <PartyTag party={party} />
        {action && <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{action}</span>}
        <span style={{
          marginLeft: action ? 0 : 'auto', minWidth: 22, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 9999,
          background: items.length ? '#fff' : 'transparent', border: `1px solid ${items.length ? C.border : 'transparent'}`,
          fontSize: 12, fontWeight: 700, color: C.textSm, fontVariantNumeric: 'tabular-nums',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{items.length}</span>
        {items.length > 0 && (
          <button type="button" onClick={() => onSelectAll(items, !allOn)} disabled={busy}
            title={allOn ? 'Unselect all' : 'Select all in this column'}
            className="lc-icon-btn lc-focus"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 9px', borderRadius: R.sm,
              border: `1px solid ${allOn || someOn ? C.primary : C.border}`, background: allOn || someOn ? C.primLt : '#fff',
              color: allOn || someOn ? C.primary : C.textSm, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}>
            {allOn ? <Check size={11} strokeWidth={3} /> : someOn ? '–' : null} All
          </button>
        )}
      </div>
      {hint && (
        <div style={{ padding: '7px 14px', fontSize: 12.5, color: C.textMut, borderBottom: `1px solid ${C.borderLt}`, lineHeight: 1.4 }}>{hint}</div>
      )}
      <div style={{ maxHeight: 330, overflowY: 'auto', flex: 1 }}>
        {items.length === 0
          ? <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 14, color: C.textMut }}>{emptyText}</div>
          : items.map(t => <TodoRow key={t.id} todo={t} selected={selected.has(t.id)} busy={busy} onSelect={onSelect} onOpenInvoice={onOpenInvoice} onOpenMaster={onOpenMaster} />)}
      </div>
    </div>
  )
}

export default function AuditTodos({ onOpenMaster }) {
  const isMobile = useIsMobile()
  const [todos, setTodos]   = useState([])
  const [unconfirmed, setUnconfirmed] = useState([])
  const [view, setView]     = usePersistentState('admin.todos.view', 'open')   // 'open' | 'done'
  const [error, setError]   = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  // Ticking a box only SELECTS it (display id). Nothing is saved until the
  // admin presses Submit in the action bar — then all selected items are
  // saved together and move out of the to-do list.
  const [selected, setSelected]     = useState(() => new Set())
  const [openInv, setOpenInv]       = useState(null)   // { id } for InvoiceDetailModal
  const [submitting, setSubmitting] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)   // "Upload cheques" from the cheque column
  const submittingRef = useRef(false)   // read by the focus listener (state would be a stale closure)
  const loadSeq = useRef(0)

  const changeView = (v) => { setView(v); setSelected(new Set()); setNotice('') }

  const load = async () => {
    const seq = ++loadSeq.current
    const { data, error } = await supabase
      .from('v_audit_todos')
      .select('*')
      .order('created_at', { ascending: false })
    if (seq !== loadSeq.current) return   // a newer reload started — drop stale result
    if (error) {
      console.error('v_audit_todos:', error)
      setError(error.code === '42P01' || error.code === 'PGRST205'
        ? 'Audit to-dos not set up yet — run migration 20261013000002_audit_todos.sql.'
        : 'Could not load audit to-dos.')
    } else {
      // Storage paths for uploaded cheques (view predates cheques.storage_path).
      let pathById = {}
      if ((data || []).some(t => t.kind === 'cheque')) {
        const { data: paths } = await supabase.from('cheques').select('id, storage_path').not('storage_path', 'is', null)
        pathById = Object.fromEntries((paths || []).map(p => [p.id, p.storage_path]))
      }
      if (seq !== loadSeq.current) return
      setTodos((data || []).map(t => (pathById[t.cheque_id] ? { ...t, cheque_storage_path: pathById[t.cheque_id] } : t)))
      setError(e => (e.startsWith('Could not load') || e.startsWith('Audit to-dos not set up') ? '' : e))
    }
    await loadUnconfirmed(seq)
    setLoading(false)
  }

  // Invoices still waiting on Ryder past the attempt/day threshold — live,
  // so they vanish the moment Ryder's confirmation arrives. Ticks ("investigated")
  // live in audit_todos (kind='unconfirmed'); missing table → just no ticks yet.
  const loadUnconfirmed = async (seq) => {
    const [{ data: invs, error: invErr }, { data: ticks }] = await Promise.all([
      supabase.from('invoices')
        .select('id, invoice_number, po_number, invoice_amount, status, advance_number, resubmit_count, ryder_submitted_at, advance_paid_at, last_resubmitted_at, created_at, drive_file_url, storage_path, pdf_path')
        .in('status', AWAITING_RYDER)
        .is('ryder_confirmed_at', null),
      supabase.from('audit_todos')
        .select('id, invoice_id, done, done_at, done_by_profile:profiles(full_name)')
        .eq('kind', 'unconfirmed'),
    ])
    if (seq !== loadSeq.current) return
    if (invErr) { console.error('unconfirmed invoices:', invErr); return }
    const tickBy = Object.fromEntries((ticks || []).map(t => [t.invoice_id, t]))
    setUnconfirmed((invs || [])
      .map(i => ({ ...i, waited_days: daysSince(i.ryder_submitted_at || i.advance_paid_at || i.created_at) }))
      .filter(i => (i.resubmit_count || 0) >= UNCONF_MIN_ATTEMPTS || (i.waited_days ?? 0) >= UNCONF_MIN_DAYS)
      .sort((a, b) => (b.waited_days ?? 0) - (a.waited_days ?? 0))
      .map(i => {
        const t = tickBy[i.id]
        return {
          ...i, kind: 'unconfirmed', invoice_id: i.id, id: `unconf-${i.id}`,
          done: !!t?.done, done_at: t?.done_at, done_by_name: t?.done_by_profile?.full_name,
        }
      }))
  }

  useEffect(() => {
    load()
    const onFocus = () => { if (!submittingRef.current) load() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const items    = [...groupCheques(todos.filter(t => t.kind === 'cheque' || t.kind === 'advance')), ...unconfirmed]
  const shown    = items.filter(t => (view === 'done') === t.done)
  const cheques  = shown.filter(t => t.kind === 'cheque')
  const advances = shown.filter(t => t.kind === 'advance')
  const unconf   = shown.filter(t => t.kind === 'unconfirmed')
  const openCount = items.filter(t => !t.done).length
  const doneCount = items.length - openCount

  // Only count selections still visible (an item may have changed elsewhere).
  const selectedItems = shown.filter(t => selected.has(t.id))

  const toggleSelect = (todo) => setSelected(prev => {
    const next = new Set(prev)
    next.has(todo.id) ? next.delete(todo.id) : next.add(todo.id)
    return next
  })
  const selectAll = (list, on) => setSelected(prev => {
    const next = new Set(prev)
    list.forEach(t => (on ? next.add(t.id) : next.delete(t.id)))
    return next
  })

  // Save every selected item in one go. "To verify" tab → mark done;
  // "Verified" tab → re-open. A grouped cheque flips all its underlying to-dos.
  const submit = async () => {
    if (!selectedItems.length) return
    const target = view === 'open'
    setSubmitting(true); submittingRef.current = true; setError(''); setNotice('')
    const results = await Promise.allSettled(selectedItems.map(todo =>
      todo.kind === 'unconfirmed'
        ? callFunction('toggle-audit-todo', { invoice_id: todo.invoice_id, done: target })
        : Promise.all((todo.members || [todo])
            .filter(m => m.done !== target)
            .map(m => callFunction('toggle-audit-todo', { todo_id: m.id, done: target })))
    ))
    const failed = selectedItems.filter((_, i) => results[i].status === 'rejected')
    results.forEach(r => r.status === 'rejected' && console.error(r.reason))
    await load()
    const ok = selectedItems.length - failed.length
    setSelected(new Set(failed.map(t => t.id)))     // keep only the failures selected to retry
    if (ok) setNotice(`${ok} item${ok === 1 ? '' : 's'} ${target ? 'marked as verified — moved to Verified' : 're-opened — moved back to To verify'}.`)
    if (failed.length) setError(`${failed.length} item${failed.length === 1 ? '' : 's'} could not be saved — still selected, press Submit to retry.`)
    setSubmitting(false); submittingRef.current = false
  }

  const tabBtn = (key, label, count) => {
    const on = view === key
    return (
      <button type="button" onClick={() => changeView(key)} disabled={submitting} aria-pressed={on}
        className={`lc-seg lc-focus${on ? ' is-on' : ''}`} style={{
        height: 28, padding: '0 10px 0 12px', borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        border: 'none', background: on ? C.primary : 'transparent', whiteSpace: 'nowrap',
        color: on ? '#fff' : C.textSm, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
        boxShadow: on ? '0 1px 2px rgba(0,87,65,0.30), inset 0 1px 0 rgba(255,255,255,0.12)' : 'none',
      }}>
        {label}
        <span style={{
          minWidth: 20, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 9999,
          background: on ? 'rgba(255,255,255,0.22)' : '#e2e8f0', color: on ? '#fff' : C.textSm,
          fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{count}</span>
      </button>
    )
  }

  const n = selectedItems.length
  // Cheque lines only carry the invoice NUMBER — look up its id to open the modal.
  const openInvoice = async ({ id, number }) => {
    if (!id) {
      const { data } = await supabase.from('invoices').select('id').eq('invoice_number', number).limit(1).maybeSingle()
      id = data?.id
    }
    if (id) setOpenInv({ id })
  }

  const colProps = { selected, busy: submitting, onSelect: toggleSelect, onSelectAll: selectAll, onOpenInvoice: openInvoice, onOpenMaster }

  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: R.lg,
      boxShadow: shadow, padding: isMobile ? 12 : '16px 18px 18px', marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px 10px', flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.textB, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Audit To-Do</span>
        <span style={{ fontSize: 13, color: C.textMut }}>
          {view === 'open' ? 'select the items you have checked, then press Submit' : 'select items to re-open, then press Submit'}
        </span>
        <div style={{
          marginLeft: 'auto', display: 'flex', gap: 2, padding: 3, borderRadius: 10,
          background: '#f1f5f9', border: `1px solid ${C.borderLt}`,
        }}>
          {tabBtn('open', 'To verify', openCount)}
          {tabBtn('done', 'Verified', doneCount)}
        </div>
      </div>

      {error && (
        <div style={{ background: C.redLt, color: C.red, borderRadius: 8, padding: '8px 12px', fontSize: 14, marginBottom: 10 }}>{error}</div>
      )}
      {notice && !error && (
        <div style={{ background: '#f0faf5', color: C.primary, border: '1px solid #b6e8d0', borderRadius: 8, padding: '8px 12px', fontSize: 14, fontWeight: 600, marginBottom: 10 }}>✓ {notice}</div>
      )}

      {loading ? (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 14, color: C.textMut }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
          <TodoColumn icon={Landmark} title="Cheques → bank deposit" party="Ryder" items={cheques} {...colProps}
            action={
              <button type="button" onClick={() => setUploadOpen(true)} title="Upload cheques — invoices are matched and marked Paid automatically"
                className="lc-btn lc-btn-subtle lc-focus" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px', borderRadius: 7,
                  border: 'none', background: C.primLt, color: C.primary, fontSize: 12.5, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}><Upload size={13} /> Upload</button>
            }
            hint="match each cheque against the bank deposit"
            emptyText={view === 'open' ? 'All cheques verified.' : 'No verified cheques yet.'} />
          <TodoColumn icon={Banknote} title="Advances → bank transfer" party="RZR" items={advances} {...colProps}
            hint="match each advance against the bank transfer to RZR"
            emptyText={view === 'open' ? 'All advances verified.' : 'No verified advances yet.'} />
          <TodoColumn icon={MailWarning} title="Ryder — no confirmation" party="Ryder" items={unconf} {...colProps}
            hint={`resent ${UNCONF_MIN_ATTEMPTS}+ times or waiting ${UNCONF_MIN_DAYS}+ days — investigate`}
            emptyText={view === 'open' ? 'Every invoice sent to Ryder has been confirmed.' : 'Nothing investigated yet.'} />
        </div>
      )}

      {/* ── Action bar — appears once something is selected ── */}
      {n > 0 && (
        <div style={{
          position: 'sticky', bottom: 12, zIndex: 5, marginTop: 12,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: isMobile ? '10px 12px' : '10px 16px', borderRadius: 10,
          background: C.sidebar, color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
          <span style={{
            minWidth: 24, height: 24, padding: '0 7px', borderRadius: 9999, background: C.primary,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800,
          }}>{n}</span>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>
            selected {view === 'open' ? '— ready to mark as verified' : '— will be re-opened'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, width: isMobile ? '100%' : 'auto' }}>
            <button type="button" onClick={() => setSelected(new Set())} disabled={submitting} style={{
              flex: isMobile ? 1 : undefined, height: 34, padding: '0 14px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.35)', background: 'transparent', color: '#fff',
              fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Clear</button>
            <button type="button" onClick={submit} disabled={submitting} style={{
              flex: isMobile ? 2 : undefined, height: 34, padding: '0 18px', borderRadius: 8, border: 'none',
              background: '#fff', color: C.primary, fontSize: 14.5, fontWeight: 800,
              cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: submitting ? 0.7 : 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Check size={14} strokeWidth={3} />
              {submitting ? 'Submitting…' : view === 'open' ? `Submit ${n} as verified` : `Re-open ${n}`}
            </button>
          </div>
        </div>
      )}
      {uploadOpen && (
        <UploadDocumentModal kind="cheque" role="admin" onClose={() => setUploadOpen(false)} onDone={() => load()} />
      )}
      {openInv && <InvoiceDetailModal invoice={openInv} onClose={() => setOpenInv(null)} onRefresh={load} />}
    </div>
  )
}
