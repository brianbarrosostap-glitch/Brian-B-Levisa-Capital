// Shared auth helpers.
//
// Two kinds of callers:
//   • people  — portal users with a Supabase JWT (admin / customer)
//   • machine — pg_cron jobs, which send the `x-internal-secret` header
//               (value = INTERNAL_SECRET function secret, also kept in Vault)

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { HttpError } from './http.ts'

export type Role = 'admin' | 'customer'

/** Service-role client: bypasses RLS. Use for all writes. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** True when the request carries the internal (cron) secret. */
export function isInternalCall(req: Request): boolean {
  const expected = Deno.env.get('INTERNAL_SECRET') ?? ''
  const given = req.headers.get('x-internal-secret') ?? ''
  if (expected.length < 16) return false // not configured → never trust
  return timingSafeEqual(given, expected)
}

export interface Caller {
  user: User
  role: Role
}

/** Resolves the portal user behind the Authorization header, or null. */
export async function getCaller(req: Request, admin: SupabaseClient): Promise<Caller | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  )
  const { data: { user }, error } = await anon.auth.getUser()
  if (error || !user) return null
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (!profile?.role) return null
  return { user, role: profile.role as Role }
}

/** Throws 401/403 unless the caller is a portal user with one of `roles`. */
export async function requireRole(req: Request, admin: SupabaseClient, roles: Role[]): Promise<Caller> {
  const caller = await getCaller(req, admin)
  if (!caller) throw new HttpError(401, 'Unauthorized')
  if (!roles.includes(caller.role)) throw new HttpError(403, `Forbidden — ${roles.join('/')} only`)
  return caller
}
