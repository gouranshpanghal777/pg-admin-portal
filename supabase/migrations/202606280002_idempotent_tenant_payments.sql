alter table public.tenants add column if not exists admission_request_id uuid;
create unique index if not exists tenants_admission_request_id_key
  on public.tenants(admission_request_id) where admission_request_id is not null;

create table if not exists public.payment_requests (
  request_id uuid primary key,
  user_id uuid not null references public.profiles(id),
  branch_id uuid not null references public.branches(id),
  result jsonb,
  created_at timestamptz not null default now()
);
alter table public.payment_requests enable row level security;

create or replace function public.record_split_payment_v2(
  p_request_id uuid,
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
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
  v_result jsonb;
begin
  if not public.has_branch_access(p_branch_id) or not public.has_permission('add_payment') then
    raise exception 'You do not have permission to add payments for this branch' using errcode = '42501';
  end if;

  insert into public.payment_requests(request_id, user_id, branch_id)
  values (p_request_id, auth.uid(), p_branch_id)
  on conflict (request_id) do nothing
  returning request_id into v_claimed;

  if v_claimed is null then
    select result into v_result from public.payment_requests
    where request_id = p_request_id and user_id = auth.uid() and branch_id = p_branch_id;
    if not found then raise exception 'Payment request key belongs to another operation' using errcode = '23505'; end if;
    return coalesce(v_result, jsonb_build_object('duplicate', true));
  end if;

  v_result := public.record_split_payment(
    p_tenant_id, p_branch_id, p_rent_amount, p_security_amount,
    p_electricity_amount, p_other_amount, p_payment_date, p_payment_mode, p_description
  );
  update public.payment_requests set result = v_result where request_id = p_request_id;
  return v_result || jsonb_build_object('request_id', p_request_id);
end;
$$;

grant execute on function public.record_split_payment_v2(uuid, uuid, uuid, numeric, numeric, numeric, numeric, date, text, text) to authenticated;

create or replace function public.admit_tenant(
  p_request_id uuid,
  p_branch_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_room_id uuid,
  p_bed_no integer,
  p_joining_date date,
  p_due_date date,
  p_monthly_rent numeric,
  p_security numeric,
  p_electricity text,
  p_electricity_amount numeric,
  p_id_proof text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_room public.rooms%rowtype;
  v_user public.profiles%rowtype;
  v_branch_name text;
  v_occupied integer;
begin
  if not public.has_branch_access(p_branch_id) or not public.has_permission('admit_tenant') then
    raise exception 'You do not have permission to admit tenants for this branch' using errcode = '42501';
  end if;

  select id into v_id from public.tenants where admission_request_id = p_request_id;
  if found then return v_id; end if;

  select * into v_room from public.rooms where id = p_room_id and branch_id = p_branch_id for update;
  if not found or v_room.status = 'Maintenance' then raise exception 'Selected room is not available' using errcode = 'P0002'; end if;
  select count(*) into v_occupied from public.tenants where room_id = p_room_id and status in ('Active', 'Notice');
  if v_occupied >= v_room.beds then raise exception 'Selected room has no vacant bed' using errcode = '23514'; end if;

  insert into public.tenants(
    branch_id, name, phone, email, room_id, bed_no, monthly_rent, security,
    security_received, electricity, electricity_amount, joining_date, due_date,
    status, id_proof, paid_this_month, admission_request_id, created_by, updated_by
  ) values (
    p_branch_id, btrim(p_name), btrim(p_phone), nullif(btrim(p_email), ''), p_room_id,
    p_bed_no, p_monthly_rent, p_security, 0, p_electricity, p_electricity_amount,
    p_joining_date, p_due_date, 'Active', nullif(p_id_proof, ''), 0, p_request_id,
    auth.uid(), auth.uid()
  ) returning id into v_id;

  select * into v_user from public.profiles where id = auth.uid();
  select name into v_branch_name from public.branches where id = p_branch_id;
  insert into public.activity_logs(branch_id, branch_name, user_id, user_name, user_role, module, action_type, description, metadata)
  values (p_branch_id, v_branch_name, auth.uid(), v_user.name, v_user.role, 'Tenants', 'Admit Tenant',
    initcap(v_user.role::text) || ' ' || v_user.name || ' admitted tenant ' || btrim(p_name) ||
      ' to Room ' || v_room.number || '. Rent: ₹' || trim(to_char(p_monthly_rent, 'FM999999990.00')) || '.',
    jsonb_build_object('tenant_id', v_id, 'request_id', p_request_id));
  return v_id;
end;
$$;

grant execute on function public.admit_tenant(uuid, uuid, text, text, text, uuid, integer, date, date, numeric, numeric, text, numeric, text) to authenticated;
