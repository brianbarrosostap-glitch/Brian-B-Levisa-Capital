import { useState, useEffect } from 'react'

// useState that survives switching screens and page refresh (localStorage).
// Use for filters / search / tabs the user sets — not for loaded data.
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? JSON.parse(raw) : initial
    } catch { return initial }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage blocked */ }
  }, [key, value])
  return [value, setValue]
}
