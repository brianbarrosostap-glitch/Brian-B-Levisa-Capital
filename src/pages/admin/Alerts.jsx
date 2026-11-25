import React, { useState, useEffect } from 'react'
import { Plug, Timer, Mail, FileWarning, Inbox, AlertTriangle, XCircle, RefreshCw, ArrowRight, BellRing, Lightbulb, ChevronDown } from 'lucide-react'
import { C, shadow } from '../../tokens'
import { Card, Btn, SearchBar, Pager, Spinner, useIsMobile } from '../../components/ui'
import { loadAlerts, ALERT_DAYS as DAYS } from '../../lib/alerts'
import { usePersistentState } from '../../hooks/usePersistentState'
import { fmtDateTime } from '../../lib/documentJobs'

// One feed of everything that went wrong, gathered from the tables the system
// already writes to (nothing new is logged): broken connections, failed
// scheduled jobs, emails that could not be sent, uploads that failed, mailbox
// emails that could not be handled, and open cheque/invoice alerts.

const PAGE_SIZES = [25, 50, 100]

const SOURCES = {
  connection: { label: 'Connections',     icon: Plug,        page: 'connections', open: 'Open Connections' },
  job:        { label: 'Scheduled jobs',  icon: Timer,       page: 'automation',  open: 'Open Automation' },
  email:      { label: 'Emails',          icon: Mail,        page: 'automation',  open: 'Open Automation' },
  upload:     { label: 'Uploads',         icon: FileWarning, page: 'review',      open: 'Open Upload Review' },
  mailbox:    { label: 'Mailbox',         icon: Inbox,       page: 'automation',  open: 'Open Automation' },
  attention:  { label: 'Needs attention', icon: BellRing,    page: 'cheques',     open: 'Open Cheques' },
}

const SEV = {
  error:   { label: 'Error',   bg: '#fef2f2', text: '#b91c1c', ring: '#fecaca', Icon: XCircle },
  warning: { label: 'Warning', bg: '#fffbeb', text: '#b45309', ring: '#fde68a', Icon: AlertTriangle },
}

const ago = (ts) => {
  if (!ts) return ''
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

const Chip = ({ on, onClick, children, count, tone }) => (
  <button type="button" onClick={onClick} className={`lc-seg lc-focus${on ? ' is-on' : ''}`} aria-pressed={on} style={{
    display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px', borderRadius: 99, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
    border: `1px solid ${on ? C.primary : C.border}`, background: on ? C.primary : '#fff', color: on ? '#fff' : C.textSm,
  }}>
    {children}
    {count != null && (
      <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 99, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: on ? 'rgba(255,255,255,0.22)' : tone === 'error' && count ? '#fee2e2' : C.panel, color: on ? '#fff' : tone === 'error' && count ? '#b91c1c' : C.textSm }}>{count}</span>
    )}
  </button>
)

export default function Alerts({ onNavigate, onChanged }) {
  const isMobile = useIsMobile()
  const [alerts, setAlerts]   = useState([])
  const [failed, setFailed]   = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [source, setSource]   = usePersistentState('admin.alerts.source', 'all')
  const [sev, setSev]         = usePersistentState('admin.alerts.severity', 'all')
  const [search, setSearch]   = usePersistentState('admin.alerts.search', '')
  const [pageSize, setPageSize] = usePersistentState('admin.alerts.pageSize', 25)
  const [pageState, setPageState] = useState({ key: '', page: 1 })

  const refresh = async () => {
    setRefreshing(true)
    const r = await loadAlerts()
    setAlerts(r.alerts); setFailed(r.failed); setLoading(false); setRefreshing(false)
    onChanged?.()
  }
  useEffect(() => {
    let off = false
    loadAlerts().then(r => { if (!off) { setAlerts(r.alerts); setFailed(r.failed); setLoading(false) } })
    return () => { off = true }
  }, [])

  const last24 = alerts.filter(a => a.recent).length
  const q = search.trim().toLowerCase()
  const bySource = (s) => alerts.filter(a => s === 'all' || a.source === s)
  const list = bySource(source)
    .filter(a => sev === 'all' || a.severity === sev)
    .filter(a => !q || `${a.title} ${a.detail} ${a.fix} ${a.tech}`.toLowerCase().includes(q))

  const size = PAGE_SIZES.includes(pageSize) ? pageSize : 25
  const key = JSON.stringify([source, sev, q, size, alerts.length])
  const pages = Math.max(1, Math.ceil(list.length / size))
  const page = Math.min(pageState.key === key ? pageState.page : 1, pages)
  const shown = list.slice((page - 1) * size, page * size)
  const errors = alerts.filter(a => a.severity === 'error').length

  return (
    <div style={{ maxWidth: 1320 }}>
      {/* summary */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          ['Open alerts', alerts.length, `last ${DAYS} days + current problems`, null],
          ['Errors', errors, 'something failed', errors ? '#b91c1c' : null],
          ['Last 24 hours', last24, 'new in the last day', last24 ? '#b45309' : null],
          ['Connections', alerts.filter(a => a.source === 'connection').length, 'broken / needs attention', alerts.some(a => a.source === 'connection') ? '#b91c1c' : null],
        ].map(([l, v, s, col]) => (
          <div key={l} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: shadow, padding: '13px 15px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textSm }}>{l}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: col || C.textB, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{loading ? '—' : v}</div>
            <div style={{ fontSize: 12.5, color: C.textMut }}>{s}</div>
          </div>
        ))}
      </div>

      <Card noPad>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Chip on={source === 'all'} onClick={() => setSource('all')} count={alerts.length}>All</Chip>
          {Object.entries(SOURCES).map(([k, s]) => (
            <Chip key={k} on={source === k} onClick={() => setSource(k)} count={bySource(k).length} tone="error"><s.icon size={14} /> {s.label}</Chip>
          ))}
        </div>
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <SearchBar placeholder="Search alerts…" value={search} onChange={setSearch} />
          <div style={{ display: 'inline-flex', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3, gap: 2 }}>
            {[['all', 'All'], ['error', 'Errors'], ['warning', 'Warnings']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSev(k)} className={`lc-seg lc-focus${sev === k ? ' is-on' : ''}`} aria-pressed={sev === k} style={{
                height: 28, padding: '0 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
                background: sev === k ? '#fff' : 'transparent', color: sev === k ? C.text : C.textSm, boxShadow: sev === k ? '0 1px 2px rgba(16,24,40,0.08)' : 'none',
              }}>{l}</button>
            ))}
          </div>
          <Btn variant="ghost" size="sm" onClick={refresh} disabled={refreshing} style={{ marginLeft: 'auto' }}>
            {refreshing ? <><Spinner size={12} /> Refreshing…</> : <><RefreshCw size={12} /> Refresh</>}
          </Btn>
        </div>
        {failed.length > 0 && (
          <div role="alert" style={{ padding: '8px 16px', background: '#fffbeb', color: '#92400e', fontSize: 13.5, borderBottom: `1px solid ${C.border}` }}>
            Some sources could not be loaded: {failed.join(' · ')}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 36, textAlign: 'center', color: C.textMut, fontSize: 14.5 }}><Spinner /> Loading alerts…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{alerts.length ? 'No alerts match these filters.' : 'No alerts — everything is running normally.'}</div>
            <div style={{ fontSize: 14, color: C.textMut, marginTop: 4 }}>Errors from the last {DAYS} days and any current problem appear here.</div>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, opacity: refreshing ? 0.55 : 1, transition: 'opacity .15s' }}>
            {shown.map((a, i) => {
              const src = SOURCES[a.source]
              const sv = SEV[a.severity]
              return (
                <li key={a.id} className="lc-row" style={{ display: 'flex', gap: 12, padding: '13px 16px', borderTop: i ? `1px solid ${C.borderLt}` : 'none', alignItems: 'flex-start', background: '#fff' }}>
                  <span title={sv.label} style={{ width: 32, height: 32, borderRadius: 9, background: sv.bg, color: sv.text, boxShadow: `inset 0 0 0 1px ${sv.ring}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><sv.Icon size={16} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: C.text, overflowWrap: 'anywhere' }}>{a.title}</span>
                      {a.count > 1 && <span title={`Reported ${a.count} times`} style={{ fontSize: 12, fontWeight: 700, color: C.textSm, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 99, padding: '0 7px' }}>×{a.count}</span>}
                    </div>
                    {a.detail && <div style={{ fontSize: 14, color: C.textSm, marginTop: 3, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{a.detail}</div>}
                    {a.fix && (
                      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 7, fontSize: 13.5, lineHeight: 1.5, color: '#065f46', background: C.primLt, border: '1px solid #c9e6d7', borderRadius: 8, padding: '6px 10px' }}>
                        <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span><strong>What to do:</strong> {a.fix}</span>
                      </div>
                    )}
                    {a.tech && a.tech !== a.detail && (
                      <details style={{ marginTop: 6 }}>
                        <summary className="lc-focus" style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: C.textMut, listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ChevronDown size={12} /> Technical details
                        </summary>
                        <pre style={{ margin: '6px 0 0', padding: '8px 10px', background: C.panel, border: `1px solid ${C.borderLt}`, borderRadius: 7, fontSize: 12, lineHeight: 1.5, color: C.textSm, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 180, overflow: 'auto' }}>{a.tech}</pre>
                      </details>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6, fontSize: 12.5, color: C.textMut }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: C.panel, border: `1px solid ${C.borderLt}`, borderRadius: 99, padding: '1px 8px', color: C.textSm, fontWeight: 600 }}><src.icon size={12} /> {src.label}</span>
                      <span title={a.at ? fmtDateTime(a.at) : ''}>{a.at ? `${fmtDateTime(a.at)} · ${ago(a.at)}` : ''}</span>
                    </div>
                  </div>
                  {onNavigate && (
                    <button type="button" onClick={() => onNavigate(a.page || src.page)} className="lc-link lc-focus" style={{
                      flexShrink: 0, background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontFamily: 'inherit',
                      color: C.primary, fontWeight: 600, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                    }}>{isMobile || a.page ? 'Open' : src.open} <ArrowRight size={13} /></button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {!loading && list.length > 0 && (
          <Pager page={page} pages={pages} pageSize={size} total={list.length} rowsShown={shown.length}
            onPage={(p) => setPageState({ key, page: p })} onPageSize={setPageSize} sizes={PAGE_SIZES} noun="alerts" compact={isMobile} />
        )}
      </Card>
    </div>
  )
}
