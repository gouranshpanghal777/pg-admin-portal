-- A rent payment may settle an older unpaid obligation, but it must never be
-- reassigned to a future month. When no older obligation exists, keep the
-- submitted rent month (which defaults to the payment date's month).
create or replace function public.route_rent_to_earliest_obligation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_period text;
begin
  if lower(new.payment_type) <> 'rent' then return new; end if;

  select period into v_period
  from public.payment_obligations
  where tenant_id = new.tenant_id
    and payment_type = 'rent'
    and period <= new.month
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
