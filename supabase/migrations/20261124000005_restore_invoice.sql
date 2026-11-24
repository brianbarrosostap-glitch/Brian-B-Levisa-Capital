-- =============================================================
-- restore_deleted_invoice(deleted_id, actor) — puts a customer-deleted
-- invoice back exactly as it was (same id, same number, same status).
-- Called only by the `restore-invoice` edge function (service role).
-- Generated columns (advance_amount, factoring_fee) are recomputed.
-- =============================================================

create or replace function public.restore_deleted_invoice(p_deleted_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.deleted_invoices;
  cols text;
begin
  select * into r from public.deleted_invoices where id = p_deleted_id for update;
  if not found then
    raise exception 'Deleted invoice not found';
  end if;
  if r.restored_at is not null then
    raise exception 'Invoice % was already restored on %', r.invoice_number, r.restored_at::date;
  end if;
  if exists (select 1 from public.invoices where id = r.invoice_id) then
    raise exception 'Invoice % already exists', r.invoice_number;
  end if;
  if exists (select 1 from public.invoices where invoice_number = r.invoice_number) then
    raise exception 'Another invoice with number % exists now — delete or rename it first', r.invoice_number;
  end if;

  -- every real (non-generated) column of invoices
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
    from pg_attribute
   where attrelid = 'public.invoices'::regclass
     and attnum > 0 and not attisdropped and attgenerated = '';

  execute format(
    'insert into public.invoices (%1$s) select %1$s from jsonb_populate_record(null::public.invoices, $1)',
    cols
  ) using r.snapshot || jsonb_build_object('updated_at', now());

  update public.deleted_invoices
     set restored_at = now(), restored_by = p_actor
   where id = p_deleted_id;

  return r.invoice_id;
end;
$$;

revoke all on function public.restore_deleted_invoice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.restore_deleted_invoice(uuid, uuid) to service_role;
