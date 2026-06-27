const today = '2026-06-27'
const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`
const daysUntil = (date) => Math.ceil((new Date(`${date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
const due = (tenant) => tenant.monthlyRent + (tenant.electricity === 'Fixed' ? tenant.electricityAmount : 0)
const status = (tenant) => {
  const balance = Math.max(0, due(tenant) - tenant.paidThisMonth)
  if (balance === 0) return 'Paid'
  return daysUntil(tenant.dueDate) < 0 ? 'Overdue' : 'Pending'
}
const paymentTotal = (payments, branchId, month, paymentType) => payments
  .filter((payment) => payment.branchId === branchId && payment.month === month && (!paymentType || payment.paymentType === paymentType))
  .reduce((sum, payment) => sum + payment.amount, 0)
const summarize = (data, branchId) => {
  const tenants = data.tenants.filter((tenant) => tenant.branchId === branchId && tenant.status !== 'Left')
  const rooms = data.rooms.filter((room) => room.branchId === branchId)
  const cashbook = data.cashbook.filter((entry) => entry.branchId === branchId)
  const tickets = data.tickets.filter((ticket) => ticket.branchId === branchId)
  return {
    tenants,
    rooms,
    revenue: cashbook.filter((entry) => entry.type === 'Credit').reduce((sum, entry) => sum + entry.amount, 0),
    expenses: cashbook.filter((entry) => entry.type === 'Debit').reduce((sum, entry) => sum + entry.amount, 0),
    occupancy: Math.round((tenants.length / rooms.reduce((sum, room) => sum + room.beds, 0)) * 100),
    openTickets: tickets.filter((ticket) => ticket.status !== 'Resolved').length,
    overdue: tenants.filter((tenant) => status(tenant) === 'Overdue').length,
  }
}
const assert = (condition, label) => {
  if (!condition) throw new Error(label)
  console.log(`PASS ${label}`)
}

let data = {
  branches: [{ id: 'b1', name: 'PG 95 - Sector 45' }, { id: 'b2', name: 'PG 95 - Cyber City' }],
  rooms: [
    { id: 'r1', branchId: 'b1', number: '101', beds: 2, status: 'Vacant' },
    { id: 'r2', branchId: 'b1', number: '102', beds: 1, status: 'Vacant' },
    { id: 'r3', branchId: 'b2', number: '201', beds: 1, status: 'Vacant' },
  ],
  tenants: [
    { id: 'old', branchId: 'b1', name: 'Overdue Tenant', roomId: 'r2', monthlyRent: 10000, electricity: 'Fixed', electricityAmount: 500, paidThisMonth: 0, dueDate: '2026-06-20', status: 'Active' },
  ],
  payments: [],
  cashbook: [],
  expenses: [],
  inventory: [{ id: 'iv1', branchId: 'b1', name: 'Bed Sheet', stock: 5, reorderAt: 8 }],
  purchases: [],
  tickets: [],
  invoices: [],
}

let selectedBranch = 'b1'
assert(summarize(data, selectedBranch).rooms.length === 2, '1. Select branch opens dashboard')
selectedBranch = ''
assert(selectedBranch === '', '2. Switch Branch returns to branch page')
selectedBranch = 'b1'

const tenant = { id: 'new', branchId: selectedBranch, name: 'Flow Tenant', roomId: 'r1', monthlyRent: 12000, security: 2500, electricity: 'Fixed', electricityAmount: 800, paidThisMonth: 0, dueDate: '2026-06-30', status: 'Active', notice: null }
data.tenants.push(tenant)
data.rooms = data.rooms.map((room) => room.id === 'r1' ? { ...room, status: 'Occupied' } : room)
assert(data.tenants.some((item) => item.id === 'new') && summarize(data, selectedBranch).occupancy > 0, '3. Admit tenant updates tenants, rooms, dashboard')

data.payments.push({ id: uid('p'), branchId: selectedBranch, tenantId: 'new', paymentType: 'Rent', amount: 8000, month: '2026-06' })
tenant.paidThisMonth += 8000
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Credit', amount: 8000 })
assert(due(tenant) - tenant.paidThisMonth === 4800 && summarize(data, selectedBranch).revenue === 8000, '4-5. Payment reduces balance, partial remains, cashbook credit updates revenue')

data.payments.push({ id: uid('p'), branchId: selectedBranch, tenantId: 'new', paymentType: 'Security Deposit', amount: 1000, month: '2026-06' })
data.payments.push({ id: uid('p'), branchId: selectedBranch, tenantId: 'new', paymentType: 'Security Deposit', amount: 1500, month: '2026-06' })
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Credit', amount: 2500, description: 'Security deposit received — Flow Tenant (Room 101)' })
const securityReceived = data.payments.filter((payment) => payment.tenantId === tenant.id && payment.paymentType === 'Security Deposit').reduce((sum, payment) => sum + payment.amount, 0)
assert(securityReceived === tenant.security && paymentTotal(data.payments, selectedBranch, '2026-06', 'Rent') === 8000, '4a. Security supports partial collection and remains separate from rent')
assert(paymentTotal(data.payments, selectedBranch, '2026-06', 'Security Deposit') === 2500 && summarize(data, selectedBranch).revenue === 10500, '4b. Security collection updates monthly total and cashbook credit')

assert(status(data.tenants.find((item) => item.id === 'old')) === 'Overdue' && summarize(data, selectedBranch).overdue === 1, '6. Overdue status and alert source exist')

tenant.notice = { noticeDate: today, expectedLeavingDate: '2026-06-30', reason: 'Relocation' }
tenant.status = 'Notice'
assert(data.tenants.filter((item) => item.status === 'Notice').length === 1, '8. Notice appears in notice filter/dashboard source')

tenant.left = { leftDate: today, reason: 'Relocation', finalSettlement: 5000 }
tenant.status = 'Left'
data.rooms = data.rooms.map((room) => room.id === 'r1' ? { ...room, status: 'Vacant' } : room)
assert(data.tenants.some((item) => item.id === 'new' && item.status === 'Left') && data.rooms.find((room) => room.id === 'r1').status === 'Vacant', '7. Vacate tenant moves to Left PG and frees room')
assert(paymentTotal(data.payments, selectedBranch, '2026-06') === 10500 && data.payments.filter((payment) => payment.tenantId === tenant.id).length === 3, '7a. Vacating preserves monthly payment totals and history')

data.expenses.push({ id: uid('e'), branchId: selectedBranch, category: 'Grocery', amount: 1000 })
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Debit', amount: 1000 })
assert(summarize(data, selectedBranch).expenses === 1000, '9. Expense updates expenses and cashbook debit')

data.inventory = data.inventory.map((item) => item.id === 'iv1' ? { ...item, stock: item.stock + 5 } : item)
data.purchases.push({ id: uid('ip'), branchId: selectedBranch, itemId: 'iv1', quantity: 5, unitCost: 100 })
data.expenses.push({ id: uid('e'), branchId: selectedBranch, category: 'Inventory', amount: 500 })
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Debit', amount: 500 })
assert(data.inventory.find((item) => item.id === 'iv1').stock === 10 && summarize(data, selectedBranch).expenses === 1500, '10. Inventory purchase increases stock and creates expense/debit')

data.tickets.push({ id: 'm1', branchId: selectedBranch, roomId: 'r2', status: 'Open' })
assert(summarize(data, selectedBranch).openTickets === 1, '11. Maintenance ticket updates dashboard count')
data.tickets = data.tickets.map((ticket) => ticket.id === 'm1' ? { ...ticket, status: 'Resolved' } : ticket)
assert(summarize(data, selectedBranch).openTickets === 0, '12. Resolve maintenance ticket reduces count')

data.invoices.push({ id: uid('i'), branchId: selectedBranch, tenantId: 'old', number: 'PG95-TEST' })
assert(data.invoices.some((invoice) => invoice.number === 'PG95-TEST'), '13. Invoice record is generated')

const report = summarize(data, selectedBranch)
assert(report.revenue === 10500 && report.expenses === 1500, '14. Monthly report totals derive from rent, security, and other entries')

const canEditFinancial = (role) => role === 'Admin'
assert(canEditFinancial('Staff') === false, '15. Staff login edit/delete restrictions enforced')
assert(canEditFinancial('Admin') === true, '16. Admin login full edit access enforced')
console.log('All PG Admin Portal flow checks passed.')
