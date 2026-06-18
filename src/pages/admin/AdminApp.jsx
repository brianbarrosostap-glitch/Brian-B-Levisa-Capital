import React, { useState, useEffect } from 'react'
import { LayoutDashboard, ListOrdered, Receipt, ScrollText } from 'lucide-react'
import { Shell, Topbar, PageContent } from '../../components/ui'
import NotificationBell from '../../components/NotificationBell'
import { supabase } from '../../lib/supabase'
import Dashboard from './Dashboard'
import Master from './Master'
import Checks from './Checks'
import AuditLogs from './AuditLogs'

const NAV = [
  { key: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard },
  { key: 'master',    label: 'Master',     icon: ListOrdered },
  { key: 'cheques',   label: 'Cheques',    icon: Receipt },
  { key: 'audit',     label: 'Audit Logs', icon: ScrollText },
]

const TITLES = {
  dashboard: { title: 'Dashboard' },
  master:    { title: 'Master', subtitle: 'All invoice records' },
  cheques:   { title: 'Cheques', subtitle: 'Payment proof from Ryder (Drive)' },
  audit:     { title: 'Audit Logs', subtitle: 'Who did what, when' },
}

export default function AdminApp({ user, onSignOut }) {
  // Persist the active tab so a refresh stays on the same screen.
  const VALID = ['dashboard', 'master', 'cheques', 'audit']
  const [page, setPage] = useState(() => {
    const saved = localStorage.getItem('admin.page')
    return VALID.includes(saved) ? saved : 'dashboard'
  })
  const [attnCount, setAttnCount] = useState(null)

  useEffect(() => { localStorage.setItem('admin.page', page) }, [page])

  // Live count of unresolved Needs-Attention items (was hardcoded to 7).
  useEffect(() => {
    const load = async () => {
      const { count } = await supabase
        .from('needs_attention')
        .select('id', { count: 'exact', head: true })
        .eq('resolved', false)
      setAttnCount(count ?? 0)
    }
    load()
  }, [page])

  const NavItems = (
    <>
      {NAV.map(n => {
        const Icon = n.icon
        const badge = n.key === 'master' && attnCount ? attnCount : null
        return (
          <button key={n.key} onClick={() => setPage(n.key)} style={{
            display: 'flex', alignItems: 'center', gap: 9, width: '100%',
            padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: page === n.key ? 'rgba(0,121,83,0.28)' : 'transparent',
            color: page === n.key ? '#fff' : 'rgba(255,255,255,0.58)',
            fontWeight: page === n.key ? 600 : 400, fontSize: 13.5,
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif', textAlign: 'left',
          }}>
            <Icon size={16} />
            <span style={{ flex: 1 }}>{n.label}</span>
            {badge != null && (
              <span style={{ background: '#dc2626', color: '#fff', borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </>
  )

  const t = TITLES[page]
  const userInfo = {
    name: user?.full_name || 'Brian Levisa',
    role: 'Owner',
    initials: user?.initials || (user?.full_name?.split(' ').map(w => w[0]).join('') || 'BL'),
  }

  return (
    <Shell nav={NavItems} user={userInfo} onSignOut={onSignOut}>
      <Topbar title={t.title} subtitle={t.subtitle}>
        {page === 'master' && (
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 13px', borderRadius: 7, border: '1px solid #dde4ec',
            background: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            color: '#4a6070', fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
        )}
        <NotificationBell />
      </Topbar>
      <PageContent>
        {page === 'dashboard' && <Dashboard />}
        {page === 'master'    && <Master />}
        {page === 'cheques'   && <Checks />}
        {page === 'audit'     && <AuditLogs />}
      </PageContent>
    </Shell>
  )
}
