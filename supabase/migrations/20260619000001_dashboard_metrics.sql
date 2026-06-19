-- =============================================================
-- Dynamic, date-filtered dashboard metrics
--
-- The old v_kpi view is a global aggregate with no date parameter, so
-- it cannot back a date-range-filtered dashboard. These functions take
-- a [p_start, p_end] range (on invoice_date) and return everything the
-- admin dashboard needs — every number is computed live, nothing static.
--
-- Labeling convention (RZR = the customer we advance to; Ryder = the
-- debtor who ultimately pays Lavisa) is applied in the UI, but the
-- semantics are encoded here so the right rows feed the right tile.
--
-- 3% margin is a NAMED config, not a magic number — see fn_factoring_rate.
-- Run on project fhmdtbvpjqftwsbdihcu.
-- =============================================================

do $$
begin
  if to_regclass('public.invoices') is null then
    raise exception 'public.invoices not found — wrong Supabase project? Use fhmdtbvpjqftwsbdihcu.';
  end if;
end $$;

-- ── Named margin config (easy to change later) ──────────────
create or replace function public.fn_factoring_rate()
returns numeric language sql immutable as $$ select 0.03::numeric $$;

comment on function public.fn_factoring_rate() is
  'Lavisa factoring margin (currently 3%). Change here to update Total Profit everywhere.';

-- ── Main metrics: all tiles for the selected invoice_date range ──
create or replace function public.dashboard_metrics(
  p_start date default '1900-01-01',
  p_end   date default '2999-12-31'
)
returns json language sql stable as $$
  with scoped as (
    select *
    from public.invoices
    where status not in ('Void','Cancelled')
      and invoice_date >= p_start
      and invoice_date <= p_end
  )
  select json_build_object(
    -- ── Pipeline status (count + $) ──────────────────────────
    'total_invoices_count',      (select count(*) from scoped),
    'total_invoices_value',      (select coalesce(sum(invoice_amount),0) from scoped),

    -- 'Eligible' folded in with 'Uploaded' — both are pre-request stages.
    'pending_count',             (select count(*) from scoped where status in ('Uploaded','Eligible')),
    'pending_value',             (select coalesce(sum(invoice_amount),0) from scoped where status in ('Uploaded','Eligible')),

    'awaiting_conf_count',       (select count(*) from scoped where status = 'Advance Confirmed'),
    'awaiting_conf_value',       (select coalesce(sum(invoice_amount),0) from scoped where status = 'Advance Confirmed'),

    -- 'Ready for Payment' (legacy enum value) is folded in here so every
    -- pre-payout invoice lands in this tile and nothing falls through.
    'open_payment_count',        (select count(*) from scoped where status in ('Payment Requested','Advance Agreed','Ready for Payment')),
    'open_payment_value',        (select coalesce(sum(advance_amount),0) from scoped where status in ('Payment Requested','Advance Agreed','Ready for Payment')),

    -- Advance Paid but NOT yet submitted to Ryder — money is out the door
    -- to RZR, waiting to be sent to Ryder. This was previously uncounted.
    'advance_paid_count',        (select count(*) from scoped where status = 'Advance Paid'),
    'advance_paid_value',        (select coalesce(sum(advance_amount),0) from scoped where status = 'Advance Paid'),

    'pending_ryder_count',       (select count(*) from scoped where status in ('Submitted to Ryder','Acknowledged','Resubmitted')),
    'pending_ryder_value',       (select coalesce(sum(advance_amount),0) from scoped where status in ('Submitted to Ryder','Acknowledged','Resubmitted')),

    'overdue_60_count',          (select count(*) from scoped where status in ('Submitted to Ryder','Acknowledged','Resubmitted') and ryder_submitted_at is not null and extract(day from (now() - ryder_submitted_at)) >= 60),
    'overdue_60_value',          (select coalesce(sum(advance_amount),0) from scoped where status in ('Submitted to Ryder','Acknowledged','Resubmitted') and ryder_submitted_at is not null and extract(day from (now() - ryder_submitted_at)) >= 60),

    -- ── Financial summary ────────────────────────────────────
    'total_face_value',          (select coalesce(sum(invoice_amount),0) from scoped),
    'total_advance_value',       (select coalesce(sum(advance_amount),0) from scoped where status in ('Advance Paid','Submitted to Ryder','Acknowledged','Resubmitted','Paid')),
    'total_advance_count',       (select count(*) from scoped where status in ('Advance Paid','Submitted to Ryder','Acknowledged','Resubmitted','Paid')),
    'discount_revenue',          (select coalesce(sum(factoring_fee),0) from scoped where status = 'Paid'),
    'collected_ryder_count',     (select count(*) from scoped where status = 'Paid'),
    'collected_ryder_value',     (select coalesce(sum(advance_amount),0) from scoped where status = 'Paid'),

    -- Total Profit = factoring margin × face value of fully-closed (Paid) invoices.
    'total_profit',              (select coalesce(sum(invoice_amount * public.fn_factoring_rate()),0) from scoped where status = 'Paid'),
    'factoring_rate',            public.fn_factoring_rate(),

    -- ── Open vs closed (reconciliation) ──────────────────────
    -- total = open + closed, by construction:
    --   total  = all non-Void/Cancelled (the `scoped` set)
    --   closed = Paid (cycle finished, money back from Ryder)
    --   open   = everything still in the pipeline (= total - closed)
    'closed_count',              (select count(*) from scoped where status = 'Paid'),
    'closed_value',              (select coalesce(sum(advance_amount),0) from scoped where status = 'Paid'),

    -- ── Operational metrics ──────────────────────────────────
    'active_invoice_count',      (select count(*) from scoped where status not in ('Paid')),
    'avg_days_to_advance',       (select round(avg(extract(epoch from (advance_paid_at - created_at)) / 86400)::numeric, 1) from scoped where advance_paid_at is not null),
    'avg_days_to_ryder_payment', (select round(avg(extract(epoch from (ryder_paid_at - ryder_submitted_at)) / 86400)::numeric, 1) from scoped where ryder_paid_at is not null and ryder_submitted_at is not null)
  );
$$;

comment on function public.dashboard_metrics(date, date) is
  'All admin-dashboard tile values for invoices whose invoice_date is in [p_start, p_end]. Every value live-computed.';

-- ── Chart 1: invoice volume over time (count + $ per period) ──
create or replace function public.dashboard_volume(
  p_start date default '1900-01-01',
  p_end   date default '2999-12-31',
  p_grain text default 'month'   -- 'week' | 'month'
)
returns table(period date, invoice_count bigint, invoice_value numeric)
language sql stable as $$
  select
    date_trunc(p_grain, invoice_date)::date as period,
    count(*)                                 as invoice_count,
    coalesce(sum(invoice_amount),0)          as invoice_value
  from public.invoices
  where status not in ('Void','Cancelled')
    and invoice_date >= p_start and invoice_date <= p_end
  group by 1
  order by 1;
$$;

-- ── Chart 3: profit trend (factoring margin on Paid, by period) ──
create or replace function public.dashboard_profit_trend(
  p_start date default '1900-01-01',
  p_end   date default '2999-12-31',
  p_grain text default 'month'
)
returns table(period date, profit numeric)
language sql stable as $$
  select
    date_trunc(p_grain, coalesce(paid_at::date, invoice_date))::date as period,
    coalesce(sum(invoice_amount * public.fn_factoring_rate()),0)     as profit
  from public.invoices
  where status = 'Paid'
    and invoice_date >= p_start and invoice_date <= p_end
  group by 1
  order by 1;
$$;

-- Grants — the dashboard reads these via the anon/authenticated role,
-- but RLS on invoices only lets admins see all rows; these are SECURITY
-- INVOKER (default) so they respect the caller's RLS.
grant execute on function public.dashboard_metrics(date, date)        to authenticated, anon;
grant execute on function public.dashboard_volume(date, date, text)   to authenticated, anon;
grant execute on function public.dashboard_profit_trend(date, date, text) to authenticated, anon;
grant execute on function public.fn_factoring_rate()                  to authenticated, anon;
