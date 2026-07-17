create or replace function public.move_tenant_room(
  p_tenant_id uuid,
  p_target_room_id uuid,
  p_target_bed_no integer,
  p_expected_room_id uuid,
  p_expected_bed_no integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_tenant public.tenants%rowtype;
  v_target_room public.rooms%rowtype;
  v_source_room public.rooms%rowtype;
  v_branch_name text;
  v_source_room_number text;
  v_target_room_number text;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id and active is true;
  if not found then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;

  select * into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;
  if not found then
    raise exception 'Tenant not found.' using errcode = 'P0002';
  end if;

  if v_tenant.status = 'Left' then
    raise exception 'A vacated tenant cannot be moved.';
  end if;

  if lower(v_profile.role::text) <> 'admin' then
    if not exists (
      select 1 from public.branch_assignments
      where user_id = v_user_id and branch_id = v_tenant.branch_id
    ) then
      raise exception 'You are not assigned to this branch.' using errcode = '42501';
    end if;

    if not exists (
      select 1 from public.staff_permissions
      where user_id = v_user_id
        and permission = 'move_tenant'
        and allowed is true
    ) then
      raise exception 'Move tenant permission is not enabled for your account.' using errcode = '42501';
    end if;
  end if;

  if v_tenant.room_id is distinct from p_expected_room_id
     or v_tenant.bed_no is distinct from p_expected_bed_no then
    raise exception 'Tenant room changed after this screen was opened. Refresh and try again.';
  end if;

  select * into v_target_room
  from public.rooms
  where id = p_target_room_id
  for update;
  if not found then
    raise exception 'Target room not found.' using errcode = 'P0002';
  end if;

  if v_target_room.branch_id <> v_tenant.branch_id then
    raise exception 'Tenant can only be moved within the same branch.' using errcode = '42501';
  end if;

  if v_target_room.status = 'Maintenance' then
    raise exception 'Target room is under maintenance.';
  end if;

  if p_target_bed_no < 1 or p_target_bed_no > v_target_room.beds then
    raise exception 'Selected bed number is invalid for this room.';
  end if;

  if exists (
    select 1 from public.tenants
    where room_id = p_target_room_id
      and bed_no = p_target_bed_no
      and status <> 'Left'
      and id <> p_tenant_id
  ) then
    raise exception 'Selected bed is already occupied.' using errcode = '23505';
  end if;

  select * into v_source_room from public.rooms where id = v_tenant.room_id;
  select name into v_branch_name from public.branches where id = v_tenant.branch_id;
  v_source_room_number := coalesce(v_source_room.number, 'Archived');
  v_target_room_number := v_target_room.number;

  update public.tenants
  set room_id = p_target_room_id,
      bed_no = p_target_bed_no,
      updated_by = v_user_id
  where id = p_tenant_id;

  select count(*) into v_active_count
  from public.tenants
  where room_id = v_tenant.room_id and status <> 'Left';
  update public.rooms
  set status = case when v_active_count = 0 then 'Vacant' else 'Occupied' end,
      updated_by = v_user_id
  where id = v_tenant.room_id and status <> 'Maintenance';

  select count(*) into v_active_count
  from public.tenants
  where room_id = p_target_room_id and status <> 'Left';
  update public.rooms
  set status = case when v_active_count = 0 then 'Vacant' else 'Occupied' end,
      updated_by = v_user_id
  where id = p_target_room_id and status <> 'Maintenance';

  insert into public.activity_logs (
    branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    v_tenant.branch_id,
    coalesce(v_branch_name, ''),
    v_user_id,
    coalesce(v_profile.name, 'User'),
    lower(v_profile.role::text),
    'Tenants',
    'Move Tenant',
    format(
      '%s %s moved tenant %s from Room %s Bed %s to Room %s Bed %s.%s',
      initcap(lower(v_profile.role::text)),
      coalesce(v_profile.name, ''),
      v_tenant.name,
      v_source_room_number,
      v_tenant.bed_no,
      v_target_room_number,
      p_target_bed_no,
      case when nullif(trim(coalesce(p_note, '')), '') is null then '' else ' Reason: ' || trim(p_note) end
    ),
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'from_room_id', v_tenant.room_id,
      'from_bed_no', v_tenant.bed_no,
      'to_room_id', p_target_room_id,
      'to_bed_no', p_target_bed_no,
      'note', nullif(trim(coalesce(p_note, '')), '')
    )
  );

  return jsonb_build_object(
    'success', true,
    'tenant_id', p_tenant_id,
    'room_id', p_target_room_id,
    'bed_no', p_target_bed_no
  );
end;
$$;

revoke all on function public.move_tenant_room(uuid, uuid, integer, uuid, integer, text) from public;
grant execute on function public.move_tenant_room(uuid, uuid, integer, uuid, integer, text) to authenticated;
