import React, { useState, useEffect, useRef } from 'react'
import { Check, ExternalLink, Landmark, Banknote, ChevronDown, ChevronUp, MailWarning } from 'lucide-react'
import { C } from '../../tokens'
import { useIsMobile } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'

const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtAdv = n => 'ADV-' + String(n).padStart(4, '0')
const fmtDate = d => d ? new Date(d).toLocaleDateString() : '—'

// "No Ryder confirmation" rule — an invoice still waiting on Ryder is
// flagged once n8n has resent it this many times OR it has waited this long.
// (n8n resends every 48h and increments invoices.resubmit_count.)
const UNCONF_MIN_ATTEMPTS = 3
const UNCONF_MIN_DAYS     = 7
const AWAITING_RYDER      = ['Submitted to Ryder', 'Resubmitted']
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

const metaText = { fontSize: 11.5, color: C.textSm, whiteSpace: 'nowrap' }
const Dot = () => <span style={{ color: C.borderMd }}>•</span>

/* ── One checkable row ── */
function TodoRow({ todo, selected, busy, onSelect }) {
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
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 14px',
      borderBottom: `1px solid ${C.border}`, opacity: busy ? 0.6 : 1, transition: 'opacity .15s, background .15s',
      background: selected ? '#f0faf5' : todo.done ? '#fafbfc' : '#fff',
    }}>
      {/* Checkbox only SELECTS — nothing is saved until "Submit" in the action bar */}
      <button type="button" onClick={() => onSelect(todo)} disabled={busy}
        title={selected ? 'Unselect' : todo.done ? 'Select to re-open' : isUnconf ? 'Select as investigated' : `Select — verified against ${compareTo}`}
        style={{
          width: 20, height: 20, marginTop: 1, borderRadius: 5, flexShrink: 0, padding: 0,
          border: `2px solid ${selected ? C.primary : C.borderMd}`,
          background: selected ? C.primary : '#fff', cursor: busy ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {selected && <Check size={12} color="#fff" strokeWidth={3} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Line 1 — identifier + amount */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <span style={{
            fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: C.text,
            textDecoration: todo.done ? 'line-through' : 'none',
          }}>{title}</span>
          <span style={{ fontWeight: 800, fontSize: 14.5, color: todo.done ? C.textMut : C.primary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fmt(amount)}
          </span>
        </div>

        {/* Line 2 — compact meta */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', marginTop: 4 }}>
          {isUnconf ? (
            <>
              <span style={metaText}>Sent {todo.waited_days != null ? `${todo.waited_days} days ago` : '—'}</span>
              <Dot />
              <span style={{ ...metaText, color: todo.resubmit_count >= UNCONF_MIN_ATTEMPTS ? C.red : C.textSm, fontWeight: 600 }}>
                Resent {todo.resubmit_count || 0}×
              </span>
              {todo.po_number && <><Dot /><span style={metaText}>PO <span style={{ fontFamily: 'monospace' }}>{todo.po_number}</span></span></>}
              {todo.advance_number != null && <><Dot /><span style={metaText}>{fmtAdv(todo.advance_number)}</span></>}
              {todo.drive_file_url && (
                <>
                  <Dot />
                  <a href={todo.drive_file_url} target="_blank" rel="noreferrer"
                    style={{ ...metaText, color: C.primary, display: 'inline-flex', alignItems: 'center', gap: 3, textDecoration: 'none', fontWeight: 600 }}>
                    View invoice <ExternalLink size={11} />
                  </a>
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
                <span style={metaText}>Inv <span style={{ fontFamily: 'monospace' }}>{invoices[0].n}</span></span>
              ) : (
                <button type="button" onClick={() => setOpen(o => !o)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px',
                  borderRadius: 9999, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${mismatch ? C.red : C.border}`,
                  background: mismatch ? C.redLt : '#f1f5f9', color: mismatch ? C.red : C.textSm,
                }}>
                  {mismatch && '⚠ '}{invoices.length} invoices
                  {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              {todo.cheque_drive_url && (
                <>
                  <Dot />
                  <a href={todo.cheque_drive_url} target="_blank" rel="noreferrer"
                    style={{ ...metaText, color: C.primary, display: 'inline-flex', alignItems: 'center', gap: 3, textDecoration: 'none', fontWeight: 600 }}>
                    View cheque <ExternalLink size={11} />
                  </a>
                </>
              )}
            </>
          ) : (
            <>
              <span style={metaText}>{todo.advance_invoice_count || 0} invoice{todo.advance_invoice_count === 1 ? '' : 's'}</span>
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
                <div key={n} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11.5, padding: '2px 0' }}>
                  <span style={{ fontFamily: 'monospace', color: C.text }}>{n}</span>
                  {amt && <span style={{ color: C.textSm, fontVariantNumeric: 'tabular-nums' }}>{amt}</span>}
                </div>
              ))}
            </div>
            {hasTotal && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', padding: '6px 10px', fontSize: 11.5, fontWeight: 700,
                borderTop: `1px solid ${C.border}`, background: mismatch ? C.redLt : '#f0faf5', color: mismatch ? C.red : C.primary,
              }}>
                <span>Invoices total {mismatch ? '— differs from cheque' : '✓ matches cheque'}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(todo.cheque_invoice_total)}</span>
              </div>
            )}
          </div>
        )}

        {todo.done && (
          <div style={{ fontSize: 11, color: C.primary, marginTop: 4, fontWeight: 600 }}>
            ✓ {isUnconf ? 'Investigated' : 'Verified'} {fmtDate(todo.done_at)}{todo.done_by_name ? ` by ${todo.done_by_name}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── One column (cheques / advances / unconfirmed) ── */
function TodoColumn({ icon: Icon, title, party, hint, items, selected, busy, onSelect, onSelectAll, emptyText }) {
  const allOn  = items.length > 0 && items.every(t => selected.has(t.id))
  const someOn = !allOn && items.some(t => selected.has(t.id))
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#f8fafb', borderBottom: `1px solid ${C.border}` }}>
        <Icon size={15} color={C.primary} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{title}</span>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: C.textSm, background: C.border, borderRadius: 5, padding: '1px 6px' }}>{party}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.textMut }}>{items.length}</span>
        {items.length > 0 && (
          <button type="button" onClick={() => onSelectAll(items, !allOn)} disabled={busy}
            title={allOn ? 'Unselect all' : 'Select all in this column'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 6,
              border: `1px solid ${allOn || someOn ? C.primary : C.border}`, background: '#fff',
              color: allOn || someOn ? C.primary : C.textSm, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {allOn ? <Check size={11} strokeWidth={3} /> : someOn ? '–' : null} All
          </button>
        )}
      </div>
      {hint && (
        <div style={{ padding: '6px 12px', fontSize: 11, color: C.textMut, borderBottom: `1px solid ${C.border}` }}>{hint}</div>
      )}
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {items.length === 0
          ? <div style={{ padding: 18, textAlign: 'center', fontSize: 12.5, color: C.textMut }}>{emptyText}</div>
          : items.map(t => <TodoRow key={t.id} todo={t} selected={selected.has(t.id)} busy={busy} onSelect={onSelect} />)}
      </div>
    </div>
  )
}

export default function AuditTodos() {
  const isMobile = useIsMobile()
  const [todos, setTodos]   = useState([])
  const [unconfirmed, setUnconfirmed] = useState([])
  const [view, setView]     = useState('open')   // 'open' | 'done'
  const [error, setError]   = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  // Ticking a box only SELECTS it (display id). Nothing is saved until the
  // admin presses Submit in the action bar — then all selected items are
  // saved together and move out of the to-do list.
  const [selected, setSelected]     = useState(() => new Set())
  const [submitting, setSubmitting] = useState(false)
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
      setTodos(data || [])
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
        .select('id, invoice_number, po_number, invoice_amount, status, advance_number, resubmit_count, ryder_submitted_at, last_resubmitted_at, created_at, drive_file_url')
        .in('status', AWAITING_RYDER),
      supabase.from('audit_todos')
        .select('id, invoice_id, done, done_at, done_by_profile:profiles(full_name)')
        .eq('kind', 'unconfirmed'),
    ])
    if (seq !== loadSeq.current) return
    if (invErr) { console.error('unconfirmed invoices:', invErr); return }
    const tickBy = Object.fromEntries((ticks || []).map(t => [t.invoice_id, t]))
    setUnconfirmed((invs || [])
      .map(i => ({ ...i, waited_days: daysSince(i.ryder_submitted_at || i.created_at) }))
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
      <button type="button" onClick={() => changeView(key)} disabled={submitting} style={{
        padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff',
        color: on ? '#fff' : C.textSm, fontFamily: 'inherit',
      }}>{label} ({count})</button>
    )
  }

  const n = selectedItems.length
  const colProps = { selected, busy: submitting, onSelect: toggleSelect, onSelectAll: selectAll }

  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.07)', padding: isMobile ? 12 : 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Audit To-Do</span>
        <span style={{ fontSize: 11.5, color: C.textMut }}>
          {view === 'open' ? 'select the items you have checked, then press Submit' : 'select items to re-open, then press Submit'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {tabBtn('open', 'To verify', openCount)}
          {tabBtn('done', 'Verified', doneCount)}
        </div>
      </div>

      {error && (
        <div style={{ background: C.redLt, color: C.red, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginBottom: 10 }}>{error}</div>
      )}
      {notice && !error && (
        <div style={{ background: '#f0faf5', color: C.primary, border: '1px solid #b6e8d0', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>✓ {notice}</div>
      )}

      {loading ? (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 12.5, color: C.textMut }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          <TodoColumn icon={Landmark} title="Cheques → bank deposit" party="Ryder" items={cheques} {...colProps}
            emptyText={view === 'open' ? 'All cheques verified.' : 'No verified cheques yet.'} />
          <TodoColumn icon={Banknote} title="Advances → bank transfer" party="RZR" items={advances} {...colProps}
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
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 800,
          }}>{n}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            selected {view === 'open' ? '— ready to mark as verified' : '— will be re-opened'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, width: isMobile ? '100%' : 'auto' }}>
            <button type="button" onClick={() => setSelected(new Set())} disabled={submitting} style={{
              flex: isMobile ? 1 : undefined, height: 34, padding: '0 14px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.35)', background: 'transparent', color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Clear</button>
            <button type="button" onClick={submit} disabled={submitting} style={{
              flex: isMobile ? 2 : undefined, height: 34, padding: '0 18px', borderRadius: 8, border: 'none',
              background: '#fff', color: C.primary, fontSize: 13, fontWeight: 800,
              cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: submitting ? 0.7 : 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Check size={14} strokeWidth={3} />
              {submitting ? 'Submitting…' : view === 'open' ? `Submit ${n} as verified` : `Re-open ${n}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
