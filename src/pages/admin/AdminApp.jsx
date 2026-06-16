import React, { useState } from 'react'
import { LayoutDashboard, ListOrdered, Receipt, LogOut } from 'lucide-react'
import { Shell, Topbar, PageContent } from '../../components/ui'
import Dashboard from './Dashboard'
import Master from './Master'
import Checks from './Checks'

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'master',    label: 'Master',    icon: ListOrdered, badge: 7 },
  { key: 'checks',    label: 'Checks',    icon: Receipt },
]

const TITLES = {
  dashboard: { title: 'Dashboard' },
  master:    { title: 'Master', subtitle: 'All invoice records' },
  checks:    { title: 'Checks', subtitle: 'Payment proof from Ryder (Drive)' },
}

export default function AdminApp({ user, onSignOut }) {
  const [page, setPage] = useState('dashboard')

  const NavItems = (
    <>
      {NAV.map(n => {
        const Icon = n.icon
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
            {n.badge != null && (
              <span style={{ background: '#dc2626', color: '#fff', borderRadius: 9999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>
                {n.badge}
              </span>
            )}
          </button>
        )
      })}

      {/* Sign out at bottom of nav */}
      <button onClick={onSignOut} style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%',
        padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
        background: 'transparent', color: 'rgba(255,255,255,0.38)',
        fontWeight: 400, fontSize: 13.5, marginTop: 8,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif', textAlign: 'left',
      }}>
        <LogOut size={15} />
        <span>Sign Out</span>
      </button>
    </>
  )

  const t = TITLES[page]
  const userInfo = {
    name: user?.full_name || 'Brian Levisa',
    role: 'Owner',
    initials: user?.initials || (user?.full_name?.split(' ').map(w => w[0]).join('') || 'BL'),
  }

  return (
    <Shell nav={NavItems} user={userInfo}>
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
      </Topbar>
      <PageContent>
        {page === 'dashboard' && <Dashboard />}
        {page === 'master'    && <Master />}
        {page === 'checks'    && <Checks />}
      </PageContent>
    </Shell>
  )
}
