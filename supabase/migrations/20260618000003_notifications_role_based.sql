-- =============================================================
-- Make notifications ROLE-TARGETED (not a blanket DB trigger)
--
-- Previously a DB trigger inserted a notification on every status
-- change, visible to everyone within RLS. We now drop that trigger and
-- let the edge functions insert notifications with an explicit
-- `audience` ('admin' | 'customer') so each role only gets what's
-- relevant. RLS still scopes customer reads to their own client.
--
-- The bell additionally filters by audience:
--   admin    → audience in ('admin','all')
--   customer → audience in ('customer','all')  AND own client (RLS)
-- =============================================================

drop trigger  if exists trg_notify_status        on public.invoices;
drop function if exists public.notify_on_status_change();

-- Make sure the audience column exists (table created earlier).
alter table public.notifications
  add column if not exists audience text not null default 'all';

-- RLS: keep admin-all + customer-own-client. Add an audience-aware
-- customer read so customers never see admin-only rows.
drop policy if exists "notif: customer read" on public.notifications;
create policy "notif: customer read"
  on public.notifications for select
  using (
    audience in ('customer', 'all')
    and client_id in (select id from public.clients where owner_id = auth.uid())
  );
