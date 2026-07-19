import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { History, Plus, X } from 'lucide-react'
import type { Category, LedgerEntry, LedgerParty, LedgerPartyStatus, LedgerPartyType } from '../App'
import {
  fetchLedgerPartyChangeHistory,
  recordCategoryAccountTransaction,
  saveCategoryAccountParty,
  type LedgerPartyChangeHistory,
} from '../lib/database'

const inputClass = 'min-h-10 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
const today = () => new Date().toISOString().slice(0, 10)
const monthNow = () => today().slice(0, 7)
const money = (value: number) => `₹${Math.abs(value || 0).toLocaleString('en-IN')}`
const showDate = (value?: string) => value ? value.slice(0, 10).split('-').reverse().join('/') : '-'
const showMonth = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return '-'
  const [year, month] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"><div className={`max-h-[92vh] w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} overflow-auto rounded-lg bg-white p-5 shadow-2xl`}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-black text-slate-900">{title}</h2><button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>{children}</div></div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm font-semibold text-slate-700">{label}{children}</label>
}

function accountActions(type: LedgerPartyType, isAdmin: boolean, canAddCashbook: boolean, canAddExpense: boolean) {
  if (type === 'Staff') return isAdmin ? ['Salary Due', 'Salary Payment', 'Advance Given', 'Bonus', 'Deduction'] : canAddCashbook ? ['Salary Payment', 'Advance Given'] : []
  if (type === 'Vendor') return [...(canAddExpense ? ['Add Bill'] : []), ...(canAddCashbook ? ['Payment Made'] : [])]
  if (type === 'Building Rent') return [...(isAdmin ? ['Rent Due'] : []), ...(canAddCashbook ? ['Rent Payment'] : [])]
  return []
}

const cashActions = new Set(['Salary Payment', 'Advance Given', 'Payment Made', 'Rent Payment'])
const dueActions = new Set(['Salary Due', 'Bonus', 'Add Bill', 'Rent Due'])

function visibleAccounts(parties: LedgerParty[]) {
  const active = parties.filter((party) => party.status === 'Active' && party.type !== 'Other')
  const byCategory = new Map<string, LedgerParty[]>()
  active.forEach((party) => {
    const key = party.categoryId || ''
    byCategory.set(key, [...(byCategory.get(key) || []), party])
  })
  return active.filter((party) => {
    const group = byCategory.get(party.categoryId || '') || []
    const isGeneral = /- GENERAL$/i.test(party.name.trim())
    return !(isGeneral && group.some((item) => item.id !== party.id && !/- GENERAL$/i.test(item.name.trim())))
  })
}

export function CategoryAccountEntryModal({
  branchName,
  categories,
  parties,
  entries,
  isAdmin,
  canAddCashbook,
  canAddExpense,
  onClose,
  onSaved,
}: {
  branchName: string
  categories: Category[]
  parties: LedgerParty[]
  entries: LedgerEntry[]
  isAdmin: boolean
  canAddCashbook: boolean
  canAddExpense: boolean
  onClose: () => void
  onSaved: (message: string) => Promise<void> | void
}) {
  const accounts = useMemo(() => visibleAccounts(parties).filter((party) => accountActions(party.type, isAdmin, canAddCashbook, canAddExpense).length > 0), [parties, isAdmin, canAddCashbook, canAddExpense])
  const [partyId, setPartyId] = useState(accounts[0]?.id || '')
  const account = accounts.find((item) => item.id === partyId)
  const category = categories.find((item) => item.id === account?.categoryId)
  const accountType = account?.type
  const actions = accountType ? accountActions(accountType, isAdmin, canAddCashbook, canAddExpense) : []
  const [action, setAction] = useState(actions[0] || '')
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState(today())
  const [period, setPeriod] = useState(monthNow())
  const [paymentMode, setPaymentMode] = useState('Cash')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const next = accounts.find((item) => item.id === partyId) || accounts[0]
    if (next && next.id !== partyId) setPartyId(next.id)
  }, [accounts, partyId])

  useEffect(() => {
    const nextActions = accountType ? accountActions(accountType, isAdmin, canAddCashbook, canAddExpense) : []
    setAction(nextActions[0] || '')
  }, [accountType, isAdmin, canAddCashbook, canAddExpense])

  useEffect(() => {
    if ((action === 'Salary Due' || action === 'Rent Due') && account?.monthlyAmount) setAmount(String(account.monthlyAmount))
    else if (action === 'Salary Due' || action === 'Rent Due') setAmount('')
  }, [action, account?.monthlyAmount])

  const accountEntries = account ? entries.filter((item) => item.partyId === account.id) : []
  const balance = accountEntries.reduce((sum, item) => sum + item.debitAmount - item.creditAmount, 0)
  const createsCash = cashActions.has(action)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!account || !action) return
    const numericAmount = Number(amount)
    if (!(numericAmount > 0)) { setError('Enter an amount greater than zero.'); return }
    if (['Salary Payment', 'Payment Made', 'Rent Payment'].includes(action) && numericAmount > Math.max(0, balance)) { setError(`Payment cannot exceed current pending balance of ${money(Math.max(0, balance))}. Use Advance Given only when extra advance is intended.`); return }
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError('')
    try {
      await recordCategoryAccountTransaction({
        requestId,
        partyId: account.id,
        action,
        amount: numericAmount,
        entryDate,
        period,
        paymentMode,
        description: String(form.get('description') || '').trim(),
        reference: String(form.get('reference') || '').trim(),
        remarks: String(form.get('remarks') || '').trim(),
      })
      setRequestId(crypto.randomUUID())
      await onSaved(`${action} of ${money(numericAmount)} saved for ${account.name}.`)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Entry could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!accounts.length) return <Modal title={`Staff / Vendor Payments · ${branchName}`} onClose={onClose}><div className="grid gap-4"><p className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">No permitted staff/vendor action is available. The owner should classify a category and enable the required Cashbook or Expense permission.</p><div className="flex justify-end"><button onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 font-bold">Close</button></div></div></Modal>

  return <Modal title={`Staff / Vendor Payments · ${branchName}`} onClose={onClose}>
    <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
      <Field label="Staff / vendor account"><select className={inputClass} value={partyId} onChange={(event) => setPartyId(event.target.value)}>{accounts.map((item) => { const itemCategory = categories.find((categoryItem) => categoryItem.id === item.categoryId); return <option key={item.id} value={item.id}>{item.name} · {item.type}{itemCategory ? ` · ${itemCategory.name}` : ''}</option> })}</select></Field>
      <Field label="Action"><select className={inputClass} value={action} onChange={(event) => setAction(event.target.value)}>{actions.map((item) => <option key={item}>{item}</option>)}</select></Field>
      <Field label="Amount"><input className={inputClass} type="number" min="0.01" step="0.01" value={amount} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setAmount(event.target.value)} required /></Field>
      <Field label="Entry date"><input className={inputClass} type="date" value={entryDate} onChange={(event) => { setEntryDate(event.target.value); setPeriod(event.target.value.slice(0, 7)) }} required /></Field>
      <Field label="Month / period"><input className={inputClass} type="month" value={period} onChange={(event) => setPeriod(event.target.value)} required /></Field>
      {createsCash && <Field label="Payment mode"><select className={inputClass} value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)}><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option></select></Field>}
      <Field label={action === 'Add Bill' ? 'Bill number / reference optional' : 'Reference optional'}><input name="reference" className={inputClass} /></Field>
      <Field label="Description"><input name="description" className={inputClass} placeholder={`${action} - ${account?.name || ''}`} /></Field>
      <Field label="Remarks optional"><input name="remarks" className={inputClass} /></Field>
      <div className="md:col-span-2 grid gap-3 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm sm:grid-cols-3"><p><span className="text-slate-500">Category</span><br /><b>{category?.name || '-'}</b></p><p><span className="text-slate-500">Current pending</span><br /><b className={balance > 0 ? 'text-rose-700' : balance < 0 ? 'text-orange-700' : 'text-emerald-700'}>{balance > 0 ? money(balance) : balance < 0 ? `Advance ${money(balance)}` : 'Clear'}</b></p><p><span className="text-slate-500">Monthly salary/rent</span><br /><b>{money(account?.monthlyAmount || 0)}</b></p></div>
      {dueActions.has(action) && <p className="md:col-span-2 rounded-md bg-blue-50 p-3 text-sm text-blue-800">This creates a bill/salary due. It does not reduce Cashbook until an actual payment is recorded.</p>}
      {error && <p className="md:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 font-bold">Cancel</button><button type="submit" disabled={saving} className="rounded-md bg-orange-500 px-4 py-2 font-bold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button></div>
    </form>
  </Modal>
}

function PartyEditor({
  category,
  party,
  history,
  onSaved,
}: {
  category: Category
  party?: LedgerParty
  history: LedgerPartyChangeHistory[]
  onSaved: (message: string) => Promise<void> | void
}) {
  const [type, setType] = useState<LedgerPartyType>(party?.type || 'Staff')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError('')
    try {
      await saveCategoryAccountParty({
        partyId: party?.id,
        categoryId: category.id,
        name: String(form.get('name') || '').trim(),
        type,
        phone: String(form.get('phone') || '').trim(),
        joiningDate: String(form.get('joiningDate') || today()),
        monthlyAmount: Number(form.get('monthlyAmount') || 0),
        dueDay: Number(form.get('dueDay') || 1),
        status: String(form.get('status') || 'Active') as LedgerPartyStatus,
        effectiveDate: String(form.get('effectiveDate') || today()),
        notes: String(form.get('notes') || '').trim(),
      })
      await onSaved(`${party ? 'Updated' : 'Added'} ${String(form.get('name') || '').trim()} under ${category.name}.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Account settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return <form key={party?.id || 'new'} className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
    <Field label="Account type"><select className={inputClass} value={type} onChange={(event) => setType(event.target.value as LedgerPartyType)}><option value="Staff">Staff</option><option value="Vendor">Vendor</option><option value="Building Rent">Building Rent</option><option value="Other">General / Other</option></select></Field>
    <Field label={type === 'Staff' ? 'Staff name' : type === 'Vendor' ? 'Vendor name' : type === 'Building Rent' ? 'Owner / building account name' : 'Account name'}><input name="name" className={inputClass} defaultValue={party?.name || category.name.toUpperCase()} required /></Field>
    <Field label="Phone optional"><input name="phone" className={inputClass} defaultValue={party?.phone || ''} /></Field>
    <Field label="Joining / start date"><input name="joiningDate" type="date" className={inputClass} defaultValue={party?.joiningDate || today()} required /></Field>
    <Field label={type === 'Staff' ? 'Current monthly salary' : type === 'Building Rent' ? 'Current monthly rent' : 'Default monthly amount optional'}><input name="monthlyAmount" type="number" min="0" step="0.01" className={inputClass} defaultValue={party?.monthlyAmount || 0} /></Field>
    <Field label="Monthly due day"><input name="dueDay" type="number" min="1" max="31" className={inputClass} defaultValue={party?.dueDay || 1} /></Field>
    <Field label="Change effective from"><input name="effectiveDate" type="date" className={inputClass} defaultValue={today()} required /></Field>
    <Field label="Status"><select name="status" className={inputClass} defaultValue={party?.status || 'Active'}><option>Active</option><option>Left</option><option>Inactive</option></select></Field>
    <Field label="Notes optional"><input name="notes" className={inputClass} defaultValue={party?.notes || ''} /></Field>
    <div className="md:col-span-2 rounded-md bg-slate-50 p-3 text-sm"><b>Owner-only setting:</b> salary/rent changes are stored permanently with the effective date and the admin who changed them.</div>
    {error && <p className="md:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="md:col-span-2 flex justify-end"><button type="submit" disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save Account Settings'}</button></div>
    <div className="md:col-span-2 border-t border-slate-200 pt-4"><h3 className="mb-2 flex items-center gap-2 font-bold"><History size={17} /> Change history</h3><div className="grid gap-2">{history.map((item) => <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{showDate(item.effectiveDate)}</b><span className="text-xs text-slate-500">{item.changedByName || 'Admin'} · {showDate(item.createdAt)}</span></div><p className="mt-1 text-slate-600">{String(item.oldValue?.name || 'New account')} → {String(item.newValue?.name || '-')} · {money(Number(item.oldValue?.monthlyAmount || 0))} → {money(Number(item.newValue?.monthlyAmount || 0))}</p></div>)}{!history.length && <p className="text-sm text-slate-500">No setting changes recorded yet.</p>}</div></div>
  </form>
}

export function CategoryAccountManagerModal({
  category,
  parties,
  onClose,
  onSaved,
}: {
  category: Category
  parties: LedgerParty[]
  onClose: () => void
  onSaved: (message: string) => Promise<void> | void
}) {
  const categoryParties = parties.filter((item) => item.categoryId === category.id)
  const nonGeneral = categoryParties.filter((item) => !/- GENERAL$/i.test(item.name.trim()))
  const selectable = nonGeneral.length ? nonGeneral : categoryParties
  const [partyId, setPartyId] = useState(selectable[0]?.id || '__new__')
  const party = categoryParties.find((item) => item.id === partyId)
  const [history, setHistory] = useState<LedgerPartyChangeHistory[]>([])

  useEffect(() => {
    let cancelled = false
    fetchLedgerPartyChangeHistory(category.id, party?.id).then((rows) => { if (!cancelled) setHistory(rows) }).catch(() => { if (!cancelled) setHistory([]) })
    return () => { cancelled = true }
  }, [category.id, party?.id])

  return <Modal title={`Edit Category Account · ${category.name}`} wide onClose={onClose}>
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"><Field label="Existing account"><select className={inputClass} value={partyId} onChange={(event) => setPartyId(event.target.value)}>{selectable.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}<option value="__new__">+ Add another staff/vendor account</option></select></Field><div className="flex-1" /><p className="text-sm text-slate-500">Category name remains <b>{category.name}</b>. Existing Cashbook history is preserved.</p></div>
      <PartyEditor key={partyId} category={category} party={partyId === '__new__' ? undefined : party} history={history} onSaved={onSaved} />
    </div>
  </Modal>
}

export function CategoryAccountSummary({
  category,
  parties,
  entries,
  isAdmin,
  onEdit,
}: {
  category: Category
  parties: LedgerParty[]
  entries: LedgerEntry[]
  isAdmin: boolean
  onEdit: () => void
}) {
  const typedParties = parties.filter((item) => item.type !== 'Other')
  const totalDue = entries.reduce((sum, item) => sum + item.debitAmount, 0)
  const totalPaid = entries.reduce((sum, item) => sum + item.creditAmount, 0)
  const balance = totalDue - totalPaid
  const recent = [...entries].sort((a, b) => (b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''))).slice(0, 8)

  return <div className="grid gap-3 rounded-lg border border-orange-200 bg-orange-50/40 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-slate-900">Staff / Vendor Account · {category.name}</h3><p className="text-sm text-slate-600">{typedParties.length ? typedParties.map((item) => `${item.name} · ${item.type}`).join(' | ') : 'General category — not yet classified as Staff or Vendor.'}</p></div>{isAdmin && <button onClick={onEdit} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white"><Plus size={15} /> Edit category account</button>}</div>
    {typedParties.length > 0 && <><div className="grid gap-3 sm:grid-cols-4"><div className="rounded-md bg-white p-3"><p className="text-xs text-slate-500">Total bill / salary due</p><b className="text-lg">{money(totalDue)}</b></div><div className="rounded-md bg-white p-3"><p className="text-xs text-slate-500">Paid / advance / adjustment</p><b className="text-lg text-emerald-700">{money(totalPaid)}</b></div><div className="rounded-md bg-white p-3"><p className="text-xs text-slate-500">Current pending</p><b className={`text-lg ${balance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{balance > 0 ? money(balance) : balance < 0 ? `Advance ${money(balance)}` : 'Clear'}</b></div><div className="rounded-md bg-white p-3"><p className="text-xs text-slate-500">Accounts</p><b className="text-lg">{typedParties.length}</b></div></div><div className="overflow-auto rounded-md bg-white"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Account</th><th className="p-3">Entry</th><th className="p-3">Due</th><th className="p-3">Paid / adjusted</th><th className="p-3">Month</th></tr></thead><tbody>{recent.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="p-3">{showDate(entry.date)}</td><td className="p-3 font-semibold">{parties.find((item) => item.id === entry.partyId)?.name || '-'}</td><td className="p-3">{entry.nature}</td><td className="p-3 text-rose-700">{entry.debitAmount ? money(entry.debitAmount) : '-'}</td><td className="p-3 text-emerald-700">{entry.creditAmount ? money(entry.creditAmount) : '-'}</td><td className="p-3">{showMonth(entry.period)}</td></tr>)}{!recent.length && <tr><td colSpan={6} className="p-4 text-center text-slate-500">No staff/vendor ledger entry yet.</td></tr>}</tbody></table></div></>}
  </div>
}
