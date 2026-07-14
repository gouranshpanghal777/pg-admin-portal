-- Migration: Fix rent-summary RPC to reconstruct full tenant-month ledger
-- Date: 2026-07-14
-- Bug: create_tenant_obligations trigger only inserts the joining month.
--      Months after joining have no payment_obligations rows, so the RPC
--      undercounts Expected Rent and Pending Till Today.

-- Corrected rent collection summary: reconstructs the full tenant-month ledger
create or replace function public.get_branch_rent_collection_summary(
  p_branch_id uuid,
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_month text;
  v_current_month_start date;
  v_expected numeric := 0;
  v_pending numeric := 0;
  v_prev numeric := 0;
  v_cm_total numeric := 0;
  v_cm_due numeric := 0;
  v_cm_notdue numeric := 0;
  v_tenant_count integer := 0;
begin
  if not public.has_branch_access(p_branch_id) then
    raise exception 'You do not have permission to view this branch data' using errcode = '42501';
  end if;

  v_current_month := to_char(p_as_of_date at time zone 'Asia/Kolkata', 'YYYY-MM');
  v_current_month_start := (date_trunc('month', (p_as_of_date at time zone 'Asia/Kolkata')))::date;

  with
  branch_tenants as (
    select t.id as tenant_id, t.name, t.status, t.monthly_rent, t.joining_date, t.due_date
    from public.tenants t
    where t.branch_id = p_branch_id
      and t.status in ('Active', 'Notice', 'Needs Verification', 'Left')
  ),
  tenant_periods as (
    select
      bt.tenant_id, bt.name, bt.status, bt.monthly_rent, bt.due_date,
      to_char(gs.dt, 'YYYY-MM') as period,
      public.rent_due_date_for_period(bt.due_date, to_char(gs.dt, 'YYYY-MM')) as computed_due_date
    from branch_tenants bt
    cross join lateral generate_series(
      date_trunc('month', bt.joining_date::timestamp),
      v_current_month_start,
      interval '1 month'
    ) as gs(dt)
  ),
  existing_obs as (
    select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied
    from public.payment_obligations po
    where po.branch_id = p_branch_id and po.payment_type = 'rent'
  ),
  payment_sums as (
    select p.tenant_id, p.month as period, sum(p.amount) as paid
    from public.payments p
    where p.branch_id = p_branch_id and lower(p.payment_type) = 'rent'
    group by p.tenant_id, p.month
  ),
  ledger as (
    select
      tp.tenant_id, tp.name as tenant_name, tp.status, tp.monthly_rent, tp.period,
      tp.computed_due_date,
      coalesce(eo.agreed_amount, tp.monthly_rent) as agreed,
      case
        when eo.tenant_id is not null then coalesce(eo.received_amount, 0)
        when tp.status in ('Active', 'Notice', 'Needs Verification') then coalesce(ps.paid, 0)
        else 0
      end as received,
      coalesce(eo.advance_applied, 0) as advance,
      greatest(
        coalesce(eo.agreed_amount, tp.monthly_rent)
        - case
            when eo.tenant_id is not null then coalesce(eo.received_amount, 0)
            when tp.status in ('Active', 'Notice', 'Needs Verification') then coalesce(ps.paid, 0)
            else 0
          end
        - coalesce(eo.advance_applied, 0),
        0
      ) as outstanding
    from tenant_periods tp
    left join existing_obs eo on eo.tenant_id = tp.tenant_id and eo.period = tp.period
    left join payment_sums ps on ps.tenant_id = tp.tenant_id and ps.period = tp.period
  )
  select
    coalesce(sum(case when outstanding > 0 then outstanding else 0 end), 0),
    coalesce(sum(case when outstanding > 0 and computed_due_date <= p_as_of_date then outstanding else 0 end), 0),
    coalesce(sum(case when outstanding > 0 and period < v_current_month then outstanding else 0 end), 0),
    coalesce(sum(case when outstanding > 0 and period = v_current_month then outstanding else 0 end), 0),
    coalesce(sum(case when outstanding > 0 and period = v_current_month and computed_due_date <= p_as_of_date then outstanding else 0 end), 0),
    count(distinct case when outstanding > 0 then tenant_id end)
  into v_expected, v_pending, v_prev, v_cm_total, v_cm_due, v_tenant_count
  from ledger;

  v_cm_notdue := greatest(v_cm_total - v_cm_due, 0);

  return jsonb_build_object(
    'expected_till_month_end', v_expected,
    'pending_till_today', v_pending,
    'previous_months_pending', v_prev,
    'current_month_total_outstanding', v_cm_total,
    'current_month_due_till_today', v_cm_due,
    'current_month_not_yet_due', v_cm_notdue,
    'tenant_count_with_pending', v_tenant_count,
    'calculated_at', now()
  );
end;
$$;

grant execute on function public.get_branch_rent_collection_summary(uuid, date) to authenticated;

-- Admin-only audit breakdown: tenant-by-tenant, month-by-month
create or replace function public.get_branch_rent_breakdown(
  p_branch_id uuid,
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_month text;
  v_current_month_start date;
  v_result jsonb;
begin
  if not public.has_branch_access(p_branch_id) then
    raise exception 'You do not have permission to view this branch data' using errcode = '42501';
  end if;

  v_current_month := to_char(p_as_of_date at time zone 'Asia/Kolkata', 'YYYY-MM');
  v_current_month_start := (date_trunc('month', (p_as_of_date at time zone 'Asia/Kolkata')))::date;

  with
  branch_tenants as (
    select t.id as tenant_id, t.name, t.status, t.monthly_rent, t.joining_date, t.due_date
    from public.tenants t
    where t.branch_id = p_branch_id
      and t.status in ('Active', 'Notice', 'Needs Verification', 'Left')
  ),
  tenant_periods as (
    select
      bt.tenant_id, bt.name, bt.status, bt.monthly_rent, bt.due_date,
      to_char(gs.dt, 'YYYY-MM') as period,
      public.rent_due_date_for_period(bt.due_date, to_char(gs.dt, 'YYYY-MM')) as computed_due_date
    from branch_tenants bt
    cross join lateral generate_series(
      date_trunc('month', bt.joining_date::timestamp),
      v_current_month_start,
      interval '1 month'
    ) as gs(dt)
  ),
  existing_obs as (
    select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied
    from public.payment_obligations po
    where po.branch_id = p_branch_id and po.payment_type = 'rent'
  ),
  payment_sums as (
    select p.tenant_id, p.month as period, sum(p.amount) as paid
    from public.payments p
    where p.branch_id = p_branch_id and lower(p.payment_type) = 'rent'
    group by p.tenant_id, p.month
  ),
  ledger as (
    select
      tp.tenant_id, tp.name as tenant_name, tp.status as tenant_status,
      tp.monthly_rent, tp.period, tp.computed_due_date,
      coalesce(eo.agreed_amount, tp.monthly_rent) as agreed,
      case
        when eo.tenant_id is not null then coalesce(eo.received_amount, 0)
        when tp.status in ('Active', 'Notice', 'Needs Verification') then coalesce(ps.paid, 0)
        else 0
      end as received,
      coalesce(eo.advance_applied, 0) as advance,
      greatest(
        coalesce(eo.agreed_amount, tp.monthly_rent)
        - case
            when eo.tenant_id is not null then coalesce(eo.received_amount, 0)
            when tp.status in ('Active', 'Notice', 'Needs Verification') then coalesce(ps.paid, 0)
            else 0
          end
        - coalesce(eo.advance_applied, 0),
        0
      ) as outstanding,
      eo.tenant_id is not null as has_obligation_row
    from tenant_periods tp
    left join existing_obs eo on eo.tenant_id = tp.tenant_id and eo.period = tp.period
    left join payment_sums ps on ps.tenant_id = tp.tenant_id and ps.period = tp.period
  )
  select jsonb_agg(
    jsonb_build_object(
      'tenant_id', l.tenant_id,
      'tenant_name', l.tenant_name,
      'tenant_status', l.tenant_status,
      'monthly_rent', l.monthly_rent,
      'period', l.period,
      'due_date', l.computed_due_date,
      'agreed', l.agreed,
      'received', l.received,
      'advance_applied', l.advance,
      'outstanding', l.outstanding,
      'included_in_expected', l.outstanding > 0,
      'included_in_pending', l.outstanding > 0 and l.computed_due_date <= p_as_of_date,
      'has_obligation_row', l.has_obligation_row,
      'source', case when l.has_obligation_row then 'payment_obligations' else 'synthesized' end
    ) order by l.tenant_name, l.period
  )
  from ledger l
  where l.outstanding > 0
  into v_result;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function public.get_branch_rent_breakdown(uuid, date) to authenticated;
