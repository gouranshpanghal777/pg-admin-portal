-- Additive migration for deployments created before split payment support.
alter table public.payments add column if not exists payment_type text;
alter table public.payments add column if not exists description text;
alter table public.payments add column if not exists payment_mode text not null default 'Cash';

update public.payments
set payment_type = 'rent'
where payment_type is null or btrim(payment_type) = '';

alter table public.payments alter column payment_type set default 'rent';
alter table public.payments alter column payment_type set not null;

alter table public.tenants add column if not exists security_received numeric(12,2) not null default 0;
alter table public.tenants add column if not exists security_balance numeric(12,2)
  generated always as (greatest(security - security_received, 0)) stored;

-- Keep the tenant aggregate consistent with existing security payment rows.
update public.tenants t
set security_received = coalesce((
  select sum(p.amount)
  from public.payments p
  where p.tenant_id = t.id
    and lower(replace(p.payment_type, '_', ' ')) in ('security', 'security deposit')
), 0);

create or replace function public.record_split_payment(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_rent_amount numeric default 0,
  p_security_amount numeric default 0,
  p_electricity_amount numeric default 0,
  p_other_amount numeric default 0,
  p_payment_date date default current_date,
  p_payment_mode text default 'Cash',
  p_description text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_room_number text;
  v_user_name text;
  v_user_role public.app_role;
  v_branch_name text;
  v_month text := to_char(p_payment_date, 'YYYY-MM');
  v_payment_count integer := 0;
begin
  if not public.has_branch_access(p_branch_id) or not public.has_permission('add_payment') then
    raise exception 'You do not have permission to add payments for this branch' using errcode = '42501';
  end if;

  if coalesce(p_rent_amount, 0) < 0 or coalesce(p_security_amount, 0) < 0
    or coalesce(p_electricity_amount, 0) < 0 or coalesce(p_other_amount, 0) < 0 then
    raise exception 'Payment amounts cannot be negative' using errcode = '22003';
  end if;
  if coalesce(p_rent_amount, 0) + coalesce(p_security_amount, 0)
    + coalesce(p_electricity_amount, 0) + coalesce(p_other_amount, 0) <= 0 then
    raise exception 'Enter at least one payment amount' using errcode = '22003';
  end if;

  select * into v_tenant from public.tenants
  where id = p_tenant_id and branch_id = p_branch_id
  for update;
  if not found then raise exception 'Tenant not found in the selected branch' using errcode = 'P0002'; end if;

  if coalesce(p_security_amount, 0) > v_tenant.security_balance then
    raise exception 'Security payment exceeds remaining balance of %', v_tenant.security_balance using errcode = '22003';
  end if;

  select number into v_room_number from public.rooms where id = v_tenant.room_id;
  select name, role into v_user_name, v_user_role from public.profiles where id = auth.uid();
  select name into v_branch_name from public.branches where id = p_branch_id;

  if coalesce(p_rent_amount, 0) > 0 then
    insert into public.payments(branch_id, tenant_id, amount, payment_date, month, status, payment_type, payment_mode, description, created_by)
    values (p_branch_id, p_tenant_id, p_rent_amount, p_payment_date, v_month,
      case when v_tenant.paid_this_month + p_rent_amount >= v_tenant.monthly_rent then 'Received' else 'Partial' end,
      'rent', p_payment_mode, coalesce(p_description, 'Rent collected'), auth.uid());
    insert into public.cashbook_entries(branch_id, type, amount, description, entry_date, source, created_by, updated_by)
    values (p_branch_id, 'Credit', p_rent_amount, 'Rent collected — ' || v_tenant.name || ' (Room ' || v_room_number || ')', p_payment_date, 'Payment', auth.uid(), auth.uid());
    v_payment_count := v_payment_count + 1;
  end if;

  if coalesce(p_security_amount, 0) > 0 then
    insert into public.payments(branch_id, tenant_id, amount, payment_date, month, status, payment_type, payment_mode, description, created_by)
    values (p_branch_id, p_tenant_id, p_security_amount, p_payment_date, v_month,
      case when v_tenant.security_received + p_security_amount >= v_tenant.security then 'Received' else 'Partial' end,
      'security', p_payment_mode, coalesce(p_description, 'Security deposit received'), auth.uid());
    insert into public.cashbook_entries(branch_id, type, amount, description, entry_date, source, created_by, updated_by)
    values (p_branch_id, 'Credit', p_security_amount, 'Security deposit received — ' || v_tenant.name || ' (Room ' || v_room_number || ')', p_payment_date, 'Payment', auth.uid(), auth.uid());
    v_payment_count := v_payment_count + 1;
  end if;

  if coalesce(p_electricity_amount, 0) > 0 then
    insert into public.payments(branch_id, tenant_id, amount, payment_date, month, status, payment_type, payment_mode, description, created_by)
    values (p_branch_id, p_tenant_id, p_electricity_amount, p_payment_date, v_month, 'Received', 'electricity', p_payment_mode, coalesce(p_description, 'Electricity received'), auth.uid());
    insert into public.cashbook_entries(branch_id, type, amount, description, entry_date, source, created_by, updated_by)
    values (p_branch_id, 'Credit', p_electricity_amount, 'Electricity received — ' || v_tenant.name || ' (Room ' || v_room_number || ')', p_payment_date, 'Payment', auth.uid(), auth.uid());
    v_payment_count := v_payment_count + 1;
  end if;

  if coalesce(p_other_amount, 0) > 0 then
    insert into public.payments(branch_id, tenant_id, amount, payment_date, month, status, payment_type, payment_mode, description, created_by)
    values (p_branch_id, p_tenant_id, p_other_amount, p_payment_date, v_month, 'Received', 'other', p_payment_mode, coalesce(p_description, 'Other payment received'), auth.uid());
    insert into public.cashbook_entries(branch_id, type, amount, description, entry_date, source, created_by, updated_by)
    values (p_branch_id, 'Credit', p_other_amount, coalesce(nullif(p_description, ''), 'Other payment received') || ' — ' || v_tenant.name || ' (Room ' || v_room_number || ')', p_payment_date, 'Payment', auth.uid(), auth.uid());
    v_payment_count := v_payment_count + 1;
  end if;

  update public.tenants
  set paid_this_month = paid_this_month + coalesce(p_rent_amount, 0),
      security_received = security_received + coalesce(p_security_amount, 0),
      updated_by = auth.uid(), updated_at = now()
  where id = p_tenant_id;

  insert into public.activity_logs(branch_id, branch_name, user_id, user_name, user_role, module, action_type, description, metadata)
  values (p_branch_id, v_branch_name, auth.uid(), v_user_name, v_user_role, 'Payments', 'Receive Payment',
    initcap(v_user_role::text) || ' ' || v_user_name || ' received ' ||
    concat_ws(' and ',
      case when p_rent_amount > 0 then '₹' || trim(to_char(p_rent_amount, 'FM999999990.00')) || ' rent' end,
      case when p_security_amount > 0 then '₹' || trim(to_char(p_security_amount, 'FM999999990.00')) || ' security deposit' end,
      case when p_electricity_amount > 0 then '₹' || trim(to_char(p_electricity_amount, 'FM999999990.00')) || ' electricity' end,
      case when p_other_amount > 0 then '₹' || trim(to_char(p_other_amount, 'FM999999990.00')) || ' other payment' end
    ) || ' from ' || v_tenant.name || ', Room ' || v_room_number || '.',
    jsonb_build_object('tenant_id', p_tenant_id, 'rent', p_rent_amount, 'security', p_security_amount,
      'electricity', p_electricity_amount, 'other', p_other_amount, 'payment_mode', p_payment_mode));

  return jsonb_build_object('payment_rows', v_payment_count, 'total',
    coalesce(p_rent_amount, 0) + coalesce(p_security_amount, 0) + coalesce(p_electricity_amount, 0) + coalesce(p_other_amount, 0));
end;
$$;

grant execute on function public.record_split_payment(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text) to authenticated;
