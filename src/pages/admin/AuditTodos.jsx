import React, { useState, useEffect } from 'react'
import { Check, ExternalLink, Landmark, Banknote } from 'lucide-react'
import { C } from '../../tokens'
import { useIsMobile } from '../../components/ui'
import { supabase, callFunction } from '../../lib/supabase'

const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtAdv = n => 'ADV-' + String(n).padStart(4, '0')
const fmtDate = d => d ? new Date(d).toLocaleDateString() : '—'

/* ── One checkable row ── */
function TodoRow({ todo, busy, onToggle }) {
  const isCheque = todo.kind === 'cheque'
  const title  = isCheque ? `Cheque #${todo.check_number || '(unreadable)'}` : fmtAdv(todo.advance_number)
  const amount = isCheque ? todo.cheque_amount : todo.advance_total
  const detail = isCheque
    ? [`Received ${fmtDate(todo.cheque_received_at)}`, todo.cheque_invoice_numbers ? `Inv ${todo.cheque_invoice_numbers}` : 'No invoice matched']
    : [`${todo.advance_invoice_count || 0} invoice${todo.advance_invoice_count === 1 ? '' : 's'}`,
       todo.advance_client_name,
       todo.advance_paid_count > 0 ? `Paid ${fmtDate(todo.advance_paid_at)}` : 'Not marked paid yet']
  const compareTo = isCheque ? 'bank deposit' : 'bank transfer to RZR'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 12px',
      borderBottom: `1px solid ${C.border}`, opacity: busy ? 0.5 : 1,
      background: todo.done ? '#fafbfc' : '#fff',
    }}>
      <button type="button" onClick={() => onToggle(todo)} disabled={busy}
        title={todo.done ? 'Mark as not verified' : `Mark verified against ${compareTo}`}
        style={{
          width: 20, height: 20, marginTop: 1, borderRadius: 5, flexShrink: 0, padding: 0,
          border: `2px solid ${todo.done ? C.primary : C.borderMd}`,
          background: todo.done ? C.primary : '#fff', cursor: busy ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {todo.done && <Check size={12} color="#fff" strokeWidth={3} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: C.text,
            textDecoration: todo.done ? 'line-through' : 'none',
          }}>{title}</span>
          <span style={{ fontWeight: 800, fontSize: 14, color: todo.done ? C.textMut : C.primary, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fmt(amount)}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: C.textSm, marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
          {detail.filter(Boolean).map(d => <span key={d}>{d}</span>)}
          {isCheque && todo.cheque_drive_url && (
            <a href={todo.cheque_drive_url} target="_blank" rel="noreferrer"
              style={{ color: C.primary, display: 'inline-flex', alignItems: 'center', gap: 3, textDecoration: 'none', fontWeight: 600 }}>
              View cheque <ExternalLink size={11} />
            </a>
          )}
        </div>
        {todo.done ? (
          <div style={{ fontSize: 11, color: C.primary, marginTop: 3, fontWeight: 600 }}>
            ✓ Verified {fmtDate(todo.done_at)}{todo.done_by_name ? ` by ${todo.done_by_name}` : ''}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.textMut, marginTop: 3 }}>
            Compare against the actual {compareTo}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── One column (cheques or advances) ── */
function TodoColumn({ icon: Icon, title, party, items, busyId, onToggle, emptyText }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#f8fafb', borderBottom: `1px solid ${C.border}` }}>
        <Icon size={15} color={C.primary} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{title}</span>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: C.textSm, background: C.border, borderRadius: 5, padding: '1px 6px' }}>{party}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.textMut }}>{items.length}</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {items.length === 0
          ? <div style={{ padding: 18, textAlign: 'center', fontSize: 12.5, color: C.textMut }}>{emptyText}</div>
          : items.map(t => <TodoRow key={t.id} todo={t} busy={busyId === t.id} onToggle={onToggle} />)}
      </div>
    </div>
  )
}

export default function AuditTodos() {
  const isMobile = useIsMobile()
  const [todos, setTodos]   = useState([])
  const [view, setView]     = useState('open')   // 'open' | 'done'
  const [busyId, setBusyId] = useState(null)
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const { data, error } = await supabase
      .from('v_audit_todos')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('v_audit_todos:', error)
      setError(error.code === '42P01' || error.code === 'PGRST205'
        ? 'Audit to-dos not set up yet — run migration 20261013000002_audit_todos.sql.'
        : 'Could not load audit to-dos.')
    } else {
      setError('')
      setTodos(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const toggle = async (todo) => {
    setBusyId(todo.id)
    try {
      await callFunction('toggle-audit-todo', { todo_id: todo.id, done: !todo.done })
      await load()
    } catch (e) {
      console.error(e)
      setError('Could not update — is the toggle-audit-todo function deployed?')
    }
    setBusyId(null)
  }

  const shown    = todos.filter(t => (view === 'done') === t.done)
  const cheques  = shown.filter(t => t.kind === 'cheque')
  const advances = shown.filter(t => t.kind === 'advance')
  const openCount = todos.filter(t => !t.done).length
  const doneCount = todos.length - openCount

  const tabBtn = (key, label, count) => {
    const on = view === key
    return (
      <button type="button" onClick={() => setView(key)} style={{
        padding: '5px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff',
        color: on ? '#fff' : C.textSm, fontFamily: 'inherit',
      }}>{label} ({count})</button>
    )
  }

  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.07)', padding: isMobile ? 12 : 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Audit To-Do</span>
        <span style={{ fontSize: 11.5, color: C.textMut }}>check each item off once it matches your bank account</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {tabBtn('open', 'To verify', openCount)}
          {tabBtn('done', 'Verified', doneCount)}
        </div>
      </div>

      {error && (
        <div style={{ background: C.redLt, color: C.red, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginBottom: 10 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 12.5, color: C.textMut }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          <TodoColumn icon={Landmark} title="Cheques → bank deposit" party="Ryder"
            items={cheques} busyId={busyId} onToggle={toggle}
            emptyText={view === 'open' ? 'All cheques verified.' : 'No verified cheques yet.'} />
          <TodoColumn icon={Banknote} title="Advances → bank transfer" party="RZR"
            items={advances} busyId={busyId} onToggle={toggle}
            emptyText={view === 'open' ? 'All advances verified.' : 'No verified advances yet.'} />
        </div>
      )}
    </div>
  )
}
