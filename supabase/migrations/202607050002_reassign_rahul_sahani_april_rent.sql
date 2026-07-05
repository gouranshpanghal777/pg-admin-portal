-- The 8 May receipt settled April rent; payment date and cashbook history stay unchanged.
update public.payments payment
set month = '2026-04'
from public.tenants tenant
join public.branches branch on branch.id = tenant.branch_id
where payment.tenant_id = tenant.id
  and payment.branch_id = tenant.branch_id
  and lower(payment.payment_type) = 'rent'
  and payment.payment_date = date '2026-05-08'
  and payment.amount = 6000
  and upper(trim(tenant.name)) = 'RAHUL SAHANI CRICKET'
  and upper(trim(branch.name)) = 'PG 95 FARUKHNAGAR';

insert into public.payment_obligations (
  branch_id, tenant_id, period, payment_type, agreed_amount,
  received_amount, advance_applied, due_date, status
)
select
  tenant.branch_id, tenant.id, '2026-04', 'rent', tenant.monthly_rent,
  tenant.monthly_rent, 0, date '2026-04-25', 'Paid'
from public.tenants tenant
join public.branches branch on branch.id = tenant.branch_id
where upper(trim(tenant.name)) = 'RAHUL SAHANI CRICKET'
  and upper(trim(branch.name)) = 'PG 95 FARUKHNAGAR'
on conflict (tenant_id, period, payment_type) do update set
  agreed_amount = excluded.agreed_amount,
  received_amount = excluded.received_amount,
  advance_applied = 0,
  due_date = excluded.due_date,
  status = 'Paid',
  updated_at = now();
