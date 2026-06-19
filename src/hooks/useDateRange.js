import { useState, useMemo } from 'react'

// Shared date-range state for the whole dashboard. Every query consumes
// the SAME { start, end } so no two metrics can drift out of sync.
//
// Returns ISO date strings (YYYY-MM-DD) for start/end, which the Supabase
// RPCs (dashboard_metrics / dashboard_volume / dashboard_profit_trend)
// take as p_start / p_end.

export const PRESETS = [
  { key: 'month',   label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'last6',   label: 'Last 6 Months' },
  { key: 'year',    label: 'This Year' },
  { key: 'all',     label: 'All Time' },
]

const iso = (d) => d.toISOString().slice(0, 10)

const rangeForPreset = (key) => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (key) {
    case 'month':
      return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) }
    case 'quarter': {
      const qStart = Math.floor(m / 3) * 3
      return { start: iso(new Date(y, qStart, 1)), end: iso(new Date(y, qStart + 3, 0)) }
    }
    case 'last6':
      return { start: iso(new Date(y, m - 5, 1)), end: iso(new Date(y, m + 1, 0)) }
    case 'year':
      return { start: iso(new Date(y, 0, 1)), end: iso(new Date(y, 11, 31)) }
    case 'all':
    default:
      return { start: '1900-01-01', end: '2999-12-31' }
  }
}

export function useDateRange(initialPreset = 'all') {
  const [preset, setPreset] = useState(initialPreset)        // active preset key, or 'custom'
  const [custom, setCustom] = useState({ start: '', end: '' })

  const range = useMemo(() => {
    if (preset === 'custom') {
      return {
        start: custom.start || '1900-01-01',
        end:   custom.end   || '2999-12-31',
      }
    }
    return rangeForPreset(preset)
  }, [preset, custom])

  // Choose a sensible chart grain so we don't render hundreds of bars.
  const grain = useMemo(() => {
    if (preset === 'month' || preset === 'quarter') return 'week'
    return 'month'
  }, [preset])

  const applyPreset = (key) => { setPreset(key); setCustom({ start: '', end: '' }) }
  const applyCustom = (start, end) => { setCustom({ start, end }); setPreset('custom') }

  return { preset, custom, range, grain, applyPreset, applyCustom }
}
