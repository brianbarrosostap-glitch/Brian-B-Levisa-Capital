import React, { useState, useEffect } from 'react'
import { FileText, CheckSquare, Upload } from 'lucide-react'
import { Shell, Topbar, PageContent, NavItem } from '../../components/ui'
import NotificationBell from '../../components/NotificationBell'
import InstallPWA from '../../components/InstallPWA'
import InvoicesToAdvance from './InvoicesToAdvance'
import AdvancedInvoices from './AdvancedInvoices'
import MyUploads from './MyUploads'

const NAV_ITEMS = [
  { key: 'invoices', label: 'Invoices to Advance', icon: FileText },
  { key: 'advanced', label: 'Advanced Invoices',   icon: CheckSquare },
  { key: 'uploads',  label: 'My Uploads',          icon: Upload },
]

const TITLES = {
  invoices: { title: 'Invoices to Advance' },
  advanced: { title: 'Advanced Invoices' },
  uploads:  { title: 'My Uploads' },
}

export default function CustomerApp({ user, onSignOut }) {
  const [page, setPage] = useState(() => {
    const saved = localStorage.getItem('customer.page')
    return TITLES[saved] ? saved : 'invoices'
  })

  useEffect(() => { localStorage.setItem('customer.page', page) }, [page])

  const initials = user?.initials
    || user?.full_name?.split(' ').map(w => w[0]).join('')
    || 'SM'

  const NavItems = (
    <>
      {NAV_ITEMS.map(n => (
        <NavItem key={n.key} icon={n.icon} label={n.label} active={page === n.key} onClick={() => setPage(n.key)} />
      ))}
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
        <InstallPWA />
        <NotificationBell role="customer" />
        <div style={{
          width: 29, height: 29, borderRadius: '50%', background: '#eaf4ef',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: '#007953', flexShrink: 0,
        }}>
          {initials}
        </div>
      </Topbar>
      <PageContent>
        {page === 'invoices' && <InvoicesToAdvance />}
        {page === 'advanced' && <AdvancedInvoices />}
        {page === 'uploads'  && <MyUploads />}
      </PageContent>
    </Shell>
  )
}
