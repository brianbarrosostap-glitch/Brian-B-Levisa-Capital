import React, { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { C, FONT_MONO } from '../../tokens'
import { Card, Badge, Btn, SearchBar, TH, TD, Pager, useIsMobile } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { usePersistentState } from '../../hooks/usePersistentState'
import { useDebounced } from '../../hooks/useDebounced'

// Server-side paging: each page is one request (rows + exact count) against v_audit_logs,
// newest first. Search runs in the database, so it covers the whole audit history.

const PAGE_SIZES = [10, 25, 50, 100]
const ACTIONS = ['insert', 'update', 'delete', 'status_change']   // audit_action enum

const ACTION_COLOUR = {
  insert:        { bg: '#dcfce7', text: '#15803d' },
  update:        { bg: '#dbeafe', text: '#1e40af' },
  delete:        { bg: '#fee2e2', text: '#991b1b' },
  status_change: { bg: '#ede9fe', text: '#5b21b6' },
}

const ActionPill = ({ action }) => {
  const c = ACTION_COLOUR[action] || { bg: '#f1f5f9', text: '#475569' }
  return (
    <span style={{
      background: c.bg, color: c.text, boxShadow: `inset 0 0 0 1px ${c.text}1f`,
      borderRadius: 9999, height: 22, boxSizing: 'border-box', padding: '0 9px',
      display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap',
    }}>
      {action}
    </span>
  )
}

const Dash = () => <span style={{ color: C.borderMd }}>—</span>
const when = (ts) => ts ? new Date(ts).toLocaleString() : '—'

/** Same fields as before (summary, invoice #, actor, table, source) + the action name. */
function applySearch(query, text) {
  const q = text.replace(/[,()"'\\*%]/g, ' ').trim()   // characters that would break an or=() filter
  if (!q) return query
  const ors = ['summary', 'invoice_number', 'actor_name', 'table_name', 'source'].map(c => `${c}.ilike.*${q}*`)
  // `action` is an enum (no ilike) — match it by name instead, e.g. "status" → status_change.
  const acts = ACTIONS.filter(a => a.includes(q.toLowerCase().replace(/\s+/g, '_')))
  if (acts.length) ors.push(`action.in.(${acts.join(',')})`)
  return query.or(ors.join(','))
}

export default function AuditLogs() {
  const isMobile = useIsMobile()
  const [search, setSearch]     = usePersistentState('admin.auditlogs.search', '')
  const [storedSize, setPageSize] = usePersistentState('admin.auditlogs.pageSize', PAGE_SIZES[0])
  const pageSize = PAGE_SIZES.includes(storedSize) ? storedSize : PAGE_SIZES[0]
  const debounced = useDebounced(search.trim(), 300)

  // The page belongs to the current search + page size: change either and it is page 1 again.
  const filterKey = JSON.stringify([debounced, pageSize])
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 })
  const page = pageState.key === filterKey ? pageState.page : 1
  const setPage = (p) => setPageState({ key: filterKey, page: p })

  const [reloads, setReloads] = useState(0)
  const requestKey = `${filterKey}|${page}|${reloads}`
  const [logs, setLogs]           = useState([])
  const [total, setTotal]         = useState(0)
  const [loadedKey, setLoadedKey] = useState(null)
  const [error, setError]         = useState('')
  const loading = loadedKey === null
  const stale = !loading && loadedKey !== requestKey

  useEffect(() => {
    let cancelled = false
    const from = (page - 1) * pageSize
    // created_at ties are common (one transaction writes several rows); id keeps page boundaries stable.
    applySearch(supabase.from('v_audit_logs').select('*', { count: 'exact' }), debounced)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + pageSize - 1)
      .then(({ data, count, error: err }) => {
        if (cancelled) return
        if (err) {
          // Asked for a page past the end (records removed / count changed) → back to page 1.
          if (err.code === 'PGRST103' && page > 1) { setPage(1); return }
          console.error('Failed to load audit logs:', err)
          setError('Could not load the audit log.')
          setLoadedKey(requestKey)
          return
        }
        if (!data?.length && page > 1 && count > 0) { setPage(Math.ceil(count / pageSize)); return }
        setError('')
        setLogs(data || [])
        setTotal(count ?? 0)
        setLoadedKey(requestKey)
      })
    return () => { cancelled = true }
  }, [requestKey])   // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const searching = !!search.trim()
  const empty = (
    <div style={{ padding: '36px 16px', textAlign: 'center', fontSize: 14.5, color: C.textMut }}>
      {searching ? <>No audit entries match “{search.trim()}”.</> : 'No audit entries yet.'}
    </div>
  )

  return (
    <div style={{ minWidth: 0 }}>
      {/* overflow:'hidden' on the default noPad Card CLIPS the wide audit
          table; override to clip-y only so the inner overflow-x can scroll. */}
      <Card noPad style={{ overflow: 'visible' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SearchBar placeholder="Search action, invoice #, actor, table…" value={search} onChange={setSearch} />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {!loading && !error && (
              <span style={{ fontSize: 13.5, color: C.textMut, fontVariantNumeric: 'tabular-nums' }}>
                {total.toLocaleString()} {searching ? 'matching ' : ''}{total === 1 ? 'entry' : 'entries'}
              </span>
            )}
            <Btn variant="ghost" size="sm" onClick={() => { setPage(1); setReloads(n => n + 1) }} disabled={stale}
              title="Reload — newest entries appear on page 1">
              <RefreshCw size={12} className={stale ? 'lc-spin' : undefined} /> Refresh
            </Btn>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 36, textAlign: 'center', fontSize: 14.5, color: C.textMut }}>Loading audit log…</div>
        ) : error ? (
          <div style={{ padding: 36, textAlign: 'center', fontSize: 14.5, color: C.red }}>{error}</div>
        ) : logs.length === 0 ? empty : isMobile ? (
          /* ── Mobile: stacked cards ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, opacity: stale ? 0.55 : 1 }} aria-busy={stale}>
            {logs.map(l => (
              <div key={l.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 15.5 }}>{l.invoice_number || '—'}</span>
                  <ActionPill action={l.action} />
                </div>
                {[
                  ['When', when(l.created_at)],
                  ['Table', l.table_name || '—'],
                  ['Status', l.new_status ? <Badge status={l.new_status} /> : '—'],
                  ['Actor', l.actor_name || 'System'],
                  ['Source', l.source || '—'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '3px 0', fontSize: 14 }}>
                    <span style={{ color: C.textMut, fontWeight: 600 }}>{k}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: C.text, textAlign: 'right' }}>{v}</span>
                  </div>
                ))}
                {l.summary && (
                  <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8, fontSize: 13.5, color: C.textSm, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                    {l.summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch', opacity: stale ? 0.55 : 1, transition: 'opacity .15s' }} aria-busy={stale}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980, tableLayout: 'auto' }}>
              <thead>
                <tr>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Table</TH>
                  <TH>Invoice #</TH>
                  <TH>Status</TH>
                  <TH>Summary</TH>
                  <TH>Actor</TH>
                  <TH>Source</TH>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="lc-trow">
                    <TD muted style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>{when(l.created_at)}</TD>
                    <TD><ActionPill action={l.action} /></TD>
                    <TD muted style={{ whiteSpace: 'nowrap' }}>{l.table_name}</TD>
                    <TD mono style={{ whiteSpace: 'nowrap' }}>{l.invoice_number || <Dash />}</TD>
                    <TD>{l.new_status ? <Badge status={l.new_status} /> : <Dash />}</TD>
                    <TD style={{ minWidth: 260, maxWidth: 440, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{l.summary || <Dash />}</TD>
                    <TD muted style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>{l.actor_name || 'System'}</TD>
                    <TD muted style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{l.source || <Dash />}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && total > 0 && (
          <Pager page={page} pages={pages} pageSize={pageSize} total={total} rowsShown={logs.length}
            onPage={setPage} onPageSize={setPageSize} sizes={PAGE_SIZES} noun="records" compact={isMobile} />
        )}
      </Card>
    </div>
  )
}
