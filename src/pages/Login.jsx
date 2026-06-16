import React, { useState } from 'react'
import { Layers, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { C } from '../tokens'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })

    if (signInErr) {
      const msg = signInErr.message || ''
      if (/email not confirmed/i.test(msg)) {
        // Hosted project has email confirmations on and this user hasn't verified.
        setError('Your email isn’t verified yet. Check your inbox for the confirmation link, or have an admin confirm the user in Supabase → Authentication → Users.')
      } else if (/invalid login credentials/i.test(msg)) {
        setError('Incorrect email or password. Please try again.')
      } else {
        // Surface anything unexpected (network, rate limit, config) instead of masking it.
        setError(msg || 'Sign-in failed. Please try again.')
      }
    }
    // On success, onAuthStateChange in App.jsx will receive the session
    // and route to the correct portal automatically — no action needed here.

    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(150deg, #edf7f2 0%, #f8fafc 60%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif', padding: 24,
    }}>
      {/* Logo lockup */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 46, height: 46, borderRadius: 11, background: C.primary,
          boxShadow: '0 4px 16px rgba(0,121,83,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Layers size={24} color="#fff" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.textB, letterSpacing: '-0.02em' }}>
            Levisa Capital
          </div>
          <div style={{
            fontSize: 11, color: C.textMut, textTransform: 'uppercase',
            letterSpacing: '0.06em', marginTop: 3,
          }}>
            Invoice Factoring Portal
          </div>
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: '#fff', borderRadius: 14, border: `1px solid ${C.border}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: 36, width: 400, maxWidth: '100%',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.textB, marginBottom: 4 }}>
          Welcome back
        </div>
        <div style={{ fontSize: 13, color: C.textSm, marginBottom: 24, lineHeight: 1.5 }}>
          Sign in with your email and password. You'll be taken to your portal automatically.
        </div>

        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#fff8f8', border: '1px solid #fecaca',
            borderRadius: 8, padding: '10px 13px', marginBottom: 18,
            fontSize: 13, color: '#991b1b',
          }}>
            <AlertCircle size={15} color="#dc2626" style={{ flexShrink: 0 }} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Email */}
          <div>
            <label style={{
              display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSm,
              marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              Email Address
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email" autoFocus
              placeholder="you@example.com"
              style={{
                width: '100%', padding: '9px 13px', borderRadius: 8,
                border: `1px solid ${error ? '#fca5a5' : C.borderMd}`,
                fontSize: 13, color: C.text, outline: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = C.primary}
              onBlur={e => e.target.style.borderColor = error ? '#fca5a5' : C.borderMd}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{
              display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSm,
              marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password} onChange={e => setPassword(e.target.value)}
                required autoComplete="current-password"
                placeholder="••••••••"
                style={{
                  width: '100%', padding: '9px 40px 9px 13px', borderRadius: 8,
                  border: `1px solid ${error ? '#fca5a5' : C.borderMd}`,
                  fontSize: 13, color: C.text, outline: 'none', boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = C.primary}
                onBlur={e => e.target.style.borderColor = error ? '#fca5a5' : C.borderMd}
              />
              <button
                type="button" onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                  display: 'flex', alignItems: 'center', color: C.textMut,
                }}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit" disabled={loading || !email || !password}
            style={{
              marginTop: 4,
              width: '100%', padding: '10px 0',
              borderRadius: 8, border: 'none',
              background: loading || !email || !password ? '#9ecfbd' : C.primary,
              color: '#fff', fontWeight: 700, fontSize: 14,
              cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', letterSpacing: '-0.01em',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div style={{ fontSize: 12, color: C.textMut, textAlign: 'center', marginTop: 18 }}>
          Need access? Contact{' '}
          <a href="mailto:brian@levisacapital.com" style={{ color: C.primary, textDecoration: 'none', fontWeight: 600 }}>
            brian@levisacapital.com
          </a>
        </div>
      </div>

      {/* Role hint */}
      <div style={{
        marginTop: 20, display: 'flex', gap: 16,
        fontSize: 11.5, color: C.textMut,
      }}>
        <span>🏢 Admin: divyanshu.sharma@growwstacks.com</span>
        <span>·</span>
        <span>📄 Client: divyanshutest2@gmail.com</span>
      </div>
    </div>
  )
}
