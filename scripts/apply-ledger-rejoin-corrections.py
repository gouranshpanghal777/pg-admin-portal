#!/usr/bin/env python3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src/App.tsx"
DB = ROOT / "src/lib/database.ts"
MIGRATION = ROOT / "supabase/migrations/202607170001_rejoin_ledger_and_farukhnagar_corrections.sql"
ALLOWED_UNTRACKED = {"qa-smoke-report.md", "scripts/qa-smoke-test.mjs"}


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


status = subprocess.run(
    ["git", "status", "--porcelain"], cwd=ROOT, check=True,
    capture_output=True, text=True,
).stdout.splitlines()
blockers = [line for line in status if not (line.startswith("?? ") and line[3:] in ALLOWED_UNTRACKED)]
if blockers:
    raise SystemExit("Working tree has unrelated changes:\n" + "\n".join(blockers))

if MIGRATION.exists():
    raise SystemExit(f"Migration already exists: {MIGRATION.relative_to(ROOT)}")

original_app = APP.read_text()
original_db = DB.read_text()
app = original_app
db = original_db
db_pushed = False

migration_sql = r'''-- Permanent rejoin obligation support and guarded Farukhnagar ledger corrections.
-- Cashbook rows are intentionally never updated or deleted by this migration.

create or replace function public.sync_rent_obligation_from_entries(
  p_tenant_id uuid,
  p_period text,
  p_due_date date,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_monthly_rent numeric;
  v_created_by uuid;
  v_obligation_id uuid;
  v_agreed numeric;
  v_received numeric;
  v_advance numeric;
  v_status text;
begin
  if p_period !~ '^\\d{4}-\\d{2}$' then
    raise exception 'Invalid rent period: %', p_period;
  end if;

  select branch_id, monthly_rent, created_by
    into v_branch_id, v_monthly_rent, v_created_by
  from public.tenants
  where id = p_tenant_id;

  if not found then
    raise exception 'Tenant % not found while syncing rent obligation', p_tenant_id;
  end if;

  select id, agreed_amount
    into v_obligation_id, v_agreed
  from public.payment_obligations
  where tenant_id = p_tenant_id
    and period = p_period
    and lower(payment_type::text) = 'rent'
  order by created_at nulls last, id
  limit 1;

  v_agreed := coalesce(v_agreed, v_monthly_rent, 0);

  select coalesce(sum(amount), 0)
    into v_received
  from public.payments
  where tenant_id = p_tenant_id
    and month = p_period
    and lower(payment_type::text) = 'rent';

  select coalesce(sum(amount), 0)
    into v_advance
  from public.tenant_advances
  where tenant_id = p_tenant_id
    and period = p_period
    and lower(movement_type::text) = 'used';

  v_status := case
    when v_received + v_advance >= v_agreed then 'Paid'
    when v_received + v_advance > 0 then 'Partial'
    when p_due_date < current_date then 'Overdue'
    else 'Pending'
  end;

  if v_obligation_id is null then
    v_obligation_id := gen_random_uuid();
    insert into public.payment_obligations (
      id, branch_id, tenant_id, period, payment_type,
      agreed_amount, received_amount, advance_applied,
      due_date, status, created_by
    ) values (
      v_obligation_id, v_branch_id, p_tenant_id, p_period, 'rent',
      v_agreed, v_received, v_advance,
      p_due_date, v_status, coalesce(p_actor_id, v_created_by)
    );
  else
    update public.payment_obligations
    set received_amount = v_received,
        advance_applied = v_advance,
        due_date = p_due_date,
        status = v_status
    where id = v_obligation_id;
  end if;

  -- Remove duplicate rent obligations for the same tenant and period, retaining the canonical row.
  delete from public.payment_obligations
  where tenant_id = p_tenant_id
    and period = p_period
    and lower(payment_type::text) = 'rent'
    and id <> v_obligation_id;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'period', p_period,
    'agreed', v_agreed,
    'received', v_received,
    'advance_applied', v_advance,
    'balance', greatest(0, v_agreed - v_received - v_advance),
    'due_date', p_due_date,
    'status', v_status
  );
end;
$$;

revoke all on function public.sync_rent_obligation_from_entries(uuid, text, date, uuid) from public;

create or replace function public.rejoin_tenant_v2(
  p_tenant_id uuid,
  p_room_id uuid,
  p_bed_no integer,
  p_rejoin_date date,
  p_due_date date,
  p_monthly_rent numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_room public.rooms%rowtype;
  v_period text;
  v_history jsonb;
  v_ledger jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found';
  end if;

  if v_tenant.status::text <> 'Left' then
    raise exception 'Only a Left tenant can be rejoined';
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id
    and branch_id = v_tenant.branch_id
  for update;

  if not found or v_room.status::text = 'Maintenance' then
    raise exception 'Selected room is unavailable';
  end if;

  if p_bed_no < 1 or p_bed_no > v_room.beds then
    raise exception 'Selected bed number is invalid';
  end if;

  if exists (
    select 1 from public.tenants
    where branch_id = v_tenant.branch_id
      and room_id = p_room_id
      and bed_no = p_bed_no
      and status::text <> 'Left'
      and id <> p_tenant_id
  ) then
    raise exception 'Selected bed is already occupied';
  end if;

  v_period := to_char(p_rejoin_date, 'YYYY-MM');
  v_history := coalesce(v_tenant.rejoin_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'rejoinDate', to_char(p_rejoin_date, 'YYYY-MM-DD'),
      'dueDate', to_char(p_due_date, 'YYYY-MM-DD'),
      'roomId', p_room_id,
      'monthlyRent', p_monthly_rent,
      'initialRentReceived', 0,
      'previousLeft', v_tenant.left_details
    )
  );

  update public.tenants
  set room_id = p_room_id,
      bed_no = p_bed_no,
      monthly_rent = p_monthly_rent,
      due_date = p_due_date,
      status = 'Active',
      left_details = null,
      notice = null,
      paid_this_month = 0,
      rejoin_history = v_history,
      updated_by = auth.uid()
  where id = p_tenant_id;

  v_ledger := public.sync_rent_obligation_from_entries(
    p_tenant_id, v_period, p_due_date, auth.uid()
  );

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'branch_id', v_tenant.branch_id,
    'period', v_period,
    'ledger', v_ledger
  );
end;
$$;

grant execute on function public.rejoin_tenant_v2(uuid, uuid, integer, date, date, numeric) to authenticated;

-- One-time production correction. It is skipped on databases without the complete target dataset.
do $$
declare
  v_branch_id uuid;
  v_actor_id uuid;
  v_count integer;
  v_kapil_id uuid;
  v_harshit_id uuid;
  v_azad_id uuid;
  v_aarzi_id uuid;
  v_hari_id uuid;
  v_kapil_due date;
  v_harshit_payment_id uuid;
  v_transfer_payment_id uuid;
  v_transfer_amount numeric;
  v_aarzi_rent numeric;
  v_result jsonb;
begin
  select count(*) into v_count
  from public.branches
  where lower(name) like '%farukhnagar%';

  if v_count = 0 then
    raise notice 'Farukhnagar correction skipped: branch is not present in this database.';
    return;
  end if;
  if v_count <> 1 then
    raise exception 'Expected exactly one Farukhnagar branch, found %', v_count;
  end if;

  select id into v_branch_id
  from public.branches
  where lower(name) like '%farukhnagar%';

  select id into v_actor_id
  from public.profiles
  where lower(role::text) = 'admin'
  order by created_at nulls last, id
  limit 1;

  if v_actor_id is null then
    raise exception 'No admin profile found for guarded correction';
  end if;

  select count(*) into v_count from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'KAPIL';
  if v_count <> 1 then raise exception 'Expected one KAPIL in Farukhnagar, found %', v_count; end if;
  select id into v_kapil_id from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'KAPIL';

  select count(*) into v_count
  from public.tenants t
  where t.branch_id = v_branch_id
    and upper(trim(t.name)) like 'HARSHIT%'
    and exists (
      select 1 from jsonb_array_elements(coalesce(t.rejoin_history, '[]'::jsonb)) item
      where item->>'rejoinDate' = '2026-07-14'
    );
  if v_count <> 1 then raise exception 'Expected one Harshit rejoined on 14/07/2026, found %', v_count; end if;
  select t.id into v_harshit_id
  from public.tenants t
  where t.branch_id = v_branch_id
    and upper(trim(t.name)) like 'HARSHIT%'
    and exists (
      select 1 from jsonb_array_elements(coalesce(t.rejoin_history, '[]'::jsonb)) item
      where item->>'rejoinDate' = '2026-07-14'
    );

  select count(*) into v_count from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'AZAD IRSHAD';
  if v_count <> 1 then raise exception 'Expected one AZAD IRSHAD, found %', v_count; end if;
  select id into v_azad_id from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'AZAD IRSHAD';

  select count(*) into v_count from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'AARZI IRSHAD';
  if v_count <> 1 then raise exception 'Expected one AARZI IRSHAD, found %', v_count; end if;
  select id, monthly_rent into v_aarzi_id, v_aarzi_rent from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'AARZI IRSHAD';

  select count(*) into v_count from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'HARI KISHAN';
  if v_count <> 1 then raise exception 'Expected one HARI KISHAN, found %', v_count; end if;
  select id into v_hari_id from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'HARI KISHAN';

  -- KAPIL: July must use no advance unless a verified advance movement exists. User confirmed none exists.
  select due_date into v_kapil_due
  from public.payment_obligations
  where tenant_id = v_kapil_id and period = '2026-07' and lower(payment_type::text) = 'rent'
  order by created_at nulls last, id
  limit 1;
  if v_kapil_due is null then
    raise exception 'KAPIL July 2026 rent obligation not found';
  end if;
  delete from public.tenant_advances
  where tenant_id = v_kapil_id and period = '2026-07' and lower(movement_type::text) = 'used';
  v_result := public.sync_rent_obligation_from_entries(v_kapil_id, '2026-07', v_kapil_due, v_actor_id);
  if abs((v_result->>'balance')::numeric - 5000) > 0.01 then
    raise exception 'KAPIL post-check failed. Expected July balance 5000, calculated %', v_result->>'balance';
  end if;

  -- HARSHIT: move the 16/07 payment from August to the rejoin month July, leaving cashbook untouched.
  select count(*) into v_count
  from public.payments
  where tenant_id = v_harshit_id
    and payment_date = date '2026-07-16'
    and month = '2026-08'
    and lower(payment_type::text) = 'rent';

  if v_count = 1 then
    select id into v_harshit_payment_id
    from public.payments
    where tenant_id = v_harshit_id
      and payment_date = date '2026-07-16'
      and month = '2026-08'
      and lower(payment_type::text) = 'rent';

    update public.payments
    set month = '2026-07',
        description = trim(coalesce(description, '') || ' [Ledger correction: rejoin payment moved from August to July]')
    where id = v_harshit_payment_id;
  elsif v_count = 0 and exists (
    select 1 from public.payments
    where tenant_id = v_harshit_id
      and payment_date = date '2026-07-16'
      and month = '2026-07'
      and lower(payment_type::text) = 'rent'
  ) then
    raise notice 'HARSHIT payment was already corrected to July.';
  else
    raise exception 'Expected one HARSHIT 16/07/2026 rent payment routed to August, found %', v_count;
  end if;

  update public.tenants
  set due_date = date '2026-07-14',
      rejoin_history = (
        select coalesce(jsonb_agg(
          case when item.value->>'rejoinDate' = '2026-07-14'
            then item.value || jsonb_build_object('dueDate', '2026-07-14')
            else item.value end
          order by item.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(coalesce(public.tenants.rejoin_history, '[]'::jsonb))
          with ordinality as item(value, ordinality)
      )
  where id = v_harshit_id;

  v_result := public.sync_rent_obligation_from_entries(v_harshit_id, '2026-07', date '2026-07-14', v_actor_id);
  if abs((v_result->>'balance')::numeric) > 0.01 then
    raise exception 'HARSHIT July post-check failed. Expected paid, balance is %', v_result->>'balance';
  end if;
  v_result := public.sync_rent_obligation_from_entries(v_harshit_id, '2026-08', date '2026-08-14', v_actor_id);
  if (v_result->>'due_date')::date <> date '2026-08-14' then
    raise exception 'HARSHIT August due-date post-check failed';
  end if;

  -- AZAD -> AARZI: transfer only the wrongly assigned July rent payment row. Never touch its linked cashbook row.
  select count(*) into v_count
  from public.payments
  where tenant_id = v_azad_id
    and payment_date = date '2026-06-22'
    and month = '2026-07'
    and lower(payment_type::text) = 'rent';

  if v_count = 1 then
    select id, amount into v_transfer_payment_id, v_transfer_amount
    from public.payments
    where tenant_id = v_azad_id
      and payment_date = date '2026-06-22'
      and month = '2026-07'
      and lower(payment_type::text) = 'rent';

    if abs(v_transfer_amount - v_aarzi_rent) > 0.01 then
      raise exception 'Transfer payment amount % does not match AARZI monthly rent %', v_transfer_amount, v_aarzi_rent;
    end if;

    if exists (
      select 1 from public.payments
      where tenant_id = v_aarzi_id and month = '2026-06' and lower(payment_type::text) = 'rent'
    ) then
      raise exception 'AARZI already has a June rent payment; guarded transfer stopped';
    end if;

    update public.payments
    set tenant_id = v_aarzi_id,
        month = '2026-06',
        description = trim(coalesce(description, '') || ' [Ledger correction: transferred from AZAD IRSHAD July to AARZI IRSHAD June]')
    where id = v_transfer_payment_id;
  elsif v_count = 0 and exists (
    select 1 from public.payments
    where tenant_id = v_aarzi_id
      and payment_date = date '2026-06-22'
      and month = '2026-06'
      and lower(payment_type::text) = 'rent'
      and description like '%transferred from AZAD IRSHAD%'
  ) then
    raise notice 'AZAD/AARZI payment transfer was already applied.';
  else
    raise exception 'Expected one AZAD 22/06/2026 payment assigned to July, found %', v_count;
  end if;

  if not exists (
    select 1 from public.payments
    where tenant_id = v_azad_id
      and payment_date = date '2026-06-22'
      and month = '2026-06'
      and lower(payment_type::text) = 'rent'
  ) then
    raise exception 'AZAD genuine June payment dated 22/06/2026 was not found';
  end if;

  update public.tenants set due_date = date '2026-07-14' where id in (v_azad_id, v_aarzi_id);

  v_result := public.sync_rent_obligation_from_entries(v_azad_id, '2026-06', date '2026-06-14', v_actor_id);
  if abs((v_result->>'balance')::numeric) > 0.01 then raise exception 'AZAD June should be paid'; end if;
  v_result := public.sync_rent_obligation_from_entries(v_azad_id, '2026-07', date '2026-07-14', v_actor_id);
  if abs((v_result->>'balance')::numeric - (v_result->>'agreed')::numeric) > 0.01 then raise exception 'AZAD July should be fully pending'; end if;
  v_result := public.sync_rent_obligation_from_entries(v_aarzi_id, '2026-06', date '2026-06-14', v_actor_id);
  if abs((v_result->>'balance')::numeric) > 0.01 then raise exception 'AARZI June should be paid'; end if;
  v_result := public.sync_rent_obligation_from_entries(v_aarzi_id, '2026-07', date '2026-07-14', v_actor_id);
  if abs((v_result->>'balance')::numeric - (v_result->>'agreed')::numeric) > 0.01 then raise exception 'AARZI July should be fully pending'; end if;

  -- HARI KISHAN: continuing tenant, cancel the active vacating notice only.
  update public.tenants
  set status = 'Active', notice = null
  where id = v_hari_id;

  if exists (select 1 from public.tenants where id = v_hari_id and (status::text <> 'Active' or notice is not null)) then
    raise exception 'HARI KISHAN notice cancellation post-check failed';
  end if;

  raise notice 'Farukhnagar ledger corrections applied successfully. Cashbook remained untouched.';
end;
$$;
'''

try:
    # Import the atomic rejoin RPC wrapper.
    old_import = "import { admitTenant, cleanupOldActivityLogs, createStaffAccount, deactivateStaffAccount, deleteBranchCascade, deleteCashbookEntryCascade, deleteTenantWithPayments, editTenantWithRentAdjustment, getAffectedTables, getBranchRentCollectionSummary, loadAppData, loadActivityLogs, persistAppData, reactivateUserAccount, recordSplitPayment, refreshTables, resetUserPassword, swapTenantRooms, undoVacateTenant, vacateTenantErp } from './lib/database'"
    new_import = "import { admitTenant, cleanupOldActivityLogs, createStaffAccount, deactivateStaffAccount, deleteBranchCascade, deleteCashbookEntryCascade, deleteTenantWithPayments, editTenantWithRentAdjustment, getAffectedTables, getBranchRentCollectionSummary, loadAppData, loadActivityLogs, persistAppData, reactivateUserAccount, recordSplitPayment, refreshTables, rejoinTenantWithObligation, resetUserPassword, swapTenantRooms, undoVacateTenant, vacateTenantErp } from './lib/database'"
    app = replace_once(app, old_import, new_import, "database import")

    # Advance used is valid only when backed by an actual tenant_advances movement.
    old_state_start = "function getRentLedgerState(tenant: Tenant, payments: Payment[], obligations: PaymentObligation[] = []) {\n  const rentObligations = new Map<string, PaymentObligation>()"
    new_state_start = "function getRentLedgerState(tenant: Tenant, payments: Payment[], obligations: PaymentObligation[] = [], advances: AdvanceMovement[] = []) {\n  const rentObligations = new Map<string, PaymentObligation>()"
    app = replace_once(app, old_state_start, new_state_start, "rent state signature")

    old_after_payments = "  for (const payment of payments) {\n    if (payment.tenantId !== tenant.id || payment.paymentType !== 'Rent') continue\n    rentPayments.set(payment.month, (rentPayments.get(payment.month) || 0) + payment.amount)\n  }\n  const currentStay = tenant.rejoins?.at(-1)"
    new_after_payments = "  for (const payment of payments) {\n    if (payment.tenantId !== tenant.id || payment.paymentType !== 'Rent') continue\n    rentPayments.set(payment.month, (rentPayments.get(payment.month) || 0) + payment.amount)\n  }\n  const advanceUsedByPeriod = new Map<string, number>()\n  for (const movement of advances) {\n    if (movement.tenantId !== tenant.id || movement.type !== 'used' || !movement.period) continue\n    advanceUsedByPeriod.set(movement.period, (advanceUsedByPeriod.get(movement.period) || 0) + movement.amount)\n  }\n  const currentStay = tenant.rejoins?.at(-1)"
    app = replace_once(app, old_after_payments, new_after_payments, "verified advance map")
    app = replace_once(app, "    const advanceApplied = obligation?.advanceApplied ?? 0", "    const advanceApplied = advanceUsedByPeriod.get(period) || 0", "verified advance usage")

    old_wrapper = "const rentLedgerState = (tenant: Tenant, obligations: PaymentObligation[], payments: Payment[]) =>\n  getRentLedgerState(tenant, payments, obligations)"
    new_wrapper = "const rentLedgerState = (tenant: Tenant, obligations: PaymentObligation[], payments: Payment[], advances: AdvanceMovement[] = []) =>\n  getRentLedgerState(tenant, payments, obligations, advances)"
    app = replace_once(app, old_wrapper, new_wrapper, "rent ledger wrapper")

    old_maps = "  const obligationsByTenant = new Map<string, PaymentObligation[]>()\n  for (const obligation of obligations) {\n    const tenantObligations = obligationsByTenant.get(obligation.tenantId)\n    if (tenantObligations) tenantObligations.push(obligation)\n    else obligationsByTenant.set(obligation.tenantId, [obligation])\n  }\n  const rentStates = new Map(activeTenants.map((tenant) => [tenant.id, getRentLedgerState(tenant, paymentsByTenant.get(tenant.id) || [], obligationsByTenant.get(tenant.id) || [])]))"
    new_maps = "  const obligationsByTenant = new Map<string, PaymentObligation[]>()\n  for (const obligation of obligations) {\n    const tenantObligations = obligationsByTenant.get(obligation.tenantId)\n    if (tenantObligations) tenantObligations.push(obligation)\n    else obligationsByTenant.set(obligation.tenantId, [obligation])\n  }\n  const advancesByTenant = new Map<string, AdvanceMovement[]>()\n  for (const movement of advances) {\n    const tenantAdvances = advancesByTenant.get(movement.tenantId)\n    if (tenantAdvances) tenantAdvances.push(movement)\n    else advancesByTenant.set(movement.tenantId, [movement])\n  }\n  const rentStates = new Map(activeTenants.map((tenant) => [tenant.id, getRentLedgerState(tenant, paymentsByTenant.get(tenant.id) || [], obligationsByTenant.get(tenant.id) || [], advancesByTenant.get(tenant.id) || [])]))"
    app = replace_once(app, old_maps, new_maps, "branch rent maps")

    old_payment_modal = "function PaymentModal({ tenants, payments, obligations, selectedTenantId, onClose, onSubmit }: { tenants: Tenant[]; payments: Payment[]; obligations: PaymentObligation[]; selectedTenantId: string; onClose: () => void; onSubmit: (payment: SplitPaymentInput) => Promise<void> }) {"
    new_payment_modal = "function PaymentModal({ tenants, payments, obligations, advances, selectedTenantId, onClose, onSubmit }: { tenants: Tenant[]; payments: Payment[]; obligations: PaymentObligation[]; advances: AdvanceMovement[]; selectedTenantId: string; onClose: () => void; onSubmit: (payment: SplitPaymentInput) => Promise<void> }) {"
    app = replace_once(app, old_payment_modal, new_payment_modal, "payment modal props")
    app = replace_once(app, "  const rentState = tenant ? getRentLedgerState(tenant, payments, obligations) : undefined", "  const rentState = tenant ? getRentLedgerState(tenant, payments, obligations, advances) : undefined", "payment modal rent state")
    app = replace_once(app, "<PaymentModal tenants={scoped.activeTenants} payments={scoped.payments} obligations={scoped.obligations} selectedTenantId={selectedTenantId}", "<PaymentModal tenants={scoped.activeTenants} payments={scoped.payments} obligations={scoped.obligations} advances={scoped.advances} selectedTenantId={selectedTenantId}", "payment modal invocation")

    old_ledger_advance = "    const advanceApplied = obligation?.advanceApplied ?? advances.filter((item) => item.type === 'used' && item.period === period).reduce((sum, item) => sum + item.amount, 0)"
    new_ledger_advance = "    const advanceApplied = advances.filter((item) => item.type === 'used' && item.period === period).reduce((sum, item) => sum + item.amount, 0)"
    app = replace_once(app, old_ledger_advance, new_ledger_advance, "tenant ledger verified advance")

    # Add Cancel Notice action beside the existing notice action.
    old_notice_action = "<CompactAction title=\"Notice\" onClick={() => { setSelectedTenantId(tenant.id); setModal('notice') }}><CalendarClock size={14} /></CompactAction>{canAction('vacate_tenant')"
    new_notice_action = "<CompactAction title=\"Notice\" onClick={() => { setSelectedTenantId(tenant.id); setModal('notice') }}><CalendarClock size={14} /></CompactAction>{(tenant.notice || tenant.status === 'Notice') && <CompactAction title=\"Cancel Vacating Notice\" onClick={() => { setSelectedTenantId(tenant.id); setModal('cancelNotice') }}><X size={14} /></CompactAction>}{canAction('vacate_tenant')"
    app = replace_once(app, old_notice_action, new_notice_action, "cancel notice action")

    # Replace the non-atomic rejoin client flow with the atomic database flow.
    rejoin_start = app.index("      {modal === 'rejoinTenant'")
    payment_start = app.index("      {modal === 'payment'", rejoin_start)
    old_rejoin_block = app[rejoin_start:payment_start]
    new_rejoin_block = """      {modal === 'rejoinTenant' && <RejoinTenantModal tenant={data.tenants.find((tenant) => tenant.id === selectedTenantId)!} rooms={scoped.rooms} activeTenants={scoped.activeTenants} onClose={closeModal} onSubmit={async (payload) => {
        const tenant = data.tenants.find((item) => item.id === selectedTenantId)!
        const room = data.rooms.find((item) => item.id === payload.roomId)!
        const occupiedBeds = new Set(data.tenants.filter((item) => item.roomId === payload.roomId && item.status !== 'Left' && item.id !== tenant.id).map((item) => item.bedNo))
        const bedNo = Array.from({ length: room.beds }, (_, index) => index + 1).find((bed) => !occupiedBeds.has(bed))
        if (!bedNo) throw new Error(`Room ${room.number} has no vacant bed.`)
        setBackendError('')
        try {
          await rejoinTenantWithObligation({ tenantId: tenant.id, roomId: payload.roomId, bedNo, rejoinDate: payload.rejoinDate, dueDate: payload.dueDate, monthlyRent: payload.monthlyRent })
          if (payload.rentReceived > 0) await recordSplitPayment({ requestId: payload.paymentRequestId, tenantId: tenant.id, branchId, rentAmount: payload.rentReceived, securityAmount: 0, electricityAmount: 0, otherAmount: 0, paymentDate: payload.paymentDate, rentPeriod: payload.rejoinDate.slice(0, 7), paymentMode: payload.paymentMode, description: `Rejoin rent payment - ${tenant.name}` })
          const refreshed = await refreshTables(['tenants', 'rooms', 'payments', 'cashbook_entries', 'payment_obligations', 'tenant_advances'], dataRef.current)
          const logged = logActivity(refreshed, { userName: currentUser.name, userId: currentUser.id, userRole: role, branchId, branchName: branch.name, module: 'Tenants', actionType: 'Rejoin Tenant', description: `${role} ${currentUser.name} rejoined tenant ${tenant.name} in Room ${room.number} on ${formatDate(payload.rejoinDate)}. ${formatMonth(payload.rejoinDate.slice(0, 7))} rent obligation created even when no payment was received.` })
          await persistAppData(refreshed, logged, currentUser.id)
          dataRef.current = logged
          setData(logged)
          refreshRentSummary()
          setSuccessMessage(`${tenant.name} rejoined successfully. ${formatMonth(payload.rejoinDate.slice(0, 7))} rent is tracked from the rejoin date.`)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to rejoin tenant'
          setBackendError(message)
          throw error
        }
      }} />}
"""
    app = app[:rejoin_start] + new_rejoin_block + app[payment_start:]

    # Insert the cancel-notice confirmation modal immediately before the vacate modal.
    vacate_marker = "      {modal === 'vacate'"
    vacate_index = app.index(vacate_marker)
    cancel_modal = """      {modal === 'cancelNotice' && (() => { const tenant = data.tenants.find((item) => item.id === selectedTenantId)!; return <ConfirmModal title=\"Cancel Vacating Notice?\" message={`Remove the active vacating notice for ${tenant.name}? Rent ledger, payments, cashbook and tenant history will remain unchanged.`} confirmLabel=\"Cancel Notice\" onClose={closeModal} onConfirm={() => updateData((previous) => ({ ...previous, tenants: previous.tenants.map((item) => item.id === tenant.id ? { ...item, status: 'Active', notice: undefined } : item) }), 'Cancel Tenant Notice', 'Tenants', `${role} ${currentUser.name} cancelled the vacating notice for ${tenant.name}. Rent ledger and financial records were unchanged.`)} /> })()}
"""
    app = app[:vacate_index] + cancel_modal + app[vacate_index:]

    # Add database wrapper.
    wrapper_marker = "export async function editTenantWithRentAdjustment(input: {"
    wrapper_index = db.index(wrapper_marker)
    rejoin_wrapper = """export async function rejoinTenantWithObligation(input: {
  tenantId: string
  roomId: string
  bedNo: number
  rejoinDate: string
  dueDate: string
  monthlyRent: number
}) {
  const { data, error } = await supabase.rpc('rejoin_tenant_v2', {
    p_tenant_id: input.tenantId,
    p_room_id: input.roomId,
    p_bed_no: input.bedNo,
    p_rejoin_date: input.rejoinDate,
    p_due_date: input.dueDate,
    p_monthly_rent: input.monthlyRent,
  })
  if (error) throw databaseError('rejoin_tenant_v2 RPC', error)
  return data as { tenant_id: string; branch_id: string; period: string; ledger: Record<string, unknown> }
}

"""
    db = db[:wrapper_index] + rejoin_wrapper + db[wrapper_index:]

    APP.write_text(app)
    DB.write_text(db)
    MIGRATION.parent.mkdir(parents=True, exist_ok=True)
    MIGRATION.write_text(migration_sql)

    run("npm", "run", "self-test")
    run("npm", "run", "build")
    run("npm", "run", "lint")

    print("\nThe next command applies a guarded database transaction. Review the Supabase prompt and answer Y.", flush=True)
    run("npx", "supabase", "db", "push")
    db_pushed = True

    Path(__file__).unlink()
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py")
    run("git", "commit", "-m", "fix: correct Farukhnagar ledgers and make rejoin rent-safe")
    run("git", "push", "origin", "main")

    print("\nLedger corrections, atomic rejoin logic, verified advance handling and Cancel Notice are live in GitHub and Supabase.")
except Exception:
    if not db_pushed:
        APP.write_text(original_app)
        DB.write_text(original_db)
        if MIGRATION.exists():
            MIGRATION.unlink()
    else:
        print("\nDatabase migration succeeded but a later git step failed. Do not rerun db push; commit/push the current files.", flush=True)
    raise
