-- =============================================================
-- Connections health (admin "Connections" tab) — 2026-11-25
--   • connection_status: one row per outside service, written by the
--     check-connections edge function (hourly cron + "Check now").
--   • cron_status(): lets that function see whether the pg_cron timers run
--     (the cron schema is not exposed to the API). service_role only.
--   • hourly cron job 'check-connections'.
-- Requires 20261124000002_cron_send_emails.sql (invoke_edge_function + Vault).
-- Apply DEV first, PROD at go-live.
-- =============================================================

create table if not exists public.connection_status (
  key           text primary key,                       -- smtp | gemini | composio_gmail | ...
  label         text        not null,
  status        text        not null default 'unknown' check (status in ('ok','warning','error','unknown')),
  message       text,
  details       jsonb       not null default '{}',
  checked_at    timestamptz,
  last_ok_at    timestamptz,
  last_error_at timestamptz,
  updated_at    timestamptz not null default now()
);

alter table public.connection_status enable row level security;

drop policy if exists "connection_status: admin read" on public.connection_status;
create policy "connection_status: admin read" on public.connection_status
  for select using (public.current_user_role() = 'admin'::public.user_role);

-- Last run of each pg_cron job (read by check-connections with the service role).
create or replace function public.cron_status()
returns table (jobname text, schedule text, active boolean, last_start timestamptz, last_status text, last_message text)
language sql
security definer
set search_path = public, cron
as $$
  select j.jobname::text, j.schedule::text, j.active,
         d.start_time, d.status::text, left(d.return_message, 300)
  from cron.job j
  left join lateral (
    select start_time, status, return_message
    from cron.job_run_details r
    where r.jobid = j.jobid
    order by r.start_time desc
    limit 1
  ) d on true;
$$;

revoke all on function public.cron_status() from public, anon, authenticated;
grant execute on function public.cron_status() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'check-connections';
select cron.schedule('check-connections', '7 * * * *', $$ select public.invoke_edge_function('check-connections') $$);
