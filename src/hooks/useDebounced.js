import { useState, useEffect } from 'react'

/** `value`, but only after it has stopped changing for `ms` (search boxes → one query per pause). */
export function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}
