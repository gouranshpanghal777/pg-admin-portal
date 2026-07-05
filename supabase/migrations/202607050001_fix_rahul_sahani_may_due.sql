-- Correct the migrated rent cycle for one verified Farukhnagar tenant.
insert into public.payment_obligations (
  branch_id, tenant_id, period, payment_type, agreed_amount,
  received_amount, advance_applied, due_date, status
)
select
  tenant.branch_id, tenant.id, '2026-05', 'rent', tenant.monthly_rent,
  0, 0, date '2026-05-25', 'Pending'
from public.tenants tenant
join public.branches branch on branch.id = tenant.branch_id
where upper(trim(tenant.name)) = 'RAHUL SAHANI CRICKET'
  and upper(trim(branch.name)) = 'PG 95 FARUKHNAGAR'
on conflict (tenant_id, period, payment_type) do update set
  agreed_amount = excluded.agreed_amount,
  received_amount = 0,
  advance_applied = 0,
  due_date = excluded.due_date,
  status = 'Pending',
  updated_at = now();

update public.tenants tenant
set due_date = date '2026-05-25', updated_at = now()
from public.branches branch
where branch.id = tenant.branch_id
  and upper(trim(tenant.name)) = 'RAHUL SAHANI CRICKET'
  and upper(trim(branch.name)) = 'PG 95 FARUKHNAGAR';
