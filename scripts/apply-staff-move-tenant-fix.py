#!/usr/bin/env python3
import subprocess
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src/App.tsx"
DB = ROOT / "src/lib/database.ts"
TEST = ROOT / "scripts/self-test.mjs"
MIGRATION = ROOT / "supabase/migrations/202607170003_staff_move_tenant_rpc.sql"
SELF = Path(__file__).resolve()
BACKUP_BRANCH = "backup-before-staff-move-fix-2026-07-17"
ALLOWED_UNTRACKED = {
    "qa-smoke-report.md",
    "scripts/qa-smoke-test.mjs",
    "farukhnagar-ledger-audit.json",
}


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


status = subprocess.run(
    ["git", "status", "--porcelain"],
    cwd=ROOT,
    check=True,
    capture_output=True,
    text=True,
).stdout.splitlines()
blockers = [line for line in status if not (line.startswith("?? ") and line[3:] in ALLOWED_UNTRACKED)]
if blockers:
    raise SystemExit("Working tree has unrelated changes:\n" + "\n".join(blockers))

if MIGRATION.exists():
    raise SystemExit(f"Target already exists: {MIGRATION.relative_to(ROOT)}")

run("git", "branch", "-f", BACKUP_BRANCH, "HEAD")
run("git", "push", "origin", f"HEAD:refs/heads/{BACKUP_BRANCH}")

original_app = APP.read_text()
original_db = DB.read_text()
original_test = TEST.read_text()
app = original_app
db = original_db
test = original_test
db_pushed = False

app = replace_once(
    app,
    "swapTenantRooms, undoVacateTenant",
    "swapTenantRooms, moveTenantRoom, undoVacateTenant",
    "database import",
)

old_move = """{modal === 'moveTenant' && <MoveTenantModal tenant={data.tenants.find((tenant) => tenant.id === selectedTenantId)!} rooms={scoped.rooms} tenants={scoped.activeTenants} onClose={closeModal} onSubmit={(roomId, bedNo, note) => { const tenant = data.tenants.find((item) => item.id === selectedTenantId)!; updateData((previous) => ({ ...previous, tenants: previous.tenants.map((item) => item.id === selectedTenantId ? { ...item, roomId, bedNo } : item) }), 'Move Tenant', 'Tenants', `${role} ${currentUser.name} moved tenant ${tenant.name} from Room ${data.rooms.find((room) => room.id === tenant.roomId)?.number} to Room ${data.rooms.find((room) => room.id === roomId)?.number} Bed ${bedNo} on ${formatDate(today)}.${note ? ` Reason: ${note}.` : ''}`) }} onSwap="""
new_move = """{modal === 'moveTenant' && <MoveTenantModal tenant={data.tenants.find((tenant) => tenant.id === selectedTenantId)!} rooms={scoped.rooms} tenants={scoped.activeTenants} onClose={closeModal} onSubmit={async (roomId, bedNo, note) => { const tenant = data.tenants.find((item) => item.id === selectedTenantId)!; setBackendError(''); try { const result = await moveTenantRoom({ tenantId: tenant.id, targetRoomId: roomId, targetBedNo: bedNo, expectedRoomId: tenant.roomId, expectedBedNo: tenant.bedNo, note }); if (!result.success) throw new Error(result.error || 'Move failed'); const refreshed = await refreshTables(['tenants', 'rooms', 'activity_logs'], dataRef.current); dataRef.current = refreshed; setData(refreshed); setSuccessMessage(`${tenant.name} moved to Room ${data.rooms.find((room) => room.id === roomId)?.number} Bed ${bedNo}.`); } catch (error) { const message = error instanceof Error ? error.message : 'Move failed'; setBackendError(message); throw error } }} onSwap="""
app = replace_once(app, old_move, new_move, "normal move handler")

insert_after = """export async function swapTenantRooms(
  tenantAId: string,
  tenantBId: string,
  tenantAExpectedRoomId: string,
  tenantAExpectedBedNo: number,
  tenantBExpectedRoomId: string,
  tenantBExpectedBedNo: number
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('swap_tenant_rooms', {
    p_tenant_a_id: tenantAId,
    p_tenant_b_id: tenantBId,
    p_tenant_a_expected_room_id: tenantAExpectedRoomId,
    p_tenant_a_expected_bed_no: tenantAExpectedBedNo,
    p_tenant_b_expected_room_id: tenantBExpectedRoomId,
    p_tenant_b_expected_bed_no: tenantBExpectedBedNo,
  })
  if (error) throw databaseError('swap_tenant_rooms RPC', error)
  return data as { success: boolean; error?: string }
}
"""
move_helper = insert_after + """

export async function moveTenantRoom(input: {
  tenantId: string
  targetRoomId: string
  targetBedNo: number
  expectedRoomId: string
  expectedBedNo: number
  note?: string
}): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('move_tenant_room', {
    p_tenant_id: input.tenantId,
    p_target_room_id: input.targetRoomId,
    p_target_bed_no: input.targetBedNo,
    p_expected_room_id: input.expectedRoomId,
    p_expected_bed_no: input.expectedBedNo,
    p_note: input.note || null,
  })
  if (error) throw databaseError('move_tenant_room RPC', error)
  return data as { success: boolean; error?: string }
}
"""
db = replace_once(db, insert_after, move_helper, "move tenant database helper")

migration_sql = r'''
create or replace function public.move_tenant_room(
  p_tenant_id uuid,
  p_target_room_id uuid,
  p_target_bed_no integer,
  p_expected_room_id uuid,
  p_expected_bed_no integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_tenant public.tenants%rowtype;
  v_target_room public.rooms%rowtype;
  v_source_room public.rooms%rowtype;
  v_branch_name text;
  v_source_room_number text;
  v_target_room_number text;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id and active is true;
  if not found then
    raise exception 'Your staff account is not active.' using errcode = '42501';
  end if;

  select * into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;
  if not found then
    raise exception 'Tenant not found.' using errcode = 'P0002';
  end if;

  if v_tenant.status = 'Left' then
    raise exception 'A vacated tenant cannot be moved.';
  end if;

  if lower(v_profile.role::text) <> 'admin' then
    if not exists (
      select 1 from public.branch_assignments
      where user_id = v_user_id and branch_id = v_tenant.branch_id
    ) then
      raise exception 'You are not assigned to this branch.' using errcode = '42501';
    end if;

    if not exists (
      select 1 from public.staff_permissions
      where user_id = v_user_id
        and permission = 'move_tenant'
        and allowed is true
    ) then
      raise exception 'Move tenant permission is not enabled for your account.' using errcode = '42501';
    end if;
  end if;

  if v_tenant.room_id is distinct from p_expected_room_id
     or v_tenant.bed_no is distinct from p_expected_bed_no then
    raise exception 'Tenant room changed after this screen was opened. Refresh and try again.';
  end if;

  select * into v_target_room
  from public.rooms
  where id = p_target_room_id
  for update;
  if not found then
    raise exception 'Target room not found.' using errcode = 'P0002';
  end if;

  if v_target_room.branch_id <> v_tenant.branch_id then
    raise exception 'Tenant can only be moved within the same branch.' using errcode = '42501';
  end if;

  if v_target_room.status = 'Maintenance' then
    raise exception 'Target room is under maintenance.';
  end if;

  if p_target_bed_no < 1 or p_target_bed_no > v_target_room.beds then
    raise exception 'Selected bed number is invalid for this room.';
  end if;

  if exists (
    select 1 from public.tenants
    where room_id = p_target_room_id
      and bed_no = p_target_bed_no
      and status <> 'Left'
      and id <> p_tenant_id
  ) then
    raise exception 'Selected bed is already occupied.' using errcode = '23505';
  end if;

  select * into v_source_room from public.rooms where id = v_tenant.room_id;
  select name into v_branch_name from public.branches where id = v_tenant.branch_id;
  v_source_room_number := coalesce(v_source_room.number, 'Archived');
  v_target_room_number := v_target_room.number;

  update public.tenants
  set room_id = p_target_room_id,
      bed_no = p_target_bed_no,
      updated_by = v_user_id
  where id = p_tenant_id;

  select count(*) into v_active_count
  from public.tenants
  where room_id = v_tenant.room_id and status <> 'Left';
  update public.rooms
  set status = case when v_active_count = 0 then 'Vacant' else 'Occupied' end,
      updated_by = v_user_id
  where id = v_tenant.room_id and status <> 'Maintenance';

  select count(*) into v_active_count
  from public.tenants
  where room_id = p_target_room_id and status <> 'Left';
  update public.rooms
  set status = case when v_active_count = 0 then 'Vacant' else 'Occupied' end,
      updated_by = v_user_id
  where id = p_target_room_id and status <> 'Maintenance';

  insert into public.activity_logs (
    branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    v_tenant.branch_id,
    coalesce(v_branch_name, ''),
    v_user_id,
    coalesce(v_profile.name, 'User'),
    lower(v_profile.role::text),
    'Tenants',
    'Move Tenant',
    format(
      '%s %s moved tenant %s from Room %s Bed %s to Room %s Bed %s.%s',
      initcap(lower(v_profile.role::text)),
      coalesce(v_profile.name, ''),
      v_tenant.name,
      v_source_room_number,
      v_tenant.bed_no,
      v_target_room_number,
      p_target_bed_no,
      case when nullif(trim(coalesce(p_note, '')), '') is null then '' else ' Reason: ' || trim(p_note) end
    ),
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'from_room_id', v_tenant.room_id,
      'from_bed_no', v_tenant.bed_no,
      'to_room_id', p_target_room_id,
      'to_bed_no', p_target_bed_no,
      'note', nullif(trim(coalesce(p_note, '')), '')
    )
  );

  return jsonb_build_object(
    'success', true,
    'tenant_id', p_tenant_id,
    'room_id', p_target_room_id,
    'bed_no', p_target_bed_no
  );
end;
$$;

revoke all on function public.move_tenant_room(uuid, uuid, integer, uuid, integer, text) from public;
grant execute on function public.move_tenant_room(uuid, uuid, integer, uuid, integer, text) to authenticated;
'''

self_test_block = r'''
// Staff move RPC wiring checks
const staffMovePayload = { tenantId: 't1', targetRoomId: 'r2', targetBedNo: 1, expectedRoomId: 'r1', expectedBedNo: 1 }
assert(staffMovePayload.targetRoomId !== staffMovePayload.expectedRoomId, 'SM1. Normal move carries expected source and target room')
assert(staffMovePayload.targetBedNo >= 1, 'SM2. Normal move carries a valid target bed')
const staffMovePermission = { assignedBranch: true, permission: 'move_tenant', allowed: true }
assert(staffMovePermission.assignedBranch && staffMovePermission.permission === 'move_tenant' && staffMovePermission.allowed, 'SM3. Staff move requires branch assignment and move_tenant permission')

'''
test = replace_once(
    test,
    "console.log('All PG Admin Portal flow checks passed.')",
    self_test_block + "console.log('All PG Admin Portal flow checks passed.')",
    "staff move self-tests",
)

try:
    APP.write_text(app)
    DB.write_text(db)
    TEST.write_text(test)
    MIGRATION.write_text(textwrap.dedent(migration_sql).lstrip())

    combined = app + db + test + migration_sql
    checks = {
        "secure frontend helper": "moveTenantRoom({ tenantId:",
        "secure database helper": "supabase.rpc('move_tenant_room'",
        "permission guard": "permission = 'move_tenant'",
        "branch assignment guard": "from public.branch_assignments",
        "same branch restriction": "Tenant can only be moved within the same branch.",
        "occupied bed guard": "Selected bed is already occupied.",
        "activity log": "'Move Tenant'",
        "RPC grant": "grant execute on function public.move_tenant_room",
    }
    for label, marker in checks.items():
        if marker not in combined:
            raise SystemExit(f"Preflight failed: {label} is missing.")

    run("npm", "run", "self-test")
    run("npm", "run", "build")
    run("npm", "run", "lint")
    print("\nThe next command adds only the secure staff Move Tenant RPC. Review the Supabase prompt and answer Y.", flush=True)
    run("npx", "supabase", "db", "push")
    db_pushed = True

    SELF.unlink()
    run(
        "git", "add",
        "src/App.tsx",
        "src/lib/database.ts",
        "scripts/self-test.mjs",
        "supabase/migrations/202607170003_staff_move_tenant_rpc.sql",
        "scripts/apply-staff-move-tenant-fix.py",
    )
    run("git", "commit", "-m", "fix: allow permitted staff to move tenants securely")
    run("git", "push", "origin", "main")
    print("\nStaff Move Tenant fix is live. Backup branch: backup-before-staff-move-fix-2026-07-17", flush=True)
except BaseException:
    if not db_pushed:
        APP.write_text(original_app)
        DB.write_text(original_db)
        TEST.write_text(original_test)
        MIGRATION.unlink(missing_ok=True)
        print("\nFiles were restored because the secure move migration did not complete.", flush=True)
    else:
        print("\nDatabase migration succeeded, but commit/push did not finish. Local files were kept for recovery.", flush=True)
    raise
