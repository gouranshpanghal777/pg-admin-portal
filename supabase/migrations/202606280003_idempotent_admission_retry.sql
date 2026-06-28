create table if not exists public.admission_requests (
  request_id uuid primary key,
  user_id uuid not null references public.profiles(id),
  branch_id uuid not null references public.branches(id),
  tenant_id uuid references public.tenants(id),
  created_at timestamptz not null default now()
);
alter table public.admission_requests enable row level security;

create or replace function public.admit_tenant_v2(
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
  v_claimed uuid;
  v_tenant_id uuid;
begin
  if not public.has_branch_access(p_branch_id) or not public.has_permission('admit_tenant') then
    raise exception 'You do not have permission to admit tenants for this branch' using errcode = '42501';
  end if;

  insert into public.admission_requests(request_id, user_id, branch_id)
  values (p_request_id, auth.uid(), p_branch_id)
  on conflict (request_id) do nothing
  returning request_id into v_claimed;

  if v_claimed is null then
    select tenant_id into v_tenant_id from public.admission_requests
    where request_id = p_request_id and user_id = auth.uid() and branch_id = p_branch_id;
    if not found then raise exception 'Admission request key belongs to another operation' using errcode = '23505'; end if;
    return v_tenant_id;
  end if;

  v_tenant_id := public.admit_tenant(
    p_request_id, p_branch_id, p_name, p_phone, p_email, p_room_id, p_bed_no,
    p_joining_date, p_due_date, p_monthly_rent, p_security, p_electricity,
    p_electricity_amount, p_id_proof
  );
  update public.admission_requests set tenant_id = v_tenant_id where request_id = p_request_id;
  return v_tenant_id;
end;
$$;

grant execute on function public.admit_tenant_v2(uuid, uuid, text, text, text, uuid, integer, date, date, numeric, numeric, text, numeric, text) to authenticated;
