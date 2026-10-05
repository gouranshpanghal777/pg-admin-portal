-- PG95 recurring electricity terms and backwards-compatible payment handling.
-- Existing tenants begin recurring electricity from the release month; historical
-- electricity is never invented. Old fixed terms are materialized before a
-- setting/rate change so later edits cannot rewrite prior months.

alter table public.tenants
  add column if not exists electricity_effective_period text;

update public.tenants
set electricity_effective_period = to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM')
where electricity_effective_period is null;

alter table public.tenants
  alter column electricity_effective_period set default to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM'),
  alter column electricity_effective_period set not null;

alter table public.tenants drop constraint if exists tenants_electricity_effective_period_check;
alter table public.tenants
  add constraint tenants_electricity_effective_period_check
  check (electricity_effective_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

create or replace function pg95_private.materialize_fixed_electricity(p_tenant uuid,p_through_period text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  v_period text;
begin
  select * into t from public.tenants where id=p_tenant;
  if not found then raise exception 'Tenant not found' using errcode='P0002'; end if;
  if t.electricity<>'Fixed' or t.electricity_amount<=0 then return; end if;
  if p_through_period is null or p_through_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid electricity billing period'; end if;
  if p_through_period<t.electricity_effective_period then return; end if;
  for v_period in
    select to_char(gs::date,'YYYY-MM')
    from generate_series(
      to_date(t.electricity_effective_period||'-01','YYYY-MM-DD'),
      to_date(p_through_period||'-01','YYYY-MM-DD'),
      interval '1 month'
    ) gs
  loop
    insert into public.payment_obligations(
      branch_id,tenant_id,period,payment_type,agreed_amount,received_amount,advance_applied,due_date,status,created_by,source
    ) values(
      t.branch_id,t.id,v_period,'electricity',t.electricity_amount,0,0,
      public.rent_due_date_for_period(t.due_date,v_period),'Pending',auth.uid(),'electricity-fixed'
    ) on conflict (tenant_id,period,payment_type) do nothing;
  end loop;
end;
$$;

create or replace function pg95_private.preserve_electricity_terms_before_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_period text := to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM');
  previous_period text := to_char((date_trunc('month',(now() at time zone 'Asia/Kolkata')::date)-interval '1 month')::date,'YYYY-MM');
begin
  if new.electricity is distinct from old.electricity or new.electricity_amount is distinct from old.electricity_amount then
    if old.electricity='Fixed' and old.electricity_amount>0 then
      perform pg95_private.materialize_fixed_electricity(old.id,previous_period);
    end if;
    new.electricity_effective_period:=current_period;
    if new.electricity='Included' then new.electricity_amount:=0; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_preserve_electricity_terms on public.tenants;
create trigger tenants_preserve_electricity_terms
before update of electricity,electricity_amount on public.tenants
for each row execute function pg95_private.preserve_electricity_terms_before_change();

create or replace function pg95_private.receive_payment_v4(p_request uuid,p_tenant uuid,p_branch uuid,p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tenants;
  req pg95_private.ledger_requests;
  payload jsonb;
  v_result jsonb;
  amounts numeric[];
  v_amount numeric;
  d date;
  v_rent_period text;
  v_electricity_period text;
  mode text;
  reason text;
  electricity_action text;
  electricity_ob public.payment_obligations;
  sec_remaining numeric;
  ids jsonb := '[]'::jsonb;
  v_payment_id uuid;
begin
  t:=pg95_private.check_access(p_tenant,false);
  if p_branch is distinct from t.branch_id then raise exception 'Tenant does not belong to the selected branch' using errcode='42501'; end if;
  if not public.pg95_has_branch_permission(t.branch_id,'add_payment') then raise exception 'Payment permission required' using errcode='42501'; end if;
  if t.status='Left' then raise exception 'Reopen the tenant stay before receiving payments; the exit settlement must be reviewed first.'; end if;

  reason:=nullif(btrim(p_values->>'description'),'');
  d:=(p_values->>'date')::date;
  v_rent_period:=p_values->>'period';
  mode:=p_values->>'mode';
  electricity_action:=lower(coalesce(nullif(p_values->>'electricity_action',''),'auto'));
  amounts:=array[
    coalesce((p_values->>'rent')::numeric,0),
    coalesce((p_values->>'security')::numeric,0),
    coalesce((p_values->>'electricity')::numeric,0),
    coalesce((p_values->>'other')::numeric,0)
  ];

  if electricity_action='auto' then
    electricity_action:=case
      when t.electricity='Fixed' and amounts[3]>0 then 'paid'
      when t.electricity='Fixed' then 'pending'
      when t.electricity='Included' and amounts[3]>0 then 'settle-existing'
      else 'included'
    end;
  end if;

  payload:=jsonb_build_object('tenant',p_tenant,'branch',p_branch,'action','receive-v4','values',p_values||jsonb_build_object('electricity_action',electricity_action));
  select * into req from pg95_private.ledger_requests where request_id=p_request;
  if found then
    if req.actor_id<>auth.uid() or req.payload<>payload then raise exception 'Request already used with different values'; end if;
    return req.result;
  end if;
  if p_request is null then raise exception 'A request ID is required'; end if;
  if exists(select 1 from public.payment_requests where request_id=p_request) then raise exception 'This receipt was already saved by the previous version. Refresh before entering another payment.'; end if;

  foreach v_amount in array amounts loop
    if v_amount<0 or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<>round(v_amount,2) or v_amount>=10000000000 then raise exception 'Amounts must be valid non-negative rupees with at most two decimals' using errcode='22003'; end if;
  end loop;
  if d is null or d>(now() at time zone 'Asia/Kolkata')::date or v_rent_period is null or v_rent_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or mode is null or mode not in ('Cash','Online','UPI','Bank Transfer','Card') then raise exception 'Enter a valid payment date, billing month and mode'; end if;
  if v_rent_period<to_char(t.joining_date,'YYYY-MM') then raise exception 'Billing month cannot be before this stay starts'; end if;
  v_electricity_period:=to_char(d,'YYYY-MM');

  if t.electricity='Included' then
    if electricity_action not in ('included','settle-existing') then raise exception 'Electricity is included for this tenant. No new electricity charge can be created.'; end if;
    if electricity_action='included' and amounts[3]<>0 then raise exception 'Electricity is included. Use previous electricity settlement only if an older balance exists.'; end if;
    if electricity_action='settle-existing' and amounts[3]<=0 then raise exception 'Enter the electricity amount being received.'; end if;
  elsif t.electricity='Fixed' then
    if electricity_action not in ('paid','pending','exempted','settle-existing') then raise exception 'Choose whether electricity is paid, pending, exempted, or settling an older balance.'; end if;
    if electricity_action in ('paid','pending') and t.electricity_amount<=0 then raise exception 'Set a positive fixed electricity amount in Edit Tenant before billing electricity.'; end if;
    if electricity_action='paid' and amounts[3]<=0 then raise exception 'Enter the electricity amount received.'; end if;
    if electricity_action in ('pending','exempted') and amounts[3]<>0 then raise exception 'Electricity amount must be zero when marked pending or exempted.'; end if;
    if electricity_action='settle-existing' and amounts[3]<=0 then raise exception 'Enter the previous electricity amount being received.'; end if;
  else
    raise exception 'Invalid electricity setting on tenant';
  end if;
  if (select sum(x) from unnest(amounts) x)<=0 and electricity_action not in ('pending','exempted') then raise exception 'Enter at least one payment amount'; end if;

  insert into pg95_private.ledger_requests(request_id,actor_id,tenant_id,payload,result,created_at) values(p_request,auth.uid(),p_tenant,payload,null,now());
  insert into pg95_private.ledger_context(transaction_id,mode,label) values(txid_current(),'write','Receive payment');
  perform pg95_private.capture_change(p_tenant,'Payment correction');

  if t.electricity='Fixed' and electricity_action in ('paid','pending') then
    perform pg95_private.materialize_fixed_electricity(t.id,v_electricity_period);
  elsif t.electricity='Fixed' and electricity_action='exempted' then
    perform pg95_private.materialize_fixed_electricity(t.id,to_char((to_date(v_electricity_period||'-01','YYYY-MM-DD')-interval '1 month')::date,'YYYY-MM'));
  end if;

  if t.electricity='Fixed' and electricity_action in ('paid','pending','exempted') then
    select * into electricity_ob from public.payment_obligations po where po.tenant_id=t.id and po.payment_type='electricity' and po.period=v_electricity_period for update;
    if electricity_action='exempted' then
      if found and coalesce(electricity_ob.received_amount,0)+coalesce(electricity_ob.advance_applied,0)>0 then raise exception 'Electricity for % already has a payment. Revise that electricity receipt before exempting the month.',v_electricity_period; end if;
      if found then
        update public.payment_obligations set agreed_amount=0,received_amount=0,advance_applied=0,due_date=public.rent_due_date_for_period(t.due_date,v_electricity_period),status='Paid',source='electricity-exempted' where id=electricity_ob.id;
      else
        insert into public.payment_obligations(branch_id,tenant_id,period,payment_type,agreed_amount,received_amount,advance_applied,due_date,status,created_by,source)
        values(t.branch_id,t.id,v_electricity_period,'electricity',0,0,0,public.rent_due_date_for_period(t.due_date,v_electricity_period),'Paid',auth.uid(),'electricity-exempted');
      end if;
    else
      if not found then raise exception 'Electricity billing period could not be prepared' using errcode='40001'; end if;
    end if;
  end if;

  select security-security_received into sec_remaining from public.tenants where id=t.id;
  if amounts[2]>0 then
    if t.security=0 then update public.tenants set security=amounts[2] where id=t.id;
    elsif amounts[2]>sec_remaining then raise exception 'Security payment exceeds remaining balance of %',greatest(sec_remaining,0); end if;
  end if;

  v_payment_id:=pg95_private.add_payment(t.id,'rent',amounts[1],d,v_rent_period,mode,coalesce(reason,'Payment received'));
  if v_payment_id is not null then ids:=ids||jsonb_build_array(v_payment_id); end if;
  v_payment_id:=pg95_private.add_payment(t.id,'security',amounts[2],d,v_rent_period,mode,coalesce(reason,'Payment received'));
  if v_payment_id is not null then ids:=ids||jsonb_build_array(v_payment_id); end if;
  if amounts[3]>0 then
    v_payment_id:=pg95_private.add_electricity_payment_v4(t.id,amounts[3],d,v_electricity_period,mode,coalesce(reason,'Electricity received'));
    if v_payment_id is not null then ids:=ids||jsonb_build_array(v_payment_id); end if;
  end if;
  v_payment_id:=pg95_private.add_payment(t.id,'other',amounts[4],d,v_rent_period,mode,coalesce(reason,'Payment received'));
  if v_payment_id is not null then ids:=ids||jsonb_build_array(v_payment_id); end if;

  update public.tenants set paid_this_month=coalesce((select sum(o.received_amount) from public.payment_obligations o where o.tenant_id=t.id and o.payment_type='rent' and o.period=to_char(now() at time zone 'Asia/Kolkata','YYYY-MM')),0),updated_by=auth.uid() where id=t.id;
  insert into public.activity_logs(branch_id,branch_name,user_id,user_name,user_role,module,action_type,description,metadata)
  select t.branch_id,b.name,p.id,p.name,p.role,'Payments','Receive Payment',format('Receive payment for %s. Electricity: %s. %s',t.name,electricity_action,coalesce(reason,'')),jsonb_build_object('tenant_id',t.id,'payment_ids',ids,'request_id',p_request,'values',p_values,'rent',amounts[1],'security',amounts[2],'electricity',amounts[3],'electricity_action',electricity_action,'electricity_period',v_electricity_period,'other',amounts[4])
  from public.profiles p join public.branches b on b.id=t.branch_id where p.id=auth.uid();

  v_result:=jsonb_build_object('payment_ids',ids,'action','receive','electricity_action',electricity_action,'electricity_period',v_electricity_period);
  update pg95_private.ledger_requests set result=v_result where request_id=p_request;
  delete from pg95_private.ledger_context where transaction_id=txid_current();
  return v_result;
end;
$$;

create or replace function public.record_split_payment_v3(
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
  p_description text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select pg95_private.receive_payment_v4(
    p_request_id,p_tenant_id,p_branch_id,
    jsonb_build_object(
      'rent',p_rent_amount,
      'security',p_security_amount,
      'electricity',p_electricity_amount,
      'other',p_other_amount,
      'date',p_payment_date,
      'period',p_rent_period,
      'mode',p_payment_mode,
      'description',p_description,
      'electricity_action','auto'
    )
  );
$$;

revoke execute on function public.record_split_payment_v3(uuid,uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,text) from public, anon;
grant execute on function public.record_split_payment_v3(uuid,uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,text) to authenticated;

grant usage on schema pg95_private to authenticated;
grant execute on function pg95_private.receive_payment_v4(uuid,uuid,uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
