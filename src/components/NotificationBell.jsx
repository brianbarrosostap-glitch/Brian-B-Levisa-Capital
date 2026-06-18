import React, { useState, useEffect, useRef } from 'react'
import { Bell, Check } from 'lucide-react'
import { C } from '../tokens'
import { supabase } from '../lib/supabase'

const timeAgo = (ts) => {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/**
 * Shared notification bell for both panels. Reads public.notifications,
 * which is role-scoped by RLS (admin sees all; customer sees only their
 * client's invoices). Rows are written by the DB status-change trigger,
 * so this covers updates from the dashboard AND from n8n/email ingest.
 */
export default function NotificationBell({ role = 'admin' }) {
  const [open, setOpen]   = useState(false)
  const [items, setItems] = useState([])
  const ref = useRef()

  const fetchItems = async () => {
    // Role-targeted: admin sees admin+all, customer sees customer+all.
    // (RLS additionally restricts customers to their own client's rows.)
    const audiences = role === 'admin' ? ['admin', 'all'] : ['customer', 'all']
    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, body, new_status, read, created_at, audience')
      .in('audience', audiences)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) { console.error('Notifications fetch failed:', error); return }
    setItems(data || [])
  }

  useEffect(() => {
    fetchItems()
    // Light polling so new notifications appear without a full refresh.
    const t = setInterval(fetchItems, 15000)
    // Also refetch when the tab regains focus.
    const onFocus = () => fetchItems()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  // Refetch every time the dropdown is opened, for immediate freshness.
  useEffect(() => { if (open) fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const unread = items.filter(i => !i.read).length

  const markAllRead = async () => {
    const ids = items.filter(i => !i.read).map(i => i.id)
    if (!ids.length) return
    setItems(prev => prev.map(i => ({ ...i, read: true })))
    await supabase.from('notifications').update({ read: true }).in('id', ids)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        style={{
          position: 'relative', width: 34, height: 34, borderRadius: 8,
          border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Bell size={16} color={C.textSm} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16,
            padding: '0 4px', borderRadius: 9999, background: C.red, color: '#fff',
            fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 42, width: 340, maxWidth: '90vw',
          background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: '0 8px 30px rgba(0,0,0,0.16)', zIndex: 50, overflow: 'hidden',
        }}>
          <div style={{ padding: '11px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: C.primary, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {items.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: C.textMut }}>No notifications yet.</div>
            ) : (
              items.map(n => (
                <div key={n.id} style={{
                  padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
                  background: n.read ? '#fff' : '#f6fef9', display: 'flex', gap: 10,
                }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: n.read ? 'transparent' : C.primary }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>{n.title}</div>
                    <div style={{ fontSize: 11.5, color: C.textSm, marginTop: 1, lineHeight: 1.4 }}>{n.body}</div>
                    <div style={{ fontSize: 10.5, color: C.textMut, marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
