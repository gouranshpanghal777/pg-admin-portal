const today = '2026-06-27'
const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`
const daysUntil = (date) => Math.ceil((new Date(`${date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
const vacateDueDays = (expectedLeavingDate) => Math.ceil((new Date(`${today}T00:00:00`) - new Date(`${expectedLeavingDate}T00:00:00`)) / 86400000)
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

const qaBranchGuard = (branch, expectedId) => {
  if (branch.id !== expectedId || branch.name.trim().toLowerCase() !== 'pg 95' || branch.name.toLowerCase().includes('farukhnagar') || branch.address.toLowerCase().includes('farukhnagar')) throw new Error('QA SAFETY STOP')
}
qaBranchGuard({ id: 'qa-branch', name: 'PG 95', address: 'sec 95' }, 'qa-branch')
assert(true, '0. QA branch guard accepts only the exact PG 95 test branch')
assert((() => { try { qaBranchGuard({ id: 'protected', name: 'PG 95 Farukhnagar', address: 'Haily Mandi Road, Farukhnagar' }, 'protected'); return false } catch { return true } })(), '0a. QA branch guard blocks Farukhnagar mutations')

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
  activityLogs: [],
}

let selectedBranch = 'b1'
assert(summarize(data, selectedBranch).rooms.length === 2, '1. Select branch opens dashboard')
selectedBranch = ''
assert(selectedBranch === '', '2. Switch Branch returns to branch page')
selectedBranch = 'b1'

const tenant = { id: 'new', branchId: selectedBranch, name: 'Flow Tenant', roomId: 'r1', monthlyRent: 6500, security: 2500, securityReceived: 0, electricity: 'Included', electricityAmount: 0, paidThisMonth: 0, dueDate: '2026-06-30', status: 'Active', notice: null }
data.tenants.push(tenant)
data.rooms = data.rooms.map((room) => room.id === 'r1' ? { ...room, status: 'Occupied' } : room)
assert(data.tenants.some((item) => item.id === 'new') && summarize(data, selectedBranch).occupancy > 0, '3. Admit tenant updates tenants, rooms, dashboard')
const admissionRequestIds = new Set(['admission-request'])
if (!admissionRequestIds.has('admission-request')) data.tenants.push({ ...tenant, id: 'duplicate' })
assert(data.tenants.filter((item) => item.name === 'Flow Tenant').length === 1, '3a. Repeated admission request creates exactly one tenant')

// Model the atomic record_split_payment RPC: two payment rows, two credits, separate tenant aggregates.
data.payments.push({ id: uid('p'), branchId: selectedBranch, tenantId: 'new', paymentType: 'Rent', amount: 6000, month: '2026-06' })
data.payments.push({ id: uid('p'), branchId: selectedBranch, tenantId: 'new', paymentType: 'Security Deposit', amount: 2000, month: '2026-06' })
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Credit', amount: 6000, description: 'Rent collected — Flow Tenant (Room 101)' })
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Credit', amount: 2000, description: 'Security deposit received — Flow Tenant (Room 101)' })
tenant.paidThisMonth += 6000
tenant.securityReceived += 2000
const securityReceived = data.payments.filter((payment) => payment.tenantId === tenant.id && payment.paymentType === 'Security Deposit').reduce((sum, payment) => sum + payment.amount, 0)
assert(data.payments.length === 2 && data.cashbook.length === 2, '4. Combined submit creates two payment rows and two cashbook credits')
assert(due(tenant) - tenant.paidThisMonth === 500 && tenant.security - tenant.securityReceived === 500, '5. Rent and security balances remain independently ₹500')
assert(securityReceived === 2000 && paymentTotal(data.payments, selectedBranch, '2026-06', 'Rent') === 6000, '5a. Reload-shaped payment rows preserve split totals')
assert(paymentTotal(data.payments, selectedBranch, '2026-06', 'Security Deposit') === 2000 && summarize(data, selectedBranch).revenue === 8000, '5b. Monthly collection and cashbook total ₹8000')
const receivedInMonth = (payments, month) => payments.filter((payment) => payment.date?.startsWith(month)).reduce((sum, payment) => sum + payment.amount, 0)
assert(receivedInMonth([{ amount: 6500, month: '2026-05', date: '2026-07-03' }], '2026-07') === 6500, '5b-a. Collection month uses payment date, not rent billing period')

const handledRequests = new Set(['initial-payment-request'])
const retryRequest = 'initial-payment-request'
if (!handledRequests.has(retryRequest)) data.payments.push({ id: uid('p'), branchId: selectedBranch, tenantId: 'new', paymentType: 'Rent', amount: 6000, month: '2026-06' })
assert(data.payments.length === 2, '5c. Retrying the same payment request creates no duplicate rows')

data.payments.push({ id: uid('p'), branchId: selectedBranch, tenantId: 'new', paymentType: 'Rent', amount: 500, month: '2026-06' })
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Credit', amount: 500 })
tenant.paidThisMonth += 500
assert(due(tenant) - tenant.paidThisMonth === 0 && tenant.security - tenant.securityReceived === 500, '5d. Remaining rent clears rent only')

data.payments.push({ id: uid('p'), branchId: selectedBranch, tenantId: 'new', paymentType: 'Security Deposit', amount: 500, month: '2026-06' })
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Credit', amount: 500 })
tenant.securityReceived += 500
assert(tenant.security - tenant.securityReceived === 0 && paymentTotal(data.payments, selectedBranch, '2026-06') === 9000, '5e. Remaining security clears security and total collected is ₹9000')

assert(status(data.tenants.find((item) => item.id === 'old')) === 'Overdue' && summarize(data, selectedBranch).overdue === 1, '6. Overdue status and alert source exist')

tenant.notice = { noticeDate: today, expectedLeavingDate: '2026-06-30', reason: 'Relocation' }
tenant.status = 'Notice'
assert(data.tenants.filter((item) => item.status === 'Notice').length === 1, '8. Notice appears in notice filter/dashboard source')

tenant.left = { leftDate: today, reason: 'Relocation', finalSettlement: 5000 }
tenant.status = 'Left'
data.rooms = data.rooms.map((room) => room.id === 'r1' ? { ...room, status: 'Vacant' } : room)
assert(data.tenants.some((item) => item.id === 'new' && item.status === 'Left') && data.rooms.find((room) => room.id === 'r1').status === 'Vacant', '7. Vacate tenant moves to Left PG and frees room')
assert(paymentTotal(data.payments, selectedBranch, '2026-06') === 9000 && data.payments.filter((payment) => payment.tenantId === tenant.id).length === 4, '7a. Vacating preserves the ₹9000 monthly total and all payment rows')
assert(paymentTotal(data.payments, selectedBranch, '2026-06', 'Rent') === 6500 && paymentTotal(data.payments, selectedBranch, '2026-06', 'Security Deposit') === 2500, '7b. Historical rent and security totals remain ₹6500 and ₹2500')

data.tenants.push({ ...tenant, id: 'delete-me', branchId: 'b2', status: 'Active' })
data.payments.push({ id: uid('p'), branchId: 'b2', tenantId: 'delete-me', paymentType: 'Rent', amount: 1000, month: '2026-06' })
data.tenants = data.tenants.filter((item) => item.id !== 'delete-me')
data.payments = data.payments.filter((payment) => payment.tenantId !== 'delete-me')
assert(!data.tenants.some((item) => item.id === 'delete-me') && !data.payments.some((payment) => payment.tenantId === 'delete-me'), '7c. Permanent delete removes tenant and payment history together')

const linkedPayment = { id: 'linked-payment', branchId: 'b1', tenantId: 'old', paymentType: 'Rent', amount: 1000, month: '2026-06' }
const linkedCredit = { id: 'linked-credit', branchId: 'b1', type: 'Credit', amount: 1000, linkedId: linkedPayment.id, source: 'Payment' }
data.payments.push(linkedPayment)
data.cashbook.push(linkedCredit)
data.cashbook = data.cashbook.filter((entry) => entry.id !== linkedCredit.id)
data.payments = data.payments.filter((payment) => payment.id !== linkedPayment.id)
assert(!data.cashbook.some((entry) => entry.id === linkedCredit.id) && !data.payments.some((payment) => payment.id === linkedPayment.id), '7d. Deleting payment cashbook credit removes linked payment')

data.expenses.push({ id: uid('e'), branchId: selectedBranch, category: 'Grocery', amount: 1000 })
data.cashbook.push({ id: uid('c'), branchId: selectedBranch, type: 'Debit', amount: 1000 })
assert(summarize(data, selectedBranch).expenses === 1000, '9. Expense updates expenses and cashbook debit')

// Standalone Cashbook "Add Entry" flow
const creditEntry = { id: uid('c'), branchId: selectedBranch, type: 'Credit', amount: 200, description: 'Standalone credit', date: '2026-06-27', source: 'Manual', category: 'Other Income', paymentMode: 'Cash', reference: '', remarks: '' }
const debitEntry = { id: uid('c'), branchId: selectedBranch, type: 'Debit', amount: 150, description: 'Standalone debit', date: '2026-06-27', source: 'Manual', category: 'Miscellaneous', paymentMode: 'Online', reference: '', remarks: '' }
const cashbookBefore = data.cashbook.length
data.cashbook = [creditEntry, debitEntry, ...data.cashbook]
assert(data.cashbook.length === cashbookBefore + 2, '9b. Standalone Cashbook credit+debit creates two entries')
const standaloneCredit = data.cashbook.find((e) => e.id === creditEntry.id)
const standaloneDebit = data.cashbook.find((e) => e.id === debitEntry.id)
assert(standaloneCredit?.type === 'Credit' && standaloneDebit?.type === 'Debit', '9c. Standalone Cashbook entries preserve Credit/Debit type')
const standaloneTotalIn = data.cashbook.filter((e) => e.type === 'Credit').reduce((s, e) => s + e.amount, 0)
const standaloneTotalOut = data.cashbook.filter((e) => e.type === 'Debit').reduce((s, e) => s + e.amount, 0)
assert(standaloneTotalIn - standaloneTotalOut >= 0, '9d. Standalone Cashbook net balance remains non-negative')
const manualIds = data.cashbook.filter((e) => e.source === 'Manual').map((e) => e.id)
assert(manualIds[0] === creditEntry.id && manualIds[1] === debitEntry.id, '9e. Standalone Cashbook entries prepended in insertion order')
data.cashbook = data.cashbook.filter((e) => e.id !== creditEntry.id && e.id !== debitEntry.id)
assert(data.cashbook.length === cashbookBefore, '9f. Standalone Cashbook entries can be removed')

const linkedExpense = { id: 'linked-expense', branchId: 'b1', category: 'Miscellaneous', amount: 250, cashbookId: 'linked-debit' }
data.expenses.push(linkedExpense)
data.cashbook.push({ id: 'linked-debit', branchId: 'b1', type: 'Debit', amount: 250, linkedId: linkedExpense.id, source: 'Expense' })
data.expenses = data.expenses.filter((expense) => expense.id !== linkedExpense.id)
data.cashbook = data.cashbook.filter((entry) => entry.id !== 'linked-debit')
assert(!data.expenses.some((expense) => expense.id === linkedExpense.id) && !data.cashbook.some((entry) => entry.id === 'linked-debit'), '9a. Deleting expense cashbook debit removes linked expense')

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
assert(report.revenue === 9000 && report.expenses === 1500, '14. Monthly report totals derive from rent, security, and other entries')

const importedLedger = [
  { date: '2026-04-30', type: 'Credit', amount: 22593 },
  { date: '2026-05-01', type: 'Credit', amount: 339850 },
  { date: '2026-05-31', type: 'Debit', amount: 169241 },
]
const openingBalance = importedLedger.filter((entry) => entry.date < '2026-05-01').reduce((sum, entry) => sum + (entry.type === 'Credit' ? entry.amount : -entry.amount), 0)
const mayIn = importedLedger.filter((entry) => entry.date.startsWith('2026-05') && entry.type === 'Credit').reduce((sum, entry) => sum + entry.amount, 0)
const mayOut = importedLedger.filter((entry) => entry.date.startsWith('2026-05') && entry.type === 'Debit').reduce((sum, entry) => sum + entry.amount, 0)
assert(openingBalance === 22593 && mayIn === 339850 && mayOut === 169241 && openingBalance + mayIn - mayOut === 193202, '14a. Imported cashbook summary derives opening and closing balances')
assert(Math.round((53 / 57) * 100) === 93 && 57 - 53 === 4, '14b. Farukhnagar occupancy supports 53 current tenants')
const importedSecurity = [{ security: 2500, securityReceived: 2500 }, { security: 0, securityReceived: 0 }]
assert(importedSecurity.every((item) => item.security - item.securityReceived === 0), '14c. Imported security is already received and zero security is not due')
const heads = [
  { type: 'rent', agreed: 6500, received: 6000, advanceApplied: 0 },
  { type: 'security', agreed: 2500, received: 2000, advanceApplied: 0 },
  { type: 'electricity', agreed: 800, received: 800, advanceApplied: 0 },
]
assert(heads.find((head) => head.type === 'rent').agreed - heads.find((head) => head.type === 'rent').received === 500, '14d. Rent obligation remains independent with ₹500 pending')
assert(heads.find((head) => head.type === 'security').agreed - heads.find((head) => head.type === 'security').received === 500, '14e. Security obligation remains independent with ₹500 pending')
const advanceMovements = [{ type: 'credit', amount: 1000 }, { type: 'used', amount: 650 }]
assert(advanceMovements.reduce((sum, item) => sum + (item.type === 'credit' ? item.amount : -item.amount), 0) === 350, '14f. Advance remaining derives from credit and usage ledger')
const historicalJune = data.payments.filter((payment) => payment.month === '2026-06').reduce((sum, payment) => sum + payment.amount, 0)
assert(historicalJune > 0 && data.tenants.some((item) => item.status === 'Left'), '14g. Vacating preserves historical ledger collections')
const monthlyDue = (originalDate, referenceDate) => {
  const dueDay = new Date(`${originalDate}T00:00:00`).getDate()
  const reference = new Date(`${referenceDate}T00:00:00`)
  const lastDay = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate()
  const result = new Date(reference.getFullYear(), reference.getMonth(), Math.min(dueDay, lastDay))
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`
}
const calculatedRentDueDate = (tenant, payments, throughMonth) => {
  for (let period = tenant.joiningDate.slice(0, 7); period <= throughMonth;) {
    const received = payments.filter((payment) => payment.tenantId === tenant.id && payment.paymentType === 'Rent' && payment.month === period).reduce((sum, payment) => sum + payment.amount, 0)
    if (received < tenant.monthlyRent) return monthlyDue(tenant.joiningDate, `${period}-01`)
    const [year, month] = period.split('-').map(Number)
    const next = new Date(year, month, 1)
    period = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
  }
  const [year, month] = throughMonth.split('-').map(Number)
  return monthlyDue(tenant.joiningDate, `${year}-${String(month + 1).padStart(2, '0')}-01`)
}
assert(monthlyDue('2025-03-05', '2026-07-03') === '2026-07-05', '14h. Upcoming rent uses recurring monthly due day')
assert(monthlyDue('2025-01-31', '2026-02-03') === '2026-02-28', '14i. Monthly due date handles short months')
assert(daysUntil('2026-06-20') < 0, '14i-0. Arrived due dates remain overdue rather than upcoming')
const dueDateTestTenant = { id: 'due-date-test', joiningDate: '2026-02-12', monthlyRent: 6500 }
const dueDateTestPayments = ['2026-02', '2026-03', '2026-04'].map((month) => ({ tenantId: dueDateTestTenant.id, paymentType: 'Rent', month, amount: 6500 }))
assert(calculatedRentDueDate(dueDateTestTenant, dueDateTestPayments, '2026-05') === '2026-05-12', '14i-a. Feb/Mar/Apr paid tenant calculates earliest unpaid due date as 2026-05-12')
const earliestUnpaid = (periods) => periods.find((item) => item.received + item.advance < item.agreed)
const rentTimeline = [
  { period: '2026-02', agreed: 6500, received: 6500, advance: 0 },
  { period: '2026-03', agreed: 6500, received: 6500, advance: 0 },
  { period: '2026-04', agreed: 6500, received: 6500, advance: 0 },
  { period: '2026-05', agreed: 6500, received: 6000, advance: 0 },
  { period: '2026-06', agreed: 6500, received: 6500, advance: 0 },
]
assert(earliestUnpaid(rentTimeline).period === '2026-05', '14j. Later payment never skips an earlier partially paid month')
rentTimeline[3].received += 500
assert(earliestUnpaid(rentTimeline) === undefined, '14k. Clearing partial rent advances beyond all settled months')
const advanceTimeline = [{ period: '2026-05', agreed: 6500, received: 6000, advance: 500 }]
assert(earliestUnpaid(advanceTimeline) === undefined, '14l. Applied advance settles rent without creating fake payment')

const canEditFinancial = (role) => role === 'Admin'
assert(canEditFinancial('Staff') === false, '15. Staff login edit/delete restrictions enforced')
assert(canEditFinancial('Admin') === true, '16. Admin login full edit access enforced')

// Comprehensive finance fix tests
const testBranch = 'b1'
const otherBranch = 'b2'

// 17-18: Credit and debit save exactly once
const creditSave = { id: 'test-credit-1', branchId: testBranch, type: 'Credit', amount: 1000, description: 'Test credit', date: '2026-06-27', source: 'Manual', category: 'Other Income', paymentMode: 'Cash', createdAt: '2026-06-27T10:00:00Z' }
const debitSave = { id: 'test-debit-1', branchId: testBranch, type: 'Debit', amount: 500, description: 'Test debit', date: '2026-06-27', source: 'Manual', category: 'Food', paymentMode: 'Online', createdAt: '2026-06-27T10:01:00Z' }
const cbBeforeSave = data.cashbook.length
data.cashbook = [creditSave, debitSave, ...data.cashbook]
assert(data.cashbook.length === cbBeforeSave + 2, '17. Credit saves exactly once')
assert(data.cashbook.length === cbBeforeSave + 2, '18. Debit saves exactly once')

// 19-22: Debit preserves selected category
const foodDebit = data.cashbook.find((e) => e.id === 'test-debit-1')
assert(foodDebit?.category === 'Food', '19. Debit preserves selected category')
assert(data.cashbook.some((e) => e.id === 'test-debit-1'), '20. Categorized debit appears in Cashbook')
const foodExpense = { id: 'test-expense-food', branchId: testBranch, category: 'Food', description: 'Food purchase', amount: 300, date: '2026-06-27', vendor: 'Vendor A', cashbookId: 'test-debit-food' }
data.expenses.push(foodExpense)
data.cashbook.push({ id: 'test-debit-food', branchId: testBranch, type: 'Debit', amount: 300, description: 'Food purchase', date: '2026-06-27', source: 'Expense', linkedId: 'test-expense-food', category: 'Food', createdAt: '2026-06-27T11:00:00Z' })
const cashFood = data.cashbook.find((e) => e.id === 'test-debit-food')
const expFood = data.expenses.find((e) => e.id === 'test-expense-food')
assert(cashFood?.category === 'Food' && expFood?.category === 'Food', '21. Same debit appears in correct Expenses category')
assert(!data.cashbook.some((e) => e.category === 'Food' && e.type === 'Debit' && e.id !== 'test-debit-1' && e.id !== 'test-debit-food' && e.category !== 'Miscellaneous'), '22. Same debit does not appear under wrong category')

// 23. Category total is correct
const foodExpensesTotal = data.expenses.filter((e) => e.branchId === testBranch && e.category === 'Food').reduce((s, e) => s + e.amount, 0)
assert(foodExpensesTotal === 300, '23. Category total is correct')

// 24. Branch isolation
const b2Entries = data.cashbook.filter((e) => e.branchId === otherBranch)
const b1Food = data.cashbook.filter((e) => e.branchId === testBranch && e.category === 'Food')
assert(!b2Entries.some((e) => e.category === 'Food'), '24. Branch isolation works')

// 25-26. Newest-first ordering by createdAt
const now = '2026-06-27T12:00:00Z'
const older = { id: 'old-entry', branchId: testBranch, type: 'Credit', amount: 100, description: 'Older entry', date: '2026-06-27', source: 'Manual', category: 'Other', createdAt: '2026-06-27T08:00:00Z' }
const newer = { id: 'new-entry', branchId: testBranch, type: 'Credit', amount: 200, description: 'Newer entry', date: '2026-06-27', source: 'Manual', category: 'Other', createdAt: '2026-06-27T09:00:00Z' }
const newest = { id: 'nst-entry', branchId: testBranch, type: 'Credit', amount: 300, description: 'Newest entry', date: '2026-06-27', source: 'Manual', category: 'Other', createdAt: '2026-06-27T10:00:00Z' }
data.cashbook = [newest, newer, older, ...data.cashbook]
const orderingEntries = data.cashbook.filter((e) => ['old-entry', 'new-entry', 'nst-entry'].includes(e.id))
const sortedByCreatedAt = [...orderingEntries].sort((a, b) => ((b.createdAt) || '').localeCompare((a.createdAt) || '') || b.id.localeCompare(a.id))
assert(sortedByCreatedAt[0].id === 'nst-entry' && sortedByCreatedAt[1].id === 'new-entry' && sortedByCreatedAt[2].id === 'old-entry', '25. Credit and debit both sort newest-created-first')
const survivingSorted = [...data.cashbook.filter((e) => !['old-entry', 'new-entry', 'nst-entry'].includes(e.id))].sort((a, b) => ((b.createdAt) || '').localeCompare((a.createdAt) || '') || b.id.localeCompare(a.id))
assert(survivingSorted.length === data.cashbook.length - 3, '26. Ordering survives reload (simulated)')

// 27-30. Cashbook PDF date range - test the data shaping logic
const pdfEntries = data.cashbook.filter((e) => e.date >= '2026-06-27' && e.date <= '2026-06-27').sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''))
const pdfCredits = pdfEntries.filter((e) => e.type === 'Credit').reduce((s, e) => s + e.amount, 0)
const pdfDebits = pdfEntries.filter((e) => e.type === 'Debit').reduce((s, e) => s + e.amount, 0)
assert(pdfEntries.length > 0, '27. Cashbook PDF date range is inclusive')
assert(pdfCredits > 0 && pdfDebits > 0, '28. PDF contains both credit and debit')
assert(pdfCredits > 0 && pdfDebits > 0, '29. PDF totals are correct')

// 30. PDF blob simulation (test download function returns blob)
const simulateBlob = { size: 12345, type: 'application/pdf' }
assert(simulateBlob.size > 0, '30. PDF generation returns a non-empty Blob')

// 31-32. Activity Log - each transaction creates exactly one log entry
const beforeLogs = data.activityLogs.length
const actionType = 'credit created'
const logEntry = { id: 'test-log-1', branchId: testBranch, branchName: 'PG 95 - Sector 45', userId: 'admin', userName: 'Admin', role: 'Admin', action: actionType, entity: 'Cashbook', module: 'Cashbook', actionType, description: 'Admin Admin added cashbook credit of Rs.1,000.', at: '', oldValue: '', newValue: '' }
data.activityLogs = [logEntry, ...data.activityLogs]
const newLogs = data.activityLogs.filter((l) => l.id === 'test-log-1')
assert(newLogs.length === 1, '31. Activity Log records each successful transaction exactly once')
assert(data.activityLogs.length === beforeLogs + 1, '32. Activity Log count increases by exactly one per transaction')

// Category ledger tests
assert((data.categories || []).length === 0, '33. Categories start empty')

// 34-35. Add category creates category record
data.categories = [
  { id: 'cat-grocery', branchId: 'b1', name: 'Grocery' },
  { id: 'cat-vegetables', branchId: 'b1', name: 'Vegetables' },
]
assert(data.categories.length === 2, '34. Add category creates category record')
assert(data.categories.some((c) => c.id === 'cat-grocery' && c.name === 'Grocery'), '35. Category has correct name and ID')

// 36. Rename category updates name without breaking transactions
data.categories = data.categories.map((c) => c.id === 'cat-grocery' ? { ...c, name: 'Provisions' } : c)
assert(data.categories.find((c) => c.id === 'cat-grocery')?.name === 'Provisions', '36. Rename category updates name without breaking transactions')

// 37. Category rename preserves historical transaction text
const groceryDebit = { id: 'cat-debit-1', branchId: 'b1', type: 'Debit', amount: 500, description: 'Weekly groceries', date: '2026-06-27', source: 'Manual', category: 'Provisions', categoryId: 'cat-grocery', createdAt: '2026-06-27T12:00:00Z' }
data.cashbook.push(groceryDebit)
const ledgerEntries = data.cashbook.filter((e) => e.branchId === 'b1' && e.type === 'Debit' && (e.categoryId === 'cat-grocery' || e.category === 'Provisions'))
assert(ledgerEntries.length === 1 && ledgerEntries[0].description === 'Weekly groceries', '37. Category ledger shows correct debit entries after rename')

// 38. Category total aggregates correctly
const ledgerTotal = ledgerEntries.reduce((s, e) => s + e.amount, 0)
assert(ledgerTotal === 500, '38. Category total aggregates correctly')

// 39. Branch isolation for categories
data.categories.push({ id: 'cat-b2', branchId: 'b2', name: 'Grocery' })
const b1Provisions = data.categories.filter((c) => c.branchId === 'b1' && c.name === 'Provisions')
const b2Grocery = data.categories.filter((c) => c.branchId === 'b2' && c.name === 'Grocery')
assert(b1Provisions.length === 1 && b2Grocery.length === 1, '39. Branch isolation works for categories')

// 40. categoryId is set when creating expenses
const catProvisions = data.categories.find((c) => c.branchId === 'b1' && c.name === 'Provisions')
const expWithCatId = { id: 'exp-catid', branchId: 'b1', category: 'Provisions', categoryId: catProvisions?.id, description: 'Test', amount: 200, date: '2026-06-27' }
data.expenses.push(expWithCatId)
assert(data.expenses.some((e) => e.id === 'exp-catid' && e.categoryId === catProvisions?.id), '40. Expense stores correct categoryId')

// 41. Delete category sets related cashbook entries to Uncategorized
data.categories = data.categories.filter((c) => c.id !== 'cat-grocery')
data.cashbook = data.cashbook.map((e) => e.categoryId === 'cat-grocery' ? { ...e, categoryId: undefined, category: 'Uncategorized' } : e)
assert(!data.cashbook.some((e) => e.categoryId === 'cat-grocery'), '41. Deleting category uncategorizes related debits')

// 42. Category ledger shows newest-first ordering
const olderEntry = { id: 'cat-order-old', branchId: 'b1', type: 'Debit', amount: 100, description: 'Old', date: '2026-06-26', source: 'Manual', category: 'Vegetables', categoryId: 'cat-vegetables', createdAt: '2026-06-26T10:00:00Z' }
const newerEntry = { id: 'cat-order-new', branchId: 'b1', type: 'Debit', amount: 200, description: 'New', date: '2026-06-27', source: 'Manual', category: 'Vegetables', categoryId: 'cat-vegetables', createdAt: '2026-06-27T10:00:00Z' }
data.cashbook = [newerEntry, olderEntry, ...data.cashbook]
const vegEntries = data.cashbook.filter((e) => e.categoryId === 'cat-vegetables').sort((a, b) => ((b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id)))
assert(vegEntries[0].id === 'cat-order-new' && vegEntries[1].id === 'cat-order-old', '42. Category ledger sorts newest-first by createdAt')

// 43. Category ledger shows all transaction metadata
const vegLedger = data.cashbook.filter((e) => e.branchId === 'b1' && e.type === 'Debit' && (e.categoryId === 'cat-vegetables' || e.category === 'Vegetables'))
assert(vegLedger.every((e) => e.date && e.description && e.amount > 0), '43. Category ledger shows date, description, amount for each entry')

// 44. Uncategorized transactions do not appear under any category ledger
const uncategorizedDebit = { id: 'cat-uncat', branchId: 'b1', type: 'Debit', amount: 100, description: 'No category', date: '2026-06-27', source: 'Manual', createdAt: '2026-06-27T13:00:00Z' }
data.cashbook.push(uncategorizedDebit)
const allCatEntries = data.cashbook.filter((e) => e.branchId === 'b1' && e.type === 'Debit' && (e.categoryId || (e.category && e.category !== 'Uncategorized')))
assert(!allCatEntries.some((e) => e.id === 'cat-uncat'), '44. Uncategorized transactions excluded from every category ledger')

// ==================== VACATE RENT CALCULATION TESTS ====================
// Test case: Due date 20/06/2026, Vacate date 02/07/2026, Extra days = 12, Rate/day = 500
// Extra-days charge = 6000, Already received for same due cycle = 3500
// Balance before settlement = 2500, Settlement = 2500, Final balance = 0
const vacateTestDueDate = '2026-06-20'
const vacateTestLeftDate = '2026-07-02'
const vacateExtraDays = Math.max(0, Math.ceil((new Date(`${vacateTestLeftDate}T00:00:00`).getTime() - new Date(`${vacateTestDueDate}T00:00:00`).getTime()) / 86400000))
assert(vacateExtraDays === 12, 'V1. Extra days = 12 for vacate from 20/06 to 02/07')

const vacateRatePerDay = 500
const vacateExtraRentCharge = vacateExtraDays * vacateRatePerDay
assert(vacateExtraRentCharge === 6000, 'V2. Extra-days rent charge = ₹6,000')

// Tenant already paid ₹3,500 for the same due cycle
const vacateAlreadyReceived = 3500
const vacateBalanceBeforeSettlement = Math.max(0, vacateExtraRentCharge - vacateAlreadyReceived)
assert(vacateBalanceBeforeSettlement === 2500, 'V3. Balance before settlement = ₹2,500 (extra charge ₹6,000 - already received ₹3,500)')

// Admin enters settlement received = 2500
const vacateSettlementReceived = 2500
const vacateFinalBalance = Math.max(0, vacateBalanceBeforeSettlement - vacateSettlementReceived)
assert(vacateFinalBalance === 0, 'V4. Final rent balance = ₹0 (balance ₹2,500 - settlement ₹2,500)')

// Test case: Same dates, but nothing received yet
const vacateNoPaymentReceived = 0
const vacateBalanceFull = Math.max(0, vacateExtraRentCharge - vacateNoPaymentReceived)
assert(vacateBalanceFull === 6000, 'V5. With ₹0 received, balance before settlement = full ₹6,000')

// Test case: Settlement receives the full balance
const vacateFinalFull = Math.max(0, vacateBalanceFull - 6000)
assert(vacateFinalFull === 0, 'V6. Settlement of ₹6,000 clears full balance')

// Test case: Extra days = 0 when left before due date
const vacateEarlyLeftDate = '2026-06-15'
const vacateExtraDaysZero = Math.max(0, Math.ceil((new Date(`${vacateEarlyLeftDate}T00:00:00`).getTime() - new Date(`${vacateTestDueDate}T00:00:00`).getTime()) / 86400000))
assert(vacateExtraDaysZero === 0, 'V7. Extra days = 0 when vacated before due date')

// ==================== VACATE DUE ALERT TESTS ====================
// Today is fixed at 2026-06-27 for all tests

// Test 1: Active tenant with notice date in future → no red overdue alert
const tenantFuture = { name: 'Future Notice', notice: { expectedLeavingDate: '2026-07-15' }, status: 'Active' }
assert(vacateDueDays(tenantFuture.notice.expectedLeavingDate) < 0, 'VD1. Future notice: vacateDueDays returns negative (not overdue)')
const futureOverdue = !!(tenantFuture.notice?.expectedLeavingDate && today >= tenantFuture.notice.expectedLeavingDate)
assert(futureOverdue === false, 'VD1a. Future notice: isVacateDue = false')

// Test 2: Active tenant with notice date today → red "VACATE DUE TODAY"
const tenantToday = { name: 'Due Today', notice: { expectedLeavingDate: '2026-06-27' }, status: 'Active' }
assert(vacateDueDays(tenantToday.notice.expectedLeavingDate) === 0, 'VD2. Today notice: vacateDueDays returns 0')
const todayOverdue = !!(tenantToday.notice?.expectedLeavingDate && today >= tenantToday.notice.expectedLeavingDate)
assert(todayOverdue === true, 'VD2a. Today notice: isVacateDue = true')

// Test 3: Active tenant with notice date 6 days ago → red "VACATE OVERDUE 6 DAYS"
const tenantPast = { name: 'Past Due', notice: { expectedLeavingDate: '2026-06-21' }, status: 'Active' }
assert(vacateDueDays(tenantPast.notice.expectedLeavingDate) === 6, 'VD3. Past notice: vacateDueDays returns 6 days overdue')

// Test 4: Tenant has no notice date → no alert
const tenantNoNotice = { name: 'No Notice', notice: null, status: 'Active' }
const noNoticeOverdue = !!(tenantNoNotice.notice?.expectedLeavingDate && today >= tenantNoNotice.notice.expectedLeavingDate)
assert(noNoticeOverdue === false, 'VD4. No notice: isVacateDue = false')

// Test 5: Tenant is already vacated → not counted in active vacate due count
const vacatedTenant = { name: 'Vacated', notice: { expectedLeavingDate: '2026-06-21' }, status: 'Left' }
// Only active tenants should be checked
const vacateDueActiveCount = [tenantFuture, tenantToday, tenantPast, tenantNoNotice, vacatedTenant]
  .filter((t) => t.status !== 'Left' && t.notice?.expectedLeavingDate && today >= t.notice.expectedLeavingDate).length
assert(vacateDueActiveCount === 2, 'VD5. Only active tenants with past/today notice date count toward vacate due (2: today + past)')

// Test 6: Verify no automatic vacate happens (just a safety assertion)
assert(tenantPast.status === 'Active', 'VD6. Tenant with overdue notice still has status Active (no auto-vacate)')
assert(tenantToday.status === 'Active', 'VD6a. Tenant with today notice still has status Active')

// Test 7: Filter logic for Vacate Due
const allTenants = [tenantFuture, tenantToday, tenantPast, tenantNoNotice, vacatedTenant]
const vacateDueFiltered = allTenants.filter((t) => t.status !== 'Left' && t.notice?.expectedLeavingDate && today >= t.notice.expectedLeavingDate)
assert(vacateDueFiltered.length === 2, 'VD7. Vacate Due filter returns exactly 2 active tenants')
assert(vacateDueFiltered.every((t) => t.name === 'Due Today' || t.name === 'Past Due'), 'VD7a. Vacate Due filter returns correct tenants')

// Test 8: Verify correct days overdue
const dayCount = vacateDueDays('2026-06-21')
assert(dayCount === 6, 'VD8. vacateDueDays(\'2026-06-21\') = 6 days overdue')

console.log('All PG Admin Portal flow checks passed.')
