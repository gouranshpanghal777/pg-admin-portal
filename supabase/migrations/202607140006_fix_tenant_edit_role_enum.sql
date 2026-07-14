-- Cast the tenant-edit audit role to the activity_logs app_role enum.
-- No tenant, payment, cashbook, invoice or ledger rows are changed here.

do $$
declare
  v_definition text;
  v_signature regprocedure := 'public.edit_tenant_with_rent_adjustment(uuid,text,text,text,uuid,integer,date,numeric,numeric,text,numeric,date,text,text,text,numeric,date,boolean,boolean)'::regprocedure;
  v_old text := 'coalesce(v_actor_name, ''Admin''), lower(v_actor_role), ''Tenants'', ''Edit Tenant''';
  v_new text := 'coalesce(v_actor_name, ''Admin''), lower(v_actor_role)::public.app_role, ''Tenants'', ''Edit Tenant''';
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if position(v_new in v_definition) > 0 then
    return;
  end if;

  if position(v_old in v_definition) = 0 then
    raise exception 'Expected tenant edit activity role expression was not found';
  end if;

  execute replace(v_definition, v_old, v_new);
end
$$;

grant execute on function public.edit_tenant_with_rent_adjustment(uuid, text, text, text, uuid, integer, date, numeric, numeric, text, numeric, date, text, text, text, numeric, date, boolean, boolean) to authenticated;
