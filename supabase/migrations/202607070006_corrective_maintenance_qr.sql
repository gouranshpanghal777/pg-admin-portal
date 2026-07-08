-- Corrective migration: fix two production bugs in branch maintenance QR
-- Safe to run on the already-migrated database (idempotent).

-- BUG 1 FIX: Add a default value for maintenance_token using built-in functions only.
-- The app's persistAppData upserts branches WITHOUT maintenance_token (it never sends it).
-- With NOT NULL and no default, every branch update violates the constraint.
-- md5, random, clock_timestamp are all built-in PostgreSQL functions (no pgcrypto needed).
alter table public.branches
  alter column maintenance_token set default md5(random()::text || clock_timestamp()::text);

-- BUG 2 FIX: Replace gen_random_bytes (pgcrypto extension) with built-in md5 for
-- ticket number generation. The pgcrypto extension is not available in this Supabase project.
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
  -- Ticket number: MT-XXXXXX using md5 (always available) instead of gen_random_bytes (pgcrypto)
  v_ticket_number := 'MT-' || upper(substr(md5(random()::text), 1, 6));

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

-- Re-grant execute with explicit signatures (idempotent)
grant execute on function public.get_branch_from_maintenance_token(text) to anon, authenticated;
grant execute on function public.get_rooms_for_maintenance_token(text) to anon, authenticated;
grant execute on function public.submit_public_maintenance_request(text, uuid, text, text, text) to anon, authenticated;
