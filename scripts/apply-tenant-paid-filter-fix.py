from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'src/App.tsx',
    "import { accountReminder, tenantAccount } from './lib/tenantAccount'",
    "import { accountReminder, isRentPaidThroughCurrentMonth, tenantAccount } from './lib/tenantAccount'",
)

replace_once(
    'src/App.tsx',
    "    if (filter === 'Vacating Notice') return tenant.status === 'Notice'\n    if (filter === 'Vacate Due') return !!tenant.notice?.expectedLeavingDate && today >= tenant.notice.expectedLeavingDate\n    return scoped.rentStates.get(tenant.id)?.status === filter",
    "    if (filter === 'Vacating Notice') return tenant.status === 'Notice'\n    if (filter === 'Vacate Due') return !!tenant.notice?.expectedLeavingDate && today >= tenant.notice.expectedLeavingDate\n    const rentState = scoped.rentStates.get(tenant.id)\n    if (filter === 'Paid') return !!rentState && isRentPaidThroughCurrentMonth(rentState)\n    return rentState?.status === filter",
)

replace_once(
    'src/App.tsx',
    "  const tenants = filter === 'Left PG' ? scoped.leftTenants : scoped.activeTenants.filter((tenant) => filter === 'All' || scoped.rentStates.get(tenant.id)?.status === filter)",
    "  const tenants = filter === 'Left PG' ? scoped.leftTenants : scoped.activeTenants.filter((tenant) => {\n    if (filter === 'All') return true\n    const rentState = scoped.rentStates.get(tenant.id)\n    if (filter === 'Paid') return !!rentState && isRentPaidThroughCurrentMonth(rentState)\n    return rentState?.status === filter\n  })",
)

replace_once(
    'src/App.tsx',
    "  const paidTenants = scoped.activeTenants.filter((tenant) => ['Paid', 'Clear'].includes(scoped.rentStates.get(tenant.id)?.status || '')).length",
    "  const paidTenants = scoped.activeTenants.filter((tenant) => { const rentState = scoped.rentStates.get(tenant.id); return !!rentState && isRentPaidThroughCurrentMonth(rentState) }).length",
)

replace_once(
    'src/lib/tenantAccount.ts',
    "export type TenantAccount = ReturnType<typeof tenantAccount>\n\nexport function accountReminder",
    "export type TenantAccount = ReturnType<typeof tenantAccount>\n\n/**\n * Paid means the tenant has cleared every rent period through the current calendar month.\n * This deliberately does not use account.status: status can be Clear/Upcoming while the\n * current month's rent is still unpaid but not due yet.\n */\nexport function isRentPaidThroughCurrentMonth(account: TenantAccount, month = account.asOfDate.slice(0, 7)) {\n  const throughMonth = account.rentLines.filter((line) => line.period <= month)\n  return throughMonth.length > 0 && throughMonth.every((line) => line.pending <= 0)\n}\n\nexport function accountReminder",
)

replace_once(
    'tests/tenantAccount.test.ts',
    "import { accountReminder, tenantAccount } from '../src/lib/tenantAccount'",
    "import { accountReminder, isRentPaidThroughCurrentMonth, tenantAccount } from '../src/lib/tenantAccount'",
)

p = Path('tests/tenantAccount.test.ts')
text = p.read_text()
addition = """

describe('tenant Paid filter classification', () => {
  it('includes a tenant whose rent is cleared through the current month', () => {
    const account = tenantAccount(tenant, [], [obligation('2026-08', 6500), obligation('2026-09', 6500)], [], '2026-09-16')
    expect(account.status).toBe('Clear')
    expect(isRentPaidThroughCurrentMonth(account)).toBe(true)
  })

  it('does not mark a future-due but unpaid current month as Paid', () => {
    const laterDueTenant = { ...tenant, dueDate: '2026-08-20' }
    const account = tenantAccount(laterDueTenant, [], [obligation('2026-08', 6500), { ...obligation('2026-09'), dueDate: '2026-09-20' }], [], '2026-09-15')
    expect(account.pending).toBe(0)
    expect(account.rentLines.find((line) => line.period === '2026-09')?.pending).toBe(6500)
    expect(isRentPaidThroughCurrentMonth(account)).toBe(false)
  })

  it('treats a fully exempted current month as cleared rent', () => {
    const account = tenantAccount(tenant, [], [obligation('2026-08', 6500), { ...obligation('2026-09', 0, 'Rent', 0), discountAmount: 6500 }], [], '2026-09-16')
    expect(isRentPaidThroughCurrentMonth(account)).toBe(true)
  })
})
"""
if "describe('tenant Paid filter classification'" in text:
    raise SystemExit('tests/tenantAccount.test.ts: paid filter tests already present')
p.write_text(text + addition)

print('tenant Paid filter fix applied')
