-- =============================================================
-- Deleted invoices archive (replaces the n8n "invoice-removal" webhook
-- that moved the Drive file to "Removed Invoices By RZR").
--
-- delete-invoice now snapshots the full invoice row here BEFORE deleting
-- it, so the admin can see every customer deletion and restore it.
-- Back-filled from audit_logs (the generic audit trigger kept the full
-- row as old_data for every past delete).
--
-- Safe to re-run. Apply to DEV first; to PROD at go-live.
-- =============================================================

create table if not exists public.deleted_invoices (
  id                   uuid        primary key default extensions.uuid_generate_v4(),
  invoice_id           uuid        not null,                -- original invoices.id (re-used on restore)
  invoice_number       text,
  invoice_amount       numeric(12,2),
  status_at_delete     text,
  client_id            uuid        references public.clients(id) on delete set null,
  snapshot             jsonb       not null,                -- full invoices row as it was
  drive_file_id        text,
  drive_file_url       text,
  storage_path         text,                                -- set once invoices live in Storage
  deleted_by           uuid        references public.profiles(id) on delete set null,
  deleted_by_email     text,
  deleted_at           timestamptz not null default now(),
  restored_at          timestamptz,
  restored_by          uuid        references public.profiles(id) on delete set null,
  source_audit_log_id  uuid        unique,                  -- set for back-filled rows
  created_at           timestamptz not null default now()
);

create index if not exists idx_deleted_invoices_deleted_at on public.deleted_invoices (deleted_at desc);
create index if not exists idx_deleted_invoices_number     on public.deleted_invoices (invoice_number);

alter table public.deleted_invoices enable row level security;

drop policy if exists "deleted_invoices: admin all" on public.deleted_invoices;
create policy "deleted_invoices: admin all" on public.deleted_invoices
  using (public.current_user_role() = 'admin'::public.user_role)
  with check (public.current_user_role() = 'admin'::public.user_role);

-- ── Back-fill past deletions from the audit trail ────────────
insert into public.deleted_invoices (
  invoice_id, invoice_number, invoice_amount, status_at_delete, client_id,
  snapshot, drive_file_id, drive_file_url, deleted_by, deleted_by_email,
  deleted_at, source_audit_log_id
)
select
  a.record_id,
  a.old_data ->> 'invoice_number',
  nullif(a.old_data ->> 'invoice_amount', '')::numeric,
  a.old_data ->> 'status',
  (select c.id from public.clients c where c.id = (a.old_data ->> 'client_id')::uuid),
  a.old_data,
  a.old_data ->> 'drive_file_id',
  a.old_data ->> 'drive_file_url',
  (select p.id from public.profiles p where p.id = a.actor_id),
  a.actor_email,
  a.created_at,
  a.id
from public.audit_logs a
where a.table_name = 'invoices'
  and a.action = 'delete'
  and a.old_data is not null
  and a.record_id is not null
on conflict (source_audit_log_id) do nothing;
