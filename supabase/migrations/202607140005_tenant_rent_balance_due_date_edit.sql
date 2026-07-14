-- Atomic tenant detail + rent-ledger edit.
-- Payment, cashbook, invoice, security and historical activity rows are never deleted.

create or replace function public.edit_tenant_with_rent_adjustment(
  p_tenant_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_room_id uuid,
  p_bed_no integer,
  p_joining_date date,
  p_monthly_rent numeric,
  p_security numeric,
  p_electricity text,
  p_electricity_amount numeric,
  p_due_date date,
  p_id_proof text,
  p_status text,
  p_rent_period text,
  p_rent_balance numeric,
  p_rent_due_date date,
  p_adjust_rent_ledger boolean default false,
  p_apply_rent_to_pending boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_actor_name text;
  v_actor_role text;
  v_branch_name text;
  v_room_beds integer;
  v_room_status text;
  v_obligation_id uuid;
  v_received numeric := 0;
  v_payment_total numeric := 0;
  v_advance numeric := 0;
  v_old_balance numeric := 0;
  v_new_agreed numeric := 0;
  v_new_status text := 'Pending';
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to edit a tenant' using errcode = '42501';
  end if;

  select p.name, p.role into v_actor_name, v_actor_role
  from public.profiles p
  where p.id = auth.uid() and p.active is not false;

  if not found or lower(coalesce(v_actor_role, '')) <> 'admin' then
    raise exception 'Only an active admin can edit tenant rent balances' using errcode = '42501';
  end if;

  select * into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  if not public.has_branch_access(v_tenant.branch_id) then
    raise exception 'You do not have permission to edit this branch' using errcode = '42501';
  end if;

  if nullif(trim(p_name), '') is null then raise exception 'Tenant name is required'; end if;
  if nullif(trim(p_phone), '') is null then raise exception 'Phone number is required'; end if;
  if p_monthly_rent < 0 or p_security < 0 or p_electricity_amount < 0 or p_rent_balance < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '22003';
  end if;
  if p_status not in ('Active', 'Notice', 'Needs Verification') then raise exception 'Invalid tenant status'; end if;
  if p_electricity not in ('Included', 'Fixed') then raise exception 'Invalid electricity option'; end if;
  if nullif(p_id_proof, '') is not null and p_id_proof !~ '^[0-9]{12}$' then raise exception 'Aadhaar number must contain 12 digits'; end if;
  if p_rent_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid rent period'; end if;

  select r.beds, r.status into v_room_beds, v_room_status
  from public.rooms r
  where r.id = p_room_id and r.branch_id = v_tenant.branch_id;

  if not found then raise exception 'Selected room does not belong to this branch'; end if;
  if v_room_status = 'Maintenance' and p_room_id <> v_tenant.room_id then raise exception 'Selected room is under maintenance'; end if;
  if p_bed_no < 1 or p_bed_no > v_room_beds then raise exception 'Invalid bed number'; end if;

  if exists (
    select 1 from public.tenants t
    where t.id <> p_tenant_id
      and t.room_id = p_room_id
      and t.bed_no = p_bed_no
      and t.status in ('Active', 'Notice', 'Needs Verification')
  ) then
    raise exception 'The selected bed is already occupied';
  end if;

  update public.tenants
  set name = upper(trim(p_name)),
      phone = trim(p_phone),
      email = nullif(trim(p_email), ''),
      room_id = p_room_id,
      bed_no = p_bed_no,
      joining_date = p_joining_date,
      monthly_rent = p_monthly_rent,
      security = p_security,
      electricity = p_electricity,
      electricity_amount = p_electricity_amount,
      due_date = p_due_date,
      id_proof = nullif(p_id_proof, ''),
      status = p_status,
      updated_by = auth.uid()
  where id = p_tenant_id;

  if p_apply_rent_to_pending then
    update public.payment_obligations
    set agreed_amount = greatest(received_amount + advance_applied, p_monthly_rent),
        status = case
          when received_amount + advance_applied >= greatest(received_amount + advance_applied, p_monthly_rent) then 'Paid'
          when received_amount + advance_applied > 0 then 'Partial'
          else 'Pending'
        end
    where tenant_id = p_tenant_id
      and payment_type = 'rent'
      and received_amount + advance_applied < agreed_amount;
  end if;

  if p_adjust_rent_ledger then
    if p_rent_due_date is null then raise exception 'Rent due date is required'; end if;

    select coalesce(sum(p.amount), 0) into v_payment_total
    from public.payments p
    where p.tenant_id = p_tenant_id
      and lower(p.payment_type) = 'rent'
      and p.month = p_rent_period;

    select po.id,
           greatest(coalesce(po.received_amount, 0), v_payment_total),
           coalesce(po.advance_applied, 0),
           greatest(coalesce(po.agreed_amount, 0) - greatest(coalesce(po.received_amount, 0), v_payment_total) - coalesce(po.advance_applied, 0), 0)
      into v_obligation_id, v_received, v_advance, v_old_balance
    from public.payment_obligations po
    where po.tenant_id = p_tenant_id
      and po.payment_type = 'rent'
      and po.period = p_rent_period
    order by po.id
    limit 1
    for update;

    if found then
      v_new_agreed := v_received + v_advance + p_rent_balance;
      v_new_status := case
        when p_rent_balance <= 0 then 'Paid'
        when v_received + v_advance > 0 then 'Partial'
        else 'Pending'
      end;

      update public.payment_obligations
      set agreed_amount = v_new_agreed,
          received_amount = v_received,
          due_date = p_rent_due_date,
          status = v_new_status
      where id = v_obligation_id;
    elsif p_rent_balance > 0 then
      v_received := v_payment_total;
      v_new_agreed := v_received + p_rent_balance;
      v_new_status := case when v_received > 0 then 'Partial' else 'Pending' end;

      insert into public.payment_obligations (
        id, branch_id, tenant_id, period, payment_type,
        agreed_amount, received_amount, advance_applied, due_date, status, created_by
      ) values (
        gen_random_uuid(), v_tenant.branch_id, p_tenant_id, p_rent_period, 'rent',
        v_new_agreed, v_received, 0, p_rent_due_date, v_new_status, auth.uid()
      );
    end if;
  end if;

  update public.rooms r
  set status = case
        when r.status = 'Maintenance' then r.status
        when (
          select count(*) from public.tenants t
          where t.room_id = r.id and t.status in ('Active', 'Notice', 'Needs Verification')
        ) >= r.beds then 'Occupied'
        else 'Vacant'
      end,
      updated_by = auth.uid()
  where r.id in (v_tenant.room_id, p_room_id);

  select b.name into v_branch_name from public.branches b where b.id = v_tenant.branch_id;

  insert into public.activity_logs (
    id, branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    gen_random_uuid(), v_tenant.branch_id, coalesce(v_branch_name, ''), auth.uid(),
    coalesce(v_actor_name, 'Admin'), lower(v_actor_role), 'Tenants', 'Edit Tenant',
    case when p_adjust_rent_ledger
      then format('Admin %s edited tenant %s and adjusted %s rent balance to ₹%s with due date %s. Existing payment and transaction history was preserved.', coalesce(v_actor_name, ''), upper(trim(p_name)), p_rent_period, p_rent_balance, p_rent_due_date)
      else format('Admin %s edited tenant %s details. Rent ledger and payment history were left unchanged.', coalesce(v_actor_name, ''), upper(trim(p_name)))
    end,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'rent_period', p_rent_period,
      'old_rent_balance', v_old_balance,
      'new_rent_balance', p_rent_balance,
      'rent_due_date', p_rent_due_date,
      'ledger_adjusted', p_adjust_rent_ledger,
      'other_pending_rent_updated', p_apply_rent_to_pending
    )
  );

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'rent_period', p_rent_period,
    'rent_balance', p_rent_balance,
    'ledger_adjusted', p_adjust_rent_ledger
  );
end;
$$;

grant execute on function public.edit_tenant_with_rent_adjustment(uuid, text, text, text, uuid, integer, date, numeric, numeric, text, numeric, date, text, text, text, numeric, date, boolean, boolean) to authenticated;

-- Make manually edited obligation due dates authoritative in both dashboard RPCs.
-- Also reconcile stale obligation.received_amount with actual rent payment rows.
do $$
declare
  v_definition text;
  v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.get_branch_rent_collection_summary(uuid,date)'::regprocedure,
    'public.get_branch_rent_breakdown(uuid,date)'::regprocedure
  ] loop
    select pg_get_functiondef(v_signature) into v_definition;

    if position('po.advance_applied, po.due_date' in v_definition) = 0 then
      if position('select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied' in v_definition) = 0 then
        raise exception 'Expected payment obligation projection was not found in %', v_signature;
      end if;
      v_definition := replace(
        v_definition,
        'select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied',
        'select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied, po.due_date'
      );
    end if;

    if position('coalesce(eo.due_date, tp.computed_due_date) as computed_due_date' in v_definition) = 0 then
      if position('tp.computed_due_date,' in v_definition) = 0 then
        raise exception 'Expected computed due date projection was not found in %', v_signature;
      end if;
      v_definition := replace(
        v_definition,
        'tp.computed_due_date,',
        'coalesce(eo.due_date, tp.computed_due_date) as computed_due_date,'
      );
    end if;

    v_definition := replace(
      v_definition,
      'when eo.tenant_id is not null then coalesce(eo.received_amount, 0)',
      'when eo.tenant_id is not null then greatest(coalesce(eo.received_amount, 0), coalesce(ps.paid, 0))'
    );

    execute v_definition;
  end loop;
end;
$$;

comment on function public.edit_tenant_with_rent_adjustment(uuid, text, text, text, uuid, integer, date, numeric, numeric, text, numeric, date, text, text, text, numeric, date, boolean, boolean) is
  'Atomically edits tenant details and optionally one rent obligation while preserving all payment, cashbook, invoice, security and historical activity rows.';
