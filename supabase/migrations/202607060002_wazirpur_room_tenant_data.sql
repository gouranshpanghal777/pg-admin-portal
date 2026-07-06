-- PG 95 Wazirpur: Room Master + Tenant Master Data Import
-- Idempotent - safe to run multiple times.
-- Only inserts records for PG 95 WAZIRPUR branch.
-- All other branches are completely untouched.

-- Verify branch exists
do $$
begin
  if not exists (select 1 from public.branches where id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'PG 95 WAZIRPUR') then
    raise exception 'PG 95 WAZIRPUR branch not found with expected id';
  end if;
end $$;

-- ===================================================================
-- ROOM MASTER: 24 rooms, 3 beds each = 72 total capacity
-- ===================================================================
-- Ground floor rooms (1-20)
insert into public.rooms (id, branch_id, number, floor, type, beds, rent, electricity, electricity_amount, status)
select gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', i::text, 0, 'Triple', 3, 0, 'Included', 0, 'Vacant'
from generate_series(1, 20) i
on conflict (branch_id, number) do nothing;

-- Basement rooms (B1-B4)
insert into public.rooms (id, branch_id, number, floor, type, beds, rent, electricity, electricity_amount, status)
select gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'B' || i::text, -1, 'Triple', 3, 0, 'Included', 0, 'Vacant'
from generate_series(1, 4) i
on conflict (branch_id, number) do nothing;

-- ===================================================================
-- TENANT MASTER DATA
-- Each tenant inserted with name, phone, room assignment, rent, 
-- security, electricity, joining date, due date
-- Idempotent: uses NOT EXISTS check by branch_id + name + phone
-- ===================================================================

-- Helper: insert tenant if not exists
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  -- ANKIT SHARMA - Room 10, joined Jan 2025, rent 6500
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '10';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'ANKIT SHARMA' and phone = '9649582945') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'ANKIT SHARMA', '9649582945', v_room_id, v_occupied + 1, 6500, 0, 0, 'Included', 0, '2025-01-01', '2025-01-01', 'Active', 0);
  end if;
end $$;

do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  -- TAPAN KUMAR - Room 14, joined Jan 2025, rent 6500, security 2500
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '14';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'TAPAN KUMAR' and phone = '9937763752') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'TAPAN KUMAR', '9937763752', v_room_id, v_occupied + 1, 6500, 2500, 2500, 'Included', 0, '2025-01-01', '2025-01-23', 'Active', 0);
  end if;
end $$;

-- SANJAY - Room 20, joined Jan 2025, rent 6500, electricity 350
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '20';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'SANJAY' and phone = '8755104442') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'SANJAY', '8755104442', v_room_id, v_occupied + 1, 6500, 0, 0, 'Fixed', 350, '2025-01-01', '2025-01-30', 'Active', 0);
  end if;
end $$;

-- RONAK - Room 10, joined Jan 2025, rent 6000, security 2000
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '10';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'RONAK' and phone = '9413146778') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'RONAK', '9413146778', v_room_id, v_occupied + 1, 6000, 2000, 2000, 'Included', 0, '2025-01-01', '2025-01-03', 'Active', 0);
  end if;
end $$;

-- RAJIB LOCHAN - Room 17, joined Jan 2025, rent 6500, security 2000, electricity 0 (Included)
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '17';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'RAJIB LOCHAN' and phone = '7735141006') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'RAJIB LOCHAN', '7735141006', v_room_id, v_occupied + 1, 6500, 2000, 2000, 'Included', 0, '2025-01-01', '2025-01-02', 'Active', 0);
  end if;
end $$;

-- PRAVEEN KUMAR - Room 10, joined May 2025, rent 6500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '10';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'PRAVEEN KUMAR' and phone = '9466702721') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'PRAVEEN KUMAR', '9466702721', v_room_id, v_occupied + 1, 6500, 0, 0, 'Fixed', 350, '2025-05-01', '2025-05-05', 'Active', 0);
  end if;
end $$;

-- NEERAJ PATHAK - Room B4, joined May 2025, rent 5500, security 2500, electricity AS PER METER → Included
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = 'B4';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'NEERAJ PATHAK' and phone = '8101031823') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'NEERAJ PATHAK', '8101031823', v_room_id, v_occupied + 1, 5500, 2500, 2500, 'Included', 0, '2025-05-01', '2025-05-30', 'Active', 0);
  end if;
end $$;

-- DURGA DUTTA - Room 19, joined Jul 2025, rent 7200, security 2500, electricity 1000 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '19';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'DURGA DUTTA' and phone = '8958634567') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'DURGA DUTTA', '8958634567', v_room_id, v_occupied + 1, 7200, 2500, 2500, 'Fixed', 1000, '2025-07-01', '2025-07-15', 'Active', 0);
  end if;
end $$;

-- JASWANTH - Room 17, joined Aug 2025, rent 6500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '17';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'JASWANTH' and phone = '9897075275') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'JASWANTH', '9897075275', v_room_id, v_occupied + 1, 6500, 0, 0, 'Fixed', 350, '2025-08-01', '2025-08-07', 'Active', 0);
  end if;
end $$;

-- PRAVESH KINANA - Room 19, joined Sep 2025, rent 7200, security 0, electricity 1000 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '19';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'PRAVESH KINANA' and phone = '9467078860') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'PRAVESH KINANA', '9467078860', v_room_id, v_occupied + 1, 7200, 0, 0, 'Fixed', 1000, '2025-09-01', '2025-09-15', 'Active', 0);
  end if;
end $$;

-- AYUSH - Room 14, joined Jan 2026, rent 6500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '14';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'AYUSH' and phone = '7006849075') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'AYUSH', '7006849075', v_room_id, v_occupied + 1, 6500, 0, 0, 'Fixed', 350, '2026-01-01', '2026-01-16', 'Active', 0);
  end if;
end $$;

-- JITENDER TRIPATHI - Room B3, joined Jan 2026, rent 6000, security 2000, electricity 300 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = 'B3';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'JITENDER TRIPATHI' and phone = '9873664915') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'JITENDER TRIPATHI', '9873664915', v_room_id, v_occupied + 1, 6000, 2000, 2000, 'Fixed', 300, '2026-01-01', '2026-01-08', 'Active', 0);
  end if;
end $$;

-- SANDEEP VISWKARMA - Room 20, joined Feb 2026, rent 6500, balance 3850, security 1500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '20';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'SANDEEP VISWKARMA' and phone = '7055353595') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'SANDEEP VISWKARMA', '7055353595', v_room_id, v_occupied + 1, 6500, 1500, 1500, 'Fixed', 350, '2026-02-01', '2026-02-15', 'Active', 0);
  end if;
end $$;

-- JASKARN SINGH - Room 19, joined Mar 2026, rent 6500, security 1500, electricity 300 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '19';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'JASKARN SINGH' and phone = '9026235880') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'JASKARN SINGH', '9026235880', v_room_id, v_occupied + 1, 6500, 1500, 1500, 'Fixed', 300, '2026-03-01', '2026-03-07', 'Active', 0);
  end if;
end $$;

-- SATYA PRAKSAH - Room 8, joined Mar 2026, rent 6500, security 2000, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '8';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'SATYA PRAKSAH' and phone = '8683928338') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'SATYA PRAKSAH', '8683928338', v_room_id, v_occupied + 1, 6500, 2000, 2000, 'Fixed', 350, '2026-03-01', '2026-03-16', 'Active', 0);
  end if;
end $$;

-- MAYANK YADAV - Room 16, joined Mar 2026, rent 7200, security 2500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '16';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'MAYANK YADAV' and phone = '9411991064') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'MAYANK YADAV', '9411991064', v_room_id, v_occupied + 1, 7200, 2500, 2500, 'Fixed', 350, '2026-03-01', '2026-03-01', 'Active', 0);
  end if;
end $$;

-- VIRENDER SINGH - Room B4, joined Apr 2026, rent 6000, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = 'B4';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'VIRENDER SINGH' and phone = '9956974713') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'VIRENDER SINGH', '9956974713', v_room_id, v_occupied + 1, 6000, 0, 0, 'Fixed', 350, '2026-04-01', '2026-04-17', 'Active', 0);
  end if;
end $$;

-- CHAND MD - Room 11, joined May 2026, rent 7200, electricity 1000 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '11';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'CHAND MD' and phone = '8950370727') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'CHAND MD', '8950370727', v_room_id, v_occupied + 1, 7200, 0, 0, 'Fixed', 1000, '2026-05-01', '2026-05-01', 'Active', 0);
  end if;
end $$;

-- ARYAN KUMAR - Room 13, joined May 2026, rent 6500, security 2500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '13';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'ARYAN KUMAR' and phone = '9161456259') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'ARYAN KUMAR', '9161456259', v_room_id, v_occupied + 1, 6500, 2500, 2500, 'Fixed', 350, '2026-05-01', '2026-05-02', 'Active', 0);
  end if;
end $$;

-- VIVEK SINGH - Room 11, joined May 2026, rent 7200, balance 5200, security 2500, electricity 1000 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '11';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'VIVEK SINGH' and phone = '9569959494') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'VIVEK SINGH', '9569959494', v_room_id, v_occupied + 1, 7200, 2500, 2500, 'Fixed', 1000, '2026-05-01', '2026-05-15', 'Active', 0);
  end if;
end $$;

-- MANU SHARMA - Room 3, joined May 2026, rent 6000, security 2500, electricity 300 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '3';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'MANU SHARMA' and phone = '7535988805') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'MANU SHARMA', '7535988805', v_room_id, v_occupied + 1, 6000, 2500, 2500, 'Fixed', 300, '2026-05-01', '2026-05-09', 'Active', 0);
  end if;
end $$;

-- SHIVANSH TIWARI - Room 11, joined May 2026, rent 7200, security 2500, electricity 1000 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '11';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'SHIVANSH TIWARI' and phone = '9118674369') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'SHIVANSH TIWARI', '9118674369', v_room_id, v_occupied + 1, 7200, 2500, 2500, 'Fixed', 1000, '2026-05-01', '2026-05-17', 'Active', 0);
  end if;
end $$;

-- VISHNU PRTAP - Room B1, joined May 2026, rent 6500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = 'B1';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'VISHNU PRTAP' and phone = '8400980068') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'VISHNU PRTAP', '8400980068', v_room_id, v_occupied + 1, 6500, 0, 0, 'Fixed', 350, '2026-05-01', '2026-05-17', 'Active', 0);
  end if;
end $$;

-- NARENDER PAL - Room 4, joined May 2026, rent 6500, security 2500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '4';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'NARENDER PAL' and phone = '7497031556') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'NARENDER PAL', '7497031556', v_room_id, v_occupied + 1, 6500, 2500, 2500, 'Fixed', 350, '2026-05-01', '2026-05-22', 'Active', 0);
  end if;
end $$;

-- KULBEER KHARKHARI - Room 17, joined Jun 2026, rent 6000, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '17';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'KULBEER KHARKHARI' and phone = '9991002626') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'KULBEER KHARKHARI', '9991002626', v_room_id, v_occupied + 1, 6000, 0, 0, 'Fixed', 350, '2026-06-01', '2026-06-02', 'Active', 0);
  end if;
end $$;

-- SONU GIRI - Room 8, joined Jun 2026, rent 6500, security pending (2500/0), electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '8';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'SONU GIRI' and phone = '9142012154') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'SONU GIRI', '9142012154', v_room_id, v_occupied + 1, 6500, 2500, 0, 'Fixed', 350, '2026-06-01', '2026-06-09', 'Active', 0);
  end if;
end $$;

-- ASIF KHAN - Room 3, joined Jun 2026, rent 6000, electricity 300 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '3';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'ASIF KHAN' and phone = '6399226410') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'ASIF KHAN', '6399226410', v_room_id, v_occupied + 1, 6000, 0, 0, 'Fixed', 300, '2026-06-01', '2026-06-09', 'Active', 0);
  end if;
end $$;

-- PRASHANT - Room 4, joined Jun 2026, rent 6500, security 2500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '4';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'PRASHANT' and phone = '7906504648') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'PRASHANT', '7906504648', v_room_id, v_occupied + 1, 6500, 2500, 2500, 'Fixed', 350, '2026-06-01', '2026-06-10', 'Active', 0);
  end if;
end $$;

-- DINESH ROBAL - Room 8, joined Jun 2026, rent 6500, balance 2500, security 2500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '8';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'DINESH ROBAL' and phone = '9024410343') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'DINESH ROBAL', '9024410343', v_room_id, v_occupied + 1, 6500, 2500, 2500, 'Fixed', 350, '2026-06-01', '2026-06-10', 'Active', 0);
  end if;
end $$;

-- ANKIT MISHRA - Room 6, joined Apr 2026, rent 6500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '6';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'ANKIT MISHRA' and phone = '8053873843') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'ANKIT MISHRA', '8053873843', v_room_id, v_occupied + 1, 6500, 0, 0, 'Fixed', 350, '2026-04-01', '2026-04-16', 'Active', 0);
  end if;
end $$;

-- MITHALIYA - Room 13, joined Jun 2026, rent 0 (special case), electricity Included
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '13';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'MITHALIYA' and phone is null) then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'MITHALIYA', '', v_room_id, v_occupied + 1, 0, 0, 0, 'Included', 0, '2026-06-01', '2026-06-12', 'Active', 0);
  end if;
end $$;

-- AMAN KUMAR - Room B1, joined Jun 2026, rent 6000, security pending (2500/0), electricity 300 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = 'B1';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'AMAN KUMAR' and phone = '8873763807') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'AMAN KUMAR', '8873763807', v_room_id, v_occupied + 1, 6000, 2500, 0, 'Fixed', 300, '2026-06-01', '2026-06-14', 'Active', 0);
  end if;
end $$;

-- NISHANT PAL - Room 12, joined Jun 2026, rent 6000, security 2000, electricity Included (0)
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '12';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'NISHANT PAL' and phone = '7037417278') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'NISHANT PAL', '7037417278', v_room_id, v_occupied + 1, 6000, 2000, 2000, 'Included', 0, '2026-06-01', '2026-06-15', 'Active', 0);
  end if;
end $$;

-- ANANAND PAL - Room 15, joined Jun 2026, rent 6500, security pending (2500/0), electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '15';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'ANANAND PAL' and phone = '7318234272') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'ANANAND PAL', '7318234272', v_room_id, v_occupied + 1, 6500, 2500, 0, 'Fixed', 350, '2026-06-01', '2026-06-15', 'Active', 0);
  end if;
end $$;

-- SHYAN AMUD - Room 13, joined Jun 2026, rent 6500, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '13';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'SHYAN AMUD' and phone = '8873783303') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'SHYAN AMUD', '8873783303', v_room_id, v_occupied + 1, 6500, 0, 0, 'Fixed', 350, '2026-06-01', '2026-06-17', 'Active', 0);
  end if;
end $$;

-- REHAN - Room 5, joined Jul 2026, rent 6500, balance 6500, security 2000, electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '5';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'REHAN' and phone = '7078212528') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'REHAN', '7078212528', v_room_id, v_occupied + 1, 6500, 2000, 2000, 'Fixed', 350, '2026-07-01', '2026-07-10', 'Active', 0);
  end if;
end $$;

-- AYUSH BASHAKR - Room 12, joined Jun 2026, rent 6000, security 1500, electricity Included (0)
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '12';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'AYUSH BASHAKR' and phone = '8851021683') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'AYUSH BASHAKR', '8851021683', v_room_id, v_occupied + 1, 6000, 1500, 1500, 'Included', 0, '2026-06-01', '2026-06-24', 'Active', 0);
  end if;
end $$;

-- NAREDER SINGH - Room 4, joined Jul 2026, rent 6000, electricity Included
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '4';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'NAREDER SINGH' and phone = '8532806328') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'NAREDER SINGH', '8532806328', v_room_id, v_occupied + 1, 6000, 0, 0, 'Included', 0, '2026-07-01', '2026-07-01', 'Active', 0);
  end if;
end $$;

-- HARI KISHAN - originally Room 4 in source but Room 4 already has 3 tenants at capacity.
-- Assigned to Room 2 which has available capacity. Rent 3500 suggests different arrangement.
-- Note: Room 4 had 4 tenants in source but capacity is 3 beds.
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '2';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'HARI KISHAN' and phone is null) then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'HARI KISHAN', '', v_room_id, v_occupied + 1, 3500, 0, 0, 'Included', 0, '2026-07-01', '2026-07-01', 'Active', 0);
  end if;
end $$;

-- DEEPAK THAKUR - Room 5, joined Jul 2026, rent 6000, balance 5000, security 2000, electricity 300 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '5';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'DEEPAK THAKUR' and phone = '7055085631') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'DEEPAK THAKUR', '7055085631', v_room_id, v_occupied + 1, 6000, 2000, 2000, 'Fixed', 300, '2026-07-01', '2026-07-03', 'Active', 0);
  end if;
end $$;

-- DISHNANT BHARDWAJ - Room 16, joined Jul 2026, rent 7200, security pending (2500/0), electricity 1000 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '16';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'DISHNANT BHARDWAJ' and phone = '9625724773') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'DISHNANT BHARDWAJ', '9625724773', v_room_id, v_occupied + 1, 7200, 2500, 0, 'Fixed', 1000, '2026-07-01', '2026-07-02', 'Active', 0);
  end if;
end $$;

-- PARMOD PARSHAD - Room B1, joined Jul 2026, rent 6000, security 2000, electricity 300 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = 'B1';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'PARMOD PARSHAD' and phone = '8825395219') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'PARMOD PARSHAD', '8825395219', v_room_id, v_occupied + 1, 6000, 2000, 2000, 'Fixed', 300, '2026-07-01', '2026-07-01', 'Active', 0);
  end if;
end $$;

-- DHARMESH - Room 1, joined Jul 2026, rent 6500, security pending (2500/0), electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '1';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'DHARMESH' and phone = '9992253014') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'DHARMESH', '9992253014', v_room_id, v_occupied + 1, 6500, 2500, 0, 'Fixed', 350, '2026-07-01', '2026-07-06', 'Active', 0);
  end if;
end $$;

-- HANU - Room 1, joined Jul 2026, rent 6500, security pending (2500/0), electricity 350 Fixed
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '1';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'HANU' and phone = '9466627353') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'HANU', '9466627353', v_room_id, v_occupied + 1, 6500, 2500, 0, 'Fixed', 350, '2026-07-01', '2026-07-06', 'Active', 0);
  end if;
end $$;

-- SAHIL YADAV - Room B2, rent 6000, balance 14000 (advance), security 2000, electricity Included
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = 'B2';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'SAHIL YADAV' and phone = '7404499271') then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'SAHIL YADAV', '7404499271', v_room_id, v_occupied + 1, 6000, 2000, 2000, 'Included', 0, '2025-11-01', '2025-11-15', 'Active', 0);
  end if;
end $$;

-- SURESH KUMAR - Room none specified, joined Mar 2025, rent 3500
do $$
declare
  v_room_id uuid;
  v_occupied integer;
  v_beds integer;
begin
  -- Find first available room, assign to Room 2 as default
  select id, beds into v_room_id, v_beds from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and number = '2';
  select count(*) into v_occupied from public.tenants where room_id = v_room_id and status in ('Active', 'Notice');
  if v_occupied < v_beds and not exists (select 1 from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4' and name = 'SURESH KUMAR' and phone is null) then
    insert into public.tenants (id, branch_id, name, phone, room_id, bed_no, monthly_rent, security, security_received, electricity, electricity_amount, joining_date, due_date, status, paid_this_month)
    values (gen_random_uuid(), '83d74eb5-e6bc-468b-b147-cf57e6356ce4', 'SURESH KUMAR', '', v_room_id, v_occupied + 1, 3500, 0, 0, 'Included', 0, '2025-03-01', '2025-03-01', 'Active', 0);
  end if;
end $$;

-- ===================================================================
-- VERIFICATION
-- ===================================================================
do $$
declare
  v_room_count integer;
  v_bed_capacity integer;
  v_tenant_count integer;
  v_active_count integer;
begin
  select count(*), coalesce(sum(beds), 0) into v_room_count, v_bed_capacity
  from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4';
  
  select count(*), count(*) filter (where status = 'Active')
  into v_tenant_count, v_active_count
  from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4';

  raise notice '=== WAIRPUR IMPORT COMPLETE ===';
  raise notice 'Rooms: % (expected 24)', v_room_count;
  raise notice 'Total capacity: % (expected 72)', v_bed_capacity;
  raise notice 'Total tenants: %', v_tenant_count;
  raise notice 'Active tenants: %', v_active_count;

  if v_room_count != 24 then
    raise exception 'Room count mismatch: expected 24, got %', v_room_count;
  end if;
  if v_bed_capacity != 72 then
    raise exception 'Capacity mismatch: expected 72, got %', v_bed_capacity;
  end if;
end $$;
