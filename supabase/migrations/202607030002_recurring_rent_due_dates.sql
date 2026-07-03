create or replace function public.rent_due_date_for_period(original_due date, billing_period text)
returns date language sql immutable set search_path = public as $$
  select make_date(
    split_part(billing_period, '-', 1)::integer,
    split_part(billing_period, '-', 2)::integer,
    least(
      extract(day from original_due)::integer,
      extract(day from (date_trunc('month', to_date(billing_period || '-01', 'YYYY-MM-DD')) + interval '1 month - 1 day'))::integer
    )
  )
$$;

update public.payment_obligations o
set due_date = public.rent_due_date_for_period(t.due_date, o.period),
    status = case
      when o.received_amount + o.advance_applied >= o.agreed_amount then 'Paid'
      when o.received_amount + o.advance_applied > 0 then 'Partial'
      when public.rent_due_date_for_period(t.due_date, o.period) < current_date then 'Overdue'
      else 'Pending' end,
    updated_at = now()
from public.tenants t
where t.id = o.tenant_id and o.payment_type <> 'security' and o.period ~ '^\d{4}-\d{2}$';

create or replace function public.create_tenant_obligations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.payment_obligations(branch_id, tenant_id, period, payment_type, agreed_amount, due_date, status, created_by)
  values(new.branch_id, new.id, to_char(new.joining_date, 'YYYY-MM'), 'rent', new.monthly_rent,
    public.rent_due_date_for_period(new.due_date, to_char(new.joining_date, 'YYYY-MM')), 'Pending', new.created_by)
  on conflict do nothing;
  if new.security > 0 then
    insert into public.payment_obligations(branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
    values(new.branch_id, new.id, 'one-time', 'security', new.security, new.security_received, new.joining_date,
      case when new.security_received >= new.security then 'Paid' when new.security_received > 0 then 'Partial' else 'Pending' end, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end $$;
