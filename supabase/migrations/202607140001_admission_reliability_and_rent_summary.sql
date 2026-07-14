-- Migration: Admission reliability fix + rent collection summary RPC
-- Date: 2026-07-14

-- 1. Rent collection summary RPC for Dashboard cards
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
  v_expected_till_month_end numeric := 0;
  v_pending_till_today numeric := 0;
  v_previous_months_pending numeric := 0;
  v_current_month_total numeric := 0;
  v_current_month_due_till_today numeric := 0;
  v_current_month_not_yet_due numeric := 0;
  v_tenant_count integer := 0;
  v_current_month text;
begin
  if not public.has_branch_access(p_branch_id) then
    raise exception 'You do not have permission to view this branch data' using errcode = '42501';
  end if;

  v_current_month := to_char(p_as_of_date at time zone 'Asia/Kolkata', 'YYYY-MM');

  -- Expected Rent Till Month End: all outstanding rent for periods <= current month
  select
    coalesce(sum(greatest(o.agreed_amount - o.received_amount - o.advance_applied, 0)), 0),
    count(distinct o.tenant_id)
  into v_expected_till_month_end, v_tenant_count
  from public.payment_obligations o
  where o.branch_id = p_branch_id
    and o.payment_type = 'rent'
    and o.period <= v_current_month
    and o.agreed_amount - o.received_amount - o.advance_applied > 0;

  -- Previous months pending
  select coalesce(sum(greatest(o.agreed_amount - o.received_amount - o.advance_applied, 0)), 0)
  into v_previous_months_pending
  from public.payment_obligations o
  where o.branch_id = p_branch_id
    and o.payment_type = 'rent'
    and o.period < v_current_month
    and o.agreed_amount - o.received_amount - o.advance_applied > 0;

  -- Current month total outstanding
  select coalesce(sum(greatest(o.agreed_amount - o.received_amount - o.advance_applied, 0)), 0)
  into v_current_month_total
  from public.payment_obligations o
  where o.branch_id = p_branch_id
    and o.payment_type = 'rent'
    and o.period = v_current_month
    and o.agreed_amount - o.received_amount - o.advance_applied > 0;

  -- Pending Till Today: outstanding where due_date <= as_of_date
  select coalesce(sum(greatest(o.agreed_amount - o.received_amount - o.advance_applied, 0)), 0)
  into v_pending_till_today
  from public.payment_obligations o
  where o.branch_id = p_branch_id
    and o.payment_type = 'rent'
    and o.period <= v_current_month
    and o.due_date <= p_as_of_date
    and o.agreed_amount - o.received_amount - o.advance_applied > 0;

  -- Current month due till today
  select coalesce(sum(greatest(o.agreed_amount - o.received_amount - o.advance_applied, 0)), 0)
  into v_current_month_due_till_today
  from public.payment_obligations o
  where o.branch_id = p_branch_id
    and o.payment_type = 'rent'
    and o.period = v_current_month
    and o.due_date <= p_as_of_date
    and o.agreed_amount - o.received_amount - o.advance_applied > 0;

  v_current_month_not_yet_due := greatest(v_current_month_total - v_current_month_due_till_today, 0);

  return jsonb_build_object(
    'expected_till_month_end', v_expected_till_month_end,
    'pending_till_today', v_pending_till_today,
    'previous_months_pending', v_previous_months_pending,
    'current_month_total_outstanding', v_current_month_total,
    'current_month_due_till_today', v_current_month_due_till_today,
    'current_month_not_yet_due', v_current_month_not_yet_due,
    'tenant_count_with_pending', v_tenant_count,
    'calculated_at', now()
  );
end;
$$;

grant execute on function public.get_branch_rent_collection_summary(uuid, date) to authenticated;
