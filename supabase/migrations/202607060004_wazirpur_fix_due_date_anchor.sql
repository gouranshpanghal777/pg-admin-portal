-- PG 95 Wazirpur: Fix due_date anchor and rebuild payment obligations
-- 
-- PROBLEM: Previous correction set due_date to specific month/year dates.
-- tenants.due_date is an ANCHOR DAY, not a specific due date.
-- The system dynamically computes due_date via:
--   getRentLedgerState() → walks periods → finds first where pending > 0
--   → rent_due_date_for_period(anchor_day, oldest_unpaid_period)
--
-- FIX: 
--   1. Set tenants.due_date = tenants.joining_date (correct day anchor)
--   2. Delete stale payment_obligations (created by trigger with wrong dates)
--   3. Insert obligations for source X months (Paid) and dot months (Partial)
--   4. System will auto-compute due dates from this state

do $$ begin

-- STEP 1: Fix due_date anchor = joining_date for all Wazirpur tenants
-- This ensures the recurring day is correct.
update public.tenants
set due_date = joining_date
where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4';

-- STEP 2: Delete stale payment_obligations for Wazirpur tenants
-- These were created by create_tenant_obligations trigger with wrong joining dates.
delete from public.payment_obligations
where tenant_id in (
  select id from public.tenants
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
);

-- STEP 3: Insert obligations for each tenant's paid/partial months
-- Tenant: ANKIT SHARMA (day=1, first active=JAN25, all X through JUN26, JUL26 blank)
-- Paid periods: 2025-01 through 2026-06 (18 months)
-- Oldest unpaid: 2026-07
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-01'),('2025-02'),('2025-03'),('2025-04'),('2025-05'),('2025-06'),
  ('2025-07'),('2025-08'),('2025-09'),('2025-10'),('2025-11'),('2025-12'),
  ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'ANKIT SHARMA'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: TAPAN KUMAR (day=23, first active=JAN25, all X through JUN26, JUL26 blank)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-01'),('2025-02'),('2025-03'),('2025-04'),('2025-05'),('2025-06'),
  ('2025-07'),('2025-08'),('2025-09'),('2025-10'),('2025-11'),('2025-12'),
  ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'TAPAN KUMAR'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: SANJAY (day=30, first active=JAN25, all X through JUN26, JUL26 blank, rent=6500, electricity=Fixed 350)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-01'),('2025-02'),('2025-03'),('2025-04'),('2025-05'),('2025-06'),
  ('2025-07'),('2025-08'),('2025-09'),('2025-10'),('2025-11'),('2025-12'),
  ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SANJAY'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: RONAK (day=3, first active=JAN25, all X through JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6000, 6000,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-01'),('2025-02'),('2025-03'),('2025-04'),('2025-05'),('2025-06'),
  ('2025-07'),('2025-08'),('2025-09'),('2025-10'),('2025-11'),('2025-12'),
  ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'RONAK'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: RAJIB LOCHAN (day=2, first active=JAN25, all X through JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-01'),('2025-02'),('2025-03'),('2025-04'),('2025-05'),('2025-06'),
  ('2025-07'),('2025-08'),('2025-09'),('2025-10'),('2025-11'),('2025-12'),
  ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'RAJIB LOCHAN'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: PRAVEEN KUMAR (day=5, first active=MAY25, all X MAY25-JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-05'),('2025-06'),('2025-07'),('2025-08'),('2025-09'),('2025-10'),
  ('2025-11'),('2025-12'),('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'PRAVEEN KUMAR'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: NEERAJ PATHAK (day=30, first active=MAY25, all X MAY25-JUN26, JUL26 blank, rent=5500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 5500, 5500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-05'),('2025-06'),('2025-07'),('2025-08'),('2025-09'),('2025-10'),
  ('2025-11'),('2025-12'),('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'NEERAJ PATHAK'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: DURGA DUTTA (day=15, first active=JUL25, all X JUL25-JUN26, JUL26 blank, rent=7200)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 7200, 7200,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-07'),('2025-08'),('2025-09'),('2025-10'),('2025-11'),('2025-12'),
  ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'DURGA DUTTA'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: JASWANTH (day=7, first active=AUG25, all X AUG25-JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-08'),('2025-09'),('2025-10'),('2025-11'),('2025-12'),
  ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'JASWANTH'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: PRAVESH KINANA (day=15, first active=SEP25, all X SEP25-JUN26, JUL26 blank, rent=7200)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 7200, 7200,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-09'),('2025-10'),('2025-11'),('2025-12'),
  ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'PRAVESH KINANA'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: AYUSH (day=16, first active=JAN26, all X JAN26-JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'AYUSH'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: JITENDER TRIPATHI (day=8, first active=JAN26, all X JAN26-JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6000, 6000,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'JITENDER TRIPATHI'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: SANDEEP VISWKARMA (day=15, first active=FEB26, X=FEB26-MAY26, .=JUN26, JUL26 blank, rent=6500, balance=3850)
-- Paid periods: FEB26 through MAY26 (4 months)
-- Partial period: JUN26 (dot, received=6500-3850=2650)
-- Oldest unresolved: JUN26
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-02'),('2026-03'),('2026-04'),('2026-05')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SANDEEP VISWKARMA'
on conflict (tenant_id, period, payment_type) do nothing;

insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6500, 2650,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Partial', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SANDEEP VISWKARMA'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: JASKARN SINGH (day=7, first active=MAR26, all X MAR26-JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'JASKARN SINGH'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: SATYA PRAKSAH (day=16, first active=MAR26, all X MAR26-JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SATYA PRAKSAH'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: MAYANK YADAV (day=1, first active=MAR26, all X MAR26-JUN26, JUL26 blank, rent=7200)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 7200, 7200,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-03'),('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'MAYANK YADAV'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: VIRENDER SINGH (day=17, first active=APR26, all X APR26-JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6000, 6000,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-04'),('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'VIRENDER SINGH'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: CHAND MD (day=1, first active=MAY26, all X MAY26-JUN26, JUL26 blank, rent=7200)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 7200, 7200,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'CHAND MD'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: ARYAN KUMAR (day=2, first active=MAY26, all X MAY26-JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'ARYAN KUMAR'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: VIVEK SINGH (day=15, first active=MAY26, X=MAY26, .=JUN26, JUL26 blank, rent=7200, balance=5200)
-- Paid: MAY26 (X)
-- Partial: JUN26 (dot, received=7200-5200=2000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-05', 'rent', 7200, 7200,
  public.rent_due_date_for_period(t.due_date, '2026-05'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'VIVEK SINGH'
on conflict (tenant_id, period, payment_type) do nothing;

insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 7200, 2000,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Partial', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'VIVEK SINGH'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: MANU SHARMA (day=9, first active=MAY26, all X MAY26-JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6000, 6000,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'MANU SHARMA'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: SHIVANSH TIWARI (day=17, first active=MAY26, all X MAY26-JUN26, JUL26 blank, rent=7200)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 7200, 7200,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SHIVANSH TIWARI'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: VISHNU PRTAP (day=17, first active=MAY26, all X MAY26-JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'VISHNU PRTAP'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: NARENDER PAL (day=22, first active=MAY26, all X MAY26-JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-05'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'NARENDER PAL'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: KULBEER KHARKHARI (day=2, first active=JUN26, X=JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6000, 6000,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'KULBEER KHARKHARI'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: SONU GIRI (day=9, first active=JUN26, X=JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6500, 6500,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SONU GIRI'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: ASIF KHAN (day=9, first active=JUN26, X=JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6000, 6000,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'ASIF KHAN'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: PRASHANT (day=10, first active=JUN26, X=JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6500, 6500,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'PRASHANT'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: DINESH ROBAL (day=10, first active=JUN26, .=JUN26, JUL26 blank, rent=6500, balance=2500)
-- Partial: JUN26 (dot, received=6500-2500=4000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6500, 4000,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Partial', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'DINESH ROBAL'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: ANKIT MISHRA (day=16, first active=MAR26, X=MAR26, .=APR26, .=MAY26, X=JUN26, JUL26 blank, rent=6500)
-- Paid: MAR26, JUN26
-- Partial: APR26 (dot, no balance specified → received=0, pending=6500)
-- Partial: MAY26 (dot, received=0, pending=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 6500, 6500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2026-03'),('2026-06')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'ANKIT MISHRA'
on conflict (tenant_id, period, payment_type) do nothing;

insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-04', 'rent', 6500, 0,
  public.rent_due_date_for_period(t.due_date, '2026-04'), 'Pending', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'ANKIT MISHRA'
on conflict (tenant_id, period, payment_type) do nothing;

insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-05', 'rent', 6500, 0,
  public.rent_due_date_for_period(t.due_date, '2026-05'), 'Pending', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'ANKIT MISHRA'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: MITHALIYA (day=12, first active=JUN26, X=JUN26, JUL26 blank, rent=0)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 0, 0,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'MITHALIYA'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: AMAN KUMAR (day=14, first active=JUN26, X=JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6000, 6000,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'AMAN KUMAR'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: NISHANT PAL (day=15, first active=JUN26, X=JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6000, 6000,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'NISHANT PAL'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: ANANAND PAL (day=15, first active=JUN26, X=JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6500, 6500,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'ANANAND PAL'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: SHYAN AMUD (day=17, first active=JUN26, X=JUN26, JUL26 blank, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6500, 6500,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SHYAN AMUD'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: REHAN (day=10, first active=JUL26, .=JUL26, rent=6500, balance=6500)
-- Partial: JUL26 (dot, received=0)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-07', 'rent', 6500, 0,
  public.rent_due_date_for_period(t.due_date, '2026-07'), 'Pending', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'REHAN'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: AYUSH BASHAKR (day=24, first active=JUN26, X=JUN26, JUL26 blank, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-06', 'rent', 6000, 6000,
  public.rent_due_date_for_period(t.due_date, '2026-06'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'AYUSH BASHAKR'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: NAREDER SINGH (day=1, first active=JUL26, X=JUL26, rent=6000)
-- All clear through Jul 2026 → due = next month (Aug 2026)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-07', 'rent', 6000, 6000,
  public.rent_due_date_for_period(t.due_date, '2026-07'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'NAREDER SINGH'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: HARI KISHAN (day=1, first active=JUL26, X=JUL26, rent=3500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-07', 'rent', 3500, 3500,
  public.rent_due_date_for_period(t.due_date, '2026-07'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'HARI KISHAN'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: DEEPAK THAKUR (day=3, first active=JUL26, .=JUL26, rent=6000, balance=5000)
-- Partial: JUL26 (dot, received=6000-5000=1000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-07', 'rent', 6000, 1000,
  public.rent_due_date_for_period(t.due_date, '2026-07'), 'Partial', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'DEEPAK THAKUR'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: DISHNANT BHARDWAJ (day=2, first active=JUL26, X=JUL26, rent=7200)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-07', 'rent', 7200, 7200,
  public.rent_due_date_for_period(t.due_date, '2026-07'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'DISHNANT BHARDWAJ'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: PARMOD PARSHAD (day=1, first active=JUL26, X=JUL26, rent=6000)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-07', 'rent', 6000, 6000,
  public.rent_due_date_for_period(t.due_date, '2026-07'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'PARMOD PARSHAD'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: DHARMESH (day=6, first active=JUL26, X=JUL26, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-07', 'rent', 6500, 6500,
  public.rent_due_date_for_period(t.due_date, '2026-07'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'DHARMESH'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: HANU (day=6, first active=JUL26, X=JUL26, rent=6500)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2026-07', 'rent', 6500, 6500,
  public.rent_due_date_for_period(t.due_date, '2026-07'), 'Paid', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'HANU'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: SAHIL YADAV (day=15, first active=DEC25, .=DEC25, .=JAN26, .=FEB26, .=MAR26, APR-JUL26 blank, rent=6000, balance=14000)
-- Partial: DEC25 (dot, received=0)
-- Partial: JAN26, FEB26, MAR26 also dot
-- Oldest unpaid: DEC25
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, '2025-12', 'rent', 6000, 0,
  public.rent_due_date_for_period(t.due_date, '2025-12'), 'Pending', t.created_by
from public.tenants t
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SAHIL YADAV'
on conflict (tenant_id, period, payment_type) do nothing;

-- Tenant: SURESH KUMAR (day=1, first active=MAR25, X=MAR25-MAR26, MAY26 blank, JUN26 blank, JUL26 blank, rent=3500)
-- Paid: MAR25 through APR26 (14 months)
insert into public.payment_obligations (branch_id, tenant_id, period, payment_type, agreed_amount, received_amount, due_date, status, created_by)
select '83d74eb5-e6bc-468b-b147-cf57e6356ce4', t.id, p.period, 'rent', 3500, 3500,
   public.rent_due_date_for_period(t.due_date, p.period), 'Paid', t.created_by
from public.tenants t, (values ('2025-03'),('2025-04'),('2025-05'),('2025-06'),('2025-07'),('2025-08'),
  ('2025-09'),('2025-10'),('2025-11'),('2025-12'),('2026-01'),('2026-02'),('2026-03'),('2026-04')) p(period)
where t.branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and t.name = 'SURESH KUMAR'
on conflict (tenant_id, period, payment_type) do nothing;

end $$;
