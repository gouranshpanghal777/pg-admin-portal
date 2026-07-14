-- Exclude vacated/left tenants from dashboard rent calculations.
-- Left-tenant balances belong to settlement/recovery reporting, not the
-- active monthly rent forecast shown by Expected Rent and Pending Till Today.
--
-- This migration updates both the summary RPC and its audit-breakdown RPC
-- without duplicating the full function bodies. It fails loudly if the
-- expected prior function definition is not present.

do $$
declare
  v_definition text;
  v_old_filter constant text := 'and t.status in (''Active'', ''Notice'', ''Needs Verification'', ''Left'')';
  v_new_filter constant text := 'and t.status in (''Active'', ''Notice'', ''Needs Verification'')';
begin
  select pg_get_functiondef(
    'public.get_branch_rent_collection_summary(uuid,date)'::regprocedure
  ) into v_definition;

  if position(v_old_filter in v_definition) = 0 then
    raise exception 'Expected Left-tenant filter was not found in get_branch_rent_collection_summary';
  end if;

  execute replace(v_definition, v_old_filter, v_new_filter);

  select pg_get_functiondef(
    'public.get_branch_rent_breakdown(uuid,date)'::regprocedure
  ) into v_definition;

  if position(v_old_filter in v_definition) = 0 then
    raise exception 'Expected Left-tenant filter was not found in get_branch_rent_breakdown';
  end if;

  execute replace(v_definition, v_old_filter, v_new_filter);
end;
$$;

comment on function public.get_branch_rent_collection_summary(uuid, date) is
  'Dashboard rent summary for Active, Notice and Needs Verification tenants only. Left tenants are excluded.';

comment on function public.get_branch_rent_breakdown(uuid, date) is
  'Tenant-month audit breakdown for Active, Notice and Needs Verification tenants only. Left tenants are excluded.';
