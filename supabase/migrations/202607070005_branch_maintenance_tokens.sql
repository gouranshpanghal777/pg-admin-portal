-- Branch-specific public maintenance QR tokens
-- Each branch gets a unique permanent token for the public maintenance request form.

-- 1. Add maintenance_token column to branches
alter table public.branches
  add column if not exists maintenance_token text;

-- Generate unique tokens for every existing branch that does not have one
update public.branches
  set maintenance_token = encode(gen_random_bytes(16), 'hex')
  where maintenance_token is null;

-- Enforce not-null and uniqueness after backfill
alter table public.branches
  alter column maintenance_token set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'branches_maintenance_token_unique'
    and conrelid = 'public.branches'::regclass
  ) then
    alter table public.branches add constraint branches_maintenance_token_unique unique (maintenance_token);
  end if;
end;
$$;

-- 2. Add ticket_number column to maintenance_tickets for public-submitted tickets
alter table public.maintenance_tickets
  add column if not exists ticket_number text;

-- 3. RPC: validate a maintenance token and return the branch id and name
create or replace function public.get_branch_from_maintenance_token(token text)
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select id, name from public.branches
  where maintenance_token = token and active = true
  limit 1;
$$;

-- 4. RPC: return only room id and number for the branch identified by the token
create or replace function public.get_rooms_for_maintenance_token(token text)
returns table (id uuid, number text)
language sql stable security definer set search_path = public
as $$
  select r.id, r.number
  from public.branches b
  join public.rooms r on r.branch_id = b.id
  where b.maintenance_token = token and b.active = true
  order by r.number;
$$;

-- 5. RPC: submit a public maintenance request (security definer, no auth required)
-- Validates token, room-branch match, and input fields before inserting.
create or replace function public.submit_public_maintenance_request(
  token text,
  room_id uuid,
  tenant_name text,
  mobile text,
  complaint text
)
returns table (ticket_id uuid, ticket_number text, branch_name text)
language plpgsql security definer set search_path = public
as $$
declare
  v_branch_id uuid;
  v_branch_name text;
  v_ticket_id uuid;
  v_ticket_number text;
  v_room_branch_id uuid;
begin
  -- --- Input validation ---

  -- tenant_name: required, 1-100 characters
  if tenant_name is null or length(trim(tenant_name)) < 1 then
    raise exception 'VALIDATION_ERROR' using hint = 'Tenant name is required';
  end if;
  if length(trim(tenant_name)) > 100 then
    raise exception 'VALIDATION_ERROR' using hint = 'Tenant name must be 100 characters or fewer';
  end if;

  -- mobile: required, exactly 10 digits, must start with 6-9 (Indian mobile)
  if mobile is null then
    raise exception 'VALIDATION_ERROR' using hint = 'Mobile number is required';
  end if;
  if not (mobile ~ '^[6-9][0-9]{9}$') then
    raise exception 'VALIDATION_ERROR' using hint = 'Invalid mobile number. Must be a 10-digit Indian mobile number starting with 6-9';
  end if;

  -- complaint: required, 5-2000 characters
  if complaint is null or length(trim(complaint)) < 5 then
    raise exception 'VALIDATION_ERROR' using hint = 'Please describe the problem in at least 5 characters';
  end if;
  if length(trim(complaint)) > 2000 then
    raise exception 'VALIDATION_ERROR' using hint = 'Complaint must be 2000 characters or fewer';
  end if;

  -- --- Token validation ---
  select b.id, b.name into v_branch_id, v_branch_name
  from public.branches b
  where b.maintenance_token = token and b.active = true;

  if v_branch_id is null then
    raise exception 'INVALID_TOKEN' using hint = 'Invalid or expired maintenance token';
  end if;

  -- --- Room validation (must belong to the token's branch) ---
  select r.branch_id into v_room_branch_id
  from public.rooms r
  where r.id = room_id;

  if v_room_branch_id is null then
    raise exception 'INVALID_ROOM' using hint = 'Room not found';
  end if;

  if v_room_branch_id != v_branch_id then
    raise exception 'ROOM_MISMATCH' using hint = 'Room does not belong to this branch';
  end if;

  -- --- Insert the ticket ---
  v_ticket_number := 'MT-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 6));

  insert into public.maintenance_tickets (
    branch_id, title, status, room_id, tenant_id, category, priority,
    raised_date, assigned_to, description, ticket_number, created_by, updated_by,
    created_at, updated_at
  ) values (
    v_branch_id,
    complaint,
    'Open',
    room_id,
    null,
    'Tenant Request',
    'Medium',
    current_date,
    'Pending',
    'Tenant Name: ' || tenant_name || E'\nMobile: ' || mobile || E'\nComplaint: ' || complaint,
    v_ticket_number,
    null,
    null,
    now(),
    now()
  )
  returning id into v_ticket_id;

  -- Return result
  return query
  select v_ticket_id::uuid, v_ticket_number::text, v_branch_name::text;
end;
$$;

-- 6. Grant execute permissions to anon and authenticated roles
-- These RPCs are security definer, but explicit grants prevent future permission issues.
-- Signatures use parameter types only (no parameter names) for unambiguous matching.
grant execute on function public.get_branch_from_maintenance_token(text) to anon, authenticated;
grant execute on function public.get_rooms_for_maintenance_token(text) to anon, authenticated;
grant execute on function public.submit_public_maintenance_request(text, uuid, text, text, text) to anon, authenticated;
