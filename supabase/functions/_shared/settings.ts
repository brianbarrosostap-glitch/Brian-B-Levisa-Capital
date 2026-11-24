// Reads public.app_settings (recipient addresses, timings, job switches).

import type { SupabaseClient } from '@supabase/supabase-js'

export type JobMode = 'off' | 'dry_run' | 'live'

export type JobName =
  | 'send_emails'
  | 'auto_advance_paid'
  | 'submit_to_ryder'
  | 'ryder_resubmit'
  | 'poll_mailbox'

export async function getSettings(admin: SupabaseClient): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('app_settings').select('key, value')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
}

export async function getSetting<T>(admin: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as T) ?? fallback
}

/** Per-job automation switch. Unknown/missing → 'off' (fail safe). */
export async function jobMode(admin: SupabaseClient, job: JobName): Promise<JobMode> {
  const modes = await getSetting<Record<string, JobMode>>(admin, 'automation', {})
  const mode = modes[job]
  return mode === 'live' || mode === 'dry_run' ? mode : 'off'
}

/** Writes one finished job_runs row (for jobs that only log when they did something). */
export async function logJobRun(
  admin: SupabaseClient,
  job: JobName,
  mode: JobMode,
  status: 'ok' | 'error',
  summary: Record<string, unknown>,
  error?: string,
  startedAt: Date = new Date(),
): Promise<void> {
  await admin.from('job_runs').insert({
    job,
    mode,
    status,
    summary,
    error: error ?? null,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
  })
}

/** Writes a job_runs row; returns a finisher to close it. */
export async function startJobRun(admin: SupabaseClient, job: JobName, mode: JobMode) {
  const { data } = await admin.from('job_runs').insert({ job, mode }).select('id').single()
  const id = data?.id as string | undefined
  return async (status: 'ok' | 'error', summary: Record<string, unknown>, error?: string) => {
    if (!id) return
    await admin.from('job_runs').update({
      status,
      summary,
      error: error ?? null,
      finished_at: new Date().toISOString(),
    }).eq('id', id)
  }
}
