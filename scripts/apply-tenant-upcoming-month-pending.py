from pathlib import Path

# --- tenantAccount helpers ---
path = Path('src/lib/tenantAccount.ts')
text = path.read_text()
marker = "export function accountReminder(name: string, account: TenantAccount): string {"
if marker not in text:
    raise SystemExit('tenantAccount marker not found')
helpers = '''/** Remaining rent for one period using the underlying agreed/received values.\n * This intentionally reconstructs the amount instead of trusting line.pending because\n * the read-only server snapshot contains outstanding rows only and can omit future-due rent.\n */\nexport function rentLineOutstanding(line: AccountLine) {\n  return Math.max(0, roundMoney(line.agreed - line.received - line.advanceApplied))\n}\n\nexport function currentMonthRentOutstanding(account: TenantAccount, month = account.asOfDate.slice(0, 7)) {\n  const line = account.rentLines.find((item) => item.period === month)\n  return line ? rentLineOutstanding(line) : 0\n}\n\n/** Pending tab is a month-end view: any uncleared current-month rent belongs here,\n * even when its due date is later this month. */\nexport function isRentPendingInCurrentMonth(account: TenantAccount, month = account.asOfDate.slice(0, 7)) {\n  return currentMonthRentOutstanding(account, month) > 0\n}\n\n/** Upcoming Rent starts exactly five days before the current month's due date. */\nexport function isRentUpcomingWithinDays(account: TenantAccount, days = 5, month = account.asOfDate.slice(0, 7), asOfDate = account.asOfDate) {\n  const line = account.rentLines.find((item) => item.period === month)\n  if (!line || rentLineOutstanding(line) <= 0) return false\n  const daysAway = calendarDays(asOfDate, line.dueDate)\n  return daysAway > 0 && daysAway <= days\n}\n\nexport function rentOutstandingThroughCurrentMonth(account: TenantAccount, month = account.asOfDate.slice(0, 7)) {\n  return roundMoney(account.rentLines\n    .filter((line) => line.period <= month)\n    .reduce((sum, line) => sum + rentLineOutstanding(line), 0))\n}\n\n'''
text = text.replace(marker, helpers + marker, 1)
path.write_text(text)

# --- App tenant filters/table ---
path = Path('src/App.tsx')
text = path.read_text()
old_import = "import { accountReminder, isRentPaidThroughCurrentMonth, tenantAccount } from './lib/tenantAccount'"
new_import = "import { accountReminder, isRentPaidThroughCurrentMonth, isRentPendingInCurrentMonth, isRentUpcomingWithinDays, rentOutstandingThroughCurrentMonth, tenantAccount } from './lib/tenantAccount'"
if old_import not in text:
    raise SystemExit('App tenantAccount import not found')
text = text.replace(old_import, new_import, 1)

old_filter = """    const rentState = scoped.rentStates.get(tenant.id)\n    if (filter === 'Paid') return !!rentState && isRentPaidThroughCurrentMonth(rentState)\n    return rentState?.status === filter"""
new_filter = """    const rentState = scoped.rentStates.get(tenant.id)\n    if (filter === 'Paid') return !!rentState && isRentPaidThroughCurrentMonth(rentState)\n    if (filter === 'Upcoming Rent') return !!rentState && isRentUpcomingWithinDays(rentState, 5)\n    if (filter === 'Pending') return !!rentState && isRentPendingInCurrentMonth(rentState)\n    return rentState?.status === filter"""
# Replace only TenantsPage occurrence, not PaymentsPage.
start = text.index('function TenantsPage')
pos = text.find(old_filter, start)
if pos == -1:
    raise SystemExit('TenantsPage filter block not found')
text = text[:pos] + new_filter + text[pos + len(old_filter):]

old_tabs = "<Tabs values={['All', 'Paid', 'Pending', 'Overdue', 'Vacating Notice', 'Vacate Due']} value={filter} onChange={setFilter} />"
new_tabs = "<Tabs values={['All', 'Paid', 'Upcoming Rent', 'Pending', 'Overdue', 'Vacating Notice', 'Vacate Due']} value={filter} onChange={setFilter} />"
if old_tabs not in text:
    raise SystemExit('Tenants tabs not found')
text = text.replace(old_tabs, new_tabs, 1)

old_rows = """            const calculatedRentDueDate = getCalculatedRentDueDate(tenant, scoped.payments, scoped.obligations)\n            const balance = rentState.pending\n            const securityReceived = tenant.securityReceived\n            const securityBalance = Math.max(0, tenant.security - tenant.securityReceived)\n            const status = rentState.status"""
new_rows = """            const currentMonthRentLine = rentState.rentLines.find((line) => line.period === currentMonth)\n            const calculatedRentDueDate = currentMonthRentLine?.dueDate || getCalculatedRentDueDate(tenant, scoped.payments, scoped.obligations)\n            const balance = rentOutstandingThroughCurrentMonth(rentState)\n            const securityReceived = tenant.securityReceived\n            const securityBalance = Math.max(0, tenant.security - tenant.securityReceived)\n            const status = rentState.overdue > 0 ? 'Overdue' : isRentUpcomingWithinDays(rentState, 5) ? 'Upcoming' : isRentPendingInCurrentMonth(rentState) ? 'Pending' : rentState.status"""
pos = text.find(old_rows, start)
if pos == -1:
    raise SystemExit('Tenants row balance/status block not found')
text = text[:pos] + new_rows + text[pos + len(old_rows):]
path.write_text(text)

# --- tests ---
path = Path('tests/tenantAccount.test.ts')
text = path.read_text()
old_test_import = "import { accountReminder, isRentPaidThroughCurrentMonth, tenantAccount } from '../src/lib/tenantAccount'"
new_test_import = "import { accountReminder, currentMonthRentOutstanding, isRentPaidThroughCurrentMonth, isRentPendingInCurrentMonth, isRentUpcomingWithinDays, rentOutstandingThroughCurrentMonth, tenantAccount } from '../src/lib/tenantAccount'"
if old_test_import not in text:
    raise SystemExit('test import not found')
text = text.replace(old_test_import, new_test_import, 1)
append = '''\n\ndescribe('tenant month-end Pending and 5-day Upcoming filters', () => {\n  it('keeps future-due current-month rent in Pending even when the outstanding-only snapshot omits it', () => {\n    const laterDueTenant = {\n      ...tenant,\n      dueDate: '2026-08-20',\n      rentSnapshot: { asOfDate: '2026-09-15', lines: [] },\n    }\n    const account = tenantAccount(laterDueTenant, [], [obligation('2026-08', 6500), { ...obligation('2026-09'), dueDate: '2026-09-20' }], [], '2026-09-15')\n    expect(account.pending).toBe(0)\n    expect(currentMonthRentOutstanding(account)).toBe(6500)\n    expect(rentOutstandingThroughCurrentMonth(account)).toBe(6500)\n    expect(isRentPendingInCurrentMonth(account)).toBe(true)\n  })\n\n  it('shows unpaid rent in Upcoming exactly from 5 days before its due date', () => {\n    const account = tenantAccount({ ...tenant, dueDate: '2026-08-20' }, [], [obligation('2026-08', 6500), { ...obligation('2026-09'), dueDate: '2026-09-20' }], [], '2026-09-15')\n    expect(isRentUpcomingWithinDays(account, 5)).toBe(true)\n  })\n\n  it('does not show rent in Upcoming six days before due, but still keeps it Pending for the month', () => {\n    const account = tenantAccount({ ...tenant, dueDate: '2026-08-21' }, [], [obligation('2026-08', 6500), { ...obligation('2026-09'), dueDate: '2026-09-21' }], [], '2026-09-15')\n    expect(isRentUpcomingWithinDays(account, 5)).toBe(false)\n    expect(isRentPendingInCurrentMonth(account)).toBe(true)\n  })\n\n  it('does not show cleared or fully exempted current-month rent as Pending or Upcoming', () => {\n    const paid = tenantAccount(tenant, [], [obligation('2026-08', 6500), obligation('2026-09', 6500)], [], '2026-09-10')\n    const exempt = tenantAccount(tenant, [], [obligation('2026-08', 6500), { ...obligation('2026-09', 0, 'Rent', 0), discountAmount: 6500 }], [], '2026-09-10')\n    expect(isRentPendingInCurrentMonth(paid)).toBe(false)\n    expect(isRentUpcomingWithinDays(paid, 5)).toBe(false)\n    expect(isRentPendingInCurrentMonth(exempt)).toBe(false)\n    expect(isRentUpcomingWithinDays(exempt, 5)).toBe(false)\n  })\n})\n'''
text = text.rstrip() + append
path.write_text(text)
