create or replace function public.delete_tenant_with_payments(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_room_number text;
  v_branch_name text;
  v_user public.profiles%rowtype;
  v_payment_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can permanently delete a tenant' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  select number into v_room_number from public.rooms where id = v_tenant.room_id;
  select name into v_branch_name from public.branches where id = v_tenant.branch_id;
  select * into v_user from public.profiles where id = auth.uid();

  select count(*) into v_payment_count from public.payments where tenant_id = p_tenant_id;
  delete from public.payments where tenant_id = p_tenant_id;
  delete from public.invoices where tenant_id = p_tenant_id;
  update public.maintenance_tickets set tenant_id = null, updated_by = auth.uid(), updated_at = now() where tenant_id = p_tenant_id;
  update public.admission_requests set tenant_id = null where tenant_id = p_tenant_id;
  delete from public.tenants where id = p_tenant_id;

  insert into public.activity_logs(branch_id, branch_name, user_id, user_name, user_role, module, action_type, description, metadata)
  values (v_tenant.branch_id, v_branch_name, auth.uid(), v_user.name, v_user.role, 'Tenants', 'Delete Tenant',
    'Admin ' || v_user.name || ' permanently deleted tenant ' || v_tenant.name ||
      ' from Room ' || coalesce(v_room_number, 'unknown') || ' and deleted ' || v_payment_count || ' payment record(s).',
    jsonb_build_object('tenant_name', v_tenant.name, 'payment_records_deleted', v_payment_count));

  return jsonb_build_object('tenant_id', p_tenant_id, 'payment_records_deleted', v_payment_count);
end;
$$;

grant execute on function public.delete_tenant_with_payments(uuid) to authenticated;
