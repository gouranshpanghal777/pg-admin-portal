import type { AppData } from '../App'
import { importedRentPaidMonths } from '../data/farukhnagarRentRegister'
import { supabase } from './supabase'

const empty: AppData = { branches: [], users: [], tenants: [], rooms: [], payments: [], cashbook: [], expenses: [], inventory: [], purchases: [], tickets: [], invoices: [], activityLogs: [], obligations: [], securityLedger: [], advances: [] }
const num = (value: unknown) => Number(value || 0)

export async function loadAppData(): Promise<AppData> {
  const tables = ['branches', 'profiles', 'staff_members', 'branch_assignments', 'staff_permissions', 'rooms', 'tenants', 'payments', 'cashbook_entries', 'expenses', 'inventory_items', 'inventory_purchases', 'maintenance_tickets', 'invoices', 'activity_logs', 'payment_obligations', 'security_ledger', 'tenant_advances'] as const
  const results = await Promise.all(tables.map((table) => supabase.from(table).select('*')))
  const failed = results.find((result) => result.error)
  if (failed?.error) throw failed.error
  const [branches, profiles, staff, assignments, permissions, rooms, tenants, payments, cashbook, expenses, inventory, purchases, tickets, invoices, logs, obligations, securityLedger, advances] = results.map((result) => result.data || [])
  const staffById = new Map(staff.map((row) => [row.id, row]))
  return {
    ...empty,
    branches: branches.map((r) => ({ id: r.id, name: r.name, address: r.address, active: r.active, floors: r.floors, notes: r.notes, contact: r.contact })),
    users: profiles.map((r) => { const s = staffById.get(r.id); return { id: r.id, name: r.name, phone: r.phone || '', role: r.role === 'admin' ? 'Admin' : 'Staff', active: r.active, email: s?.email || '', username: s?.username || '', branchIds: assignments.filter((a) => a.user_id === r.id).map((a) => a.branch_id), permissions: permissions.filter((p) => p.user_id === r.id && p.allowed).map((p) => p.permission) } }),
    rooms: rooms.map((r) => ({ id: r.id, branchId: r.branch_id, number: r.number, floor: r.floor, type: r.type, beds: r.beds, rent: num(r.rent), electricity: r.electricity, electricityAmount: num(r.electricity_amount), status: r.status, notes: r.notes })),
    tenants: tenants.map((r) => ({ id: r.id, branchId: r.branch_id, name: r.name, phone: r.phone, email: r.email || '', roomId: r.room_id, bedNo: r.bed_no, monthlyRent: num(r.monthly_rent), security: num(r.security), securityReceived: num(r.security_received), securityBalance: num(r.security_balance ?? num(r.security) - num(r.security_received)), electricity: r.electricity, electricityAmount: num(r.electricity_amount), joiningDate: r.joining_date, dueDate: r.due_date, status: r.status, idProof: r.id_proof || '', paidThisMonth: num(r.paid_this_month), notice: r.notice || undefined, left: r.left_details || undefined, rejoins: r.rejoin_history || [] })),
    payments: payments.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, amount: num(r.amount), date: r.payment_date, month: r.month, status: r.status, invoiceId: r.invoice_id || '', paymentType: normalizePaymentType(r.payment_type), paymentMode: r.payment_mode || 'Cash', description: r.description || '' })),
    cashbook: cashbook.map((r) => ({ id: r.id, branchId: r.branch_id, type: r.type, amount: num(r.amount), description: r.description, date: r.entry_date, source: r.source, linkedId: r.linked_id || undefined, category: r.category, paymentMode: r.payment_mode, reference: r.reference, remarks: r.remarks, createdAt: r.created_at })),
    expenses: expenses.map((r) => ({ id: r.id, branchId: r.branch_id, category: r.category, description: r.description, amount: num(r.amount), date: r.expense_date, vendor: r.vendor || '', cashbookId: r.cashbook_entry_id || undefined, ticketId: r.maintenance_ticket_id || undefined })),
    inventory: inventory.map((r) => ({ id: r.id, branchId: r.branch_id, name: r.name, category: r.category, stock: num(r.stock), unit: r.unit, reorderAt: num(r.reorder_at), lastPurchase: r.last_purchase || '' })),
    purchases: purchases.map((r) => ({ id: r.id, branchId: r.branch_id, itemId: r.item_id, quantity: num(r.quantity), unitCost: num(r.unit_cost), date: r.purchase_date, note: r.note || '', expenseId: r.expense_id || undefined, cashbookId: r.cashbook_entry_id || undefined })),
    tickets: tickets.map((r) => ({ id: r.id, branchId: r.branch_id, title: r.title, status: r.status, roomId: r.room_id, tenantId: r.tenant_id || undefined, category: r.category, priority: r.priority, raisedDate: r.raised_date, assignedTo: r.assigned_to || '', description: r.description || '', resolution: r.resolution || undefined })),
    invoices: invoices.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, number: r.number, period: r.period, createdAt: r.created_at.slice(0, 10) })),
    activityLogs: logs.map((r) => ({ id: r.id, branchId: r.branch_id || '', branchName: r.branch_name, userId: r.user_id, userName: r.user_name, role: r.user_role === 'admin' ? 'Admin' : 'Staff', action: r.action_type, entity: r.module, module: r.module, actionType: r.action_type, description: r.description, metadata: r.metadata, at: r.created_at, oldValue: '', newValue: '' })).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)),
    obligations: obligations.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, period: r.period, paymentType: normalizePaymentType(r.payment_type), agreed: num(r.agreed_amount), received: num(r.received_amount), advanceApplied: num(r.advance_applied), dueDate: r.due_date, status: r.status })),
    securityLedger: securityLedger.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, type: r.movement_type, amount: num(r.amount), date: r.movement_date, reason: r.reason })),
    advances: advances.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, type: r.movement_type, amount: num(r.amount), date: r.movement_date, period: r.period, description: r.description })),
  } as AppData
}

export async function loadActivityLogs(): Promise<AppData['activityLogs']> {
  const { data, error } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false })
  if (error) throw databaseError('select activity_logs', error)
  return (data || []).map((r) => ({ id: r.id, branchId: r.branch_id || '', branchName: r.branch_name, userId: r.user_id, userName: r.user_name, role: r.user_role === 'admin' ? 'Admin' : 'Staff', action: r.action_type, entity: r.module, module: r.module, actionType: r.action_type, description: r.description, metadata: r.metadata, at: r.created_at, oldValue: '', newValue: '' }))
}

const rows = {
  branches: (r: any, userId: string) => ({ id: r.id, name: r.name, address: r.address, floors: r.floors || null, notes: r.notes || null, contact: r.contact || null, active: r.active !== false, created_by: userId, updated_at: new Date().toISOString() }),
  rooms: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, number: r.number, floor: r.floor, type: r.type, beds: r.beds, rent: r.rent, electricity: r.electricity, electricity_amount: r.electricityAmount, status: r.status, notes: r.notes || null, created_by: userId, updated_by: userId }),
  tenants: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, name: r.name, phone: r.phone, email: r.email || null, room_id: r.roomId, bed_no: r.bedNo, monthly_rent: r.monthlyRent, security: r.security, security_received: r.securityReceived || 0, electricity: r.electricity, electricity_amount: r.electricityAmount, joining_date: r.joiningDate, due_date: r.dueDate, status: r.status, id_proof: r.idProof || null, paid_this_month: r.paidThisMonth, notice: r.notice || null, left_details: r.left || null, rejoin_history: r.rejoins || [], created_by: userId, updated_by: userId }),
  payments: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, tenant_id: r.tenantId, amount: r.amount, payment_date: r.date, month: r.month, status: r.status, payment_type: r.paymentType, payment_mode: r.paymentMode || 'Cash', description: r.description || null, invoice_id: r.invoiceId || null, created_by: userId }),
  cashbook: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, type: r.type, amount: r.amount, description: r.description, entry_date: r.date, source: r.source, linked_id: r.linkedId || null, category: r.category || 'Uncategorized', payment_mode: r.paymentMode || 'Cash', reference: r.reference || null, remarks: r.remarks || null, created_at: r.createdAt || new Date().toISOString(), created_by: userId, updated_by: userId }),
  expenses: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, category: r.category, description: r.description, amount: r.amount, expense_date: r.date, vendor: r.vendor || null, cashbook_entry_id: r.cashbookId || null, maintenance_ticket_id: r.ticketId || null, created_by: userId }),
  inventory: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, name: r.name, category: r.category, stock: r.stock, unit: r.unit, reorder_at: r.reorderAt, last_purchase: r.lastPurchase || null, created_by: userId, updated_by: userId }),
  purchases: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, item_id: r.itemId, quantity: r.quantity, unit_cost: r.unitCost, purchase_date: r.date, note: r.note || null, expense_id: r.expenseId || null, cashbook_entry_id: r.cashbookId || null, created_by: userId }),
  tickets: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, title: r.title, status: r.status, room_id: r.roomId, tenant_id: r.tenantId || null, category: r.category, priority: r.priority, raised_date: r.raisedDate, assigned_to: r.assignedTo || null, description: r.description || null, resolution: r.resolution || null, created_by: userId, updated_by: userId }),
  invoices: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, tenant_id: r.tenantId, number: r.number, period: r.period, created_by: userId }),
  activityLogs: (r: any) => ({ id: r.id, branch_id: r.branchId || null, branch_name: r.branchName, user_id: r.userId, user_name: r.userName, user_role: r.role.toLowerCase(), module: r.module, action_type: r.actionType, description: r.description, metadata: r.metadata || {} }),
}

const tableNames: Record<string, string> = { cashbook: 'cashbook_entries', inventory: 'inventory_items', purchases: 'inventory_purchases', tickets: 'maintenance_tickets', activityLogs: 'activity_logs' }

export async function persistAppData(before: AppData, after: AppData, userId: string): Promise<void> {
  const order: Array<keyof typeof rows> = ['branches', 'rooms', 'tenants', 'invoices', 'payments', 'cashbook', 'expenses', 'inventory', 'purchases', 'tickets', 'activityLogs']
  for (const key of order) {
    const oldItems = (before as any)[key] || []
    const newItems = (after as any)[key] || []
    const oldMap = new Map(oldItems.map((item: any) => [item.id, JSON.stringify(rows[key](item, userId))]))
    const changed = newItems.filter((item: any) => oldMap.get(item.id) !== JSON.stringify(rows[key](item, userId)))
    const table = tableNames[key] || key
    if (changed.length) { const { error } = await supabase.from(table).upsert(changed.map((item: any) => rows[key](item, userId))); if (error) throw databaseError(`upsert ${table}`, error) }
  }
  for (const key of [...order].reverse()) {
    const oldItems = (before as any)[key] || []
    const newItems = (after as any)[key] || []
    const removed = oldItems.filter((item: any) => !newItems.some((next: any) => next.id === item.id)).map((item: any) => item.id)
    const table = tableNames[key] || key
    if (removed.length) { const { error } = await supabase.from(table).delete().in('id', removed); if (error) throw databaseError(`delete ${table}`, error) }
  }
}

const normalizePaymentType = (value: unknown): 'Rent' | 'Security Deposit' | 'Electricity' | 'Other' => {
  const type = String(value || 'rent').toLowerCase().replace('_', ' ')
  if (type === 'security' || type === 'security deposit') return 'Security Deposit'
  if (type === 'electricity') return 'Electricity'
  if (type === 'other') return 'Other'
  return 'Rent'
}

const databaseError = (operation: string, error: { message?: string; code?: string; details?: string; hint?: string }) => {
  const detail = [error.message, error.details, error.hint].filter(Boolean).join(' | ')
  const result = new Error(`Supabase ${operation} failed${error.code ? ` [${error.code}]` : ''}: ${detail || 'Unknown database error'}`)
  console.error(result.message, error)
  return result
}

export async function recordSplitPayment(input: { requestId: string; tenantId: string; branchId: string; rentAmount: number; securityAmount: number; electricityAmount: number; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }) {
  const requestStartedAt = new Date(Date.now() - 10_000).toISOString()
  const payload = {
    p_request_id: input.requestId,
    p_tenant_id: input.tenantId,
    p_branch_id: input.branchId,
    p_rent_amount: input.rentAmount,
    p_security_amount: input.securityAmount,
    p_electricity_amount: input.electricityAmount,
    p_other_amount: input.otherAmount,
    p_payment_date: input.paymentDate,
    p_payment_mode: input.paymentMode,
    p_description: input.description || null,
  }
  let response = await supabase.rpc('record_split_payment_v2', payload)
  if (response.error && !response.error.code && /failed to fetch|networkerror/i.test(response.error.message || '')) {
    await new Promise((resolve) => window.setTimeout(resolve, 400))
    response = await supabase.rpc('record_split_payment_v2', payload)
  }
  const { data, error } = response
  if (error) throw databaseError('record_split_payment_v2 RPC', error)
  if (input.rentAmount > 0) await repairFutureRoutedRentPayment(input, requestStartedAt)
  return data
}

async function repairFutureRoutedRentPayment(input: { tenantId: string; branchId: string; rentAmount: number; paymentDate: string; rentPeriod?: string }, requestStartedAt: string) {
  const intendedPeriod = input.rentPeriod || input.paymentDate.slice(0, 7)
  const { data: payments, error: paymentLookupError } = await supabase.from('payments')
    .select('id, month')
    .eq('tenant_id', input.tenantId)
    .eq('branch_id', input.branchId)
    .eq('payment_type', 'rent')
    .eq('payment_date', input.paymentDate)
    .eq('amount', input.rentAmount)
    .gte('created_at', requestStartedAt)
    .order('created_at', { ascending: false })
    .limit(1)
  if (paymentLookupError) throw databaseError('verify rent payment allocation', paymentLookupError)
  const payment = payments?.[0]
  if (!payment) return

  const [{ data: tenant, error: tenantError }, { data: obligations, error: obligationError }, { data: auth }] = await Promise.all([
    supabase.from('tenants').select('monthly_rent, due_date').eq('id', input.tenantId).eq('branch_id', input.branchId).single(),
    supabase.from('payment_obligations').select('*').eq('tenant_id', input.tenantId).eq('payment_type', 'rent').gte('period', intendedPeriod).order('period'),
    supabase.auth.getUser(),
  ])
  if (tenantError) throw databaseError('load tenant for rent allocation', tenantError)
  if (obligationError) throw databaseError('load rent obligations', obligationError)
  const dueDay = new Date(`${tenant.due_date}T00:00:00`).getDate()
  const followingPeriod = (period: string) => { const [year, month] = period.split('-').map(Number); const date = new Date(year, month, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` }
  const dueDateFor = (period: string) => { const [year, month] = period.split('-').map(Number); return `${period}-${String(Math.min(dueDay, new Date(year, month, 0).getDate())).padStart(2, '0')}` }
  const obligationByPeriod = new Map((obligations || []).map((item) => [item.period, { ...item }]))
  const source = obligationByPeriod.get(payment.month)
  if (source) source.received_amount = Math.max(0, Number(source.received_amount || 0) - input.rentAmount)

  const { error: paymentUpdateError } = await supabase.from('payments').update({ month: intendedPeriod }).eq('id', payment.id)
  if (paymentUpdateError) throw databaseError('correct rent payment month', paymentUpdateError)
  const { error: advanceError } = await supabase.from('tenant_advances').delete().eq('payment_id', payment.id)
  if (advanceError) throw databaseError('remove allocated rent from advance ledger', advanceError)

  let remaining = input.rentAmount
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
}

export async function admitTenant(input: { requestId: string; branchId: string; name: string; phone: string; email: string; roomId: string; bedNo: number; joiningDate: string; dueDate: string; monthlyRent: number; security: number; electricity: string; electricityAmount: number; idProof: string }) {
  const { data, error } = await supabase.rpc('admit_tenant_v2', {
    p_request_id: input.requestId, p_branch_id: input.branchId, p_name: input.name,
    p_phone: input.phone, p_email: input.email || '', p_room_id: input.roomId,
    p_bed_no: input.bedNo, p_joining_date: input.joiningDate, p_due_date: input.dueDate,
    p_monthly_rent: input.monthlyRent, p_security: input.security,
    p_electricity: input.electricity, p_electricity_amount: input.electricityAmount,
    p_id_proof: input.idProof || '',
  })
  if (error) throw databaseError('admit_tenant_v2 RPC', error)
  return data as string
}

export async function updateUnsettledTenantRent(tenantId: string, monthlyRent: number) {
  const { data: obligations, error: loadError } = await supabase.from('payment_obligations').select('id, received_amount, advance_applied, agreed_amount').eq('tenant_id', tenantId).eq('payment_type', 'rent')
  if (loadError) throw databaseError('load rent obligations for tenant edit', loadError)
  const unsettled = (obligations || []).filter((item) => Number(item.received_amount || 0) + Number(item.advance_applied || 0) < Number(item.agreed_amount || 0))
  for (const obligation of unsettled) {
    const received = Number(obligation.received_amount || 0)
    const advanceApplied = Number(obligation.advance_applied || 0)
    const { error } = await supabase.from('payment_obligations').update({
      agreed_amount: monthlyRent,
      status: received + advanceApplied >= monthlyRent ? 'Paid' : received + advanceApplied > 0 ? 'Partial' : 'Pending',
    }).eq('id', obligation.id)
    if (error) throw databaseError('update unsettled rent obligation', error)
  }
}

export async function deleteTenantWithPayments(tenantId: string) {
  const { data, error } = await supabase.rpc('delete_tenant_with_payments', { p_tenant_id: tenantId })
  if (error) throw databaseError('delete_tenant_with_payments RPC', error)
  return data as { tenant_id: string; payment_records_deleted: number }
}

export async function deleteCashbookEntryCascade(cashbookId: string) {
  const { data: entry, error: entryError } = await supabase.from('cashbook_entries').select('source, linked_id').eq('id', cashbookId).single()
  if (entryError) throw databaseError('load cashbook entry before delete', entryError)
  let rentTenantId: string | undefined
  if (entry.source === 'Payment' && entry.linked_id) {
    const { data: payment, error: paymentError } = await supabase.from('payments').select('tenant_id, payment_type').eq('id', entry.linked_id).maybeSingle()
    if (paymentError) throw databaseError('load linked payment before delete', paymentError)
    if (payment && String(payment.payment_type).toLowerCase() === 'rent') rentTenantId = payment.tenant_id
  }
  const { data, error } = await supabase.rpc('delete_cashbook_entry_cascade', { p_cashbook_id: cashbookId })
  if (error) throw databaseError('delete_cashbook_entry_cascade RPC', error)
  if (rentTenantId) await rebuildTenantRentObligations(rentTenantId)
  return data as { cashbook_id: string; linked_entity_deleted: string }
}

async function rebuildTenantRentObligations(tenantId: string) {
  const [{ data: tenant, error: tenantError }, { data: payments, error: paymentError }, { data: obligations, error: obligationError }, { data: auth }] = await Promise.all([
    supabase.from('tenants').select('branch_id, name, monthly_rent, joining_date, due_date, branches!inner(name)').eq('id', tenantId).single(),
    supabase.from('payments').select('amount, payment_date, created_at').eq('tenant_id', tenantId).eq('payment_type', 'rent').order('payment_date').order('created_at'),
    supabase.from('payment_obligations').select('*').eq('tenant_id', tenantId).eq('payment_type', 'rent').order('period'),
    supabase.auth.getUser(),
  ])
  if (tenantError) throw databaseError('load tenant while rebuilding rent ledger', tenantError)
  if (paymentError) throw databaseError('load payments while rebuilding rent ledger', paymentError)
  if (obligationError) throw databaseError('load obligations while rebuilding rent ledger', obligationError)
  const tenantBranches = tenant.branches as unknown as { name: string } | Array<{ name: string }> | null
  const branchName = Array.isArray(tenantBranches) ? tenantBranches[0]?.name : tenantBranches?.name
  const isFarukhnagar = branchName === 'PG 95 Farukhnagar'
  const importedPaid = new Set(isFarukhnagar ? importedRentPaidMonths[tenant.name.trim().toUpperCase()] || [] : [])
  const existingByPeriod = new Map((obligations || []).map((item) => [item.period, item]))
  const nextPeriod = (period: string) => { const [year, month] = period.split('-').map(Number); const date = new Date(year, month, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` }
  const dueDay = new Date(`${tenant.due_date}T00:00:00`).getDate()
  const dueDateFor = (period: string) => { const [year, month] = period.split('-').map(Number); return `${period}-${String(Math.min(dueDay, new Date(year, month, 0).getDate())).padStart(2, '0')}` }
  let paymentPool = (payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  let period = tenant.joining_date.slice(0, 7)
  const currentPeriod = new Date().toISOString().slice(0, 7)
  const lastExistingPeriod = (obligations || []).at(-1)?.period || currentPeriod
  const rows = []
  for (let index = 0; index < 240 && (period <= currentPeriod || period <= lastExistingPeriod || paymentPool > 0); index += 1, period = nextPeriod(period)) {
    const existing = existingByPeriod.get(period)
    const agreed = Number(existing?.agreed_amount || tenant.monthly_rent)
    const received = importedPaid.has(period) ? agreed : Math.min(paymentPool, agreed)
    if (!importedPaid.has(period)) paymentPool -= received
    rows.push({
      id: existing?.id || crypto.randomUUID(), branch_id: tenant.branch_id, tenant_id: tenantId, period,
      payment_type: 'rent', agreed_amount: agreed, received_amount: received, advance_applied: 0,
      due_date: existing?.due_date || dueDateFor(period), status: received >= agreed ? 'Paid' : received > 0 ? 'Partial' : 'Pending',
      created_by: existing?.created_by || auth.user?.id,
    })
  }
  const { error: rebuildError } = await supabase.from('payment_obligations').upsert(rows)
  if (rebuildError) throw databaseError('rebuild rent obligations after delete', rebuildError)
  const { error: normalizeError } = await supabase.from('payment_obligations').upsert(rows.map((row) => ({ ...row, advance_applied: 0 })))
  if (normalizeError) throw databaseError('normalize rebuilt rent obligations', normalizeError)
  const currentRentReceived = (payments || []).filter((payment) => payment.payment_date?.slice(0, 7) === currentPeriod).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  await supabase.from('tenants').update({ paid_this_month: currentRentReceived }).eq('id', tenantId)
}

export async function vacateTenantErp(tenantId: string, left: { leftDate: string; reason: string; finalRentBalance: number; electricityBalance: number; maintenanceDeduction: number; securityRefund: number; finalSettlement?: number; extraDays?: number; extraRentCharge?: number; settlementReceived?: number }) {
  const { data, error } = await supabase.rpc('vacate_tenant_erp', { p_tenant_id: tenantId, p_left_date: left.leftDate, p_reason: left.reason, p_final_rent_balance: left.finalRentBalance, p_electricity_balance: left.electricityBalance, p_maintenance_deduction: left.maintenanceDeduction, p_security_refund: left.securityRefund })
  if (error) throw databaseError('vacate_tenant_erp RPC', error)
  const { error: detailsError } = await supabase.from('tenants').update({ left_details: left }).eq('id', tenantId).eq('status', 'Left')
  if (detailsError) throw databaseError('save vacate settlement details', detailsError)
  return data
}

export async function undoVacateTenant(tenantId: string) {
  const [{ data: tenant, error: tenantError }, { data: auth, error: authError }] = await Promise.all([
    supabase.from('tenants').select('*, rooms!inner(id, number, beds, status), branches!inner(name)').eq('id', tenantId).single(),
    supabase.auth.getUser(),
  ])
  if (tenantError) throw databaseError('load vacated tenant', tenantError)
  if (authError || !auth.user) throw authError || new Error('Signed-in user not found')
  if (tenant.status !== 'Left' || !tenant.left_details) throw new Error('Only a vacated tenant can be restored.')
  if (tenant.rooms.status === 'Maintenance') throw new Error(`Room ${tenant.rooms.number} is under maintenance. Make it available before undoing vacate.`)
  const { data: occupants, error: occupantError } = await supabase.from('tenants').select('bed_no').eq('room_id', tenant.room_id).in('status', ['Active', 'Notice'])
  if (occupantError) throw databaseError('check original room capacity', occupantError)
  if ((occupants?.length || 0) >= tenant.rooms.beds) throw new Error(`Room ${tenant.rooms.number} has no vacant bed. Move another tenant or admit this tenant to a different room.`)
  const occupiedBeds = new Set((occupants || []).map((item) => Number(item.bed_no)))
  const bedNo = Array.from({ length: tenant.rooms.beds }, (_, index) => index + 1).find((bed) => !occupiedBeds.has(bed)) || tenant.bed_no
  const leftDate = String(tenant.left_details.leftDate)
  const { data: movements, error: movementError } = await supabase.from('security_ledger').select('id, movement_type, cashbook_entry_id').eq('tenant_id', tenantId).eq('movement_date', leftDate).in('movement_type', ['refunded', 'deducted'])
  if (movementError) throw databaseError('load vacating settlement', movementError)

  const { error: restoreError } = await supabase.from('tenants').update({ status: 'Active', left_details: null, notice: null, bed_no: bedNo, updated_by: auth.user.id }).eq('id', tenantId).eq('status', 'Left')
  if (restoreError) throw databaseError('undo tenant vacate', restoreError)
  const cashbookIds = (movements || []).map((item) => item.cashbook_entry_id).filter(Boolean)
  if (cashbookIds.length) {
    const { error } = await supabase.from('cashbook_entries').delete().in('id', cashbookIds)
    if (error) throw databaseError('reverse security refund cashbook entries', error)
  }
  if (movements?.length) {
    const { error } = await supabase.from('security_ledger').delete().in('id', movements.map((item) => item.id))
    if (error) throw databaseError('reverse vacating security ledger', error)
  }
  await supabase.from('rooms').update({ status: 'Occupied', updated_by: auth.user.id }).eq('id', tenant.room_id)
  const { data: profile } = await supabase.from('profiles').select('name, role').eq('id', auth.user.id).single()
  const { error: logError } = await supabase.from('activity_logs').insert({
    branch_id: tenant.branch_id, branch_name: tenant.branches.name, user_id: auth.user.id,
    user_name: profile?.name || 'Admin', user_role: profile?.role || 'admin', module: 'Tenants', action_type: 'Undo Vacate',
    description: `Admin ${profile?.name || ''} restored ${tenant.name} to Room ${tenant.rooms.number} Bed ${bedNo} and reversed the vacating settlement.`,
    metadata: { tenant_id: tenantId, room_id: tenant.room_id, bed_no: bedNo, original_left_date: leftDate },
  })
  if (logError) throw databaseError('log undo vacate', logError)
}

export async function createStaffAccount(payload: { id?: string; name: string; phone?: string; email?: string; username?: string; password?: string; branchIds: string[]; permissions: string[] }) {
  const { data, error } = await supabase.functions.invoke('create-staff', { body: payload })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export async function deleteBranchCascade(branchId: string, userId?: string, userName?: string, userRole?: string, branchName?: string) {
  const { error } = await supabase.rpc('delete_branch_cascade', {
    p_branch_id: branchId,
    p_user_id: userId || null,
    p_user_name: userName || null,
    p_user_role: userRole || null,
    p_branch_name: branchName || null,
  })
  if (error) throw databaseError('delete_branch_cascade RPC', error)
}

export async function cleanupOldActivityLogs() {
  const { data, error } = await supabase.rpc('cleanup_old_activity_logs')
  if (error) throw databaseError('cleanup_old_activity_logs RPC', error)
  return data as number
}

export async function deactivateStaffAccount(id: string) {
  const { data, error } = await supabase.functions.invoke('create-staff', { body: { id, deactivate: true } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
}
