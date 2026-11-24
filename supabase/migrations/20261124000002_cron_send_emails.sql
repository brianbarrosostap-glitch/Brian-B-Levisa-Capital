-- =============================================================
-- Phase 1 — schedule the send-emails edge function (every 2 minutes)
--
-- PREREQUISITES (per project — dev first, prod at go-live):
--   1. Edge function `send-emails` deployed.
--   2. Function secret INTERNAL_SECRET set (random, >= 16 chars).
--   3. The same value + the project URL stored in Vault:
--        select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--        select vault.create_secret('<INTERNAL_SECRET value>',    'internal_secret');
--
-- invoke_edge_function() is reused by every later scheduled job
-- (scheduler, poll-mailbox). It never exposes the secret to clients.
-- =============================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

create or replace function public.invoke_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'internal_secret';
  if v_url is null or v_secret is null then
    raise warning 'invoke_edge_function(%): Vault secrets project_url / internal_secret are missing', p_name;
    return null;
  end if;
  return net.http_post(
    url                  := rtrim(v_url, '/') || '/functions/v1/' || p_name,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body                 := p_body,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.invoke_edge_function(text, jsonb) from public, anon, authenticated;

-- (Re)schedule idempotently.
select cron.unschedule(jobid) from cron.job where jobname = 'send-emails';
select cron.schedule('send-emails', '*/2 * * * *', $$ select public.invoke_edge_function('send-emails') $$);
