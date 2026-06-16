import React, { useState } from 'react'
import { FileText, CheckSquare, LogOut } from 'lucide-react'
import { Shell, Topbar, PageContent } from '../../components/ui'
import InvoicesToAdvance from './InvoicesToAdvance'
import AdvancedInvoices from './AdvancedInvoices'

const NAV_ITEMS = [
  { key: 'invoices', label: 'Invoices to Advance', icon: FileText },
  { key: 'advanced', label: 'Advanced Invoices',   icon: CheckSquare },
]

const TITLES = {
  invoices: { title: 'Invoices to Advance' },
  advanced: { title: 'Advanced Invoices' },
}

export default function CustomerApp({ user, onSignOut }) {
  const [page, setPage] = useState('invoices')

  const initials = user?.initials
    || user?.full_name?.split(' ').map(w => w[0]).join('')
    || 'SM'

  const NavItems = (
    <>
      {NAV_ITEMS.map(n => {
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
            <span>{n.label}</span>
          </button>
        )
      })}

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

  return (
    <Shell
      nav={NavItems}
      user={{ name: user?.full_name || 'Sarah Mitchell', role: 'RZR Inc', initials }}
    >
      <Topbar title={t.title}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 29, height: 29, borderRadius: '50%', background: '#eaf4ef',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#007953',
          }}>
            {initials}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0d1b14' }}>
            {user?.full_name || 'Sarah Mitchell'}
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8fa3b0" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </Topbar>
      <PageContent>
        {page === 'invoices' && <InvoicesToAdvance />}
        {page === 'advanced' && <AdvancedInvoices />}
      </PageContent>
    </Shell>
  )
}
