-- Permanent rejoin obligation support and guarded Farukhnagar ledger corrections.
-- Cashbook rows are intentionally never updated or deleted by this migration.

create or replace function public.sync_rent_obligation_from_entries(
  p_tenant_id uuid,
  p_period text,
  p_due_date date,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_monthly_rent numeric;
  v_created_by uuid;
  v_obligation_id uuid;
  v_agreed numeric;
  v_received numeric;
  v_advance numeric;
  v_status public.payment_obligations.status%TYPE;
begin
  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Invalid rent period: %', p_period;
  end if;

  select branch_id, monthly_rent, created_by
    into v_branch_id, v_monthly_rent, v_created_by
  from public.tenants
  where id = p_tenant_id;

  if not found then
    raise exception 'Tenant % not found while syncing rent obligation', p_tenant_id;
  end if;

  select id, agreed_amount
    into v_obligation_id, v_agreed
  from public.payment_obligations
  where tenant_id = p_tenant_id
    and period = p_period
    and lower(payment_type::text) = 'rent'
  order by created_at nulls last, id
  limit 1;

  v_agreed := coalesce(v_agreed, v_monthly_rent, 0);

  select coalesce(sum(amount), 0)
    into v_received
  from public.payments
  where tenant_id = p_tenant_id
    and month = p_period
    and lower(payment_type::text) = 'rent';

  select coalesce(sum(amount), 0)
    into v_advance
  from public.tenant_advances
  where tenant_id = p_tenant_id
    and period = p_period
    and lower(movement_type::text) = 'used';

  v_status := case
    when v_received + v_advance >= v_agreed then 'Paid'
    when v_received + v_advance > 0 then 'Partial'
    when p_due_date < current_date then 'Overdue'
    else 'Pending'
  end;

  if v_obligation_id is null then
    v_obligation_id := gen_random_uuid();
    insert into public.payment_obligations (
      id, branch_id, tenant_id, period, payment_type,
      agreed_amount, received_amount, advance_applied,
      due_date, status, created_by
    ) values (
      v_obligation_id, v_branch_id, p_tenant_id, p_period, 'rent',
      v_agreed, v_received, v_advance,
      p_due_date, v_status, coalesce(p_actor_id, v_created_by)
    );
  else
    update public.payment_obligations
    set received_amount = v_received,
        advance_applied = v_advance,
        due_date = p_due_date,
        status = v_status
    where id = v_obligation_id;
  end if;

  -- Remove duplicate rent obligations for the same tenant and period, retaining the canonical row.
  delete from public.payment_obligations
  where tenant_id = p_tenant_id
    and period = p_period
    and lower(payment_type::text) = 'rent'
    and id <> v_obligation_id;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'period', p_period,
    'agreed', v_agreed,
    'received', v_received,
    'advance_applied', v_advance,
    'balance', greatest(0, v_agreed - v_received - v_advance),
    'due_date', p_due_date,
    'status', v_status
  );
end;
$$;

revoke all on function public.sync_rent_obligation_from_entries(uuid, text, date, uuid) from public;

create or replace function public.rejoin_tenant_v2(
  p_tenant_id uuid,
  p_room_id uuid,
  p_bed_no integer,
  p_rejoin_date date,
  p_due_date date,
  p_monthly_rent numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_room public.rooms%rowtype;
  v_period text;
  v_history jsonb;
  v_ledger jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found';
  end if;

  if v_tenant.status::text <> 'Left' then
    raise exception 'Only a Left tenant can be rejoined';
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id
    and branch_id = v_tenant.branch_id
  for update;

  if not found or v_room.status::text = 'Maintenance' then
    raise exception 'Selected room is unavailable';
  end if;

  if p_bed_no < 1 or p_bed_no > v_room.beds then
    raise exception 'Selected bed number is invalid';
  end if;

  if exists (
    select 1 from public.tenants
    where branch_id = v_tenant.branch_id
      and room_id = p_room_id
      and bed_no = p_bed_no
      and status::text <> 'Left'
      and id <> p_tenant_id
  ) then
    raise exception 'Selected bed is already occupied';
  end if;

  v_period := to_char(p_rejoin_date, 'YYYY-MM');
  v_history := coalesce(v_tenant.rejoin_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'rejoinDate', to_char(p_rejoin_date, 'YYYY-MM-DD'),
      'dueDate', to_char(p_due_date, 'YYYY-MM-DD'),
      'roomId', p_room_id,
      'monthlyRent', p_monthly_rent,
      'initialRentReceived', 0,
      'previousLeft', v_tenant.left_details
    )
  );

  update public.tenants
  set room_id = p_room_id,
      bed_no = p_bed_no,
      monthly_rent = p_monthly_rent,
      due_date = p_due_date,
      status = 'Active',
      left_details = null,
      notice = null,
      paid_this_month = 0,
      rejoin_history = v_history,
      updated_by = auth.uid()
  where id = p_tenant_id;

  v_ledger := public.sync_rent_obligation_from_entries(
    p_tenant_id, v_period, p_due_date, auth.uid()
  );

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'branch_id', v_tenant.branch_id,
    'period', v_period,
    'ledger', v_ledger
  );
end;
$$;

grant execute on function public.rejoin_tenant_v2(uuid, uuid, integer, date, date, numeric) to authenticated;


-- Exact, audit-backed Farukhnagar correction.
-- Cashbook rows are snapshotted and compared byte-for-byte inside this transaction.
do $$
declare
  v_branch_id constant uuid := 'd179afaa-d5e4-5851-aa17-e7eae926948a';
  v_kapil_id constant uuid := 'dc5628be-088f-55b9-94c4-ff3d05b86739';
  v_harshit_id constant uuid := '1e05ecdd-9bbc-5078-8650-89d4e9734a6f';
  v_azad_id constant uuid := 'd0a6e553-d7d0-5a12-8fab-4ed42274a6e6';
  v_aarzi_id constant uuid := '8e9b6d1e-01fb-59cf-873a-0ab0665f8866';

  v_kapil_obligation constant uuid := 'c0fdc5a1-1c39-40f3-b093-204b55e37364';
  v_kapil_advance constant uuid := '1afd4a16-beb7-44cb-a995-260020e1a65d';

  v_harshit_payment constant uuid := 'e67318c1-fab9-4056-8617-a174447e56b5';
  v_harshit_july_obligation constant uuid := 'df54d45c-4bdc-435d-89e8-fbe8cfc88980';
  v_harshit_august_obligation constant uuid := '9efdc67a-3a93-4038-a112-b3432bcc9744';
  v_harshit_cashbook constant uuid := '163be4b2-5401-40fc-a251-538ddeec6690';

  v_azad_june_payment constant uuid := 'cfb866da-912a-489a-9744-e1958fd06d4e';
  v_transfer_payment constant uuid := '99083fb9-cd0e-4211-ab26-b580dd3d7f2a';
  v_transfer_cashbook constant uuid := 'adbd81bf-b861-468b-a8f6-147c8a40c13f';
  v_azad_june_obligation constant uuid := '3ec9bec8-dc67-4a99-8323-cbd385f19d78';
  v_azad_july_obligation constant uuid := '31d08116-7e1c-42d6-baaf-ae139974876f';
  v_aarzi_june_obligation constant uuid := '7248be09-ede3-453f-998d-bb55edd8f622';
  v_aarzi_july_obligation constant uuid := 'c3fdeef3-63c4-4d79-b710-5bfa449e79aa';

  v_rows integer;
  v_value text;
  v_harshit_cashbook_before jsonb;
  v_transfer_cashbook_before jsonb;
begin
  if not exists (
    select 1 from public.branches
    where id = v_branch_id and upper(trim(name)) = 'PG 95 FARUKHNAGAR'
  ) then
    raise exception 'Audit branch no longer matches PG 95 FARUKHNAGAR';
  end if;

  if not exists (select 1 from public.tenants where id = v_kapil_id and branch_id = v_branch_id and upper(trim(name)) = 'KAPIL') then
    raise exception 'Audited KAPIL tenant no longer matches';
  end if;
  if not exists (select 1 from public.tenants where id = v_harshit_id and branch_id = v_branch_id and upper(trim(name)) = 'HARSHIT KHARI') then
    raise exception 'Audited HARSHIT KHARI tenant no longer matches';
  end if;
  if not exists (select 1 from public.tenants where id = v_azad_id and branch_id = v_branch_id and upper(trim(name)) = 'AZAD IRSHAD') then
    raise exception 'Audited AZAD IRSHAD tenant no longer matches';
  end if;
  if not exists (select 1 from public.tenants where id = v_aarzi_id and branch_id = v_branch_id and upper(trim(name)) = 'AARZI IRSHAD') then
    raise exception 'Audited AARZI IRSHAD tenant no longer matches';
  end if;

  select to_jsonb(c) into v_harshit_cashbook_before
  from public.cashbook_entries c where c.id = v_harshit_cashbook;
  if v_harshit_cashbook_before is null then
    raise exception 'HARSHIT linked cashbook row is missing';
  end if;

  select to_jsonb(c) into v_transfer_cashbook_before
  from public.cashbook_entries c where c.id = v_transfer_cashbook;
  if v_transfer_cashbook_before is null then
    raise exception 'AZAD duplicate-payment linked cashbook row is missing';
  end if;

  if not exists (
    select 1 from public.payment_obligations
    where id = v_kapil_obligation
      and tenant_id = v_kapil_id
      and period = '2026-07'
      and lower(payment_type::text) = 'rent'
  ) then
    raise exception 'Audited KAPIL July obligation is missing';
  end if;

  delete from public.tenant_advances
  where id = v_kapil_advance
    and tenant_id = v_kapil_id
    and period = '2026-07'
    and lower(movement_type::text) = 'used';

  update public.payment_obligations
  set agreed_amount = 5000,
      received_amount = 0,
      advance_applied = 0,
      due_date = date '2026-07-05',
      status = 'Overdue',
      updated_at = now()
  where id = v_kapil_obligation
    and tenant_id = v_kapil_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KAPIL obligation update affected % rows', v_rows;
  end if;

  select month into v_value
  from public.payments
  where id = v_harshit_payment
    and tenant_id = v_harshit_id
    and amount = 6500
    and payment_date = date '2026-07-16'
    and lower(payment_type::text) = 'rent';
  if not found then
    raise exception 'Audited HARSHIT 16/07 payment is missing';
  end if;

  if v_value = '2026-08' then
    update public.payments
    set month = '2026-07',
        description = trim(coalesce(description, '') || ' [Corrected: July rejoin rent]')
    where id = v_harshit_payment;
  elsif v_value <> '2026-07' then
    raise exception 'HARSHIT payment has unexpected rent month %', v_value;
  end if;

  update public.payment_obligations
  set agreed_amount = 6500,
      received_amount = 6500,
      advance_applied = 0,
      due_date = date '2026-07-14',
      status = 'Paid',
      updated_at = now()
  where id = v_harshit_july_obligation
    and tenant_id = v_harshit_id
    and period = '2026-07';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'HARSHIT July obligation update affected % rows', v_rows;
  end if;

  update public.payment_obligations
  set agreed_amount = 6500,
      received_amount = 0,
      advance_applied = 0,
      due_date = date '2026-08-14',
      status = 'Pending',
      updated_at = now()
  where id = v_harshit_august_obligation
    and tenant_id = v_harshit_id
    and period = '2026-08';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'HARSHIT August obligation update affected % rows', v_rows;
  end if;

  update public.tenants
  set due_date = date '2026-08-14',
      rejoin_history = (
        select coalesce(jsonb_agg(
          case when item.value->>'rejoinDate' = '2026-07-14'
            then item.value || jsonb_build_object('dueDate', '2026-07-14')
            else item.value end
          order by item.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(coalesce(public.tenants.rejoin_history, '[]'::jsonb))
          with ordinality as item(value, ordinality)
      )
  where id = v_harshit_id;

  if not exists (
    select 1 from public.payments
    where id = v_azad_june_payment
      and tenant_id = v_azad_id
      and month = '2026-06'
      and amount = 8500
      and payment_date = date '2026-06-22'
  ) then
    raise exception 'AZAD genuine June payment is missing';
  end if;

  select tenant_id::text || '|' || month into v_value
  from public.payments
  where id = v_transfer_payment
    and amount = 8500
    and payment_date = date '2026-06-22'
    and lower(payment_type::text) = 'rent';
  if not found then
    raise exception 'Audited AZAD duplicate payment is missing';
  end if;

  if v_value = v_azad_id::text || '|2026-07' then
    update public.payments
    set tenant_id = v_aarzi_id,
        month = '2026-06',
        description = trim(coalesce(description, '') || ' [Corrected: AARZI IRSHAD June rent]')
    where id = v_transfer_payment;
  elsif v_value <> v_aarzi_id::text || '|2026-06' then
    raise exception 'Transfer payment has unexpected tenant/month %', v_value;
  end if;

  update public.payment_obligations
  set agreed_amount = 8500,
      received_amount = 8500,
      advance_applied = 0,
      status = 'Paid',
      updated_at = now()
  where id = v_azad_june_obligation
    and tenant_id = v_azad_id
    and period = '2026-06';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'AZAD June obligation update affected % rows', v_rows; end if;

  update public.payment_obligations
  set agreed_amount = 8500,
      received_amount = 0,
      advance_applied = 0,
      due_date = date '2026-07-14',
      status = 'Overdue',
      updated_at = now()
  where id = v_azad_july_obligation
    and tenant_id = v_azad_id
    and period = '2026-07';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'AZAD July obligation update affected % rows', v_rows; end if;

  update public.payment_obligations
  set agreed_amount = 8500,
      received_amount = 8500,
      advance_applied = 0,
      status = 'Paid',
      updated_at = now()
  where id = v_aarzi_june_obligation
    and tenant_id = v_aarzi_id
    and period = '2026-06';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'AARZI June obligation update affected % rows', v_rows; end if;

  update public.payment_obligations
  set agreed_amount = 8500,
      received_amount = 0,
      advance_applied = 0,
      due_date = date '2026-07-14',
      status = 'Overdue',
      updated_at = now()
  where id = v_aarzi_july_obligation
    and tenant_id = v_aarzi_id
    and period = '2026-07';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'AARZI July obligation update affected % rows', v_rows; end if;

  update public.tenants
  set due_date = date '2026-07-14'
  where id in (v_azad_id, v_aarzi_id);

  if exists (
    select 1 from public.tenant_advances
    where tenant_id = v_kapil_id and period = '2026-07'
      and lower(movement_type::text) = 'used'
  ) then
    raise exception 'KAPIL unsupported July advance usage still exists';
  end if;

  if not exists (
    select 1 from public.payment_obligations
    where id = v_kapil_obligation
      and agreed_amount = 5000
      and received_amount = 0
      and advance_applied = 0
      and greatest(0, agreed_amount - received_amount - advance_applied) = 5000
  ) then
    raise exception 'KAPIL final July balance is not 5000';
  end if;

  if not exists (
    select 1 from public.payments
    where id = v_harshit_payment and tenant_id = v_harshit_id and month = '2026-07'
  ) then
    raise exception 'HARSHIT payment was not assigned to July';
  end if;
  if not exists (
    select 1 from public.payment_obligations
    where id = v_harshit_july_obligation and received_amount = 6500 and status::text = 'Paid'
  ) then
    raise exception 'HARSHIT July is not paid';
  end if;
  if not exists (
    select 1 from public.payment_obligations
    where id = v_harshit_august_obligation
      and received_amount = 0
      and due_date = date '2026-08-14'
      and status::text = 'Pending'
  ) then
    raise exception 'HARSHIT August pending obligation is incorrect';
  end if;

  if not exists (
    select 1 from public.payments
    where id = v_transfer_payment and tenant_id = v_aarzi_id and month = '2026-06'
  ) then
    raise exception 'AZAD duplicate payment was not transferred to AARZI June';
  end if;
  if not exists (
    select 1 from public.payment_obligations
    where id = v_azad_june_obligation and received_amount = 8500 and status::text = 'Paid'
  ) or not exists (
    select 1 from public.payment_obligations
    where id = v_azad_july_obligation and received_amount = 0
      and due_date = date '2026-07-14' and status::text = 'Overdue'
  ) then
    raise exception 'AZAD final June/July ledger is incorrect';
  end if;
  if not exists (
    select 1 from public.payment_obligations
    where id = v_aarzi_june_obligation and received_amount = 8500 and status::text = 'Paid'
  ) or not exists (
    select 1 from public.payment_obligations
    where id = v_aarzi_july_obligation and received_amount = 0
      and due_date = date '2026-07-14' and status::text = 'Overdue'
  ) then
    raise exception 'AARZI final June/July ledger is incorrect';
  end if;

  if (select to_jsonb(c) from public.cashbook_entries c where c.id = v_harshit_cashbook)
      is distinct from v_harshit_cashbook_before then
    raise exception 'HARSHIT cashbook row changed unexpectedly';
  end if;
  if (select to_jsonb(c) from public.cashbook_entries c where c.id = v_transfer_cashbook)
      is distinct from v_transfer_cashbook_before then
    raise exception 'AZAD/AARZI linked cashbook row changed unexpectedly';
  end if;

  raise notice 'Exact Farukhnagar ledger correction completed; linked cashbook rows are unchanged.';
end;
$$;

