do $$
declare
  v_branch record;
  v_rooms integer;
  v_tenants integer;
  v_active integer;
begin
  raise warning '=== PRE-IMPORT CHECK ===';
  for v_branch in select id, name from public.branches order by name loop
    select count(*) into v_rooms from public.rooms where branch_id = v_branch.id;
    select count(*) into v_tenants from public.tenants where branch_id = v_branch.id;
    select count(*) into v_active from public.tenants where branch_id = v_branch.id and status = 'Active';
    raise warning 'Branch: %, id: %, rooms: %, tenants: %, active: %',
      v_branch.name, v_branch.id, v_rooms, v_tenants, v_active;
  end loop;
end $$;
