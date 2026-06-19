import React, { useState, useEffect } from 'react'
import { Download } from 'lucide-react'
import { C } from '../tokens'

/**
 * "Install app" button for the PWA.
 *
 * Chromium fires `beforeinstallprompt` when the app is installable — we
 * capture it and show a button that triggers the native install dialog.
 * On iOS Safari (which has no such event) we show a hint button that
 * explains the Share → "Add to Home Screen" flow.
 * The button hides itself once installed / in standalone mode.
 */
export default function InstallPWA() {
  const [deferred, setDeferred] = useState(null)
  const [showIosHint, setShowIosHint] = useState(false)

  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone)
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  // Already installed → nothing to show.
  if (isStandalone) return null

  // Chromium: native install available.
  const handleInstall = async () => {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }

  // Show on iOS (hint) OR when a deferred prompt exists.
  if (!deferred && !isIos) return null

  return (
    <>
      <button
        onClick={() => (isIos ? setShowIosHint(true) : handleInstall())}
        title="Install app"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', height: 34, borderRadius: 8,
          border: `1px solid ${C.primary}`, background: C.primary, color: '#fff',
          fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        }}
      >
        <Download size={15} /> Install app
      </button>

      {showIosHint && (
        <div onClick={() => setShowIosHint(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(7,36,24,0.46)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 14, maxWidth: 340, padding: '20px 22px',
            boxShadow: '0 24px 70px rgba(0,0,0,0.34)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 8 }}>Install Levisa Capital</div>
            <div style={{ fontSize: 13, color: C.textSm, lineHeight: 1.55 }}>
              On iPhone/iPad: tap the <strong>Share</strong> button in Safari, then choose
              <strong> “Add to Home Screen.”</strong> The app will open fullscreen like a native app.
            </div>
            <button onClick={() => setShowIosHint(false)} style={{
              marginTop: 16, padding: '8px 14px', borderRadius: 8, border: 'none',
              background: C.primary, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>Got it</button>
          </div>
        </div>
      )}
    </>
  )
}
