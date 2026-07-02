import type { AppData } from '../App'
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
    tenants: tenants.map((r) => ({ id: r.id, branchId: r.branch_id, name: r.name, phone: r.phone, email: r.email || '', roomId: r.room_id, bedNo: r.bed_no, monthlyRent: num(r.monthly_rent), security: num(r.security), securityReceived: num(r.security_received), securityBalance: num(r.security_balance ?? num(r.security) - num(r.security_received)), electricity: r.electricity, electricityAmount: num(r.electricity_amount), joiningDate: r.joining_date, dueDate: r.due_date, status: r.status, idProof: r.id_proof || '', paidThisMonth: num(r.paid_this_month), notice: r.notice || undefined, left: r.left_details || undefined })),
    payments: payments.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, amount: num(r.amount), date: r.payment_date, month: r.month, status: r.status, invoiceId: r.invoice_id || '', paymentType: normalizePaymentType(r.payment_type), paymentMode: r.payment_mode || 'Cash', description: r.description || '' })),
    cashbook: cashbook.map((r) => ({ id: r.id, branchId: r.branch_id, type: r.type, amount: num(r.amount), description: r.description, date: r.entry_date, source: r.source, linkedId: r.linked_id || undefined, category: r.category, paymentMode: r.payment_mode, reference: r.reference, remarks: r.remarks })),
    expenses: expenses.map((r) => ({ id: r.id, branchId: r.branch_id, category: r.category, description: r.description, amount: num(r.amount), date: r.expense_date, vendor: r.vendor || '', cashbookId: r.cashbook_entry_id || undefined, ticketId: r.maintenance_ticket_id || undefined })),
    inventory: inventory.map((r) => ({ id: r.id, branchId: r.branch_id, name: r.name, category: r.category, stock: num(r.stock), unit: r.unit, reorderAt: num(r.reorder_at), lastPurchase: r.last_purchase || '' })),
    purchases: purchases.map((r) => ({ id: r.id, branchId: r.branch_id, itemId: r.item_id, quantity: num(r.quantity), unitCost: num(r.unit_cost), date: r.purchase_date, note: r.note || '', expenseId: r.expense_id || undefined, cashbookId: r.cashbook_entry_id || undefined })),
    tickets: tickets.map((r) => ({ id: r.id, branchId: r.branch_id, title: r.title, status: r.status, roomId: r.room_id, tenantId: r.tenant_id || undefined, category: r.category, priority: r.priority, raisedDate: r.raised_date, assignedTo: r.assigned_to || '', description: r.description || '', resolution: r.resolution || undefined })),
    invoices: invoices.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, number: r.number, period: r.period, createdAt: r.created_at.slice(0, 10) })),
    activityLogs: logs.map((r) => ({ id: r.id, branchId: r.branch_id || '', branchName: r.branch_name, userId: r.user_id, userName: r.user_name, role: r.user_role === 'admin' ? 'Admin' : 'Staff', action: r.action_type, entity: r.module, module: r.module, actionType: r.action_type, description: r.description, metadata: r.metadata, at: r.created_at, oldValue: '', newValue: '' })),
    obligations: obligations.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, period: r.period, paymentType: normalizePaymentType(r.payment_type), agreed: num(r.agreed_amount), received: num(r.received_amount), advanceApplied: num(r.advance_applied), dueDate: r.due_date, status: r.status })),
    securityLedger: securityLedger.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, type: r.movement_type, amount: num(r.amount), date: r.movement_date, reason: r.reason })),
    advances: advances.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, type: r.movement_type, amount: num(r.amount), date: r.movement_date, period: r.period, description: r.description })),
  } as AppData
}

const rows = {
  branches: (r: any, userId: string) => ({ id: r.id, name: r.name, address: r.address, floors: r.floors || null, notes: r.notes || null, contact: r.contact || null, active: r.active !== false, created_by: userId, updated_at: new Date().toISOString() }),
  rooms: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, number: r.number, floor: r.floor, type: r.type, beds: r.beds, rent: r.rent, electricity: r.electricity, electricity_amount: r.electricityAmount, status: r.status, notes: r.notes || null, created_by: userId, updated_by: userId }),
  tenants: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, name: r.name, phone: r.phone, email: r.email || null, room_id: r.roomId, bed_no: r.bedNo, monthly_rent: r.monthlyRent, security: r.security, security_received: r.securityReceived || 0, electricity: r.electricity, electricity_amount: r.electricityAmount, joining_date: r.joiningDate, due_date: r.dueDate, status: r.status, id_proof: r.idProof || null, paid_this_month: r.paidThisMonth, notice: r.notice || null, left_details: r.left || null, created_by: userId, updated_by: userId }),
  payments: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, tenant_id: r.tenantId, amount: r.amount, payment_date: r.date, month: r.month, status: r.status, payment_type: r.paymentType, payment_mode: r.paymentMode || 'Cash', description: r.description || null, invoice_id: r.invoiceId || null, created_by: userId }),
  cashbook: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, type: r.type, amount: r.amount, description: r.description, entry_date: r.date, source: r.source, linked_id: r.linkedId || null, category: r.category || 'Uncategorized', payment_mode: r.paymentMode || 'Cash', reference: r.reference || null, remarks: r.remarks || null, created_by: userId, updated_by: userId }),
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
    const oldMap = new Map(oldItems.map((item: any) => [item.id, JSON.stringify(item)]))
    const changed = newItems.filter((item: any) => oldMap.get(item.id) !== JSON.stringify(item))
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

export async function recordSplitPayment(input: { requestId: string; tenantId: string; branchId: string; rentAmount: number; securityAmount: number; electricityAmount: number; otherAmount: number; paymentDate: string; paymentMode: string; description: string }) {
  const { data, error } = await supabase.rpc('record_split_payment_v2', {
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
  })
  if (error) throw databaseError('record_split_payment_v2 RPC', error)
  return data
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

export async function deleteTenantWithPayments(tenantId: string) {
  const { data, error } = await supabase.rpc('delete_tenant_with_payments', { p_tenant_id: tenantId })
  if (error) throw databaseError('delete_tenant_with_payments RPC', error)
  return data as { tenant_id: string; payment_records_deleted: number }
}

export async function deleteCashbookEntryCascade(cashbookId: string) {
  const { data, error } = await supabase.rpc('delete_cashbook_entry_cascade', { p_cashbook_id: cashbookId })
  if (error) throw databaseError('delete_cashbook_entry_cascade RPC', error)
  return data as { cashbook_id: string; linked_entity_deleted: string }
}

export async function vacateTenantErp(tenantId: string, left: { leftDate: string; reason: string; finalRentBalance: number; electricityBalance: number; maintenanceDeduction: number; securityRefund: number }) {
  const { data, error } = await supabase.rpc('vacate_tenant_erp', { p_tenant_id: tenantId, p_left_date: left.leftDate, p_reason: left.reason, p_final_rent_balance: left.finalRentBalance, p_electricity_balance: left.electricityBalance, p_maintenance_deduction: left.maintenanceDeduction, p_security_refund: left.securityRefund })
  if (error) throw databaseError('vacate_tenant_erp RPC', error)
  return data
}

export async function createStaffAccount(payload: { id?: string; name: string; phone?: string; email?: string; username?: string; password?: string; branchIds: string[]; permissions: string[] }) {
  const { data, error } = await supabase.functions.invoke('create-staff', { body: payload })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export async function deactivateStaffAccount(id: string) {
  const { data, error } = await supabase.functions.invoke('create-staff', { body: { id, deactivate: true } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
}
