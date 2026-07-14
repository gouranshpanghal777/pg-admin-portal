#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}. No files were committed.")
    return text.replace(old, new, 1)


def main() -> None:
    status = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()
    if status:
        raise SystemExit("Working tree is not clean. Commit/stash unrelated local changes first.\n" + status)

    db_path = ROOT / "src/lib/database.ts"
    db = db_path.read_text()

    db = replace_once(
        db,
        "const num = (value: unknown) => Number(value || 0)\n",
        "const num = (value: unknown) => Number(value || 0)\nconst ACTIVITY_LOG_LIMIT = 1000\n",
        "activity log limit constant",
    )
    db = replace_once(
        db,
        "  const results = await Promise.all(tables.map((table) => supabase.from(table).select('*')))\n",
        "  const results = await Promise.all(tables.map((table) =>\n    table === 'activity_logs'\n      ? supabase.from(table).select('*').order('created_at', { ascending: false }).limit(ACTIVITY_LOG_LIMIT)\n      : supabase.from(table).select('*')\n  ))\n",
        "bounded activity logs on initial load",
    )
    db = replace_once(
        db,
        "  const { data, error } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false })\n",
        "  const { data, error } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(ACTIVITY_LOG_LIMIT)\n",
        "bounded activity log refresh",
    )

    old_persist = """export async function persistAppData(before: AppData, after: AppData, userId: string): Promise<void> {
  const order: Array<keyof typeof rows> = ['branches', 'rooms', 'tenants', 'invoices', 'payments', 'cashbook', 'expenses', 'categories', 'inventory', 'purchases', 'tickets', 'activityLogs']
  for (const key of order) {
    const oldItems = (before as any)[key] || []
    const newItems = (after as any)[key] || []
    const oldMap = new Map(oldItems.map((item: any) => [item.id, JSON.stringify(rows[key](item, userId))]))
    const changed = newItems.filter((item: any) => oldMap.get(item.id) !== JSON.stringify(rows[key](item, userId)))
    const table = tableNames[key] || key
    if (changed.length) await upsertWithRetry(table, changed.map((item: any) => rows[key](item, userId)))
  }
  for (const key of [...order].reverse()) {
    const oldItems = (before as any)[key] || []
    const newItems = (after as any)[key] || []
    const removed = oldItems.filter((item: any) => !newItems.some((next: any) => next.id === item.id)).map((item: any) => item.id)
    const table = tableNames[key] || key
    if (removed.length) await deleteWithRetry(table, removed)
  }
}
"""
    new_persist = """export async function persistAppData(before: AppData, after: AppData, userId: string): Promise<void> {
  const order: Array<keyof typeof rows> = ['branches', 'rooms', 'tenants', 'invoices', 'payments', 'cashbook', 'expenses', 'categories', 'inventory', 'purchases', 'tickets', 'activityLogs']
  for (const key of order) {
    const oldItems = (before as any)[key] || []
    const newItems = (after as any)[key] || []
    const serialize = rows[key] as (item: any, actorId: string) => Record<string, unknown>
    const oldMap = new Map(oldItems.map((item: any) => [item.id, JSON.stringify(serialize(item, userId))]))
    const changedRows: Record<string, unknown>[] = []
    for (const item of newItems) {
      const serialized = serialize(item, userId)
      if (oldMap.get(item.id) !== JSON.stringify(serialized)) changedRows.push(serialized)
    }
    const table = tableNames[key] || key
    if (changedRows.length) await upsertWithRetry(table, changedRows)
  }
  for (const key of [...order].reverse()) {
    const oldItems = (before as any)[key] || []
    const newItems = (after as any)[key] || []
    const newIds = new Set(newItems.map((item: any) => item.id))
    const removed = oldItems.filter((item: any) => !newIds.has(item.id)).map((item: any) => item.id)
    const table = tableNames[key] || key
    if (removed.length) await deleteWithRetry(table, removed)
  }
}
"""
    db = replace_once(db, old_persist, new_persist, "linear persistence diff")

    old_refresh = """  const entries = await Promise.all(
    tables.map(async (table) => {
      const { data, error } = await supabase.from(table).select('*')
      if (error) throw error
      return [table, data || []] as const
    })
  )
"""
    new_refresh = """  const entries = await Promise.all(
    tables.map(async (table) => {
      const response = table === 'activity_logs'
        ? await supabase.from(table).select('*').order('created_at', { ascending: false }).limit(ACTIVITY_LOG_LIMIT)
        : await supabase.from(table).select('*')
      if (response.error) throw response.error
      return [table, response.data || []] as const
    })
  )
"""
    db = replace_once(db, old_refresh, new_refresh, "bounded logs in targeted refresh")

    old_guard = """  const payment = payments?.[0]
  if (!payment) return

  const [{ data: tenant, error: tenantError }, { data: obligations, error: obligationError }, { data: auth }] = await Promise.all([
"""
    new_guard = """  const payment = payments?.[0]
  if (!payment) return
  if (payment.month === intendedPeriod) {
    const { data: advanceRows, error: advanceLookupError } = await supabase.from('tenant_advances')
      .select('id')
      .eq('payment_id', payment.id)
      .limit(1)
    if (advanceLookupError) throw databaseError('check rent advance allocation', advanceLookupError)
    if (!advanceRows?.length) return
  }

  const [{ data: tenant, error: tenantError }, { data: obligations, error: obligationError }, { data: auth }] = await Promise.all([
"""
    db = replace_once(db, old_guard, new_guard, "skip unnecessary rent repair")

    old_allocation = """  let remaining = input.rentAmount
  let period = intendedPeriod
  for (let index = 0; remaining > 0 && index < 120; index += 1, period = followingPeriod(period)) {
    const existing = obligationByPeriod.get(period)
    const agreed = Number(existing?.agreed_amount || tenant.monthly_rent)
    const received = Number(existing?.received_amount || 0)
    const advanceApplied = Number(existing?.advance_applied || 0)
    const applied = Math.min(remaining, Math.max(0, agreed - received - advanceApplied))
    const nextReceived = received + applied
    const row = {
      id: existing?.id || crypto.randomUUID(), branch_id: input.branchId, tenant_id: input.tenantId,
      period, payment_type: 'rent', agreed_amount: agreed, received_amount: nextReceived,
      advance_applied: advanceApplied, due_date: existing?.due_date || dueDateFor(period),
      status: nextReceived + advanceApplied >= agreed ? 'Paid' : nextReceived + advanceApplied > 0 ? 'Partial' : 'Pending',
      created_by: existing?.created_by || auth.user?.id,
    }
    const { error: allocationError } = await supabase.from('payment_obligations').upsert(row)
    if (allocationError) throw databaseError('allocate rent across monthly obligations', allocationError)
    obligationByPeriod.set(period, row)
    remaining -= applied
  }
"""
    new_allocation = """  let remaining = input.rentAmount
  let period = intendedPeriod
  const allocationRows: Record<string, unknown>[] = []
  for (let index = 0; remaining > 0 && index < 120; index += 1, period = followingPeriod(period)) {
    const existing = obligationByPeriod.get(period)
    const agreed = Number(existing?.agreed_amount || tenant.monthly_rent)
    const received = Number(existing?.received_amount || 0)
    const advanceApplied = Number(existing?.advance_applied || 0)
    const applied = Math.min(remaining, Math.max(0, agreed - received - advanceApplied))
    if (applied <= 0) continue
    const nextReceived = received + applied
    const row = {
      id: existing?.id || crypto.randomUUID(), branch_id: input.branchId, tenant_id: input.tenantId,
      period, payment_type: 'rent', agreed_amount: agreed, received_amount: nextReceived,
      advance_applied: advanceApplied, due_date: existing?.due_date || dueDateFor(period),
      status: nextReceived + advanceApplied >= agreed ? 'Paid' : 'Partial',
      created_by: existing?.created_by || auth.user?.id,
    }
    allocationRows.push(row)
    obligationByPeriod.set(period, row)
    remaining -= applied
  }
  if (allocationRows.length) {
    const { error: allocationError } = await supabase.from('payment_obligations').upsert(allocationRows)
    if (allocationError) throw databaseError('allocate rent across monthly obligations', allocationError)
  }
"""
    db = replace_once(db, old_allocation, new_allocation, "batch rent allocation")

    old_duplicate = """  const { error: rebuildError } = await supabase.from('payment_obligations').upsert(rows)
  if (rebuildError) throw databaseError('rebuild rent obligations after delete', rebuildError)
  const { error: normalizeError } = await supabase.from('payment_obligations').upsert(rows.map((row) => ({ ...row, advance_applied: 0 })))
  if (normalizeError) throw databaseError('normalize rebuilt rent obligations', normalizeError)
"""
    new_duplicate = """  const { error: rebuildError } = await supabase.from('payment_obligations').upsert(rows)
  if (rebuildError) throw databaseError('rebuild rent obligations after delete', rebuildError)
"""
    db = replace_once(db, old_duplicate, new_duplicate, "remove duplicate ledger upsert")
    db_path.write_text(db)

    app_path = ROOT / "src/App.tsx"
    app = app_path.read_text()

    old_ledger_start = """function getRentLedgerState(tenant: Tenant, payments: Payment[], obligations: PaymentObligation[] = []) {
  const rentObligations = obligations.filter((item) => item.tenantId === tenant.id && item.paymentType === 'Rent')
  const currentStay = tenant.rejoins?.at(-1)
"""
    new_ledger_start = """function getRentLedgerState(tenant: Tenant, payments: Payment[], obligations: PaymentObligation[] = []) {
  const rentObligations = new Map<string, PaymentObligation>()
  for (const item of obligations) if (item.tenantId === tenant.id && item.paymentType === 'Rent') rentObligations.set(item.period, item)
  const rentPayments = new Map<string, number>()
  for (const payment of payments) {
    if (payment.tenantId !== tenant.id || payment.paymentType !== 'Rent') continue
    rentPayments.set(payment.month, (rentPayments.get(payment.month) || 0) + payment.amount)
  }
  const currentStay = tenant.rejoins?.at(-1)
"""
    app = replace_once(app, old_ledger_start, new_ledger_start, "indexed tenant rent ledger")
    app = replace_once(
        app,
        "  const importedPaidMonths = importedRentPaidMonths[tenant.name.trim().toUpperCase()] || []\n",
        "  const importedPaidMonths = new Set(importedRentPaidMonths[tenant.name.trim().toUpperCase()] || [])\n",
        "indexed imported paid months",
    )
    old_loop_lookup = """    const obligation = rentObligations.find((item) => item.period === period)
    const recordedPayments = payments.filter((payment) => payment.tenantId === tenant.id && payment.paymentType === 'Rent' && payment.month === period).reduce((sum, payment) => sum + payment.amount, 0)
    const agreed = obligation?.agreed ?? tenant.monthlyRent
    const received = Math.max(obligation?.received ?? 0, recordedPayments, importedPaidMonths.includes(period) ? agreed : 0)
"""
    new_loop_lookup = """    const obligation = rentObligations.get(period)
    const recordedPayments = rentPayments.get(period) || 0
    const agreed = obligation?.agreed ?? tenant.monthlyRent
    const received = Math.max(obligation?.received ?? 0, recordedPayments, importedPaidMonths.has(period) ? agreed : 0)
"""
    app = replace_once(app, old_loop_lookup, new_loop_lookup, "constant-time monthly rent lookup")

    old_rent_states = """  const expected = activeTenants.reduce((sum, tenant) => sum + getTenantDue(tenant), 0)
  const rentStates = new Map(activeTenants.map((tenant) => [tenant.id, getRentLedgerState(tenant, payments, obligations)]))
"""
    new_rent_states = """  const expected = activeTenants.reduce((sum, tenant) => sum + getTenantDue(tenant), 0)
  const paymentsByTenant = new Map<string, Payment[]>()
  for (const payment of payments) {
    const tenantPayments = paymentsByTenant.get(payment.tenantId)
    if (tenantPayments) tenantPayments.push(payment)
    else paymentsByTenant.set(payment.tenantId, [payment])
  }
  const obligationsByTenant = new Map<string, PaymentObligation[]>()
  for (const obligation of obligations) {
    const tenantObligations = obligationsByTenant.get(obligation.tenantId)
    if (tenantObligations) tenantObligations.push(obligation)
    else obligationsByTenant.set(obligation.tenantId, [obligation])
  }
  const rentStates = new Map(activeTenants.map((tenant) => [tenant.id, getRentLedgerState(tenant, paymentsByTenant.get(tenant.id) || [], obligationsByTenant.get(tenant.id) || [])]))
"""
    app = replace_once(app, old_rent_states, new_rent_states, "group rent data once per branch")

    app = replace_once(
        app,
        "    description: input.description, metadata: input.metadata, at: '', oldValue: '', newValue: '',\n",
        "    description: input.description, metadata: input.metadata, at: new Date().toISOString(), oldValue: '', newValue: '',\n",
        "local activity timestamp",
    )
    app = replace_once(
        app,
        "  return { ...data, activityLogs: [log, ...data.activityLogs] }\n",
        "  return { ...data, activityLogs: [log, ...data.activityLogs].slice(0, 1000) }\n",
        "bound local activity history",
    )

    old_rooms = """  const refreshRoomStatuses = (next: AppData): AppData => ({
    ...next,
    rooms: next.rooms.map((room) => {
      if (room.status === 'Maintenance') return room
      const activeCount = next.tenants.filter((tenant) => tenant.roomId === room.id && tenant.status !== 'Left').length
      return { ...room, status: activeCount >= room.beds ? 'Occupied' : 'Vacant' }
    }),
  })
"""
    new_rooms = """  const refreshRoomStatuses = (next: AppData): AppData => {
    const occupiedByRoom = new Map<string, number>()
    for (const tenant of next.tenants) {
      if (tenant.status === 'Left') continue
      occupiedByRoom.set(tenant.roomId, (occupiedByRoom.get(tenant.roomId) || 0) + 1)
    }
    return {
      ...next,
      rooms: next.rooms.map((room) => room.status === 'Maintenance'
        ? room
        : { ...room, status: (occupiedByRoom.get(room.id) || 0) >= room.beds ? 'Occupied' : 'Vacant' }),
    }
  }
"""
    app = replace_once(app, old_rooms, new_rooms, "linear room status calculation")

    old_update_queue = """      .then(async () => {
        await persistAppData(previous, logged, currentUser.id)
        const refreshedLogs = await loadActivityLogs()
        const refreshed = { ...logged, activityLogs: refreshedLogs }
        dataRef.current = refreshed
        setData(refreshed)
      })
"""
    app = replace_once(
        app, old_update_queue,
        "      .then(() => persistAppData(previous, logged, currentUser.id))\n",
        "remove full log reload after every entry",
    )

    old_branch_queue = """      .then(async () => {
        await persistAppData(previous, next, currentUser.id)
        const refreshedLogs = await loadActivityLogs()
        const refreshed = { ...next, activityLogs: refreshedLogs }
        dataRef.current = refreshed
        setData(refreshed)
      })
"""
    app = replace_once(
        app, old_branch_queue,
        "      .then(() => persistAppData(previous, next, currentUser.id))\n",
        "remove full log reload after branch save",
    )

    app = replace_once(
        app,
        "if (logged !== next) { await persistAppData(next, logged, session.user.id); try { const refreshedLogs = await loadActivityLogs(); const refreshed = { ...logged, activityLogs: refreshedLogs }; dataRef.current = refreshed; setData(refreshed) } catch {}; sessionStorage.setItem(loginKey, '1') }",
        "if (logged !== next) { await persistAppData(next, logged, session.user.id); sessionStorage.setItem(loginKey, '1') }",
        "remove login log redownload",
    )
    app = replace_once(
        app,
        "persistenceQueue.current = persistenceQueue.current.then(async () => { await persistAppData(previous, logged, currentUser.id); try { const refreshedLogs = await loadActivityLogs(); const refreshed = { ...logged, activityLogs: refreshedLogs }; dataRef.current = refreshed; setData(refreshed) } catch {} }).catch(() => {})",
        "persistenceQueue.current = persistenceQueue.current.then(() => persistAppData(previous, logged, currentUser.id)).catch(() => {})",
        "remove export log redownload",
    )
    app_path.write_text(app)

    migration = ROOT / "supabase/migrations/202607140004_runtime_performance_indexes.sql"
    migration.write_text("""-- Indexes for the app's hottest entry and refresh paths.\n-- Idempotent; no business data or calculation rules are changed.\n\ncreate index if not exists idx_payments_repair_lookup\n  on public.payments (tenant_id, branch_id, payment_type, payment_date, amount, created_at desc);\ncreate index if not exists idx_payments_branch_month\n  on public.payments (branch_id, month, payment_type);\ncreate index if not exists idx_payment_obligations_tenant_period\n  on public.payment_obligations (tenant_id, payment_type, period);\ncreate index if not exists idx_payment_obligations_branch_period\n  on public.payment_obligations (branch_id, payment_type, period);\ncreate index if not exists idx_tenant_advances_payment\n  on public.tenant_advances (payment_id);\ncreate index if not exists idx_tenants_branch_status\n  on public.tenants (branch_id, status);\ncreate index if not exists idx_cashbook_branch_date\n  on public.cashbook_entries (branch_id, entry_date desc);\ncreate index if not exists idx_activity_logs_branch_created\n  on public.activity_logs (branch_id, created_at desc);\n""")

    run("npm", "ci")
    run("npm", "run", "self-test")
    run("npm", "run", "build")
    run("npm", "run", "lint")

    Path(__file__).unlink()
    run("git", "add", "src/App.tsx", "src/lib/database.ts", "supabase/migrations/202607140004_runtime_performance_indexes.sql", "scripts/apply-performance-audit-fix.py")
    run("git", "commit", "-m", "perf: remove redundant entry work and repeated scans")
    run("git", "push", "origin", "main")
    run("npx", "supabase", "db", "push")

    print("\nPerformance audit fix applied, validated, pushed, and migrated successfully.")


if __name__ == "__main__":
    main()
