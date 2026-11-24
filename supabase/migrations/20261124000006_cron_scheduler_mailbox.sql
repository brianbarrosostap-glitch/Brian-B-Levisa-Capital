-- =============================================================
-- Schedule the scheduler (every 10 min) and poll-mailbox (every 5 min).
-- Requires 20261124000002_cron_send_emails.sql (invoke_edge_function + Vault).
-- Each job still obeys its app_settings.automation switch (off by default),
-- so scheduling these does nothing until a job is switched to dry_run/live.
-- =============================================================

select cron.unschedule(jobid) from cron.job where jobname in ('scheduler', 'poll-mailbox');

select cron.schedule('scheduler',    '*/10 * * * *', $$ select public.invoke_edge_function('scheduler') $$);
select cron.schedule('poll-mailbox', '*/5 * * * *',  $$ select public.invoke_edge_function('poll-mailbox') $$);
