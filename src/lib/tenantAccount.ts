import type { AdvanceMovement, Payment, PaymentObligation, Tenant } from '../App'
import { businessDate, calendarDays, dueDateForPeriod, nextPeriod, periodsBetween, roundMoney } from './businessDate'

export type RentRpcLine = {
  tenant_id: string; period: string; due_date: string; agreed: number; received: number;
  advance_applied: number; outstanding: number; source: 'payment_obligations' | 'synthesized';
}
export type RentSnapshot = { asOfDate: string; lines: RentRpcLine[] }
export type AccountLine = {
  period: string; dueDate: string; agreed: number; received: number; advanceApplied: number;
  pending: number; due: boolean; source: 'payment_obligations' | 'synthesized';
}

/** Mirrors the existing read-only RPC reconstruction; never generates or changes DB rows. */
export function tenantAccount(tenant: Tenant, payments: Payment[], obligations: PaymentObligation[] = [], advances: AdvanceMovement[] = [], asOfDate = businessDate()) {
  const month = asOfDate.slice(0, 7)
  const own = <T extends { tenantId: string; branchId: string }>(rows: T[]) => rows.filter((row) => row.tenantId === tenant.id && row.branchId === tenant.branchId)
  const ownPayments = own(payments)
  const ownObligations = own(obligations)
  const ownAdvances = own(advances)
  const rentObligations = ownObligations.filter((row) => row.paymentType === 'Rent')
  const snapshot = tenant.rentSnapshot?.asOfDate === asOfDate ? tenant.rentSnapshot : undefined
  const explicitPeriods = rentObligations.map((row) => row.period)
  // Left tenants retain explicit history; do not manufacture rent during their absence.
  const periods = [...new Set([
    ...(tenant.status !== 'Left' ? periodsBetween(tenant.joiningDate.slice(0, 7), month) : []),
    ...explicitPeriods,
    ...(snapshot?.lines.map((line) => line.period) || []),
  ])].sort()
  const rentLines: AccountLine[] = periods.map((period) => {
    const obligation = rentObligations.find((row) => row.period === period)
    const server = snapshot?.lines.find((line) => line.period === period)
    const recorded = ownPayments.filter((row) => !row.allocationManaged && row.paymentType === 'Rent' && row.month === period).reduce((sum, row) => sum + row.amount, 0)
    const agreed = Number(server?.agreed ?? obligation?.agreed ?? tenant.monthlyRent)
    const received = Number(server?.received ?? Math.max(obligation?.received || 0, recorded))
    // Obligation advance_applied is authoritative. Do not also subtract the advance ledger.
    const advanceApplied = Number(server?.advance_applied ?? obligation?.advanceApplied ?? 0)
    const dueDate = server?.due_date || obligation?.dueDate || dueDateForPeriod(tenant.dueDate || tenant.joiningDate, period)
    const reconstructed = Math.max(0, roundMoney(agreed - received - advanceApplied))
    // The existing RPC returns outstanding rows only. An omitted period within its horizon is clear.
    const pending = snapshot && period <= month && tenant.status !== 'Left' ? Number(server?.outstanding || 0) : reconstructed
    return { period, dueDate, agreed, received, advanceApplied, pending, due: dueDate <= asOfDate, source: server?.source || (obligation ? 'payment_obligations' : 'synthesized') }
  })
  const dueLines = rentLines.filter((line) => line.due && line.pending > 0)
  const first = [...rentLines].filter((line) => line.pending > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.period.localeCompare(b.period))[0]
  const sum = (lines: AccountLine[]) => roundMoney(lines.reduce((value, line) => value + line.pending, 0))
  const pending = sum(dueLines)
  const overdue = sum(dueLines.filter((line) => line.dueDate < asOfDate))
  const period = first?.period || nextPeriod(periods.at(-1) && periods.at(-1)! > month ? periods.at(-1)! : month)
  const dueDate = first?.dueDate || dueDateForPeriod(tenant.dueDate || tenant.joiningDate, period)
  const status: 'Overdue' | 'Pending' | 'Upcoming' | 'Clear' = overdue > 0 ? 'Overdue' : pending > 0 ? 'Pending' : calendarDays(asOfDate, dueDate) >= 0 && calendarDays(asOfDate, dueDate) <= 3 ? 'Upcoming' : 'Clear'
  const explicitHeadDue = (head: PaymentObligation['paymentType']) => roundMoney(ownObligations.filter((row) => row.paymentType === head && (row.dueDate || `${row.period}-01`) <= asOfDate).reduce((sum, row) => {
    const paid = ownPayments.filter((payment) => !payment.allocationManaged && payment.paymentType === head && payment.month === row.period).reduce((total, payment) => total + payment.amount, 0)
    return sum + Math.max(0, row.agreed - Math.max(row.received, paid) - row.advanceApplied)
  }, 0))

  // Fixed electricity is recurring from its effective month. Explicit rows always win:
  // they preserve historical rates, paid/partial receipts, and zero-value exempted months.
  const electricityObligations = ownObligations.filter((row) => row.paymentType === 'Electricity')
  const explicitElectricityPeriods = new Set(electricityObligations.map((row) => row.period))
  const electricityEffectivePeriod = (tenant as Tenant & { electricityEffectivePeriod?: string }).electricityEffectivePeriod || month
  const electricityStartPeriod = [tenant.joiningDate.slice(0, 7), electricityEffectivePeriod].sort().at(-1) || month
  const synthesizedElectricityDue = tenant.status !== 'Left' && tenant.electricity === 'Fixed' && tenant.electricityAmount > 0
    ? roundMoney(periodsBetween(electricityStartPeriod, month).reduce((sum, billingPeriod) => {
        if (explicitElectricityPeriods.has(billingPeriod)) return sum
        const billDueDate = dueDateForPeriod(tenant.dueDate || tenant.joiningDate, billingPeriod)
        return billDueDate <= asOfDate ? sum + tenant.electricityAmount : sum
      }, 0))
    : 0
  // Old explicit electricity balances remain payable even after the current setting becomes Included.
  const electricityDue = roundMoney(explicitHeadDue('Electricity') + synthesizedElectricityDue)

  // WhatsApp should show this month's fixed electricity even before its due date.
  // Explicit current-month rows (including zero-value exemptions) take priority and payments reduce the reminder balance.
  const currentElectricityObligation = electricityObligations.find((row) => row.period === month)
  const currentElectricityNonManagedPaid = roundMoney(ownPayments.filter((payment) => !payment.allocationManaged && payment.paymentType === 'Electricity' && payment.month === month).reduce((total, payment) => total + payment.amount, 0))
  const currentElectricityAllPaid = roundMoney(ownPayments.filter((payment) => payment.paymentType === 'Electricity' && payment.month === month).reduce((total, payment) => total + payment.amount, 0))
  const currentElectricityOutstanding = currentElectricityObligation
    ? Math.max(0, roundMoney(currentElectricityObligation.agreed - Math.max(currentElectricityObligation.received, currentElectricityNonManagedPaid) - currentElectricityObligation.advanceApplied))
    : tenant.status !== 'Left' && tenant.electricity === 'Fixed' && tenant.electricityAmount > 0 && electricityStartPeriod <= month
      ? Math.max(0, roundMoney(tenant.electricityAmount - currentElectricityAllPaid))
      : 0
  const currentElectricityDueDate = currentElectricityObligation?.dueDate || dueDateForPeriod(tenant.dueDate || tenant.joiningDate, month)
  const currentElectricityForReminder = currentElectricityDueDate > asOfDate ? currentElectricityOutstanding : 0

  const otherDue = explicitHeadDue('Other')
  const securityDue = Math.max(0, roundMoney(tenant.security - tenant.securityReceived))
  const credit = Math.max(0, roundMoney(ownAdvances.reduce((sum, row) => sum + (row.type === 'credit' ? row.amount : -row.amount), 0)))
  return {
    asOfDate, rentLines, previousRentDue: sum(dueLines.filter((line) => line.period < month)),
    currentRentDue: sum(dueLines.filter((line) => line.period === month)), pending, overdue,
    expectedTillMonthEnd: sum(rentLines.filter((line) => line.period <= month)),
    period, dueDate, status: status as 'Paid' | 'Overdue' | 'Pending' | 'Upcoming' | 'Clear', periodPending: first?.pending || 0,
    agreed: first?.agreed ?? tenant.monthlyRent, received: first?.received || 0, advanceApplied: first?.advanceApplied || 0,
    paidThroughMonth: rentLines.filter((line) => line.pending === 0 && line.period < period).at(-1)?.period || '-',
    electricityDue, currentElectricityForReminder, securityDue, otherDue, credit,
    totalPayable: roundMoney(pending + electricityDue + securityDue + otherDue),
    electricityNeedsReview: tenant.electricity === 'Fixed' && tenant.electricityAmount <= 0,
    source: snapshot ? 'database' as const : 'reconstructed' as const,
  }
}

export type TenantAccount = ReturnType<typeof tenantAccount>

/**
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

export function accountReminder(name: string, account: TenantAccount): string {
  const currency = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  const reminderElectricityDue = roundMoney(account.electricityDue + account.currentElectricityForReminder)
  const reminderTotalPayable = roundMoney(account.totalPayable + account.currentElectricityForReminder)
  const lines = [
    ["Previous rent balance", account.previousRentDue], ["Current rent due", account.currentRentDue],
    ["Electricity due", reminderElectricityDue], ["Security balance", account.securityDue], ["Other charges", account.otherDue],
  ] as const
  return [`Hello ${name},`, `PG95 payment summary as of ${account.asOfDate}:`,
    ...lines.filter(([, amount]) => amount > 0).map(([label, amount]) => `${label}: ${currency(amount)}`),
    `Total payable: ${currency(reminderTotalPayable)}`,
    ...(account.credit > 0 ? [`Unapplied advance: ${currency(account.credit)} (shown separately; please confirm allocation).`] : []),
    ...(account.electricityNeedsReview ? ['Fixed electricity amount is missing; update the tenant before collecting or carrying electricity forward.'] : []),
    ...(account.pending > 0 ? [`Oldest unpaid rent due: ${account.dueDate}`] : []),
    'Thank you.',
  ].join('\n')
}