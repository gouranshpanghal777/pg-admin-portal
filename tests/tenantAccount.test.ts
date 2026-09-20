import { describe, expect, it } from 'vitest'
import type { Payment, PaymentObligation, Tenant } from '../src/App'
import { accountReminder, tenantAccount } from '../src/lib/tenantAccount'

const tenant: Tenant = { id: 't1', branchId: 'b1', name: 'TEST TENANT', phone: '', email: '', roomId: 'r1', bedNo: 1, monthlyRent: 6500, security: 0, securityReceived: 0, securityBalance: 0, electricity: 'Included', electricityAmount: 350, joiningDate: '2026-08-15', dueDate: '2026-08-15', status: 'Active', idProof: '', paidThisMonth: 0 }
const obligation = (period: string, received = 0, head: PaymentObligation['paymentType'] = 'Rent', agreed = 6500): PaymentObligation => ({ id: period + head, tenantId: 't1', branchId: 'b1', period, paymentType: head, agreed, received, advanceApplied: 0, dueDate: `${period}-15`, status: 'Pending' })
const obligations = [obligation('2026-08', 5900), obligation('2026-09')]

describe('canonical tenant account', () => {
  it('accumulates ₹600 arrears + ₹6500 newly due = ₹7100', () => {
    const account = tenantAccount(tenant, [], obligations, [], '2026-09-15')
    expect(account.pending).toBe(7100); expect(account.periodPending).toBe(600)
    expect(account.previousRentDue).toBe(600); expect(account.currentRentDue).toBe(6500)
    expect(account.overdue).toBe(600)
  })
  it('does not demand future rent', () => expect(tenantAccount(tenant, [], obligations, [], '2026-09-14').pending).toBe(600))
  it('uses explicit fixed electricity only, never double charges Included', () => {
    const billed = [...obligations, obligation('2026-09', 0, 'Electricity', 350)]
    expect(tenantAccount({ ...tenant, electricity: 'Fixed' }, [], billed, [], '2026-09-15').totalPayable).toBe(7450)
    expect(tenantAccount(tenant, [], billed, [], '2026-09-15').totalPayable).toBe(7100)
    expect(tenantAccount({ ...tenant, electricity: 'Fixed' }, [], obligations, [], '2026-09-15').electricityNeedsReview).toBe(true)
  })
  it('never adds payment rows on top of received totals', () => {
    const payment = { tenantId: 't1', branchId: 'b1', paymentType: 'Rent', month: '2026-08', amount: 5900 } as Payment
    expect(tenantAccount(tenant, [payment], obligations, [], '2026-09-15').pending).toBe(7100)
  })
  it('clearing oldest ₹600 leaves ₹6500', () => expect(tenantAccount(tenant, [], [obligation('2026-08', 6500), obligation('2026-09')], [], '2026-09-15').pending).toBe(6500))
  it('allocated ₹7000 leaves ₹100', () => expect(tenantAccount(tenant, [], [obligation('2026-08', 6500), obligation('2026-09', 6400)], [], '2026-09-15').pending).toBe(100))
  it('full payment clears both months', () => expect(tenantAccount(tenant, [], [obligation('2026-08', 6500), obligation('2026-09', 6500)], [], '2026-09-15').pending).toBe(0))
  it('zero-payment admission has debt without fake payments', () => expect(tenantAccount({ ...tenant, joiningDate: '2026-09-15' }, [], [], [], '2026-09-15').pending).toBe(6500))
  it('subtracts an applied advance once, not again from its ledger', () => {
    const account = tenantAccount({ ...tenant, joiningDate: '2026-09-15' }, [], [{ ...obligation('2026-09'), advanceApplied: 500 }], [{ id: 'a1', tenantId: 't1', branchId: 'b1', type: 'used', period: '2026-09', amount: 500, date: '2026-09-15' }], '2026-09-15')
    expect(account.pending).toBe(6000)
  })
  it('explicit historical agreed amount is not replaced by current rent', () => expect(tenantAccount({ ...tenant, monthlyRent: 8500 }, [], obligations, [], '2026-09-15').pending).toBe(7100))
  it('keeps security independent and unapplied credits visible', () => {
    const account = tenantAccount({ ...tenant, security: 2500, securityReceived: 1000 }, [], obligations, [{ id: 'a', tenantId: 't1', branchId: 'b1', type: 'credit', amount: 200, date: '2026-09-15' }], '2026-09-15')
    expect(account.securityDue).toBe(1500); expect(account.credit).toBe(200); expect(account.totalPayable).toBe(8600)
  })
  it('isolates tenant and branch', () => expect(tenantAccount(tenant, [], obligations.map((row) => ({ ...row, branchId: 'other', received: 6500 })), [], '2026-09-15').pending).toBe(13000))
  it('uses the actual server breakdown and its authoritative due dates', () => {
    const account = tenantAccount({ ...tenant, rentSnapshot: { asOfDate: '2026-09-15', lines: [{ tenant_id: 't1', period: '2026-09', due_date: '2026-09-20', agreed: 6500, received: 0, advance_applied: 0, outstanding: 6500, source: 'payment_obligations' }] } }, [], obligations, [], '2026-09-15')
    expect(account.pending).toBe(0); expect(account.expectedTillMonthEnd).toBe(6500)
  })
  it('does not synthesize new rent for a left tenant', () => expect(tenantAccount({ ...tenant, status: 'Left' }, [], [], [], '2026-09-15').pending).toBe(0))
  it('reminder and UI use exactly the same breakup', () => {
    const message = accountReminder(tenant.name, tenantAccount(tenant, [], obligations, [], '2026-09-15'))
    expect(message).toContain('Previous rent balance: ₹600'); expect(message).toContain('Total payable: ₹7,100')
  })
})
