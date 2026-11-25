import React, { useState, useEffect } from 'react'
import { LayoutDashboard, ListOrdered, Receipt, ScrollText, FileSearch, Archive, Trash2, Bot, BookOpen, BellRing, Plug } from 'lucide-react'
import { Shell, Topbar, PageContent, NavItem, NavSection } from '../../components/ui'
import NotificationBell from '../../components/NotificationBell'
import InstallPWA from '../../components/InstallPWA'
import { supabase } from '../../lib/supabase'
import { REVIEW_JOB_STATUSES } from '../../lib/documentJobs'
import Dashboard from './Dashboard'
import Master from './Master'
import { presetMasterFilters } from '../../lib/masterFilters'
import Checks from './Checks'
import AuditLogs from './AuditLogs'
import UploadReview from './UploadReview'
import PastInvoices from './PastInvoices'
import DeletedInvoices from './DeletedInvoices'
import Automation from './Automation'
import HowItWorks from './HowItWorks'
import Alerts from './Alerts'
import Connections from './Connections'
import { countRecentAlerts } from '../../lib/alerts'

// Sidebar, grouped. Order inside each group is the old order.
const NAV_GROUPS = [
  { label: null, items: [
    { key: 'dashboard',   label: 'Dashboard',        icon: LayoutDashboard },
    { key: 'alerts',      label: 'Alerts',           icon: BellRing },
  ] },
  { label: 'Invoices', items: [
    { key: 'master',      label: 'Master',           icon: ListOrdered },
    { key: 'review',      label: 'Upload Review',    icon: FileSearch },
    { key: 'past',        label: 'Past Invoices',    icon: Archive },
    { key: 'deleted',     label: 'Deleted Invoices', icon: Trash2 },
  ] },
  { label: 'Payments', items: [
    { key: 'cheques',     label: 'Cheques',          icon: Receipt },
  ] },
  { label: 'System', items: [
    { key: 'automation',  label: 'Automation',       icon: Bot },
    { key: 'connections', label: 'Connections',      icon: Plug },
    { key: 'audit',       label: 'Audit Logs',       icon: ScrollText },
  ] },
  { label: 'Help', items: [
    { key: 'guide',       label: 'How It Works',     icon: BookOpen },
  ] },
]
const NAV = NAV_GROUPS.flatMap(g => g.items)

const TITLES = {
  dashboard:  { title: 'Dashboard' },
  master:     { title: 'Master', subtitle: 'All invoice records' },
  cheques:    { title: 'Cheques', subtitle: 'Payment proof from Ryder' },
  review:     { title: 'Upload Review', subtitle: 'Uploads the portal could not read cleanly' },
  past:       { title: 'Past Invoices', subtitle: 'Paid, void and cancelled' },
  deleted:    { title: 'Deleted Invoices', subtitle: 'Removed from the portal — restorable' },
  automation: { title: 'Automation', subtitle: 'Settings, emails and job runs' },
  audit:      { title: 'Audit Logs', subtitle: 'Who did what, when' },
  alerts:      { title: 'Alerts', subtitle: 'Every error and problem in one place' },
  connections: { title: 'Connections', subtitle: 'Outside services the portal depends on' },
  guide:      { title: 'How the System Works', subtitle: 'Every step, email and screen explained' },
}

const VALID = NAV.map(n => n.key)
const REVIEW_POLL_MS = 30000
const ALERTS_POLL_MS = 120000

export default function AdminApp({ user, onSignOut }) {
  // Persist the active tab so a refresh stays on the same screen.
  const [page, setPage] = useState(() => {
    const saved = localStorage.getItem('admin.page')
    return VALID.includes(saved) ? saved : 'dashboard'
  })
  const [reviewCount, setReviewCount] = useState(null)
  const [alertCount, setAlertCount]   = useState(null)

  useEffect(() => { localStorage.setItem('admin.page', page) }, [page])

  // Live "Upload Review" badge: uploads needing review or that failed.
  const fetchReviewCount = async () => {
    const { count, error } = await supabase
      .from('document_jobs')
      .select('id', { count: 'exact', head: true })
      .in('status', REVIEW_JOB_STATUSES)
    if (!error) setReviewCount(count ?? 0)
  }
  useEffect(() => {
    fetchReviewCount()
    const t = setInterval(() => { if (!document.hidden) fetchReviewCount() }, REVIEW_POLL_MS)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { fetchReviewCount() }, [page])

  // Live "Alerts" badge: connection problems + errors from the last 24 hours.
  const fetchAlertCount = () => countRecentAlerts().then(setAlertCount).catch(() => {})
  useEffect(() => {
    fetchAlertCount()
    const t = setInterval(() => { if (!document.hidden) fetchAlertCount() }, ALERTS_POLL_MS)
    return () => clearInterval(t)
  }, [])

  const badges = { review: reviewCount, alerts: alertCount }

  // Dashboard tiles / to-dos → Master with filters pre-set.
  const openMaster = (filters) => { presetMasterFilters(filters); setPage('master') }

  const NavItems = (
    <>
      {NAV_GROUPS.map(g => (
        <NavSection key={g.label || 'main'} label={g.label}>
          {g.items.map(n => (
            <NavItem key={n.key} icon={n.icon} label={n.label} active={page === n.key}
              badge={badges[n.key] > 0 ? badges[n.key] : null} onClick={() => setPage(n.key)} />
          ))}
        </NavSection>
      ))}
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
        {/* {page === 'master' && (
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 13px', borderRadius: 7, border: '1px solid #dde4ec',
            background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            color: '#4a6070', fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
        )} */}
        <InstallPWA />
        <NotificationBell />
      </Topbar>
      <PageContent>
        {page === 'dashboard'  && <Dashboard onOpenMaster={openMaster} />}
        {page === 'master'     && <Master />}
        {page === 'cheques'    && <Checks />}
        {page === 'review'     && <UploadReview onChanged={fetchReviewCount} />}
        {page === 'past'       && <PastInvoices />}
        {page === 'deleted'    && <DeletedInvoices />}
        {page === 'automation' && <Automation />}
        {page === 'audit'      && <AuditLogs />}
        {page === 'guide'      && <HowItWorks onNavigate={setPage} />}
        {page === 'alerts'      && <Alerts onNavigate={setPage} onChanged={fetchAlertCount} />}
        {page === 'connections' && <Connections onChanged={fetchAlertCount} />}
      </PageContent>
    </Shell>
  )
}
