-- =============================================================
-- Notifications — role-scoped feed for both panels
--
-- A DB trigger fires on EVERY change to invoices.status (whether the
-- change comes from the admin dashboard, an edge function, or n8n/email
-- ingest). It inserts one notification row. Both panels read this table;
-- RLS scopes what each role sees:
--   • admin    → all notifications
--   • customer → only notifications for invoices of their own client
--
-- This is a DB trigger (allowed) — NOT an external automation/poller.
-- =============================================================

do $$
begin
  if to_regclass('public.invoices') is null then
    raise exception 'public.invoices not found — wrong Supabase project? Use fhmdtbvpjqftwsbdihcu.';
  end if;
end $$;

-- ── Table ───────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid        primary key default uuid_generate_v4(),
  invoice_id  uuid        references public.invoices(id) on delete cascade,
  client_id   uuid        references public.clients(id)  on delete cascade,
  title       text        not null,
  body        text        not null default '',
  new_status  public.invoice_status,
  audience    text        not null default 'all',   -- 'all' | 'admin' | 'customer'
  read        boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_created on public.notifications(created_at desc);
create index if not exists idx_notifications_client  on public.notifications(client_id);

-- ── Trigger function: on invoices.status change → notify ────
create or replace function public.notify_on_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only when status actually changes (INSERT always notifies; UPDATE only on diff)
  if (tg_op = 'UPDATE' and new.status is distinct from old.status)
     or tg_op = 'INSERT' then
    insert into public.notifications (invoice_id, client_id, title, body, new_status)
    values (
      new.id,
      new.client_id,
      'Invoice ' || new.invoice_number || ' — ' || new.status,
      case
        when tg_op = 'INSERT' then 'New invoice ' || new.invoice_number || ' added (' || new.status || ').'
        else 'Invoice ' || new.invoice_number || ' moved to ' || new.status || '.'
      end,
      new.status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_status on public.invoices;
create trigger trg_notify_status
  after insert or update of status on public.invoices
  for each row execute procedure public.notify_on_status_change();

-- ── RLS: role-scoped visibility ─────────────────────────────
alter table public.notifications enable row level security;

drop policy if exists "notif: admin all"      on public.notifications;
drop policy if exists "notif: customer read"  on public.notifications;
drop policy if exists "notif: customer update" on public.notifications;

-- Admin sees everything
create policy "notif: admin all"
  on public.notifications for all
  using (public.current_user_role() = 'admin');

-- Customer reads only notifications tied to their own client's invoices
create policy "notif: customer read"
  on public.notifications for select
  using (
    client_id in (select id from public.clients where owner_id = auth.uid())
  );

-- Customer may mark their own notifications read
create policy "notif: customer update"
  on public.notifications for update
  using (
    client_id in (select id from public.clients where owner_id = auth.uid())
  );
