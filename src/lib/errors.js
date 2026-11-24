// Best-effort readable message from a Supabase / edge-function error.
// FunctionsHttpError keeps the HTTP Response in `context`; its JSON body
// usually carries `{ error }` or `{ message }`.
export async function errorMessage(e, fallback = 'Something went wrong') {
  try {
    const res = e?.context
    if (res && typeof res.clone === 'function') {
      const body = await res.clone().json().catch(() => null)
      const msg = body?.error || body?.message
      if (msg) return typeof msg === 'string' ? msg : JSON.stringify(msg)
    }
  } catch { /* fall through */ }
  return e?.message || (typeof e === 'string' ? e : fallback)
}
