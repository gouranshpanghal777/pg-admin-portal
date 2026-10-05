from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


# App types/imports.
replace_once(
    'src/App.tsx',
    "import { paymentDraftKey, purgePaymentDrafts } from './lib/paymentDraft'",
    "import { paymentDraftKey, purgePaymentDrafts } from './lib/paymentDraft'\nimport type { ElectricityPaymentAction } from './lib/paymentDraft'",
)
replace_once(
    'src/App.tsx',
    "  electricityAmount: number\n  joiningDate: string",
    "  electricityAmount: number\n  electricityEffectivePeriod?: string\n  joiningDate: string",
)

# Electricity settings are ordinary tenant settings; only the explicit rent-ledger fields stay behind the financial-correction switch.
replace_once(
    'src/App.tsx',
    "    const monthlyRent = Number(form.get('monthlyRent'))\n    if (!Number.isFinite(monthlyRent) || monthlyRent < 0) { setError('Monthly rent must be 0 or more.'); return }\n    const monthlyRentChanged = Math.abs(monthlyRent - tenant.monthlyRent) > 0.009\n    const balanceChanged = Math.abs(rentBalance - rentState.periodPending) > 0.009\n    const dueDateChanged = rentDueDate !== rentState.dueDate\n    const confirmations = [\n      monthlyRentChanged ? `Monthly rent ${money(tenant.monthlyRent)} → ${money(monthlyRent)}. Existing recorded rent periods keep their agreed amounts; new periods use the new rent.` : '',\n      adjustment && balanceChanged ? `${formatMonth(rentState.period)} balance ${money(rentState.periodPending)} → ${money(rentBalance)}.` : '',\n      adjustment && dueDateChanged ? `${formatMonth(rentState.period)} due date ${formatDate(rentState.dueDate)} → ${formatDate(rentDueDate)}.` : '',\n    ].filter(Boolean)",
    "    const monthlyRent = Number(form.get('monthlyRent'))\n    if (!Number.isFinite(monthlyRent) || monthlyRent < 0) { setError('Monthly rent must be 0 or more.'); return }\n    const electricity = String(form.get('electricity')) as Tenant['electricity']\n    const enteredElectricityAmount = Number(form.get('electricityAmount') || 0)\n    const electricityAmount = electricity === 'Included' ? 0 : enteredElectricityAmount\n    if (!Number.isFinite(electricityAmount) || electricityAmount < 0) { setError('Electricity amount must be 0 or more.'); return }\n    if (electricity === 'Fixed' && electricityAmount <= 0) { setError('Enter a positive monthly electricity amount when electricity is Fixed.'); return }\n    const monthlyRentChanged = Math.abs(monthlyRent - tenant.monthlyRent) > 0.009\n    const electricityChanged = electricity !== tenant.electricity || Math.abs(electricityAmount - tenant.electricityAmount) > 0.009\n    const balanceChanged = Math.abs(rentBalance - rentState.periodPending) > 0.009\n    const dueDateChanged = rentDueDate !== rentState.dueDate\n    const confirmations = [\n      monthlyRentChanged ? `Monthly rent ${money(tenant.monthlyRent)} → ${money(monthlyRent)}. Existing recorded rent periods keep their agreed amounts; new periods use the new rent.` : '',\n      electricityChanged ? `Electricity ${tenant.electricity === 'Fixed' ? money(tenant.electricityAmount) + ' fixed' : 'Included'} → ${electricity === 'Fixed' ? money(electricityAmount) + ' fixed per month' : 'Included'}. Existing billed electricity periods are preserved.` : '',\n      adjustment && balanceChanged ? `${formatMonth(rentState.period)} balance ${money(rentState.periodPending)} → ${money(rentBalance)}.` : '',\n      adjustment && dueDateChanged ? `${formatMonth(rentState.period)} due date ${formatDate(rentState.dueDate)} → ${formatDate(rentDueDate)}.` : '',\n    ].filter(Boolean)",
)
replace_once(
    'src/App.tsx',
    "        electricity: adjustment ? String(form.get('electricity')) as Tenant['electricity'] : tenant.electricity,\n        electricityAmount: adjustment ? Number(form.get('electricityAmount')) : tenant.electricityAmount,",
    "        electricity,\n        electricityAmount,",
)
replace_once(
    'src/App.tsx',
    '<Field label="Electricity option"><select name="electricity" disabled={!adjustment} className={inputClass} defaultValue={tenant.electricity}><option>Included</option><option>Fixed</option></select></Field>\n    <Field label="Electricity amount"><input name="electricityAmount" disabled={!adjustment} className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" onWheel={(event) => event.currentTarget.blur()} defaultValue={tenant.electricityAmount} /></Field>',
    '<Field label="Electricity option"><select name="electricity" className={inputClass} defaultValue={tenant.electricity}><option>Included</option><option>Fixed</option></select></Field>\n    <Field label="Fixed electricity / month"><input name="electricityAmount" className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" onWheel={(event) => event.currentTarget.blur()} defaultValue={tenant.electricityAmount} /></Field>',
)
replace_once(
    'src/App.tsx',
    'Profile edits preserve joining date, recurring billing day and room history. Monthly rent can be changed here: existing recorded rent periods keep their agreed amount, while new rent periods use the updated monthly rent. Use Move Room for a room change.',
    'Profile edits preserve joining date, recurring billing day and room history. Monthly rent and electricity settings can be changed here. Existing recorded rent/electricity periods keep their agreed amounts; new periods use the updated settings. Use Move Room for a room change.',
)

# Payment form: explicit electricity handling is saved in the durable draft and sent to the v4 RPC.
replace_once(
    'src/App.tsx',
    "type SplitPaymentInput = { requestId: string; tenantId: string; rentAmount: number; securityAmount: number; electricityAmount: number; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }",
    "type SplitPaymentInput = { requestId: string; tenantId: string; rentAmount: number; securityAmount: number; electricityAmount: number; electricityAction: ElectricityPaymentAction; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }",
)
replace_once(
    'src/App.tsx',
    "    paymentDate: businessDate(), rentAmount: 0, securityAmount: 0, electricityAmount: 0, otherAmount: 0,\n    description: '', attempted: false,",
    "    paymentDate: businessDate(), rentAmount: 0, securityAmount: 0, electricityAmount: 0, electricityAction: 'auto' as ElectricityPaymentAction, otherAmount: 0,\n    description: '', attempted: false,",
)
replace_once(
    'src/App.tsx',
    "  const { tenantId, paymentMode, paymentDate, requestId, rentAmount, securityAmount, electricityAmount, otherAmount } = draft.value",
    "  const { tenantId, paymentMode, paymentDate, requestId, rentAmount, securityAmount, electricityAmount, otherAmount } = draft.value\n  const electricityAction: ElectricityPaymentAction = draft.value.electricityAction || 'auto'",
)
replace_once(
    'src/App.tsx',
    "    draft.patch({ tenantId: id }); draft.patch({ rentAmount: 0 }); draft.patch({ securityAmount: 0 }); draft.patch({ electricityAmount: 0 }); draft.patch({ otherAmount: 0 }); setError('')",
    "    draft.patch({ tenantId: id, rentAmount: 0, securityAmount: 0, electricityAmount: 0, electricityAction: 'auto', otherAmount: 0 }); setError('')",
)
replace_once(
    'src/App.tsx',
    "    if (rentAmount + securityAmount + electricityAmount + otherAmount <= 0) { setError('Enter at least one payment amount.'); return }\n    if (!draft.value.attempted && securityAmount > 0 && !isFirstTimeSecurity && securityAmount > securityBalance) { setError(`Security amount (${money(securityAmount)}) exceeds remaining balance of ${money(securityBalance)}.`); return }",
    "    const zeroMoneyElectricityAction = electricityAction === 'pending' || electricityAction === 'exempted'\n    if (rentAmount + securityAmount + electricityAmount + otherAmount <= 0 && !zeroMoneyElectricityAction) { setError('Enter at least one payment amount, or choose Pending/Exempted for electricity.'); return }\n    if (['pending', 'exempted', 'included'].includes(electricityAction) && electricityAmount > 0) { setError('Electricity amount must be 0 for Pending, Exempted or Included.'); return }\n    if ((electricityAction === 'paid' || electricityAction === 'settle-existing') && electricityAmount <= 0) { setError('Enter the electricity amount being received.'); return }\n    if (!draft.value.attempted && securityAmount > 0 && !isFirstTimeSecurity && securityAmount > securityBalance) { setError(`Security amount (${money(securityAmount)}) exceeds remaining balance of ${money(securityBalance)}.`); return }",
)
replace_once(
    'src/App.tsx',
    "      await onSubmit({ requestId, tenantId, rentAmount, securityAmount, electricityAmount, otherAmount, paymentDate, rentPeriod, paymentMode, description: draft.value.description })",
    "      await onSubmit({ requestId, tenantId, rentAmount, securityAmount, electricityAmount, electricityAction, otherAmount, paymentDate, rentPeriod, paymentMode, description: draft.value.description })",
)
replace_once(
    'src/App.tsx',
    '<Field label="Electricity received"><input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={electricityAmount || \'\'} placeholder="0" onWheel={(event) => event.currentTarget.blur()} onChange={(event) => draft.patch({ electricityAmount: Number(event.target.value) })} /></Field><Field label="Other received">',
    '<Field label="Electricity handling"><select className={inputClass} value={electricityAction} onChange={(event) => { const next = event.target.value as ElectricityPaymentAction; draft.patch({ electricityAction: next, ...([\'pending\', \'exempted\', \'included\'].includes(next) ? { electricityAmount: 0 } : {}) }) }}>{tenant?.electricity === \'Fixed\' ? <><option value="auto">Auto — amount = received, blank = pending</option><option value="paid">Electricity received now</option><option value="pending">Pending — carry forward</option><option value="exempted">Exempt this month</option><option value="settle-existing">Settle previous due only</option></> : <><option value="auto">Included — no new charge</option><option value="included">Included / no new charge</option><option value="settle-existing">Settle previous electricity due</option></>}</select></Field><Field label="Electricity received"><input className={inputClass} type="number" min="0" step="0.01" inputMode="decimal" value={electricityAmount || \'\'} placeholder="0" disabled={[\'pending\', \'exempted\', \'included\'].includes(electricityAction)} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => draft.patch({ electricityAmount: Number(event.target.value) })} /></Field><Field label="Other received">',
)
replace_once(
    'src/App.tsx',
    '</Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Payment date">',
    '</Field></div><p className="text-xs text-slate-600">Fixed electricity is monthly. If you leave Auto with ₹0, the fixed bill stays pending and carries into Total payable. Exempted records a zero-due month. Electricity receipts settle the oldest electricity balance first.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Payment date">',
)

# Database mappings expose the recurring electricity effective month to the account calculator.
replace_once(
    'src/lib/database.ts',
    "electricity: r.electricity, electricityAmount: num(r.electricity_amount), joiningDate: r.joining_date",
    "electricity: r.electricity, electricityAmount: num(r.electricity_amount), electricityEffectivePeriod: r.electricity_effective_period || undefined, joiningDate: r.joining_date",
)
replace_once(
    'src/lib/database.ts',
    "electricity: r.electricity, electricityAmount: num(r.electricity_amount), joiningDate: r.joining_date",
    "electricity: r.electricity, electricityAmount: num(r.electricity_amount), electricityEffectivePeriod: r.electricity_effective_period || undefined, joiningDate: r.joining_date",
)

replace_once(
    'src/lib/database.ts',
    "export async function recordSplitPayment(input: { requestId: string; tenantId: string; branchId: string; rentAmount: number; securityAmount: number; electricityAmount: number; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }) {",
    "export async function recordSplitPayment(input: { requestId: string; tenantId: string; branchId: string; rentAmount: number; securityAmount: number; electricityAmount: number; electricityAction?: string; otherAmount: number; paymentDate: string; rentPeriod?: string; paymentMode: string; description: string }) {",
)
replace_once(
    'src/lib/database.ts',
    "    p_payment_mode: input.paymentMode, p_description: input.description || null,\n  }\n  let response = await supabase.rpc('record_split_payment_v3', payload)",
    "    p_payment_mode: input.paymentMode, p_description: input.description || null,\n    p_electricity_action: input.electricityAction || 'auto',\n  }\n  let response = await supabase.rpc('record_split_payment_v4', payload)",
)
replace_once(
    'src/lib/database.ts',
    "    response = await supabase.rpc('record_split_payment_v3', payload)",
    "    response = await supabase.rpc('record_split_payment_v4', payload)",
)
replace_once(
    'src/lib/database.ts',
    "  if (response.error) throw databaseError('record_split_payment_v3 RPC', response.error)",
    "  if (response.error) throw databaseError('record_split_payment_v4 RPC', response.error)",
)

print('electricity billing UI/data patch applied')
