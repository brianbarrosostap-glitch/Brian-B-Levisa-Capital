import React, { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { C } from '../tokens'
import { getFileUrl, hasFile } from '../lib/files'

/**
 * Link to an invoice / cheque / upload file. Works for both new Storage
 * files (signed URL resolved on click) and old Google Drive links.
 *
 * props
 *   fileRef     { bucket, path, fallbackUrl } — see src/lib/files.js
 *   label       text when a file exists (default "View")
 *   emptyLabel  text when there is no file (default = label)
 *   variant     'badge' (small pill, default) | 'button' (larger pill) | 'text' (inline link)
 *   style       extra styles
 */
export default function FileLink({ fileRef, label = 'View', emptyLabel, variant = 'badge', style }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')
  const ok = hasFile(fileRef)

  const open = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!ok || busy) return
    setErr('')
    // Open the tab synchronously (inside the click) so popup blockers allow
    // it, then point it at the URL once the signed link is ready.
    const win = window.open('about:blank', '_blank')
    if (win) win.opener = null
    setBusy(true)
    try {
      const url = await getFileUrl(fileRef)
      if (!url) throw new Error('No file')
      if (win) win.location.replace(url)
      else window.open(url, '_blank', 'noopener')
    } catch (ex) {
      if (win) win.close()
      console.error('FileLink:', ex)
      setErr('Could not open the file')
    }
    setBusy(false)
  }

  const Icon = busy ? Loader2 : ExternalLink
  const text = ok ? label : (emptyLabel ?? label)

  const styles = {
    badge: {
      gap: 4, background: C.linkBg, border: `1px solid ${C.border}`, borderRadius: 6,
      color: ok ? C.link : C.textMut, fontSize: 12, padding: '2px 7px',
    },
    button: {
      gap: 6, background: C.linkBg, border: `1px solid ${ok ? '#cfdcf7' : C.border}`, borderRadius: 7,
      color: ok ? C.link : C.textMut, fontSize: 14, height: 30, boxSizing: 'border-box', padding: '0 11px', fontWeight: 600,
      whiteSpace: 'nowrap',
    },
    text: {
      gap: 3, background: 'none', border: 'none', padding: 0,
      color: ok ? C.primary : C.textMut, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
    },
  }
  const iconSize = variant === 'button' ? 13 : variant === 'text' ? 11 : 9

  return (
    <a
      href="#"
      onClick={open}
      className={ok && variant === 'button' ? 'lc-filebtn lc-focus' : 'lc-focus'}
      title={err || (ok ? undefined : 'No file uploaded')}
      style={{
        display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
        fontFamily: 'inherit', cursor: ok ? (busy ? 'wait' : 'pointer') : 'default',
        opacity: ok ? 1 : 0.5,
        ...styles[variant],
        ...(err ? { color: C.red } : {}),
        ...style,
      }}
    >
      {variant !== 'text' && <Icon size={iconSize} className={busy ? 'lc-spin' : undefined} />}
      {text}
      {variant === 'text' && <Icon size={iconSize} className={busy ? 'lc-spin' : undefined} />}
    </a>
  )
}
