from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, addition: str) -> None:
    p = Path(path)
    text = p.read_text()
    if addition.strip() in text:
        return
    if marker not in text:
        raise SystemExit(f'{path}: marker not found: {marker[:160]!r}')
    p.write_text(text.replace(marker, marker + addition, 1))


# Expose persisted discount metadata for future ledger/report UI without changing calculations.
replace_once(
    'src/App.tsx',
    "export type PaymentObligation = { id: string; branchId: string; tenantId: string; period: string; paymentType: 'Rent' | 'Security Deposit' | 'Electricity' | 'Other'; agreed: number; received: number; advanceApplied: number; dueDate?: string; status: 'Paid' | 'Partial' | 'Pending' | 'Overdue' }",
    "export type PaymentObligation = { id: string; branchId: string; tenantId: string; period: string; paymentType: 'Rent' | 'Security Deposit' | 'Electricity' | 'Other'; agreed: number; received: number; advanceApplied: number; discountAmount?: number; dueDate?: string; status: 'Paid' | 'Partial' | 'Pending' | 'Overdue' }",
)

# Payment modal input/draft.
replace_once(
    'src/App.tsx',
    "type SplitPaymentInput = { requestId: string; tenantId: string; rentAmount: number; securityAmount: number; electricityAmount: number; electricityAction: ElectricityPaymentAction; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }",
    "type SplitPaymentInput = { requestId: string; tenantId: string; rentAmount: number; rentDiscountAmount: number; securityAmount: number; electricityAmount: number; electricityAction: ElectricityPaymentAction; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }",
)
replace_once(
    'src/App.tsx',
    "    paymentDate: businessDate(), rentAmount: 0, securityAmount: 0, electricityAmount: 0, electricityAction: 'auto' as ElectricityPaymentAction, otherAmount: 0,",
    "    paymentDate: businessDate(), rentAmount: 0, rentDiscountAmount: 0, securityAmount: 0, electricityAmount: 0, electricityAction: 'auto' as ElectricityPaymentAction, otherAmount: 0,",
)
replace_once(
    'src/App.tsx',
    "  const electricityAction: ElectricityPaymentAction = draft.value.electricityAction || 'auto'",
    "  const electricityAction: ElectricityPaymentAction = draft.value.electricityAction || 'auto'\n  const rentDiscountAmount = draft.value.rentDiscountAmount || 0",
)
replace_once(
    'src/App.tsx',
    "  const rentBalance = rentState?.pending || 0",
    "  const rentBalance = rentState?.pending || 0\n  const rentPeriodBalance = rentState?.periodPending || 0",
)
replace_once(
    'src/App.tsx',
    "    draft.patch({ tenantId: id, rentAmount: 0, securityAmount: 0, electricityAmount: 0, electricityAction: 'auto', otherAmount: 0 }); setError('')",
    "    draft.patch({ tenantId: id, rentAmount: 0, rentDiscountAmount: 0, securityAmount: 0, electricityAmount: 0, electricityAction: 'auto', otherAmount: 0 }); setError('')",
)
replace_once(
    'src/App.tsx',
    "    const zeroMoneyElectricityAction = electricityAction === 'pending' || electricityAction === 'exempted'\n    if (rentAmount + securityAmount + electricityAmount + otherAmount <= 0 && !zeroMoneyElectricityAction) { setError('Enter at least one payment amount, or choose Pending/Exempted for electricity.'); return }",
    "    const zeroMoneyElectricityAction = electricityAction === 'pending' || electricityAction === 'exempted'\n    const rentDiscountCap = Math.max(0, rentPeriodBalance - Math.min(rentAmount, rentPeriodBalance))\n    if (rentAmount + securityAmount + electricityAmount + otherAmount <= 0 && rentDiscountAmount <= 0 && !zeroMoneyElectricityAction) { setError('Enter a payment amount, a rent discount, or choose Pending/Exempted for electricity.'); return }\n    if (rentDiscountAmount > rentDiscountCap + 0.009) { setError(`Rent discount (${money(rentDiscountAmount)}) exceeds the remaining ${formatMonth(rentState?.period)} rent balance of ${money(rentDiscountCap)} after this rent receipt.`); return }",
)
replace_once(
    'src/App.tsx',
    "      await onSubmit({ requestId, tenantId, rentAmount, securityAmount, electricityAmount, electricityAction, otherAmount, paymentDate, rentPeriod, paymentMode, description: draft.value.description })",
    "      await onSubmit({ requestId, tenantId, rentAmount, rentDiscountAmount, securityAmount, electricityAmount, electricityAction, otherAmount, paymentDate, rentPeriod, paymentMode, description: draft.value.description })",
)

# Insert the period-specific discount directly beside Rent received.
old_rent_field = "<Field label=\"Rent received\"><input className={inputClass} type=\"number\" min=\"0\" step=\"0.01\" inputMode=\"decimal\" value={rentAmount || ''} placeholder=\"0\" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => draft.patch({ rentAmount: Number(event.target.value) })} /></Field><Field label={`Security deposit received${isFirstTimeSecurity ? ' (first-time)' : ''}`}>"
new_rent_field = "<Field label=\"Rent received\"><input className={inputClass} type=\"number\" min=\"0\" step=\"0.01\" inputMode=\"decimal\" value={rentAmount || ''} placeholder=\"0\" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => draft.patch({ rentAmount: Number(event.target.value) })} /></Field><Field label=\"Rent discount / exemption\"><input className={inputClass} type=\"number\" min=\"0\" step=\"0.01\" inputMode=\"decimal\" max={Math.max(0, rentPeriodBalance - Math.min(rentAmount, rentPeriodBalance))} value={rentDiscountAmount || ''} placeholder=\"0\" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => draft.patch({ rentDiscountAmount: Number(event.target.value) })} /></Field><Field label={`Security deposit received${isFirstTimeSecurity ? ' (first-time)' : ''}`}>"
replace_once('src/App.tsx', old_rent_field, new_rent_field)
replace_once(
    'src/App.tsx',
    "</Field></div><p className=\"text-xs text-slate-600\">Fixed electricity is monthly. If you leave Auto with ₹0, the fixed bill stays pending and carries into Total payable. Exempted records a zero-due month. Electricity receipts settle the oldest electricity balance first.</p><div className=\"grid gap-4 sm:grid-cols-2\"><Field label=\"Payment date\">",
    "</Field></div><p className=\"text-xs text-slate-600\"><b>Rent discount / exemption:</b> applies only to {rentState?.period ? formatMonth(rentState.period) : 'the selected rent month'}. It reduces that month’s rent obligation and is never counted as received cash. The next month returns to the normal monthly rent.</p>{rentDiscountAmount > 0 && <p className=\"rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800\">After rent received + discount, selected-period rent remaining: <b>{money(Math.max(0, rentPeriodBalance - Math.min(rentAmount, rentPeriodBalance) - rentDiscountAmount))}</b></p>}<p className=\"text-xs text-slate-600\">Fixed electricity is monthly. If you leave Auto with ₹0, the fixed bill stays pending and carries into Total payable. Exempted records a zero-due month. Electricity receipts settle the oldest electricity balance first.</p><div className=\"grid gap-4 sm:grid-cols-2\"><Field label=\"Payment date\">",
)

# Durable draft keeps the discount through refresh/retry while remaining compatible with old drafts.
replace_once(
    'src/lib/paymentDraft.ts',
    "  rentAmount: number; securityAmount: number; electricityAmount: number; otherAmount: number;",
    "  rentAmount: number; rentDiscountAmount?: number; securityAmount: number; electricityAmount: number; otherAmount: number;",
)
replace_once(
    'src/lib/paymentDraft.ts',
    "    if (![d.rentAmount, d.securityAmount, d.electricityAmount, d.otherAmount].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return",
    "    if (![d.rentAmount, d.securityAmount, d.electricityAmount, d.otherAmount].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return\n    const rentDiscountAmount = d.rentDiscountAmount === undefined ? undefined : d.rentDiscountAmount\n    if (rentDiscountAmount !== undefined && (typeof rentDiscountAmount !== 'number' || !Number.isFinite(rentDiscountAmount) || rentDiscountAmount < 0)) return",
)
replace_once(
    'src/lib/paymentDraft.ts',
    "    return { requestId: d.requestId, tenantId: d.tenantId, paymentMode: d.paymentMode, paymentDate: d.paymentDate, rentAmount: d.rentAmount, securityAmount: d.securityAmount, electricityAmount: d.electricityAmount, otherAmount: d.otherAmount, description: d.description.slice(0, 2000), attempted: d.attempted, rentPeriod: typeof d.rentPeriod === 'string' && /^\\d{4}-\\d{2}$/.test(d.rentPeriod) ? d.rentPeriod : undefined, ...(electricityAction ? { electricityAction } : {}) }",
    "    return { requestId: d.requestId, tenantId: d.tenantId, paymentMode: d.paymentMode, paymentDate: d.paymentDate, rentAmount: d.rentAmount, ...(rentDiscountAmount !== undefined ? { rentDiscountAmount } : {}), securityAmount: d.securityAmount, electricityAmount: d.electricityAmount, otherAmount: d.otherAmount, description: d.description.slice(0, 2000), attempted: d.attempted, rentPeriod: typeof d.rentPeriod === 'string' && /^\\d{4}-\\d{2}$/.test(d.rentPeriod) ? d.rentPeriod : undefined, ...(electricityAction ? { electricityAction } : {}) }",
)

# Database mapping and v5 call. Legacy callers default to zero discount.
replace_once(
    'src/lib/database.ts',
    "obligations: obligations.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, period: r.period, paymentType: normalizePaymentType(r.payment_type), agreed: num(r.agreed_amount), received: num(r.received_amount), advanceApplied: num(r.advance_applied), dueDate: r.due_date, status: r.status })),",
    "obligations: obligations.map((r) => ({ id: r.id, branchId: r.branch_id, tenantId: r.tenant_id, period: r.period, paymentType: normalizePaymentType(r.payment_type), agreed: num(r.agreed_amount), received: num(r.received_amount), advanceApplied: num(r.advance_applied), discountAmount: num(r.discount_amount), dueDate: r.due_date, status: r.status })),",
)
replace_once(
    'src/lib/database.ts',
    "export async function recordSplitPayment(input: { requestId: string; tenantId: string; branchId: string; rentAmount: number; securityAmount: number; electricityAmount: number; electricityAction?: string; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }) {",
    "export async function recordSplitPayment(input: { requestId: string; tenantId: string; branchId: string; rentAmount: number; rentDiscountAmount?: number; securityAmount: number; electricityAmount: number; electricityAction?: string; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }) {",
)
replace_once(
    'src/lib/database.ts',
    "    p_payment_mode: input.paymentMode, p_description: input.description || null,\n    p_electricity_action: input.electricityAction || 'auto',\n  }\n  let response = await supabase.rpc('record_split_payment_v4', payload)",
    "    p_payment_mode: input.paymentMode, p_description: input.description || null,\n    p_electricity_action: input.electricityAction || 'auto',\n    p_rent_discount_amount: input.rentDiscountAmount || 0,\n  }\n  let response = await supabase.rpc('record_split_payment_v5', payload)",
)
replace_once(
    'src/lib/database.ts',
    "    response = await supabase.rpc('record_split_payment_v4', payload)",
    "    response = await supabase.rpc('record_split_payment_v5', payload)",
)
replace_once(
    'src/lib/database.ts',
    "  if (response.error) throw databaseError('record_split_payment_v4 RPC', response.error)",
    "  if (response.error) throw databaseError('record_split_payment_v5 RPC', response.error)",
)

# Focused draft regression tests.
append_once(
    'tests/paymentDraft.test.ts',
    "it('does not restore extra identity or credential fields', () => {\n  const restored = decodePaymentDraft(encodePaymentDraft({ ...draft, password: 'not-allowed', idProof: 'not-allowed' } as PaymentDraft))\n  expect(restored).not.toHaveProperty('password')\n  expect(restored).not.toHaveProperty('idProof')\n})\n",
    "it('preserves a period rent discount and rejects an invalid discount draft', () => {\n  const discounted = { ...draft, rentDiscountAmount: 1000 }\n  expect(decodePaymentDraft(encodePaymentDraft(discounted))?.rentDiscountAmount).toBe(1000)\n  expect(decodePaymentDraft(encodePaymentDraft({ ...draft, rentDiscountAmount: -1 }))).toBeUndefined()\n})\n",
)

print('rent period discount UI/data patch applied')
