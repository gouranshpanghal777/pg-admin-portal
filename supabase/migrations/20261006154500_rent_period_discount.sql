-- PG95 period-specific rent discount / exemption.
-- Discounts reduce only the selected rent obligation. They are not payments and
-- never create Cashbook income. The next rent period continues to use the normal
-- monthly rent unless another discount is explicitly recorded.

alter table public.payment_obligations
  add column if not exists discount_amount numeric(12,2) not null default 0;

alter table public.payment_obligations
  drop constraint if exists payment_obligations_discount_amount_check;

alter table public.payment_obligations
  add constraint payment_obligations_discount_amount_check
  check (discount_amount >= 0);

create or replace function pg95_private.apply_rent_discount(
  p_tenant uuid,
  p_period text,
  p_discount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  o public.payment_obligations;
  v_paid numeric := 0;
  v_settled numeric := 0;
  v_remaining numeric := 0;
begin
  if p_discount is null or p_discount <= 0 then
    return jsonb_build_object('amount', 0, 'period', p_period);
  end if;
  if p_discount::text in ('NaN','Infinity','-Infinity')
     or p_discount <> round(p_discount, 2)
     or p_discount >= 10000000000 then
    raise exception 'Rent discount must be a valid positive rupee amount with at most two decimals' using errcode = '22003';
  end if;
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Select a valid rent month for the discount';
  end if;

  select * into t from public.tenants where id = p_tenant for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  if p_period < to_char(t.joining_date, 'YYYY-MM') then
    raise exception 'Rent discount month cannot be before this stay starts';
  end if;
  if p_period > to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM') then
    raise exception 'Rent discount can only be applied to a current or previous rent month';
  end if;

  select * into o
  from public.payment_obligations po
  where po.tenant_id = t.id
    and po.payment_type = 'rent'
    and po.period = p_period
  for update;

  if not found then
    if t.monthly_rent <= 0 then raise exception 'Set a positive rent amount before applying a discount'; end if;
    insert into public.payment_obligations(
      branch_id, tenant_id, period, payment_type, agreed_amount,
      received_amount, advance_applied, due_date, status, created_by, source, discount_amount
    ) values (
      t.branch_id, t.id, p_period, 'rent', t.monthly_rent,
      0, 0, public.rent_due_date_for_period(t.due_date, p_period),
      'Pending', auth.uid(), 'rent-discount', 0
    ) returning * into o;
  end if;

  select coalesce(sum(x.paid), 0)
  into v_paid
  from (
    select p.amount as paid
    from public.payments p
    where p.tenant_id = t.id
      and lower(p.payment_type) = 'rent'
      and p.month = p_period
      and not p.allocation_managed
    union all
    select a.amount
    from public.payment_allocations a
    join public.payment_obligations ao on ao.id = a.obligation_id
    where a.tenant_id = t.id
      and ao.payment_type = 'rent'
      and ao.period = p_period
  ) x;

  v_settled := greatest(coalesce(o.received_amount, 0), v_paid) + coalesce(o.advance_applied, 0);
  v_remaining := greatest(o.agreed_amount - v_settled, 0);

  if p_discount > v_remaining + 0.009 then
    raise exception 'Rent discount exceeds the remaining balance of % for %', v_remaining, p_period;
  end if;

  update public.payment_obligations
  set agreed_amount = agreed_amount - p_discount,
      discount_amount = discount_amount + p_discount,
      status = case
        when v_settled + 0.009 >= agreed_amount - p_discount then 'Paid'
        when v_settled > 0 then 'Partial'
        else 'Pending'
      end,
      source = case when source = 'payment-ledger' then 'rent-discount' else source end
  where id = o.id
  returning * into o;

  return jsonb_build_object(
    'amount', p_discount,
    'period', p_period,
    'agreed_after', o.agreed_amount,
    'remaining_after', greatest(o.agreed_amount - v_settled, 0),
    'total_discount', o.discount_amount
  );
end;
$$;

revoke execute on function pg95_private.apply_rent_discount(uuid,text,numeric) from public, anon, authenticated;

create or replace function pg95_private.receive_payment_v5(
  p_request uuid,
  p_tenant uuid,
  p_branch uuid,
  p_rent numeric,
  p_security numeric,
  p_electricity numeric,
  p_other numeric,
  p_payment_date date,
  p_rent_period text,
  p_mode text,
  p_description text,
  p_electricity_action text,
  p_rent_discount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  req pg95_private.ledger_requests;
  v_values jsonb;
  v_result jsonb;
  v_discount_result jsonb;
  v_total numeric;
  v_electricity_action text;
  v_use_payment_flow boolean;
begin
  v_electricity_action := lower(coalesce(nullif(p_electricity_action, ''), 'auto'));
  v_values := jsonb_build_object(
    'rent', coalesce(p_rent, 0),
    'security', coalesce(p_security, 0),
    'electricity', coalesce(p_electricity, 0),
    'other', coalesce(p_other, 0),
    'date', p_payment_date,
    'period', p_rent_period,
    'mode', p_mode,
    'description', p_description,
    'electricity_action', v_electricity_action,
    'rent_discount', coalesce(p_rent_discount, 0)
  );

  select * into req from pg95_private.ledger_requests where request_id = p_request;
  if found then
    if req.actor_id <> auth.uid() then raise exception 'Request already belongs to another user'; end if;
    if req.result->>'action' = 'receive-v5' and req.result->'v5_values' = v_values then
      return req.result;
    end if;
    raise exception 'Request already used with different values';
  end if;

  if p_request is null then raise exception 'A request ID is required'; end if;
  if coalesce(p_rent_discount, 0) < 0
     or coalesce(p_rent_discount, 0)::text in ('NaN','Infinity','-Infinity')
     or coalesce(p_rent_discount, 0) <> round(coalesce(p_rent_discount, 0), 2)
     or coalesce(p_rent_discount, 0) >= 10000000000 then
    raise exception 'Rent discount must be a valid non-negative rupee amount with at most two decimals' using errcode = '22003';
  end if;

  t := pg95_private.check_access(p_tenant, false);
  if p_branch is distinct from t.branch_id then raise exception 'Tenant does not belong to the selected branch' using errcode = '42501'; end if;
  if not public.pg95_has_branch_permission(t.branch_id, 'add_payment') then raise exception 'Payment permission required' using errcode = '42501'; end if;
  if t.status = 'Left' then raise exception 'Reopen the tenant stay before receiving payments; the exit settlement must be reviewed first.'; end if;
  if p_payment_date is null or p_payment_date > (now() at time zone 'Asia/Kolkata')::date
     or p_rent_period is null or p_rent_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     or p_mode is null or p_mode not in ('Cash','Online','UPI','Bank Transfer','Card') then
    raise exception 'Enter a valid payment date, billing month and mode';
  end if;
  if p_rent_period < to_char(t.joining_date, 'YYYY-MM') then raise exception 'Billing month cannot be before this stay starts'; end if;

  v_total := coalesce(p_rent, 0) + coalesce(p_security, 0) + coalesce(p_electricity, 0) + coalesce(p_other, 0);
  v_use_payment_flow := v_total > 0
    or v_electricity_action not in ('auto', 'included')
    or (v_electricity_action = 'auto' and t.electricity = 'Fixed');

  if v_total <= 0 and coalesce(p_rent_discount, 0) <= 0 and not v_use_payment_flow then
    raise exception 'Enter at least one payment amount or a rent discount';
  end if;

  if v_use_payment_flow then
    -- v4 performs all payment/electricity validation and writes the actual money.
    -- rent_discount is included in its idempotency payload but ignored by v4 itself.
    v_result := pg95_private.receive_payment_v4(p_request, p_tenant, p_branch, v_values);

    if coalesce(p_rent_discount, 0) > 0 then
      v_discount_result := pg95_private.apply_rent_discount(p_tenant, p_rent_period, p_rent_discount);
    else
      v_discount_result := jsonb_build_object('amount', 0, 'period', p_rent_period);
    end if;
  else
    -- Discount-only/full-exemption entry: no payment or Cashbook row is created.
    insert into pg95_private.ledger_requests(request_id, actor_id, tenant_id, payload, result, created_at)
    values(
      p_request, auth.uid(), p_tenant,
      jsonb_build_object('tenant', p_tenant, 'branch', p_branch, 'action', 'receive-v5-discount-only', 'values', v_values),
      null, now()
    );
    insert into pg95_private.ledger_context(transaction_id, mode, label)
    values(txid_current(), 'write', 'Rent discount / exemption');
    perform pg95_private.capture_change(p_tenant, 'Rent discount / exemption');
    v_discount_result := pg95_private.apply_rent_discount(p_tenant, p_rent_period, p_rent_discount);
    v_result := jsonb_build_object('payment_ids', '[]'::jsonb);
  end if;

  if coalesce(p_rent_discount, 0) > 0 then
    insert into public.activity_logs(
      branch_id, branch_name, user_id, user_name, user_role,
      module, action_type, description, metadata
    )
    select t.branch_id, b.name, p.id, p.name, p.role,
      'Payments', 'Rent Discount',
      format('Rent discount of %s applied to %s for %s. Actual money received remains separate.', p_rent_discount, p_rent_period, t.name),
      jsonb_build_object(
        'tenant_id', t.id,
        'request_id', p_request,
        'period', p_rent_period,
        'discount', p_rent_discount,
        'actual_rent_received', coalesce(p_rent, 0),
        'discount_result', v_discount_result
      )
    from public.profiles p
    join public.branches b on b.id = t.branch_id
    where p.id = auth.uid();
  end if;

  v_result := coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'action', 'receive-v5',
    'rent_discount_amount', coalesce(p_rent_discount, 0),
    'rent_discount_period', p_rent_period,
    'rent_discount_result', coalesce(v_discount_result, '{}'::jsonb),
    'v5_values', v_values
  );
  update pg95_private.ledger_requests set result = v_result where request_id = p_request;
  delete from pg95_private.ledger_context where transaction_id = txid_current();
  return v_result;
end;
$$;

grant usage on schema pg95_private to authenticated;
grant execute on function pg95_private.receive_payment_v5(uuid,uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,text,text,numeric) to authenticated;

create or replace function public.record_split_payment_v5(
  p_request_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_rent_amount numeric,
  p_security_amount numeric,
  p_electricity_amount numeric,
  p_other_amount numeric,
  p_payment_date date,
  p_rent_period text,
  p_payment_mode text,
  p_description text,
  p_electricity_action text,
  p_rent_discount_amount numeric
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select pg95_private.receive_payment_v5(
    p_request_id, p_tenant_id, p_branch_id,
    p_rent_amount, p_security_amount, p_electricity_amount, p_other_amount,
    p_payment_date, p_rent_period, p_payment_mode, p_description,
    p_electricity_action, p_rent_discount_amount
  );
$$;

revoke execute on function public.record_split_payment_v5(uuid,uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,text,text,numeric) from public, anon;
grant execute on function public.record_split_payment_v5(uuid,uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,text,text,numeric) to authenticated;

notify pgrst, 'reload schema';
