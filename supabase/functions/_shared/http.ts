// Shared HTTP helpers for edge functions.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Returns a preflight response for OPTIONS requests, otherwise null. */
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Run work after the response is sent (Supabase EdgeRuntime), or inline as a fallback. */
export function runInBackground(work: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  const guarded = work.catch((err) => console.error('background task failed:', err))
  if (rt?.waitUntil) rt.waitUntil(guarded)
}
