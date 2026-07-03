-- Generic payment fixes found by the full-system QA run. This migration does not
-- read or update existing business rows.
create or replace function public.route_rent_to_earliest_obligation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_period text;
begin
  if lower(new.payment_type) <> 'rent' then return new; end if;
  select period into v_period
  from public.payment_obligations
  where tenant_id = new.tenant_id
    and payment_type = 'rent'
    and received_amount + advance_applied < agreed_amount
  order by period
  limit 1;
  if v_period is not null then new.month := v_period; end if;
  return new;
end $$;

drop trigger if exists route_rent_to_earliest_obligation on public.payments;
create trigger route_rent_to_earliest_obligation
before insert on public.payments
for each row execute function public.route_rent_to_earliest_obligation();

create or replace function public.humanize_erp_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tenant public.tenants%rowtype; v_room text; v_pending numeric;
begin
  if new.metadata ? 'tenant_id' then
    select * into v_tenant from public.tenants where id = (new.metadata->>'tenant_id')::uuid;
    if found then select number into v_room from public.rooms where id = v_tenant.room_id; end if;
  end if;
  if new.action_type = 'Admit Tenant' and v_tenant.id is not null then
    new.description := initcap(new.user_role::text) || ' ' || new.user_name || ' admitted ' || v_tenant.name ||
      ' to Room ' || coalesce(v_room, '-') || ' Bed ' || v_tenant.bed_no || '. Rent ₹' ||
      trim(to_char(v_tenant.monthly_rent, 'FM999999990.00')) || '. Security ₹' ||
      trim(to_char(v_tenant.security, 'FM999999990.00')) || '.';
  elsif new.action_type = 'Receive Payment' and v_tenant.id is not null then
    select greatest(agreed_amount - received_amount - advance_applied, 0)
    into v_pending
    from public.payment_obligations
    where tenant_id = v_tenant.id and payment_type = 'rent'
    order by period
    limit 1;
    new.description := initcap(new.user_role::text) || ' ' || new.user_name || ' received ' || concat_ws(', ',
      case when coalesce((new.metadata->>'rent')::numeric, 0) > 0 then '₹' || (new.metadata->>'rent') || ' rent' end,
      case when coalesce((new.metadata->>'security')::numeric, 0) > 0 then '₹' || (new.metadata->>'security') || ' security' end,
      case when coalesce((new.metadata->>'electricity')::numeric, 0) > 0 then '₹' || (new.metadata->>'electricity') || ' electricity' end,
      case when coalesce((new.metadata->>'other')::numeric, 0) > 0 then '₹' || (new.metadata->>'other') || ' other charges' end
    ) || ' from ' || v_tenant.name || ', Room ' || coalesce(v_room, '-') || '. Rent pending ₹' ||
      trim(to_char(coalesce(v_pending, 0), 'FM999999990.00')) || '.';
  end if;
  return new;
end $$;
