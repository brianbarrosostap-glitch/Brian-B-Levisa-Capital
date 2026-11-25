import React from 'react'
import { TONE } from '../tokens'

/** Small status pill coloured by tone: success | warn | danger | info | muted. */
export default function StatusPill({ label, tone = 'muted', title, small }) {
  const t = TONE[tone] || TONE.muted
  return (
    <span title={title} style={{
      background: t.bg, color: t.text, borderRadius: 9999,
      fontSize: small ? 11 : 11.5, fontWeight: 600,
      padding: small ? '1px 7px' : '3px 10px', whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', lineHeight: 1.5,
    }}>{label}</span>
  )
}
