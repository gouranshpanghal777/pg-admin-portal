-- PG 95 Wazirpur Tenant Data Corrections
-- Based on source Excel register business logic:
--   1. RENT DATE column = EXACT JOINING DATE (day + first active month)
--   2. Recurring due day = day of joining date
--   3. Month grid: X=CLEAR, .=PARTIAL, blank-after-joining=PENDING
--   4. Oldest unresolved month controls current due date
--   5. Security: PENDING=2500/0, Rs0=nothing, amount=paid, BALANCE=2500/0, 1 TARIK=2500/0
--   6. Balance column preserved as-is
--   7. Electricity: paid/INCLUDE=Included, number=Fixed, AS PER METER=Included

-- Record pre-correction counts (branch-agnostic, uses only Wazirpur by ID)
do $$
declare
  v_before_rooms integer;
  v_before_tenants integer;
begin
  select count(*) into v_before_rooms from public.rooms where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4';
  select count(*) into v_before_tenants from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4';
  raise notice 'BEFORE: Wazirpur: % rooms, % tenants', v_before_rooms, v_before_tenants;
end $$;

-- ===================================================================
-- CORRECTION: Tenant corrections
-- ===================================================================
-- Each block updates a tenant matched by branch_id + name.
-- Fields corrected: joining_date, due_date, security, security_received,
-- electricity, electricity_amount, monthly_rent
-- ===================================================================

do $$
begin
  -- ANKIT SHARMA - Room 10
  -- Source: RD=01, joined Jan 2025, months all X through Jun 2026, Jul 2026 blank
  -- Correct: JOIN=2025-01-01, DUE=2026-07-01, SEC=0/0, ELEC=Included(0)
  update public.tenants
  set joining_date = '2025-01-01',
      due_date = '2026-07-01',
      security = 0,
      security_received = 0,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'ANKIT SHARMA';
end $$;

do $$
begin
  -- TAPAN KUMAR - Room 14
  -- Source: RD=23, joined Jan 2025, all X through Jun 2026, Jul 2026 blank
  -- Correct: JOIN=2025-01-23, DUE=2026-07-23, SEC=2500/2500, ELEC=Included(0)
  update public.tenants
  set joining_date = '2025-01-23',
      due_date = '2026-07-23',
      security = 2500,
      security_received = 2500,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'TAPAN KUMAR';
end $$;

do $$
begin
  -- SANJAY - Room 20
  -- Source: RD=30, joined Jan 2025, all X through Jun 2026, Jul 2026 blank
  -- Correct: JOIN=2025-01-30, DUE=2026-07-30, SEC=0/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2025-01-30',
      due_date = '2026-07-30',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'SANJAY';
end $$;

do $$
begin
  -- RONAK - Room 10
  -- Source: RD=03, joined Jan 2025, all X through Jun 2026, Jul 2026 blank
  -- Correct: JOIN=2025-01-03, DUE=2026-07-03, SEC=2000/2000, ELEC=Included(0)
  update public.tenants
  set joining_date = '2025-01-03',
      due_date = '2026-07-03',
      security = 2000,
      security_received = 2000,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'RONAK';
end $$;

do $$
begin
  -- RAJIB LOCHAN - Room 17
  -- Source: RD=02, joined Jan 2025, all X through Jun 2026, Jul 2026 blank
  -- Correct: JOIN=2025-01-02, DUE=2026-07-02, SEC=2000/2000, ELEC=Fixed(0)
  update public.tenants
  set joining_date = '2025-01-02',
      due_date = '2026-07-02',
      security = 2000,
      security_received = 2000,
      electricity = 'Fixed',
      electricity_amount = 0,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'RAJIB LOCHAN';
end $$;

do $$
begin
  -- PRAVEEN KUMAR - Room 10
  -- Source: RD=05, joined May 2025 (first X in MAY25), all X through Jun 2026, Jul blank
  -- Correct: JOIN=2025-05-05, DUE=2026-07-05, SEC=0/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2025-05-05',
      due_date = '2026-07-05',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'PRAVEEN KUMAR';
end $$;

do $$
begin
  -- NEERAJ PATHAK - Room B4
  -- Source: RD=30, joined May 2025, all X through Jun 2026, Jul 2026 blank
  -- Correct: JOIN=2025-05-30, DUE=2026-07-30, SEC=2500/2500, ELEC=Included (AS PER METER)
  update public.tenants
  set joining_date = '2025-05-30',
      due_date = '2026-07-30',
      security = 2500,
      security_received = 2500,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 5500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'NEERAJ PATHAK';
end $$;

do $$
begin
  -- DURGA DUTTA - Room 19
  -- Source: RD=15, joined Jul 2025, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2025-07-15, DUE=2026-07-15, SEC=2500/2500, ELEC=Fixed(1000)
  update public.tenants
  set joining_date = '2025-07-15',
      due_date = '2026-07-15',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 1000,
      monthly_rent = 7200
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'DURGA DUTTA';
end $$;

do $$
begin
  -- JASWANTH - Room 17
  -- Source: RD=07, joined Aug 2025, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2025-08-07, DUE=2026-07-07, SEC=0/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2025-08-07',
      due_date = '2026-07-07',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'JASWANTH';
end $$;

do $$
begin
  -- PRAVESH KINANA - Room 19
  -- Source: RD=15, joined Sep 2025, all X through Jun 2026, Jul blank
  -- Security: "1 TARIK" → pending 2500/0
  -- Correct: JOIN=2025-09-15, DUE=2026-07-15, SEC=2500/0, ELEC=Fixed(1000)
  update public.tenants
  set joining_date = '2025-09-15',
      due_date = '2026-07-15',
      security = 2500,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 1000,
      monthly_rent = 7200
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'PRAVESH KINANA';
end $$;

do $$
begin
  -- AYUSH - Room 14
  -- Source: RD=16, joined Jan 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-01-16, DUE=2026-07-16, SEC=0/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-01-16',
      due_date = '2026-07-16',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'AYUSH';
end $$;

do $$
begin
  -- JITENDER TRIPATHI - Room B3
  -- Source: RD=08, joined Jan 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-01-08, DUE=2026-07-08, SEC=2000/2000, ELEC=Fixed(300)
  update public.tenants
  set joining_date = '2026-01-08',
      due_date = '2026-07-08',
      security = 2000,
      security_received = 2000,
      electricity = 'Fixed',
      electricity_amount = 300,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'JITENDER TRIPATHI';
end $$;

do $$
begin
  -- SANDEEP VISWKARMA - Room 20
  -- Source: RD=15, joined Feb 2026, X Feb-Jun, . Jun, blank Jul
  -- Oldest unresolved: Jun 2026 (dot)
  -- Balance: 3850
  -- Correct: JOIN=2026-02-15, DUE=2026-06-15, SEC=1500/1500, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-02-15',
      due_date = '2026-06-15',
      security = 1500,
      security_received = 1500,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'SANDEEP VISWKARMA';
end $$;

do $$
begin
  -- JASKARN SINGH - Room 19
  -- Source: RD=07, joined Mar 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-03-07, DUE=2026-07-07, SEC=1500/1500, ELEC=Fixed(300)
  update public.tenants
  set joining_date = '2026-03-07',
      due_date = '2026-07-07',
      security = 1500,
      security_received = 1500,
      electricity = 'Fixed',
      electricity_amount = 300,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'JASKARN SINGH';
end $$;

do $$
begin
  -- SATYA PRAKSAH - Room 8
  -- Source: RD=16, joined Mar 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-03-16, DUE=2026-07-16, SEC=2000/2000, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-03-16',
      due_date = '2026-07-16',
      security = 2000,
      security_received = 2000,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'SATYA PRAKSAH';
end $$;

do $$
begin
  -- MAYANK YADAV - Room 16
  -- Source: RD=01, joined Mar 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-03-01, DUE=2026-07-01, SEC=2500/2500, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-03-01',
      due_date = '2026-07-01',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 7200
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'MAYANK YADAV';
end $$;

do $$
begin
  -- VIRENDER SINGH - Room B4
  -- Source: RD=17, joined Apr 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-04-17, DUE=2026-07-17, SEC=0/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-04-17',
      due_date = '2026-07-17',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'VIRENDER SINGH';
end $$;

do $$
begin
  -- CHAND MD - Room 11
  -- Source: RD=01, joined May 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-05-01, DUE=2026-07-01, SEC=0/0, ELEC=Fixed(1000)
  update public.tenants
  set joining_date = '2026-05-01',
      due_date = '2026-07-01',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 1000,
      monthly_rent = 7200
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'CHAND MD';
end $$;

do $$
begin
  -- ARYAN KUMAR - Room 13
  -- Source: RD=02, joined May 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-05-02, DUE=2026-07-02, SEC=2500/2500, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-05-02',
      due_date = '2026-07-02',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'ARYAN KUMAR';
end $$;

do $$
begin
  -- VIVEK SINGH - Room 11
  -- Source: RD=15, joined May 2026, X=MAY26, .=JUN26, blank=JUL26
  -- Oldest unresolved: Jun 2026 (dot), Balance=5200
  -- Correct: JOIN=2026-05-15, DUE=2026-06-15, SEC=2500/2500, ELEC=Fixed(1000)
  update public.tenants
  set joining_date = '2026-05-15',
      due_date = '2026-06-15',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 1000,
      monthly_rent = 7200
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'VIVEK SINGH';
end $$;

do $$
begin
  -- MANU SHARMA - Room 3
  -- Source: RD=09, joined May 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-05-09, DUE=2026-07-09, SEC=2500/2500, ELEC=Fixed(300)
  update public.tenants
  set joining_date = '2026-05-09',
      due_date = '2026-07-09',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 300,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'MANU SHARMA';
end $$;

do $$
begin
  -- SHIVANSH TIWARI - Room 11
  -- Source: RD=17, joined May 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-05-17, DUE=2026-07-17, SEC=2500/2500, ELEC=Fixed(1000)
  update public.tenants
  set joining_date = '2026-05-17',
      due_date = '2026-07-17',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 1000,
      monthly_rent = 7200
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'SHIVANSH TIWARI';
end $$;

do $$
begin
  -- VISHNU PRTAP - Room B1
  -- Source: RD=17, joined May 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-05-17, DUE=2026-07-17, SEC=0/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-05-17',
      due_date = '2026-07-17',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'VISHNU PRTAP';
end $$;

do $$
begin
  -- NARENDER PAL - Room 4
  -- Source: RD=22, joined May 2026, all X through Jun 2026, Jul blank
  -- Correct: JOIN=2026-05-22, DUE=2026-07-22, SEC=2500/2500, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-05-22',
      due_date = '2026-07-22',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'NARENDER PAL';
end $$;

do $$
begin
  -- KULBEER KHARKHARI - Room 17
  -- Source: RD=02, joined Jun 2026, X=JUN26, blank=JUL26
  -- Correct: JOIN=2026-06-02, DUE=2026-07-02, SEC=0/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-06-02',
      due_date = '2026-07-02',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'KULBEER KHARKHARI';
end $$;

do $$
begin
  -- SONU GIRI - Room 8
  -- Source: RD=09, joined Jun 2026, X=JUN26, blank=JUL26
  -- Security: "BALANCE" → PENDING = 2500/0
  -- Correct: JOIN=2026-06-09, DUE=2026-07-09, SEC=2500/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-06-09',
      due_date = '2026-07-09',
      security = 2500,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'SONU GIRI';
end $$;

do $$
begin
  -- ASIF KHAN - Room 3
  -- Source: RD=09, joined Jun 2026, X=JUN26, blank=JUL26
  -- Correct: JOIN=2026-06-09, DUE=2026-07-09, SEC=0/0, ELEC=Fixed(300)
  update public.tenants
  set joining_date = '2026-06-09',
      due_date = '2026-07-09',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 300,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'ASIF KHAN';
end $$;

do $$
begin
  -- PRASHANT - Room 4
  -- Source: RD=10, joined Jun 2026, X=JUN26, blank=JUL26
  -- Correct: JOIN=2026-06-10, DUE=2026-07-10, SEC=2500/2500, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-06-10',
      due_date = '2026-07-10',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'PRASHANT';
end $$;

do $$
begin
  -- DINESH ROBAL - Room 8
  -- Source: RD=10, joined Jun 2026, .=JUN26, blank=JUL26
  -- Oldest unresolved: Jun 2026 (dot), Balance=2500
  -- Correct: JOIN=2026-06-10, DUE=2026-06-10, SEC=2500/2500, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-06-10',
      due_date = '2026-06-10',
      security = 2500,
      security_received = 2500,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'DINESH ROBAL';
end $$;

do $$
begin
  -- ANKIT MISHRA - Room 6
  -- Source: RD=16, joined Mar 2026, X=MAR26, .=APR26, .=MAY26, X=JUN26, blank=JUL26
  -- Oldest unresolved: Apr 2026 (first dot)
  -- Correct: JOIN=2026-03-16, DUE=2026-04-16, SEC=0/0, ELEC=Included(0)
  update public.tenants
  set joining_date = '2026-03-16',
      due_date = '2026-04-16',
      security = 0,
      security_received = 0,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'ANKIT MISHRA';
end $$;

do $$
begin
  -- MITHALIYA - Room 13
  -- Source: RD=12, joined Jun 2026, X=JUN26, blank=JUL26, rent=0
  -- Correct: JOIN=2026-06-12, DUE=2026-07-12, SEC=0/0, ELEC=Included(0)
  update public.tenants
  set joining_date = '2026-06-12',
      due_date = '2026-07-12',
      security = 0,
      security_received = 0,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 0
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'MITHALIYA';
end $$;

do $$
begin
  -- AMAN KUMAR - Room B1
  -- Source: RD=14, joined Jun 2026, X=JUN26, blank=JUL26
  -- Security: "PENDING" → 2500/0
  -- Correct: JOIN=2026-06-14, DUE=2026-07-14, SEC=2500/0, ELEC=Fixed(300)
  update public.tenants
  set joining_date = '2026-06-14',
      due_date = '2026-07-14',
      security = 2500,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 300,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'AMAN KUMAR';
end $$;

do $$
begin
  -- NISHANT PAL - Room 12
  -- Source: RD=15, joined Jun 2026, X=JUN26, blank=JUL26
  -- Correct: JOIN=2026-06-15, DUE=2026-07-15, SEC=2000/2000, ELEC=Included(0)
  update public.tenants
  set joining_date = '2026-06-15',
      due_date = '2026-07-15',
      security = 2000,
      security_received = 2000,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'NISHANT PAL';
end $$;

do $$
begin
  -- ANANAND PAL - Room 15
  -- Source: RD=15, joined Jun 2026, X=JUN26, blank=JUL26
  -- Security: "1 TARIK" → pending 2500/0
  -- Correct: JOIN=2026-06-15, DUE=2026-07-15, SEC=2500/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-06-15',
      due_date = '2026-07-15',
      security = 2500,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'ANANAND PAL';
end $$;

do $$
begin
  -- SHYAN AMUD - Room 13
  -- Source: RD=17, joined Jun 2026, X=JUN26, blank=JUL26
  -- Correct: JOIN=2026-06-17, DUE=2026-07-17, SEC=0/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-06-17',
      due_date = '2026-07-17',
      security = 0,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'SHYAN AMUD';
end $$;

do $$
begin
  -- REHAN - Room 5
  -- Source: RD=10, joined Jul 2026, .=JUL26 (first month partial)
  -- Oldest unresolved: Jul 2026 (dot), Balance=6500
  -- Correct: JOIN=2026-07-10, DUE=2026-07-10, SEC=2000/2000, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-07-10',
      due_date = '2026-07-10',
      security = 2000,
      security_received = 2000,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'REHAN';
end $$;

do $$
begin
  -- AYUSH BASHAKR - Room 12
  -- Source: RD=24, joined Jun 2026, X=JUN26, blank=JUL26
  -- Correct: JOIN=2026-06-24, DUE=2026-07-24, SEC=1500/1500, ELEC=Included(0)
  update public.tenants
  set joining_date = '2026-06-24',
      due_date = '2026-07-24',
      security = 1500,
      security_received = 1500,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'AYUSH BASHAKR';
end $$;

do $$
begin
  -- NAREDER SINGH - Room 4
  -- Source: RD=01, joined Jul 2026, X=JUL26 (clear)
  -- All clear through Jul 2026 → next month due
  -- Correct: JOIN=2026-07-01, DUE=2026-08-01, SEC=0/0, ELEC=Included(0)
  update public.tenants
  set joining_date = '2026-07-01',
      due_date = '2026-08-01',
      security = 0,
      security_received = 0,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'NAREDER SINGH';
end $$;

do $$
begin
  -- HARI KISHAN - Room 2 (relocated from Room 4 due to capacity)
  -- Source: RD=01, joined Jul 2026, X=JUL26 (clear)
  -- All clear through Jul 2026 → next month due
  -- Correct: JOIN=2026-07-01, DUE=2026-08-01, SEC=0/0, ELEC=Included(0)
  update public.tenants
  set joining_date = '2026-07-01',
      due_date = '2026-08-01',
      security = 0,
      security_received = 0,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 3500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'HARI KISHAN';
end $$;

do $$
begin
  -- DEEPAK THAKUR - Room 5
  -- Source: RD=03, joined Jul 2026, .=JUL26 (partial)
  -- Oldest unresolved: Jul 2026 (dot), Balance=5000
  -- Correct: JOIN=2026-07-03, DUE=2026-07-03, SEC=2000/2000, ELEC=Fixed(300)
  update public.tenants
  set joining_date = '2026-07-03',
      due_date = '2026-07-03',
      security = 2000,
      security_received = 2000,
      electricity = 'Fixed',
      electricity_amount = 300,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'DEEPAK THAKUR';
end $$;

do $$
begin
  -- DISHNANT BHARDWAJ - Room 16
  -- Source: RD=02, joined Jul 2026, X=JUL26 (clear)
  -- All clear through Jul 2026 → next month due
  -- Security: "PENDING" → 2500/0
  -- Correct: JOIN=2026-07-02, DUE=2026-08-02, SEC=2500/0, ELEC=Fixed(1000)
  update public.tenants
  set joining_date = '2026-07-02',
      due_date = '2026-08-02',
      security = 2500,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 1000,
      monthly_rent = 7200
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'DISHNANT BHARDWAJ';
end $$;

do $$
begin
  -- PARMOD PARSHAD - Room B1
  -- Source: RD=01, joined Jul 2026, X=JUL26 (clear)
  -- All clear through Jul 2026 → next month due
  -- Correct: JOIN=2026-07-01, DUE=2026-08-01, SEC=2000/2000, ELEC=Fixed(300)
  update public.tenants
  set joining_date = '2026-07-01',
      due_date = '2026-08-01',
      security = 2000,
      security_received = 2000,
      electricity = 'Fixed',
      electricity_amount = 300,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'PARMOD PARSHAD';
end $$;

do $$
begin
  -- DHARMESH - Room 1
  -- Source: RD=06, joined Jul 2026, X=JUL26 (clear)
  -- All clear through Jul 2026 → next month due
  -- Security: "PENDING" → 2500/0
  -- Correct: JOIN=2026-07-06, DUE=2026-08-06, SEC=2500/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-07-06',
      due_date = '2026-08-06',
      security = 2500,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'DHARMESH';
end $$;

do $$
begin
  -- HANU - Room 1
  -- Source: RD=06, joined Jul 2026, X=JUL26 (clear)
  -- All clear through Jul 2026 → next month due
  -- Security: "PENDING" → 2500/0
  -- Correct: JOIN=2026-07-06, DUE=2026-08-06, SEC=2500/0, ELEC=Fixed(350)
  update public.tenants
  set joining_date = '2026-07-06',
      due_date = '2026-08-06',
      security = 2500,
      security_received = 0,
      electricity = 'Fixed',
      electricity_amount = 350,
      monthly_rent = 6500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'HANU';
end $$;

do $$
begin
  -- SAHIL YADAV - Room B2
  -- Source: RD=15, joined Dec 2025 (first activity = dot in DEC25)
  -- Months: DEC25=., JAN26=., FEB26=., MAR26=., APR-JUL26=blank
  -- Oldest unresolved: Dec 2025 (dot)
  -- Correct: JOIN=2025-12-15, DUE=2025-12-15, SEC=2000/2000, ELEC=Included(0)
  update public.tenants
  set joining_date = '2025-12-15',
      due_date = '2025-12-15',
      security = 2000,
      security_received = 2000,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 6000
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'SAHIL YADAV';
end $$;

do $$
begin
  -- SURESH KUMAR - Room 2 (no room in source, assigned to Room 2)
  -- Source: RD=01, joined Mar 2025, X from MAR25 through MAR26, then MAY-JUL26 blank
  -- Oldest unresolved: May 2026 (first blank after joining)
  -- Correct: JOIN=2025-03-01, DUE=2026-05-01, SEC=0/0, ELEC=Included(0)
  update public.tenants
  set joining_date = '2025-03-01',
      due_date = '2026-05-01',
      security = 0,
      security_received = 0,
      electricity = 'Included',
      electricity_amount = 0,
      monthly_rent = 3500
  where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
    and name = 'SURESH KUMAR';
end $$;

-- ===================================================================
-- VERIFICATION
-- ===================================================================
do $$
declare
  v_tenant_count integer;
  rec record;
  v_errors text := '';
begin
  select count(*) into v_tenant_count
  from public.tenants where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4';

  raise notice 'AFTER: Wazirpur: % tenants', v_tenant_count;

  for rec in
    select name, joining_date, due_date
    from public.tenants
    where branch_id = '83d74eb5-e6bc-468b-b147-cf57e6356ce4'
      and joining_date = due_date
      and name not in ('DINESH ROBAL','REHAN','DEEPAK THAKUR','SAHIL YADAV','SANDEEP VISWKARMA','VIVEK SINGH','ANKIT MISHRA')
  loop
    v_errors := v_errors || ' ' || rec.name;
  end loop;

  if v_errors != '' then
    raise warning 'Unexpected joining_date=due_date for:%', v_errors;
  end if;

  raise notice '=== WAZIRPUR CORRECTIONS APPLIED ===';
end $$;
