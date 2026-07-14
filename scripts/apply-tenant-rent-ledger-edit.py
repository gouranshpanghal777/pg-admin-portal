#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "src/App.tsx"
DB_PATH = ROOT / "src/lib/database.ts"
MIGRATION_PATH = ROOT / "supabase/migrations/202607140005_tenant_rent_balance_due_date_edit.sql"
ALLOWED_UNTRACKED = {"qa-smoke-report.md", "scripts/qa-smoke-test.mjs"}


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_line_containing(text: str, needle: str, replacement: str, label: str) -> str:
    lines = text.splitlines()
    matches = [index for index, line in enumerate(lines) if needle in line]
    if len(matches) != 1:
        raise RuntimeError(f"{label}: expected exactly one matching line, found {len(matches)}")
    lines[matches[0]] = replacement
    return "\n".join(lines) + "\n"


def replace_section(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise RuntimeError(f"{label}: section markers were not found")
    if text.find(start_marker, start + 1) >= 0:
        raise RuntimeError(f"{label}: start marker is not unique")
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


def assert_clean_enough() -> None:
    output = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.splitlines()
    blockers: list[str] = []
    for line in output:
        if line.startswith("?? ") and line[3:] in ALLOWED_UNTRACKED:
            continue
        blockers.append(line)
    if blockers:
        raise RuntimeError("Working tree has unrelated changes:\n" + "\n".join(blockers))


def main() -> None:
    assert_clean_enough()
    original_app = APP_PATH.read_text()
    original_db = DB_PATH.read_text()
    migration_existed = MIGRATION_PATH.exists()
    original_migration = MIGRATION_PATH.read_text() if migration_existed else ""

    try:
        app = original_app
        db = original_db

        app = replace_once(
            app,
            "import { admitTenant, cleanupOldActivityLogs, createStaffAccount, deactivateStaffAccount, deleteBranchCascade, deleteCashbookEntryCascade, deleteTenantWithPayments, getAffectedTables, getBranchRentCollectionSummary, loadAppData, loadActivityLogs, persistAppData, reactivateUserAccount, recordSplitPayment, refreshTables, resetUserPassword, swapTenantRooms, undoVacateTenant, updateUnsettledTenantRent, vacateTenantErp } from './lib/database'",
            "import { admitTenant, cleanupOldActivityLogs, createStaffAccount, deactivateStaffAccount, deleteBranchCascade, deleteCashbookEntryCascade, deleteTenantWithPayments, editTenantWithRentAdjustment, getAffectedTables, getBranchRentCollectionSummary, loadAppData, loadActivityLogs, persistAppData, reactivateUserAccount, recordSplitPayment, refreshTables, resetUserPassword, swapTenantRooms, undoVacateTenant, vacateTenantErp } from './lib/database'",
            "database import",
        )
        app = replace_once(
            app,
            "  const dueAnchor = currentStay?.dueDate || tenant.dueDate || cycleStartDate\n",
            "  const dueAnchor = tenant.dueDate || currentStay?.dueDate || cycleStartDate\n",
            "editable due-date anchor",
        )
        app = replace_once(
            app,
            "      const originalDueDate = rentDueDateForPeriod(dueAnchor, period)\n",
            "      const originalDueDate = obligation?.dueDate || rentDueDateForPeriod(dueAnchor, period)\n",
            "obligation-specific due date",
        )

        new_edit_handler = """      {modal === 'editTenant' && (() => {
        const tenant = data.tenants.find((item) => item.id === selectedTenantId)!
        const rentState = scoped.rentStates.get(tenant.id) || rentLedgerState(tenant, scoped.obligations, scoped.payments)
        return <EditTenantModal tenant={tenant} rentState={rentState} rooms={scoped.rooms} tenants={scoped.activeTenants} onClose={closeModal} onSubmit={async (changes) => {
          setBackendError('')
          try {
            await editTenantWithRentAdjustment({ tenantId: tenant.id, ...changes })
            const refreshed = await refreshTables(getAffectedTables('edit_tenant'), dataRef.current)
            dataRef.current = refreshed
            setData(refreshed)
            refreshRentSummary()
            setSuccessMessage(`${changes.name} updated successfully. Payment and transaction history was preserved.`)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to edit tenant.'
            setBackendError(message)
            throw error
          }
        }} />
      })()}"""
        app = replace_line_containing(
            app,
            "{modal === 'editTenant' && <EditTenantModal",
            new_edit_handler,
            "edit tenant handler",
        )

        new_modal_section = """type TenantEditChanges = {
  name: string
  phone: string
  email: string
  roomId: string
  bedNo: number
  joiningDate: string
  monthlyRent: number
  security: number
  electricity: Tenant['electricity']
  electricityAmount: number
  dueDate: string
  idProof: string
  status: Exclude<TenantStatus, 'Left'>
  rentPeriod: string
  rentBalance: number
  rentDueDate: string
  adjustRentLedger: boolean
  applyRentToPending: boolean
}

type TenantRentState = ReturnType<typeof getRentLedgerState>

function EditTenantModal({ tenant, rentState, rooms, tenants, onClose, onSubmit }: { tenant: Tenant; rentState: TenantRentState; rooms: Room[]; tenants: Tenant[]; onClose: () => void; onSubmit: (changes: TenantEditChanges) => Promise<void> }) {
  const [roomId, setRoomId] = useState(tenant.roomId)
  const [rentBalance, setRentBalance] = useState(rentState.pending)
  const [rentDueDate, setRentDueDate] = useState(rentState.dueDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const available = rooms.filter((room) => room.id === tenant.roomId || (room.status !== 'Maintenance' && tenants.filter((item) => item.roomId === room.id && item.id !== tenant.id).length < room.beds))

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const form = new FormData(event.currentTarget)
    const room = rooms.find((item) => item.id === roomId)
    if (!room) { setError('Select a valid room.'); return }
    const occupants = tenants.filter((item) => item.roomId === roomId && item.id !== tenant.id)
    const occupiedBeds = new Set(occupants.map((item) => item.bedNo))
    const nextFreeBed = Array.from({ length: room.beds }, (_, index) => index + 1).find((bed) => !occupiedBeds.has(bed))
    const bedNo = roomId === tenant.roomId ? tenant.bedNo : nextFreeBed
    if (!bedNo) { setError(`Room ${room.number} has no vacant bed.`); return }
    const balanceChanged = Math.abs(rentBalance - rentState.pending) > 0.009
    const dueDateChanged = rentDueDate !== rentState.dueDate
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        name: String(form.get('name')).trim().toUpperCase(),
        phone: String(form.get('phone')),
        email: String(form.get('email') || ''),
        roomId,
        bedNo,
        joiningDate: String(form.get('joiningDate')),
        monthlyRent: Number(form.get('monthlyRent')),
        security: Number(form.get('security')),
        electricity: String(form.get('electricity')) as Tenant['electricity'],
        electricityAmount: Number(form.get('electricityAmount')),
        dueDate: dueDateChanged ? rentDueDate : tenant.dueDate,
        idProof: String(form.get('idProof') || '').replace(/\s/g, ''),
        status: String(form.get('status')) as Exclude<TenantStatus, 'Left'>,
        rentPeriod: rentState.period,
        rentBalance,
        rentDueDate,
        adjustRentLedger: balanceChanged || dueDateChanged,
        applyRentToPending: form.get('applyRentToPending') === 'on',
      })
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Tenant could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Edit Tenant" onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
    <Field label="Tenant name"><input name="name" className={inputClass} defaultValue={tenant.name} required /></Field>
    <Field label="Phone"><input name="phone" className={inputClass} defaultValue={tenant.phone} required /></Field>
    <Field label="Email"><input name="email" className={inputClass} type="email" defaultValue={tenant.email} placeholder="Optional" /></Field>
    <Field label="Room number"><select className={inputClass} value={roomId} onChange={(event) => setRoomId(event.target.value)}>{available.map((room) => <option key={room.id} value={room.id}>Room {room.number} · {tenants.filter((item) => item.roomId === room.id && item.id !== tenant.id).length}/{room.beds} occupied</option>)}</select></Field>
    <Field label="Joining date"><input name="joiningDate" className={inputClass} type="date" defaultValue={tenant.joiningDate} /></Field>
    <Field label="Monthly rent"><input name="monthlyRent" className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" onWheel={(event) => event.currentTarget.blur()} defaultValue={tenant.monthlyRent} /></Field>
    <Field label="Security deposit"><input name="security" className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" onWheel={(event) => event.currentTarget.blur()} defaultValue={tenant.security} /></Field>
    <Field label="Electricity option"><select name="electricity" className={inputClass} defaultValue={tenant.electricity}><option>Included</option><option>Fixed</option></select></Field>
    <Field label="Electricity amount"><input name="electricityAmount" className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" onWheel={(event) => event.currentTarget.blur()} defaultValue={tenant.electricityAmount} /></Field>
    <Field label="Aadhaar number"><input name="idProof" className={inputClass} inputMode="numeric" maxLength={12} pattern="[0-9]{12}" title="Enter a 12-digit Aadhaar number" defaultValue={tenant.idProof.replace(/\s/g, '')} placeholder="Optional, 12 digits" /></Field>
    <Field label="Status"><select name="status" className={inputClass} defaultValue={tenant.status}><option>Active</option><option>Notice</option><option>Needs Verification</option></select></Field>

    <div className="md:col-span-2 grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
      <div><p className="font-bold text-amber-900">Rent Ledger Adjustment</p><p className="text-xs text-amber-800">Period: {formatMonth(rentState.period)} · Already received: {money(rentState.received)} · Advance applied: {money(rentState.advanceApplied)}</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Current rent balance"><input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={rentBalance} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setRentBalance(Math.max(0, Number(event.target.value)))} required /></Field>
        <Field label="Current rent due date"><input className={inputClass} type="date" value={rentDueDate} onChange={(event) => setRentDueDate(event.target.value)} required /></Field>
      </div>
      <p className="text-xs text-amber-800"><b>Safe edit:</b> changing these fields adjusts only this rent ledger obligation. Existing payments, cashbook entries, invoices, security entries and old activity history are not deleted or rewritten.</p>
    </div>

    <label className="md:col-span-2 flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"><input name="applyRentToPending" type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" /><span><b>Apply new monthly rent to other existing unpaid months</b><br /><span className="text-slate-500">Off by default so a normal detail edit never changes old rent ledger entries.</span></span></label>
    {error && <p className="md:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="md:col-span-2 flex justify-end gap-2"><Button tone="soft" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Tenant'}</Button></div>
  </form></Modal>
}"""
        app = replace_section(
            app,
            "type TenantEditChanges =",
            "type InitialAdmissionPayment =",
            new_modal_section,
            "tenant edit modal",
        )

        db = replace_once(
            db,
            "  payment: ['tenants', 'payments', 'cashbook_entries', 'activity_logs', 'payment_obligations', 'security_ledger'] as const,\n",
            "  payment: ['tenants', 'payments', 'cashbook_entries', 'activity_logs', 'payment_obligations', 'security_ledger'] as const,\n  edit_tenant: ['tenants', 'rooms', 'activity_logs', 'payment_obligations'] as const,\n",
            "edit tenant affected tables",
        )
        db = replace_once(
            db,
            "export function getAffectedTables(operation: 'admit' | 'payment' | 'vacate' | 'delete_tenant' | 'delete_cashbook' | 'swap'): readonly string[] {\n",
            "export function getAffectedTables(operation: 'admit' | 'payment' | 'edit_tenant' | 'vacate' | 'delete_tenant' | 'delete_cashbook' | 'swap'): readonly string[] {\n",
            "edit tenant affected-table type",
        )

        edit_helper = """export async function editTenantWithRentAdjustment(input: {
  tenantId: string
  name: string
  phone: string
  email: string
  roomId: string
  bedNo: number
  joiningDate: string
  monthlyRent: number
  security: number
  electricity: string
  electricityAmount: number
  dueDate: string
  idProof: string
  status: 'Active' | 'Notice' | 'Needs Verification'
  rentPeriod: string
  rentBalance: number
  rentDueDate: string
  adjustRentLedger: boolean
  applyRentToPending: boolean
}) {
  const { data, error } = await supabase.rpc('edit_tenant_with_rent_adjustment', {
    p_tenant_id: input.tenantId,
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email || '',
    p_room_id: input.roomId,
    p_bed_no: input.bedNo,
    p_joining_date: input.joiningDate,
    p_monthly_rent: input.monthlyRent,
    p_security: input.security,
    p_electricity: input.electricity,
    p_electricity_amount: input.electricityAmount,
    p_due_date: input.dueDate,
    p_id_proof: input.idProof || '',
    p_status: input.status,
    p_rent_period: input.rentPeriod,
    p_rent_balance: input.rentBalance,
    p_rent_due_date: input.rentDueDate,
    p_adjust_rent_ledger: input.adjustRentLedger,
    p_apply_rent_to_pending: input.applyRentToPending,
  })
  if (error) throw databaseError('edit_tenant_with_rent_adjustment RPC', error)
  return data as { tenant_id: string; rent_period: string; rent_balance: number; ledger_adjusted: boolean }
}

"""
        db = replace_once(
            db,
            "export async function updateUnsettledTenantRent(tenantId: string, monthlyRent: number) {\n",
            edit_helper + "export async function updateUnsettledTenantRent(tenantId: string, monthlyRent: number) {\n",
            "tenant ledger edit database helper",
        )

        migration = r"""-- Atomic tenant detail + rent-ledger edit.
-- Payment, cashbook, invoice, security and historical activity rows are never deleted.

create or replace function public.edit_tenant_with_rent_adjustment(
  p_tenant_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_room_id uuid,
  p_bed_no integer,
  p_joining_date date,
  p_monthly_rent numeric,
  p_security numeric,
  p_electricity text,
  p_electricity_amount numeric,
  p_due_date date,
  p_id_proof text,
  p_status text,
  p_rent_period text,
  p_rent_balance numeric,
  p_rent_due_date date,
  p_adjust_rent_ledger boolean default false,
  p_apply_rent_to_pending boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_actor_name text;
  v_actor_role text;
  v_branch_name text;
  v_room_beds integer;
  v_room_status text;
  v_obligation_id uuid;
  v_received numeric := 0;
  v_payment_total numeric := 0;
  v_advance numeric := 0;
  v_old_balance numeric := 0;
  v_new_agreed numeric := 0;
  v_new_status text := 'Pending';
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to edit a tenant' using errcode = '42501';
  end if;

  select p.name, p.role into v_actor_name, v_actor_role
  from public.profiles p
  where p.id = auth.uid() and p.active is not false;

  if not found or lower(coalesce(v_actor_role, '')) <> 'admin' then
    raise exception 'Only an active admin can edit tenant rent balances' using errcode = '42501';
  end if;

  select * into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  if not public.has_branch_access(v_tenant.branch_id) then
    raise exception 'You do not have permission to edit this branch' using errcode = '42501';
  end if;

  if nullif(trim(p_name), '') is null then raise exception 'Tenant name is required'; end if;
  if nullif(trim(p_phone), '') is null then raise exception 'Phone number is required'; end if;
  if p_monthly_rent < 0 or p_security < 0 or p_electricity_amount < 0 or p_rent_balance < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '22003';
  end if;
  if p_status not in ('Active', 'Notice', 'Needs Verification') then raise exception 'Invalid tenant status'; end if;
  if p_electricity not in ('Included', 'Fixed') then raise exception 'Invalid electricity option'; end if;
  if nullif(p_id_proof, '') is not null and p_id_proof !~ '^[0-9]{12}$' then raise exception 'Aadhaar number must contain 12 digits'; end if;
  if p_rent_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid rent period'; end if;

  select r.beds, r.status into v_room_beds, v_room_status
  from public.rooms r
  where r.id = p_room_id and r.branch_id = v_tenant.branch_id;

  if not found then raise exception 'Selected room does not belong to this branch'; end if;
  if v_room_status = 'Maintenance' and p_room_id <> v_tenant.room_id then raise exception 'Selected room is under maintenance'; end if;
  if p_bed_no < 1 or p_bed_no > v_room_beds then raise exception 'Invalid bed number'; end if;

  if exists (
    select 1 from public.tenants t
    where t.id <> p_tenant_id
      and t.room_id = p_room_id
      and t.bed_no = p_bed_no
      and t.status in ('Active', 'Notice', 'Needs Verification')
  ) then
    raise exception 'The selected bed is already occupied';
  end if;

  update public.tenants
  set name = upper(trim(p_name)),
      phone = trim(p_phone),
      email = nullif(trim(p_email), ''),
      room_id = p_room_id,
      bed_no = p_bed_no,
      joining_date = p_joining_date,
      monthly_rent = p_monthly_rent,
      security = p_security,
      electricity = p_electricity,
      electricity_amount = p_electricity_amount,
      due_date = p_due_date,
      id_proof = nullif(p_id_proof, ''),
      status = p_status,
      updated_by = auth.uid()
  where id = p_tenant_id;

  if p_apply_rent_to_pending then
    update public.payment_obligations
    set agreed_amount = greatest(received_amount + advance_applied, p_monthly_rent),
        status = case
          when received_amount + advance_applied >= greatest(received_amount + advance_applied, p_monthly_rent) then 'Paid'
          when received_amount + advance_applied > 0 then 'Partial'
          else 'Pending'
        end
    where tenant_id = p_tenant_id
      and payment_type = 'rent'
      and received_amount + advance_applied < agreed_amount;
  end if;

  if p_adjust_rent_ledger then
    if p_rent_due_date is null then raise exception 'Rent due date is required'; end if;

    select coalesce(sum(p.amount), 0) into v_payment_total
    from public.payments p
    where p.tenant_id = p_tenant_id
      and lower(p.payment_type) = 'rent'
      and p.month = p_rent_period;

    select po.id,
           greatest(coalesce(po.received_amount, 0), v_payment_total),
           coalesce(po.advance_applied, 0),
           greatest(coalesce(po.agreed_amount, 0) - greatest(coalesce(po.received_amount, 0), v_payment_total) - coalesce(po.advance_applied, 0), 0)
      into v_obligation_id, v_received, v_advance, v_old_balance
    from public.payment_obligations po
    where po.tenant_id = p_tenant_id
      and po.payment_type = 'rent'
      and po.period = p_rent_period
    order by po.id
    limit 1
    for update;

    if found then
      v_new_agreed := v_received + v_advance + p_rent_balance;
      v_new_status := case
        when p_rent_balance <= 0 then 'Paid'
        when v_received + v_advance > 0 then 'Partial'
        else 'Pending'
      end;

      update public.payment_obligations
      set agreed_amount = v_new_agreed,
          received_amount = v_received,
          due_date = p_rent_due_date,
          status = v_new_status
      where id = v_obligation_id;
    elsif p_rent_balance > 0 then
      v_received := v_payment_total;
      v_new_agreed := v_received + p_rent_balance;
      v_new_status := case when v_received > 0 then 'Partial' else 'Pending' end;

      insert into public.payment_obligations (
        id, branch_id, tenant_id, period, payment_type,
        agreed_amount, received_amount, advance_applied, due_date, status, created_by
      ) values (
        gen_random_uuid(), v_tenant.branch_id, p_tenant_id, p_rent_period, 'rent',
        v_new_agreed, v_received, 0, p_rent_due_date, v_new_status, auth.uid()
      );
    end if;
  end if;

  update public.rooms r
  set status = case
        when r.status = 'Maintenance' then r.status
        when (
          select count(*) from public.tenants t
          where t.room_id = r.id and t.status in ('Active', 'Notice', 'Needs Verification')
        ) >= r.beds then 'Occupied'
        else 'Vacant'
      end,
      updated_by = auth.uid()
  where r.id in (v_tenant.room_id, p_room_id);

  select b.name into v_branch_name from public.branches b where b.id = v_tenant.branch_id;

  insert into public.activity_logs (
    id, branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    gen_random_uuid(), v_tenant.branch_id, coalesce(v_branch_name, ''), auth.uid(),
    coalesce(v_actor_name, 'Admin'), lower(v_actor_role), 'Tenants', 'Edit Tenant',
    case when p_adjust_rent_ledger
      then format('Admin %s edited tenant %s and adjusted %s rent balance to ₹%s with due date %s. Existing payment and transaction history was preserved.', coalesce(v_actor_name, ''), upper(trim(p_name)), p_rent_period, p_rent_balance, p_rent_due_date)
      else format('Admin %s edited tenant %s details. Rent ledger and payment history were left unchanged.', coalesce(v_actor_name, ''), upper(trim(p_name)))
    end,
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'rent_period', p_rent_period,
      'old_rent_balance', v_old_balance,
      'new_rent_balance', p_rent_balance,
      'rent_due_date', p_rent_due_date,
      'ledger_adjusted', p_adjust_rent_ledger,
      'other_pending_rent_updated', p_apply_rent_to_pending
    )
  );

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'rent_period', p_rent_period,
    'rent_balance', p_rent_balance,
    'ledger_adjusted', p_adjust_rent_ledger
  );
end;
$$;

grant execute on function public.edit_tenant_with_rent_adjustment(uuid, text, text, text, uuid, integer, date, numeric, numeric, text, numeric, date, text, text, text, numeric, date, boolean, boolean) to authenticated;

-- Make manually edited obligation due dates authoritative in both dashboard RPCs.
-- Also reconcile stale obligation.received_amount with actual rent payment rows.
do $$
declare
  v_definition text;
  v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.get_branch_rent_collection_summary(uuid,date)'::regprocedure,
    'public.get_branch_rent_breakdown(uuid,date)'::regprocedure
  ] loop
    select pg_get_functiondef(v_signature) into v_definition;

    if position('po.advance_applied, po.due_date' in v_definition) = 0 then
      if position('select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied' in v_definition) = 0 then
        raise exception 'Expected payment obligation projection was not found in %', v_signature;
      end if;
      v_definition := replace(
        v_definition,
        'select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied',
        'select po.tenant_id, po.period, po.agreed_amount, po.received_amount, po.advance_applied, po.due_date'
      );
    end if;

    if position('coalesce(eo.due_date, tp.computed_due_date) as computed_due_date' in v_definition) = 0 then
      if position('tp.computed_due_date,' in v_definition) = 0 then
        raise exception 'Expected computed due date projection was not found in %', v_signature;
      end if;
      v_definition := replace(
        v_definition,
        'tp.computed_due_date,',
        'coalesce(eo.due_date, tp.computed_due_date) as computed_due_date,'
      );
    end if;

    v_definition := replace(
      v_definition,
      'when eo.tenant_id is not null then coalesce(eo.received_amount, 0)',
      'when eo.tenant_id is not null then greatest(coalesce(eo.received_amount, 0), coalesce(ps.paid, 0))'
    );

    execute v_definition;
  end loop;
end;
$$;

comment on function public.edit_tenant_with_rent_adjustment(uuid, text, text, text, uuid, integer, date, numeric, numeric, text, numeric, date, text, text, text, numeric, date, boolean, boolean) is
  'Atomically edits tenant details and optionally one rent obligation while preserving all payment, cashbook, invoice, security and historical activity rows.';
"""

        APP_PATH.write_text(app)
        DB_PATH.write_text(db)
        MIGRATION_PATH.write_text(migration)

        checks = {
            "rent balance field": "Current rent balance" in app,
            "rent due date field": "Current rent due date" in app,
            "safe RPC handler": "editTenantWithRentAdjustment" in app and "edit_tenant_with_rent_adjustment" in db,
            "ledger untouched by detail edit": "adjustRentLedger: balanceChanged || dueDateChanged" in app,
            "no destructive SQL": all(token not in migration.lower() for token in ["delete from public.payments", "delete from public.cashbook_entries", "delete from public.invoices", "truncate"]),
        }
        failed = [name for name, passed in checks.items() if not passed]
        if failed:
            raise RuntimeError("Static validation failed: " + ", ".join(failed))

        run("npm", "run", "self-test")
        run("npm", "run", "build")
        run("npm", "run", "lint")
        run("npx", "supabase", "db", "push", "--yes")

        Path(__file__).unlink()
        run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION_PATH.relative_to(ROOT)), "scripts/apply-tenant-rent-ledger-edit.py")
        run("git", "commit", "-m", "feat: edit tenant rent balance and due date safely")
        run("git", "push", "origin", "main")

        print("\nTenant rent balance and due-date editing is validated, migrated and pushed successfully.")
        print("Your untracked QA files were not touched.")
    except Exception:
        APP_PATH.write_text(original_app)
        DB_PATH.write_text(original_db)
        if migration_existed:
            MIGRATION_PATH.write_text(original_migration)
        elif MIGRATION_PATH.exists():
            MIGRATION_PATH.unlink()
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"\nInstaller stopped safely: {error}")
        raise SystemExit(1)
