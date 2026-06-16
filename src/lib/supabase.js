import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local\n' +
    'Copy them from Supabase Dashboard → Project Settings → API'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

// ── Typed helpers ──────────────────────────────────────────────

/** Call an Edge Function (passes the current session's JWT automatically) */
export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw error
  return data
}
