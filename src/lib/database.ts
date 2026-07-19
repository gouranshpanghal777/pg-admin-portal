import type { AppData } from '../App'
import { importedRentPaidMonths } from '../data/farukhnagarRentRegister'
import { supabase } from './supabase'

const empty: AppData = { branches: [], users: [], tenants: [], rooms: [], payments: [], cashbook: [], expenses: [], inventory: [], purchases: [], tickets: [], invoices: [], activityLogs: [], obligations: [], securityLedger: [], advances: [], categories: [], ledgerParties: [], ledgerEntries: [] }
const num = (value: unknown) => Number(value || 0)
const ACTIVITY_LOG_LIMIT = 1000

export async function loadAppData(): Promise<AppData> {
  const tables = ['branches', 'profiles', 'staff_members', 'branch_assignments', 'staff_permissions', 'rooms', 'tenants', 'payments', 'cashbook_entries', 'expenses', 'inventory_items', 'inventory_purchases', 'maintenance_tickets', 'invoices', 'activity_logs', 'payment_obligations', 'security_ledger', 'tenant_advances', 'categories', 'ledger_parties', 'ledger_entries'] as const
  const results = await Promise.all(tables.map((table) =>
    table === 'activity_logs'
      ? supabase.from(table).select('*').order('created_at', { ascending: false }).limit(ACTIVITY_LOG_LIMIT)
      : supabase.from(table).select('*')
  ))
  const failed = results.find((result) => result.error)
  if (failed?.error) throw failed.error
  const [branches, profiles, staff, assignments, permissions, rooms, tenants, payments, cashbook, expenses, inventory, purchases, tickets, invoices, logs, obligations, securityLedger, advances, categories, ledgerParties, ledgerEntries] = results.map((result) => result.data || [])
  const staffById = new Map(staff.map((row) => [row.id, row]))
  return {
    ...empty,
    branches: branches.map((r) => ({ id: r.id, name: r.name, address: r.address, active: r.active, floors: r.floors, notes: r.notes, contact: r.contact, maintenanceToken: r.maintenance_token })),
    users: profiles.map((r) => { const s = staffById.get(r.id); return { id: r.id, name: r.name, phone: r.phone || '', role: r.role === 'admin' ? 'Admin' : 'Staff', active: r.active, email: s?.email || '', username: s?.username || '', branchIds: assignments.filter((a) => a.user_id === r.id).map((a) => a.branch_id), permissions: permissions.filter((p) => p.user_id === r.id && p.allowed).map((p) => p.permission) } }),
    rooms: rooms.map((r) => ({ id: r.id, branchId: r.branch_id, number: r.number, floor: r.floor, type: r.type, beds: r.beds, rent: num(r.rent), electricity: r.electricity, electricityAmount: num(r.electricity_amount), status: r.status, notes: r.notes })),
    tenants: tenants.map((r) => ({ id: r.id, branchId: r.branch_id, name: r.name, phone: r.phone, email: r.email || '', roomId: r.room_id, bedNo: r.bed_no, monthlyRent: num(r.monthly_rent), security: num(r.security), securityReceived: num(r.security_received), securityBalance: num(r.security_balance ?? num(r.security) - num(r.security_received)), electricity: r.electricity, electricityAmount: num(r.electricity_amount), joiningDate: r.joining_date, dueDate: r.due_date, status: r.status, idProof: r.id_proof || '', paidThisMonth: num(r.paid_this_month), notice: r.notice || undefined, left: r.left_details || undefined, rejoins: r.rejoin_history || [] })),
    payments: payments.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, amount: num(r.amount), date: r.payment_date, month: r.month, status: r.status, invoiceId: r.invoice_id || '', paymentType: normalizePaymentType(r.payment_type), paymentMode: r.payment_mode || 'Cash', description: r.description || '' })),
    cashbook: cashbook.map((r) => ({ id: r.id, branchId: r.branch_id, type: r.type, amount: num(r.amount), description: r.description, date: r.entry_date, source: r.source, linkedId: r.linked_id || undefined, category: r.category, categoryId: r.category_id || undefined, paymentMode: r.payment_mode, reference: r.reference, remarks: r.remarks, createdAt: r.created_at })),
    expenses: expenses.map((r) => ({ id: r.id, branchId: r.branch_id, category: r.category, categoryId: r.category_id || undefined, description: r.description, amount: num(r.amount), date: r.expense_date, vendor: r.vendor || '', cashbookId: r.cashbook_entry_id || undefined, ticketId: r.maintenance_ticket_id || undefined })),
    inventory: inventory.map((r) => ({ id: r.id, branchId: r.branch_id, name: r.name, category: r.category, stock: num(r.stock), unit: r.unit, reorderAt: num(r.reorder_at), lastPurchase: r.last_purchase || '' })),
    purchases: purchases.map((r) => ({ id: r.id, branchId: r.branch_id, itemId: r.item_id, quantity: num(r.quantity), unitCost: num(r.unit_cost), date: r.purchase_date, note: r.note || '', expenseId: r.expense_id || undefined, cashbookId: r.cashbook_entry_id || undefined })),
    tickets: tickets.map((r) => ({ id: r.id, branchId: r.branch_id, title: r.title, status: r.status, roomId: r.room_id, tenantId: r.tenant_id || undefined, category: r.category, priority: r.priority, raisedDate: r.raised_date, assignedTo: r.assigned_to || '', description: r.description || '', ticketNumber: r.ticket_number || undefined, resolution: r.resolution || undefined })),
    invoices: invoices.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, number: r.number, period: r.period, createdAt: r.created_at.slice(0, 10) })),
    activityLogs: logs.map((r) => ({ id: r.id, branchId: r.branch_id || '', branchName: r.branch_name, userId: r.user_id, userName: r.user_name, role: r.user_role === 'admin' ? 'Admin' : 'Staff', action: r.action_type, entity: r.module, module: r.module, actionType: r.action_type, description: r.description, metadata: r.metadata, at: r.created_at, oldValue: '', newValue: '' })).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)),
    obligations: obligations.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, period: r.period, paymentType: normalizePaymentType(r.payment_type), agreed: num(r.agreed_amount), received: num(r.received_amount), advanceApplied: num(r.advance_applied), dueDate: r.due_date, status: r.status })),
    securityLedger: securityLedger.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, type: r.movement_type, amount: num(r.amount), date: r.movement_date, reason: r.reason })),
    advances: advances.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, type: r.movement_type, amount: num(r.amount), date: r.movement_date, period: r.period, description: r.description })),
    categories: categories.map((r) => ({ id: r.id, branchId: r.branch_id, name: r.name })),
    ledgerParties: ledgerParties.map((r) => ({ id: r.id, branchId: r.branch_id, categoryId: r.category_id || undefined, name: r.name, type: r.party_type, phone: r.phone || '', joiningDate: r.joining_date, monthlyAmount: num(r.monthly_amount), dueDay: num(r.due_day), status: r.status, leftDate: r.left_date || undefined, notes: r.notes || '' })),
    ledgerEntries: ledgerEntries.map((r) => ({ id: r.id, branchId: r.branch_id, partyId: r.party_id, categoryId: r.category_id || undefined, nature: r.nature, amount: num(r.amount), debitAmount: num(r.debit_amount), creditAmount: num(r.credit_amount), date: r.entry_date, period: r.period, description: r.description || '', paymentMode: r.payment_mode || undefined, reference: r.reference || undefined, remarks: r.remarks || undefined, cashbookId: r.cashbook_entry_id || undefined, expenseId: r.expense_id || undefined, createdAt: r.created_at })),
  } as AppData
}

export async function loadActivityLogs(): Promise<AppData['activityLogs']> {
  const { data, error } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(ACTIVITY_LOG_LIMIT)
  if (error) throw databaseError('select activity_logs', error)
  return (data || []).map((r) => ({ id: r.id, branchId: r.branch_id || '', branchName: r.branch_name, userId: r.user_id, userName: r.user_name, role: r.user_role === 'admin' ? 'Admin' : 'Staff', action: r.action_type, entity: r.module, module: r.module, actionType: r.action_type, description: r.description, metadata: r.metadata, at: r.created_at, oldValue: '', newValue: '' }))
}

const rows = {
  branches: (r: any, userId: string) => ({ id: r.id, name: r.name, address: r.address, floors: r.floors || null, notes: r.notes || null, contact: r.contact || null, active: r.active !== false, created_by: userId }),
  rooms: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, number: r.number, floor: r.floor, type: r.type, beds: r.beds, rent: r.rent, electricity: r.electricity, electricity_amount: r.electricityAmount, status: r.status, notes: r.notes || null, created_by: userId, updated_by: userId }),
  tenants: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, name: r.name, phone: r.phone, email: r.email || null, room_id: r.roomId, bed_no: r.bedNo, monthly_rent: r.monthlyRent, security: r.security, security_received: r.securityReceived || 0, electricity: r.electricity, electricity_amount: r.electricityAmount, joining_date: r.joiningDate, due_date: r.dueDate, status: r.status, id_proof: r.idProof || null, paid_this_month: r.paidThisMonth, notice: r.notice || null, left_details: r.left || null, rejoin_history: r.rejoins || [], created_by: userId, updated_by: userId }),
  payments: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, tenant_id: r.tenantId, amount: r.amount, payment_date: r.date, month: r.month, status: r.status, payment_type: r.paymentType, payment_mode: r.paymentMode || 'Cash', description: r.description || null, invoice_id: r.invoiceId || null, created_by: userId }),
  cashbook: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, type: r.type, amount: r.amount, description: r.description, entry_date: r.date, source: r.source, linked_id: r.linkedId || null, category: r.category || 'Uncategorized', category_id: r.categoryId || null, payment_mode: r.paymentMode || 'Cash', reference: r.reference || null, remarks: r.remarks || null, created_at: r.createdAt, created_by: userId, updated_by: userId }),
  expenses: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, category: r.category, category_id: r.categoryId || null, description: r.description, amount: r.amount, expense_date: r.date, vendor: r.vendor || null, cashbook_entry_id: r.cashbookId || null, maintenance_ticket_id: r.ticketId || null, created_by: userId }),
  categories: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, name: r.name, created_by: userId }),
  ledgerParties: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, category_id: r.categoryId || null, name: r.name, party_type: r.type, phone: r.phone || null, joining_date: r.joiningDate, monthly_amount: r.monthlyAmount || 0, due_day: r.dueDay || 1, status: r.status, left_date: r.leftDate || null, notes: r.notes || null, created_by: userId, updated_by: userId }),
  ledgerEntries: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, party_id: r.partyId, category_id: r.categoryId || null, nature: r.nature, amount: r.amount, debit_amount: r.debitAmount || 0, credit_amount: r.creditAmount || 0, entry_date: r.date, period: r.period, description: r.description || null, payment_mode: r.paymentMode || null, reference: r.reference || null, remarks: r.remarks || null, cashbook_entry_id: r.cashbookId || null, expense_id: r.expenseId || null, created_at: r.createdAt, created_by: userId }),
  inventory: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, name: r.name, category: r.category, stock: r.stock, unit: r.unit, reorder_at: r.reorderAt, last_purchase: r.lastPurchase || null, created_by: userId, updated_by: userId }),
  purchases: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, item_id: r.itemId, quantity: r.quantity, unit_cost: r.unitCost, purchase_date: r.date, note: r.note || null, expense_id: r.expenseId || null, cashbook_entry_id: r.cashbookId || null, created_by: userId }),
  tickets: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, title: r.title, status: r.status, room_id: r.roomId, tenant_id: r.tenantId || null, category: r.category, priority: r.priority, raised_date: r.raisedDate, assigned_to: r.assignedTo || null, description: r.description || null, resolution: r.resolution || null, created_by: userId, updated_by: userId }),
  invoices: (r: any, userId: string) => ({ id: r.id, branch_id: r.branchId, tenant_id: r.tenantId, number: r.number, period: r.period, created_by: userId }),
  activityLogs: (r: any) => ({ id: r.id, branch_id: r.branchId || null, branch_name: r.branchName, user_id: r.userId, user_name: r.userName, user_role: r.role.toLowerCase(), module: r.module, action_type: r.actionType, description: r.description, metadata: r.metadata || {} }),
}

const tableNames: Record<string, string> = { cashbook: 'cashbook_entries', inventory: 'inventory_items', purchases: 'inventory_purchases', tickets: 'maintenance_tickets', activityLogs: 'activity_logs', ledgerParties: 'ledger_parties', ledgerEntries: 'ledger_entries' }

const isTransientNetworkError = (error: { message?: string; code?: string }): boolean =>
  !error.code && /failed to fetch|networkerror|aborterror|the operation was aborted/i.test(error.message || '')

async function upsertWithRetry(table: string, rows: Record<string, unknown>[]): Promise<void> {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabase.from(table).upsert(rows)
    if (!error) return
    if (isTransientNetworkError(error) && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
      continue
    }
    throw databaseError(`upsert ${table}`, error)
  }
}

async function deleteWithRetry(table: string, ids: string[]): Promise<void> {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error } = await supabase.from(table).delete().in('id', ids)
    if (!error) return
    if (isTransientNetworkError(error) && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
      continue
    }
    throw databaseError(`delete ${table}`, error)
  }
}

export async function persistAppData(before: AppData, after: AppData, userId: string): Promise<void> {
  const order: Array<keyof typeof rows> = ['branches', 'rooms', 'tenants', 'invoices', 'payments', 'cashbook', 'expenses', 'categories', 'ledgerParties', 'ledgerEntries', 'inventory', 'purchases', 'tickets', 'activityLogs']
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

const AFFECTED_TABLES: Record<string, readonly string[]> = {
  admit: ['tenants', 'payments', 'cashbook_entries', 'activity_logs', 'payment_obligations', 'security_ledger', 'tenant_advances'] as const,
  payment: ['tenants', 'payments', 'cashbook_entries', 'activity_logs', 'payment_obligations', 'security_ledger'] as const,
  edit_tenant: ['tenants', 'rooms', 'activity_logs', 'payment_obligations'] as const,
  vacate: ['tenants', 'rooms', 'cashbook_entries', 'activity_logs', 'payment_obligations', 'security_ledger'] as const,
  delete_tenant: ['tenants', 'payments', 'cashbook_entries', 'activity_logs', 'payment_obligations', 'security_ledger', 'tenant_advances'] as const,
  delete_cashbook: ['cashbook_entries', 'expenses', 'ledger_entries'] as const,
  swap: ['tenants', 'rooms'] as const,
}

export async function refreshTables(tables: readonly string[], currentData: AppData): Promise<AppData> {
  const entries = await Promise.all(
    tables.map(async (table) => {
      const response = table === 'activity_logs'
        ? await supabase.from(table).select('*').order('created_at', { ascending: false }).limit(ACTIVITY_LOG_LIMIT)
        : await supabase.from(table).select('*')
      if (response.error) throw response.error
      return [table, response.data || []] as const
    })
  )
  const byTable = Object.fromEntries(entries)
  const r = (table: string) => byTable[table]
  const next: AppData = { ...currentData }
  if (r('tenants')) next.tenants = r('tenants').map((r: any) => ({ id: r.id, branchId: r.branch_id, name: r.name, phone: r.phone, email: r.email || '', roomId: r.room_id, bedNo: r.bed_no, monthlyRent: num(r.monthly_rent), security: num(r.security), securityReceived: num(r.security_received), securityBalance: num(r.security_balance ?? num(r.security) - num(r.security_received)), electricity: r.electricity, electricityAmount: num(r.electricity_amount), joiningDate: r.joining_date, dueDate: r.due_date, status: r.status, idProof: r.id_proof || '', paidThisMonth: num(r.paid_this_month), notice: r.notice || undefined, left: r.left_details || undefined, rejoins: r.rejoin_history || [] }))
  if (r('rooms')) next.rooms = r('rooms').map((r: any) => ({ id: r.id, branchId: r.branch_id, number: r.number, floor: r.floor, type: r.type, beds: r.beds, rent: num(r.rent), electricity: r.electricity, electricityAmount: num(r.electricity_amount), status: r.status, notes: r.notes }))
  if (r('payments')) next.payments = r('payments').map((r: any) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, amount: num(r.amount), date: r.payment_date, month: r.month, status: r.status, invoiceId: r.invoice_id || '', paymentType: normalizePaymentType(r.payment_type), paymentMode: r.payment_mode || 'Cash', description: r.description || '' }))
  if (r('cashbook_entries')) next.cashbook = r('cashbook_entries').map((r: any) => ({ id: r.id, branchId: r.branch_id, type: r.type, amount: num(r.amount), description: r.description, date: r.entry_date, source: r.source, linkedId: r.linked_id || undefined, category: r.category, categoryId: r.category_id || undefined, paymentMode: r.payment_mode, reference: r.reference, remarks: r.remarks, createdAt: r.created_at }))
  if (r('activity_logs')) next.activityLogs = r('activity_logs').map((r: any) => ({ id: r.id, branchId: r.branch_id || '', branchName: r.branch_name, userId: r.user_id, userName: r.user_name, role: r.user_role === 'admin' ? 'Admin' : 'Staff', action: r.action_type, entity: r.module, module: r.module, actionType: r.action_type, description: r.description, metadata: r.metadata, at: r.created_at, oldValue: '', newValue: '' } as AppData['activityLogs'][number])).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
  if (r('payment_obligations')) next.obligations = r('payment_obligations').map((r: any) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, period: r.period, paymentType: normalizePaymentType(r.payment_type), agreed: num(r.agreed_amount), received: num(r.received_amount), advanceApplied: num(r.advance_applied), dueDate: r.due_date, status: r.status }))
  if (r('security_ledger')) next.securityLedger = r('security_ledger').map((r: any) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, type: r.movement_type, amount: num(r.amount), date: r.movement_date, reason: r.reason }))
  if (r('tenant_advances')) next.advances = r('tenant_advances').map((r: any) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, type: r.movement_type, amount: num(r.amount), date: r.movement_date, period: r.period, description: r.description }))
  if (r('invoices')) next.invoices = r('invoices').map((r: any) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, number: r.number, period: r.period, createdAt: r.created_at.slice(0, 10) }))
  if (r('expenses')) next.expenses = r('expenses').map((r: any) => ({ id: r.id, branchId: r.branch_id, category: r.category, categoryId: r.category_id || undefined, description: r.description, amount: num(r.amount), date: r.expense_date, vendor: r.vendor || '', cashbookId: r.cashbook_entry_id || undefined, ticketId: r.maintenance_ticket_id || undefined }))
  if (r('inventory_items')) next.inventory = r('inventory_items').map((r: any) => ({ id: r.id, branchId: r.branch_id, name: r.name, category: r.category, stock: num(r.stock), unit: r.unit, reorderAt: num(r.reorder_at), lastPurchase: r.last_purchase || '' }))
  if (r('inventory_purchases')) next.purchases = r('inventory_purchases').map((r: any) => ({ id: r.id, branchId: r.branch_id, itemId: r.item_id, quantity: num(r.quantity), unitCost: num(r.unit_cost), date: r.purchase_date, note: r.note || '', expenseId: r.expense_id || undefined, cashbookId: r.cashbook_entry_id || undefined }))
  if (r('maintenance_tickets')) next.tickets = r('maintenance_tickets').map((r: any) => ({ id: r.id, branchId: r.branch_id, title: r.title, status: r.status, roomId: r.room_id, tenantId: r.tenant_id || undefined, category: r.category, priority: r.priority, raisedDate: r.raised_date, assignedTo: r.assigned_to || '', description: r.description || '', ticketNumber: r.ticket_number || undefined, resolution: r.resolution || undefined }))
  if (r('categories')) next.categories = r('categories').map((r: any) => ({ id: r.id, branchId: r.branch_id, name: r.name }))
  if (r('ledger_parties')) next.ledgerParties = r('ledger_parties').map((r: any) => ({ id: r.id, branchId: r.branch_id, categoryId: r.category_id || undefined, name: r.name, type: r.party_type, phone: r.phone || '', joiningDate: r.joining_date, monthlyAmount: num(r.monthly_amount), dueDay: num(r.due_day), status: r.status, leftDate: r.left_date || undefined, notes: r.notes || '' }))
  if (r('ledger_entries')) next.ledgerEntries = r('ledger_entries').map((r: any) => ({ id: r.id, branchId: r.branch_id, partyId: r.party_id, categoryId: r.category_id || undefined, nature: r.nature, amount: num(r.amount), debitAmount: num(r.debit_amount), creditAmount: num(r.credit_amount), date: r.entry_date, period: r.period, description: r.description || '', paymentMode: r.payment_mode || undefined, reference: r.reference || undefined, remarks: r.remarks || undefined, cashbookId: r.cashbook_entry_id || undefined, expenseId: r.expense_id || undefined, createdAt: r.created_at }))
  if (r('branches')) next.branches = r('branches').map((r: any) => ({ id: r.id, name: r.name, address: r.address, active: r.active, floors: r.floors, notes: r.notes, contact: r.contact, maintenanceToken: r.maintenance_token }))
  if (r('profiles') || r('staff_members') || r('branch_assignments') || r('staff_permissions')) {
    const staffList = r('staff_members') || []
    const profileList = r('profiles') || currentData.users.map((u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role === 'Admin' ? 'admin' : 'staff', active: true }))
    const assignmentList = r('branch_assignments') || []
    const permissionList = r('staff_permissions') || []
    const staffById = new Map(staffList.map((row: any) => [row.id, row]))
    next.users = profileList.map((r: any) => { const s = staffById.get(r.id); return { id: r.id, name: r.name, phone: r.phone || '', role: r.role === 'admin' ? 'Admin' : 'Staff', active: r.active, email: s?.email || '', username: s?.username || '', branchIds: assignmentList.filter((a: any) => a.user_id === r.id).map((a: any) => a.branch_id), permissions: permissionList.filter((p: any) => p.user_id === r.id && p.allowed).map((p: any) => p.permission) } })
  }
  return next
}

export function getAffectedTables(operation: 'admit' | 'payment' | 'edit_tenant' | 'vacate' | 'delete_tenant' | 'delete_cashbook' | 'swap'): readonly string[] {
  return AFFECTED_TABLES[operation]
}

const normalizePaymentType = (value: unknown): 'Rent' | 'Security Deposit' | 'Electricity' | 'Other' => {
  const type = String(value || 'rent').toLowerCase().replace('_', ' ')
  if (type === 'security' || type === 'security deposit') return 'Security Deposit'
  if (type === 'electricity') return 'Electricity'
  if (type === 'other') return 'Other'
  return 'Rent'
}

const friendlyDbError = (error: { message?: string; code?: string }): string => {
  const code = error.code || ''
  if (code === '42501') return 'You do not have permission to perform this action.'
  if (code === '23505') return 'This entry already exists.'
  if (code === '23503') return 'This record is referenced by other data and cannot be modified.'
  if (code === '22003') return 'The amount entered is invalid.'
  if (code === 'P0002') return 'The requested record was not found.'
  if (/failed to fetch|load failed|networkerror|aborterror/i.test(error.message || '')) return 'The entry could not be confirmed. Please check your connection and try again.'
  return error.message || 'Unable to save. Please try again.'
}

const databaseError = (operation: string, error: { message?: string; code?: string; details?: string; hint?: string }) => {
  const detail = [error.message, error.details, error.hint].filter(Boolean).join(' | ')
  console.error(`Supabase ${operation} failed${error.code ? ` [${error.code}]` : ''}:`, detail || 'Unknown database error', error)
  return new Error(friendlyDbError(error))
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
  if (response.error && isTransientNetworkError(response.error)) {
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
  if (payment.month === intendedPeriod) {
    const { data: advanceRows, error: advanceLookupError } = await supabase.from('tenant_advances')
      .select('id')
      .eq('payment_id', payment.id)
      .limit(1)
    if (advanceLookupError) throw databaseError('check rent advance allocation', advanceLookupError)
    if (!advanceRows?.length) return
  }

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
}

async function verifyAdmission(requestId: string): Promise<string | null> {
  const { data } = await supabase.from('admission_requests').select('tenant_id').eq('request_id', requestId).maybeSingle()
  return data?.tenant_id || null
}

export async function admitTenant(input: { requestId: string; branchId: string; name: string; phone: string; email: string; roomId: string; bedNo: number; joiningDate: string; dueDate: string; monthlyRent: number; security: number; electricity: string; electricityAmount: number; idProof: string }) {
  const payload = {
    p_request_id: input.requestId, p_branch_id: input.branchId, p_name: input.name,
    p_phone: input.phone, p_email: input.email || '', p_room_id: input.roomId,
    p_bed_no: input.bedNo, p_joining_date: input.joiningDate, p_due_date: input.dueDate,
    p_monthly_rent: input.monthlyRent, p_security: input.security,
    p_electricity: input.electricity, p_electricity_amount: input.electricityAmount,
    p_id_proof: input.idProof || '',
  }
  const maxAttempts = 3
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await supabase.rpc('admit_tenant_v2', payload)
    if (!response.error) return response.data as string
    if (isTransientNetworkError(response.error)) {
      lastError = response.error
      if (attempt < maxAttempts) await new Promise((resolve) => window.setTimeout(resolve, 400 * attempt))
      continue
    }
    throw databaseError('admit_tenant_v2 RPC', response.error)
  }
  const verified = await verifyAdmission(input.requestId)
  if (verified) return verified
  throw databaseError('admit_tenant_v2 RPC', lastError as { message?: string; code?: string })
}

export async function rejoinTenantWithObligation(input: {
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

export async function editTenantWithRentAdjustment(input: {
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
  const { data: ledgerEntry, error: ledgerLookupError } = await supabase.from('ledger_entries').select('id').eq('cashbook_entry_id', cashbookId).maybeSingle()
  if (ledgerLookupError) throw databaseError('load linked account ledger before delete', ledgerLookupError)
  if (ledgerEntry) {
    const { data, error } = await supabase.rpc('delete_ledger_cashbook_entry', { p_cashbook_id: cashbookId })
    if (error) throw databaseError('delete_ledger_cashbook_entry RPC', error)
    return data as { cashbook_id: string; linked_entity_deleted: string }
  }

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
  const currentRentReceived = (payments || []).filter((payment) => payment.payment_date?.slice(0, 7) === currentPeriod).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  await supabase.from('tenants').update({ paid_this_month: currentRentReceived }).eq('id', tenantId)
}

export async function vacateTenantErp(tenantId: string, left: { leftDate: string; reason: string; finalRentBalance: number; electricityBalance: number; maintenanceDeduction: number; securityRefund: number; finalSettlement?: number; extraDays?: number; extraRentCharge?: number; alreadyReceived?: number; balanceBeforeSettlement?: number; settlementReceived?: number }) {
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

export async function createStaffAccount(payload: { id?: string; name: string; phone?: string; email?: string; username?: string; password?: string; branchIds: string[]; permissions: string[]; role?: 'Admin' | 'Staff' }) {
  const { data, error } = await supabase.functions.invoke('create-staff', { body: { ...payload, role: (payload.role || 'Staff').toLowerCase() } })
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

export async function reactivateUserAccount(id: string) {
  const { data, error } = await supabase.functions.invoke('create-staff', { body: { id, reactivate: true } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
}

export async function resetUserPassword(id: string, newPassword: string) {
  const { data, error } = await supabase.functions.invoke('create-staff', { body: { id, resetPassword: newPassword } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
}

export async function swapTenantRooms(
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

export type RentCollectionSummary = {
  expectedTillMonthEnd: number
  pendingTillToday: number
  previousMonthsPending: number
  currentMonthTotalOutstanding: number
  currentMonthDueTillToday: number
  currentMonthNotYetDue: number
  tenantCountWithPending: number
  calculatedAt: string
}

export async function getBranchRentCollectionSummary(branchId: string): Promise<RentCollectionSummary> {
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' })
  const { data, error } = await supabase.rpc('get_branch_rent_collection_summary', {
    p_branch_id: branchId,
    p_as_of_date: todayStr,
  })
  if (error) throw databaseError('get_branch_rent_collection_summary', error)
  const row = data as Record<string, unknown>
  return {
    expectedTillMonthEnd: num(row.expected_till_month_end),
    pendingTillToday: num(row.pending_till_today),
    previousMonthsPending: num(row.previous_months_pending),
    currentMonthTotalOutstanding: num(row.current_month_total_outstanding),
    currentMonthDueTillToday: num(row.current_month_due_till_today),
    currentMonthNotYetDue: num(row.current_month_not_yet_due),
    tenantCountWithPending: num(row.tenant_count_with_pending),
    calculatedAt: String(row.calculated_at || ''),
  }
}
export type LedgerPartyChangeHistory = {
  id: string
  branchId: string
  categoryId: string
  partyId: string
  effectiveDate: string
  oldValue?: Record<string, unknown>
  newValue: Record<string, unknown>
  changedBy?: string
  changedByName?: string
  createdAt: string
}

export async function fetchLedgerPartyChangeHistory(categoryId: string, partyId?: string): Promise<LedgerPartyChangeHistory[]> {
  let query = supabase
    .from('ledger_party_change_history')
    .select('id, branch_id, category_id, party_id, effective_date, old_value, new_value, changed_by, changed_by_name, created_at')
    .eq('category_id', categoryId)
    .order('created_at', { ascending: false })
  if (partyId) query = query.eq('party_id', partyId)
  const { data, error } = await query
  if (error) throw databaseError('load ledger party change history', error)
  return (data || []).map((row) => ({
    id: String(row.id),
    branchId: String(row.branch_id),
    categoryId: String(row.category_id),
    partyId: String(row.party_id),
    effectiveDate: String(row.effective_date),
    oldValue: row.old_value as Record<string, unknown> | undefined,
    newValue: (row.new_value || {}) as Record<string, unknown>,
    changedBy: row.changed_by ? String(row.changed_by) : undefined,
    changedByName: row.changed_by_name ? String(row.changed_by_name) : undefined,
    createdAt: String(row.created_at),
  }))
}

export async function saveCategoryAccountParty(input: {
  partyId?: string
  categoryId: string
  name: string
  type: 'Staff' | 'Vendor' | 'Building Rent' | 'Other'
  phone?: string
  joiningDate: string
  monthlyAmount: number
  dueDay: number
  status: 'Active' | 'Left' | 'Inactive'
  effectiveDate: string
  notes?: string
}): Promise<{ success: boolean; party_id: string }> {
  const { data, error } = await supabase.rpc('save_category_account_party', {
    p_party_id: input.partyId || null,
    p_category_id: input.categoryId,
    p_name: input.name,
    p_party_type: input.type,
    p_phone: input.phone || null,
    p_joining_date: input.joiningDate,
    p_monthly_amount: input.monthlyAmount,
    p_due_day: input.dueDay,
    p_status: input.status,
    p_effective_date: input.effectiveDate,
    p_notes: input.notes || null,
  })
  if (error) throw databaseError('save_category_account_party RPC', error)
  return data as { success: boolean; party_id: string }
}

export async function recordCategoryAccountTransaction(input: {
  requestId: string
  partyId: string
  action: string
  amount: number
  entryDate: string
  period: string
  paymentMode?: string
  description?: string
  reference?: string
  remarks?: string
}): Promise<{ success: boolean; ledger_entry_id: string; cashbook_entry_id?: string; expense_id?: string }> {
  const { data, error } = await supabase.rpc('record_category_account_transaction', {
    p_request_id: input.requestId,
    p_party_id: input.partyId,
    p_action: input.action,
    p_amount: input.amount,
    p_entry_date: input.entryDate,
    p_period: input.period,
    p_payment_mode: input.paymentMode || null,
    p_description: input.description || null,
    p_reference: input.reference || null,
    p_remarks: input.remarks || null,
  })
  if (error) throw databaseError('record_category_account_transaction RPC', error)
  return data as { success: boolean; ledger_entry_id: string; cashbook_entry_id?: string; expense_id?: string }
}
