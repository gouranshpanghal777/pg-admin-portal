from pathlib import Path

account_path = Path('src/lib/tenantAccount.ts')
account = account_path.read_text()
old = """/**
 * Paid means the tenant has cleared every rent period through the current calendar month.
 * This deliberately does not use account.status: status can be Clear/Upcoming while the
 * current month's rent is still unpaid but not due yet.
 */
export function isRentPaidThroughCurrentMonth(account: TenantAccount, month = account.asOfDate.slice(0, 7)) {
  const throughMonth = account.rentLines.filter((line) => line.period <= month)
  return throughMonth.length > 0 && throughMonth.every((line) => line.pending <= 0)
}
"""
new = """/**
 * Paid means this calendar month's rent has actually become due and is fully cleared,
 * with no older rent balance left. A future-due current month must never appear as Paid,
 * even when the outstanding-only server snapshot omits that future obligation.
 */
export function isRentPaidThroughCurrentMonth(account: TenantAccount, month = account.asOfDate.slice(0, 7), asOfDate = account.asOfDate) {
  const throughMonth = account.rentLines.filter((line) => line.period <= month)
  const currentMonthLine = throughMonth.find((line) => line.period === month)
  if (!currentMonthLine || currentMonthLine.dueDate > asOfDate || currentMonthLine.pending > 0) return false
  return throughMonth.filter((line) => line.period < month).every((line) => line.pending <= 0)
}
"""
if account.count(old) != 1:
    raise SystemExit(f'Expected one paid helper block, found {account.count(old)}')
account_path.write_text(account.replace(old, new))

test_path = Path('tests/tenantAccount.test.ts')
tests = test_path.read_text()
old_test = """  it('does not mark a future-due but unpaid current month as Paid', () => {
    const laterDueTenant = { ...tenant, dueDate: '2026-08-20' }
    const account = tenantAccount(laterDueTenant, [], [obligation('2026-08', 6500), { ...obligation('2026-09'), dueDate: '2026-09-20' }], [], '2026-09-15')
    expect(account.pending).toBe(0)
    expect(account.rentLines.find((line) => line.period === '2026-09')?.pending).toBe(6500)
    expect(isRentPaidThroughCurrentMonth(account)).toBe(false)
  })
"""
new_test = """  it('does not mark a future-due current month as Paid even when the server snapshot omits it', () => {
    const laterDueTenant = {
      ...tenant,
      dueDate: '2026-08-20',
      rentSnapshot: { asOfDate: '2026-09-15', lines: [] },
    }
    const account = tenantAccount(laterDueTenant, [], [obligation('2026-08', 6500), { ...obligation('2026-09'), dueDate: '2026-09-20' }], [], '2026-09-15')
    expect(account.pending).toBe(0)
    expect(account.rentLines.find((line) => line.period === '2026-09')?.pending).toBe(0)
    expect(account.rentLines.find((line) => line.period === '2026-09')?.dueDate).toBe('2026-09-20')
    expect(isRentPaidThroughCurrentMonth(account)).toBe(false)
  })

  it('marks a cleared current month Paid on or after its due date', () => {
    const account = tenantAccount(tenant, [], [obligation('2026-08', 6500), obligation('2026-09', 6500)], [], '2026-09-15')
    expect(isRentPaidThroughCurrentMonth(account)).toBe(true)
  })

  it('does not mark current month Paid while an older rent balance remains', () => {
    const account = tenantAccount(tenant, [], [obligation('2026-08', 6400), obligation('2026-09', 6500)], [], '2026-09-16')
    expect(isRentPaidThroughCurrentMonth(account)).toBe(false)
  })
"""
if tests.count(old_test) != 1:
    raise SystemExit(f'Expected one future-due Paid test, found {tests.count(old_test)}')
test_path.write_text(tests.replace(old_test, new_test))
