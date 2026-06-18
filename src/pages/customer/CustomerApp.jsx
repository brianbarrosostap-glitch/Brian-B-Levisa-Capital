import React, { useState, useEffect } from 'react'
import { FileText, CheckSquare } from 'lucide-react'
import { Shell, Topbar, PageContent } from '../../components/ui'
import NotificationBell from '../../components/NotificationBell'
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
  const [page, setPage] = useState(() => localStorage.getItem('customer.page') || 'invoices')

  useEffect(() => { localStorage.setItem('customer.page', page) }, [page])

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
    </>
  )

  const t = TITLES[page]

  return (
    <Shell
      nav={NavItems}
      user={{ name: user?.full_name || 'Sarah Mitchell', role: 'RZR Inc', initials }}
      onSignOut={onSignOut}
    >
      <Topbar title={t.title}>
        <NotificationBell role="customer" />
        <div style={{
          width: 29, height: 29, borderRadius: '50%', background: '#eaf4ef',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: '#007953', flexShrink: 0,
        }}>
          {initials}
        </div>
      </Topbar>
      <PageContent>
        {page === 'invoices' && <InvoicesToAdvance />}
        {page === 'advanced' && <AdvancedInvoices />}
      </PageContent>
    </Shell>
  )
}
