import React, { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import AdminApp from './pages/admin/AdminApp'
import CustomerApp from './pages/customer/CustomerApp'
import { C } from './tokens'
import { Layers } from 'lucide-react'

/**
 * Auth flow:
 *  1. App mounts → check for existing session (supabase.auth.getSession)
 *  2. onAuthStateChange fires on every sign-in / sign-out
 *  3. After session established, fetch profile row → read role
 *  4. role = 'admin'    → <AdminApp />
 *     role = 'customer' → <CustomerApp />
 *     no session        → <Login />
 */

export default function App() {
  const [session, setSession]   = useState(undefined)  // undefined = loading
  const [profile, setProfile]   = useState(null)
  const [profLoading, setProfLoading] = useState(false)
  const [profError, setProfError] = useState('')

  // ── Subscribe to auth state ──────────────────────────────────
  useEffect(() => {
    // Check existing session immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    // Listen for login / logout
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        setProfile(null)
        setProfError('')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Fetch profile whenever session changes ───────────────────
  useEffect(() => {
    if (!session?.user) return

    let cancelled = false
    setProfLoading(true)
    setProfError('')

    supabase
      .from('profiles')
      .select('role, full_name, initials')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // Surface the real failure instead of hanging on a spinner.
          console.error('Profile fetch failed:', error)
          setProfError(error.message || 'Could not load your profile.')
          setProfile(null)
        } else if (data) {
          setProfile(data)
        } else {
          setProfError('No profile row found for this account. Run the seed step in Supabase.')
        }
        setProfLoading(false)
      })

    return () => { cancelled = true }
  }, [session])

  // ── Loading splash ───────────────────────────────────────────
  if (session === undefined || profLoading) {
    return <LoadingScreen />
  }

  // ── Not logged in ────────────────────────────────────────────
  if (!session) {
    return <Login />
  }

  // ── Profile fetch errored — show it, don't hang ──────────────
  if (profError) {
    return (
      <ErrorScreen
        message={profError}
        onSignOut={() => supabase.auth.signOut()}
      />
    )
  }

  // ── Logged in but profile not yet loaded ─────────────────────
  if (!profile) {
    return <LoadingScreen message="Loading your profile…" />
  }

  // ── Route by role ────────────────────────────────────────────
  if (profile.role === 'admin') {
    return <AdminApp user={profile} onSignOut={() => supabase.auth.signOut()} />
  }

  if (profile.role === 'customer') {
    return <CustomerApp user={profile} onSignOut={() => supabase.auth.signOut()} />
  }

  // Unknown role — show an error (shouldn't happen with correct DB setup)
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      background: '#f2f5f8', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>Access error</div>
      <div style={{ fontSize: 13, color: C.textSm }}>
        Your account doesn't have a valid role assigned. Contact brian@levisacapital.com.
      </div>
      <button
        onClick={() => supabase.auth.signOut()}
        style={{ marginTop: 8, padding: '8px 18px', borderRadius: 7, border: 'none', background: C.primary, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
      >
        Sign Out
      </button>
    </div>
  )
}

function ErrorScreen({ message, onSignOut }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      background: '#f2f5f8', flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>Couldn't load your account</div>
      <div style={{ fontSize: 13, color: C.textSm, maxWidth: 420, lineHeight: 1.5 }}>
        {message}
      </div>
      <button
        onClick={onSignOut}
        style={{ marginTop: 8, padding: '8px 18px', borderRadius: 7, border: 'none', background: C.primary, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
      >
        Sign Out & Retry
      </button>
    </div>
  )
}

function LoadingScreen({ message = 'Loading…' }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(150deg, #edf7f2 0%, #f8fafc 60%)',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif', gap: 16,
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 11, background: C.primary,
        boxShadow: '0 4px 16px rgba(0,121,83,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Layers size={24} color="#fff" />
      </div>
      <div style={{ fontSize: 13, color: C.textMut }}>{message}</div>
    </div>
  )
}
