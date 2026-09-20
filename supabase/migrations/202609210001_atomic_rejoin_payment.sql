-- Prepared only. Do not apply to production until owner review and backup/restore checks are complete.
-- Makes tenant rejoin + optional first rent payment one idempotent database transaction.

create table if not exists public.rejoin_requests (
  request_id uuid primary key,
  user_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now()
);

alter table public.rejoin_requests enable row level security;
revoke all on table public.rejoin_requests from anon, authenticated;

create or replace function public.rejoin_tenant_with_payment_v1(
  p_request_id uuid,
  p_payment_request_id uuid,
  p_tenant_id uuid,
  p_room_id uuid,
  p_bed_no integer,
  p_rejoin_date date,
  p_due_date date,
  p_monthly_rent numeric,
  p_rent_received numeric default 0,
  p_payment_date date default current_date,
  p_payment_mode text default 'Cash'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_branch_id uuid;
  v_claimed uuid;
  v_existing_payload jsonb;
  v_existing_result jsonb;
  v_payload jsonb;
  v_rejoin jsonb;
  v_payment jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Rejoin request id is required.';
  end if;
  if coalesce(p_rent_received, 0) < 0 then
    raise exception 'Rent received cannot be negative.';
  end if;
  if coalesce(p_rent_received, 0) > 0 and p_payment_request_id is null then
    raise exception 'Payment request id is required when rent is received.';
  end if;

  select branch_id
  into v_branch_id
  from public.tenants
  where id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  if not public.has_branch_access(v_branch_id) or not public.has_permission('admit_tenant') then
    raise exception 'You do not have permission to rejoin tenants for this branch' using errcode = '42501';
  end if;
  if coalesce(p_rent_received, 0) > 0
     and (not public.has_branch_access(v_branch_id) or not public.has_permission('add_payment')) then
    raise exception 'You do not have permission to record the rejoin payment for this branch' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'tenant_id', p_tenant_id,
    'room_id', p_room_id,
    'bed_no', p_bed_no,
    'rejoin_date', p_rejoin_date,
    'due_date', p_due_date,
    'monthly_rent', p_monthly_rent,
    'rent_received', coalesce(p_rent_received, 0),
    'payment_request_id', p_payment_request_id,
    'payment_date', p_payment_date,
    'payment_mode', coalesce(p_payment_mode, 'Cash')
  );

  insert into public.rejoin_requests(request_id, user_id, tenant_id, branch_id, payload)
  values (p_request_id, v_user_id, p_tenant_id, v_branch_id, v_payload)
  on conflict (request_id) do nothing
  returning request_id into v_claimed;

  if v_claimed is null then
    select payload, result
    into v_existing_payload, v_existing_result
    from public.rejoin_requests
    where request_id = p_request_id
      and user_id = v_user_id
      and tenant_id = p_tenant_id
      and branch_id = v_branch_id;

    if not found then
      raise exception 'Rejoin request key belongs to another operation' using errcode = '23505';
    end if;
    if v_existing_payload is distinct from v_payload then
      raise exception 'Rejoin request values changed after the first attempt. Retry with the original values.' using errcode = '23505';
    end if;
    if v_existing_result is null then
      raise exception 'The original rejoin request has not finished yet. Retry shortly.';
    end if;
    return v_existing_result || jsonb_build_object('duplicate', true);
  end if;

  v_rejoin := public.rejoin_tenant_v2(
    p_tenant_id,
    p_room_id,
    p_bed_no,
    p_rejoin_date,
    p_due_date,
    p_monthly_rent
  );

  if coalesce(p_rent_received, 0) > 0 then
    v_payment := public.record_split_payment_v2(
      p_payment_request_id,
      p_tenant_id,
      v_branch_id,
      p_rent_received,
      0,
      0,
      0,
      p_payment_date,
      coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
      'Rejoin rent payment'
    );
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'tenant_id', p_tenant_id,
    'branch_id', v_branch_id,
    'rejoin', v_rejoin,
    'payment', v_payment
  );

  update public.rejoin_requests
  set result = v_result
  where request_id = p_request_id;

  return v_result;
end;
$function$;

revoke all on function public.rejoin_tenant_with_payment_v1(
  uuid, uuid, uuid, uuid, integer, date, date, numeric, numeric, date, text
) from public, anon;
grant execute on function public.rejoin_tenant_with_payment_v1(
  uuid, uuid, uuid, uuid, integer, date, date, numeric, numeric, date, text
) to authenticated;
