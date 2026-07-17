import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Building2, Edit3, Eye, Plus, ReceiptText, RotateCcw, Trash2, UserMinus, Users, WalletCards, X } from 'lucide-react'
import type { AppData, Branch, Category, LedgerEntry, LedgerParty, LedgerPartyType, Role, User } from '../App'

type UpdateData = (
  updater: (previous: AppData) => AppData,
  action: string,
  entity: string,
  description?: string,
  metadata?: Record<string, string | number>,
) => void

export type UnifiedLedgerEntryInput = {
  categoryId: string
  partyId?: string
  nature: string
  amount: number
  date: string
  period: string
  paymentMode: string
  description: string
  reference?: string
  remarks?: string
  newParty?: {
    name: string
    type: LedgerPartyType
    phone?: string
    joiningDate: string
    monthlyAmount: number
    dueDay: number
    notes?: string
  }
}

const currentDate = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const currentPeriod = () => currentDate().slice(0, 7)
const inr = (value: number) => `₹${Math.abs(value).toLocaleString('en-IN')}`
const showDate = (value?: string) => value ? value.slice(0, 10).split('-').reverse().join('/') : '-'
const showMonth = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return '-'
  const [year, month] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
}
const newId = () => crypto.randomUUID()
const inputClass = 'min-h-10 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

const natureOptions = (type: LedgerPartyType | 'Simple') => {
  if (type === 'Staff') return ['Salary Due', 'Salary Payment', 'Advance Given', 'Bonus', 'Deduction', 'Final Settlement', 'Opening Balance']
  if (type === 'Building Rent') return ['Rent Due', 'Rent Payment', 'Maintenance / Other Bill', 'Direct Purchase & Payment', 'Discount / Credit', 'Opening Balance']
  if (type === 'Vendor') return ['Bill / Purchase', 'Payment Made', 'Direct Purchase & Payment', 'Discount / Credit', 'Opening Balance']
  if (type === 'Other') return ['Add Payable', 'Payment Made', 'Direct Purchase & Payment', 'Reduce Payable', 'Opening Balance']
  return ['Simple Expense', 'Simple Cashbook Debit', 'Simple Cashbook Credit']
}

const dueNatures = new Set(['Salary Due', 'Bonus', 'Bill / Purchase', 'Rent Due', 'Maintenance / Other Bill', 'Add Payable'])
const increaseNatures = new Set([...dueNatures, 'Opening Balance'])
const decreaseNatures = new Set(['Salary Payment', 'Advance Given', 'Deduction', 'Final Settlement', 'Payment Made', 'Rent Payment', 'Discount / Credit', 'Reduce Payable'])
const cashNatures = new Set(['Salary Payment', 'Advance Given', 'Final Settlement', 'Payment Made', 'Rent Payment', 'Direct Purchase & Payment'])
const directNature = 'Direct Purchase & Payment'

export function applyLedgerEntry(previous: AppData, branchId: string, input: UnifiedLedgerEntryInput): AppData {
  const category = previous.categories.find((item) => item.id === input.categoryId && item.branchId === branchId)
  if (!category) throw new Error('Select a valid category before saving.')

  const now = new Date().toISOString()
  let ledgerParties = previous.ledgerParties
  let partyId = input.partyId
  let party = partyId ? ledgerParties.find((item) => item.id === partyId && item.branchId === branchId) : undefined

  if (input.newParty) {
    const normalizedName = input.newParty.name.trim().toUpperCase()
    if (!normalizedName) throw new Error('Enter the staff/vendor name.')
    const duplicate = ledgerParties.some((item) => item.branchId === branchId && item.categoryId === input.categoryId && item.name.trim().toUpperCase() === normalizedName && item.status !== 'Inactive')
    if (duplicate) throw new Error('A party with this name already exists in the selected category.')
    partyId = newId()
    party = {
      id: partyId,
      branchId,
      categoryId: input.categoryId,
      name: normalizedName,
      type: input.newParty.type,
      phone: input.newParty.phone || '',
      joiningDate: input.newParty.joiningDate,
      monthlyAmount: input.newParty.monthlyAmount,
      dueDay: input.newParty.dueDay,
      status: 'Active',
      notes: input.newParty.notes || '',
    }
    ledgerParties = [party, ...ledgerParties]
  }

  if (input.nature.startsWith('Simple ')) {
    const amount = Number(input.amount)
    if (!(amount > 0)) throw new Error('Amount must be greater than zero.')
    const cashbookId = newId()
    const expenseId = input.nature === 'Simple Expense' ? newId() : undefined
    const type = input.nature === 'Simple Cashbook Credit' ? 'Credit' : 'Debit'
    const description = input.description.trim() || `${input.nature} - ${category.name}`
    return {
      ...previous,
      ledgerParties,
      expenses: expenseId ? [{
        id: expenseId,
        branchId,
        category: category.name as AppData['expenses'][number]['category'],
        categoryId: category.id,
        description,
        amount,
        date: input.date,
        vendor: '',
        cashbookId,
      }, ...previous.expenses] : previous.expenses,
      cashbook: [{
        id: cashbookId,
        branchId,
        type,
        amount,
        description,
        date: input.date,
        source: expenseId ? 'Expense' : 'Manual',
        linkedId: expenseId,
        category: category.name,
        categoryId: category.id,
        paymentMode: input.paymentMode,
        reference: input.reference,
        remarks: input.remarks,
        createdAt: now,
      }, ...previous.cashbook],
    }
  }

  if (!party || !partyId) throw new Error('Select or add a staff/vendor/party.')
  if (party.categoryId !== input.categoryId) throw new Error('The selected party is not linked to this category.')
  if (party.status !== 'Active') throw new Error('This party is inactive/left. Reactivate it before adding new entries.')

  const amount = Number(input.amount)
  if (!(amount > 0)) throw new Error('Amount must be greater than zero.')
  const period = input.period || input.date.slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Select a valid month/period.')

  if ((input.nature === 'Salary Due' || input.nature === 'Rent Due') && previous.ledgerEntries.some((entry) => entry.partyId === partyId && entry.period === period && entry.nature === input.nature)) {
    throw new Error(`${input.nature} is already generated for ${showMonth(period)}.`)
  }

  const ledgerEntryId = newId()
  const createsExpense = dueNatures.has(input.nature) || input.nature === directNature
  const createsCashbook = cashNatures.has(input.nature)
  const expenseId = createsExpense ? newId() : undefined
  const cashbookId = createsCashbook ? newId() : undefined

  let debitAmount = 0
  let creditAmount = 0
  if (input.nature === directNature) {
    debitAmount = amount
     creditAmount = amount
  } else if (increaseNatures.has(input.nature)) {
    debitAmount = amount
  } else if (decreaseNatures.has(input.nature)) {
    creditAmount = amount
  } else {
    throw new Error('Unsupported ledger entry type.')
  }

  const description = input.description.trim() || `${input.nature} - ${party.name}`
  const ledgerEntry: LedgerEntry = {
    id: ledgerEntryId,
    branchId,
    partyId,
    categoryId: category.id,
    nature: input.nature,
    amount,
    debitAmount,
    creditAmount,
    date: input.date,
    period,
    description,
    paymentMode: createsCashbook ? input.paymentMode : undefined,
    reference: input.reference,
    remarks: input.remarks,
    cashbookId,
    expenseId,
    createdAt: now,
  }

  return {
    ...previous,
    ledgerParties,
    ledgerEntries: [ledgerEntry, ...previous.ledgerEntries],
    expenses: expenseId ? [{
      id: expenseId,
      branchId,
      category: category.name as AppData['expenses'][number]['category'],
      categoryId: category.id,
      description,
      amount,
      date: input.date,
      vendor: party.name,
      cashbookId,
    }, ...previous.expenses] : previous.expenses,
    cashbook: cashbookId ? [{
      id: cashbookId,
      branchId,
      type: 'Debit',
      amount,
      description,
      date: input.date,
      source: expenseId ? 'Expense' : 'Manual',
      linkedId: expenseId || ledgerEntryId,
      category: category.name,
      categoryId: category.id,
      paymentMode: input.paymentMode,
      reference: input.reference || `LEDGER|${partyId}|${ledgerEntryId}`,
      remarks: input.remarks,
      createdAt: now,
    }, ...previous.cashbook] : previous.cashbook,
  }
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"><div className={`max-h-[92vh] w-full ${wide ? 'max-w-6xl' : 'max-w-2xl'} overflow-auto rounded-lg bg-white p-5 shadow-2xl`}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-black text-slate-900">{title}</h2><button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>{children}</div></div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm font-semibold text-slate-700">{label}{children}</label>
}

function SmallButton({ children, onClick, tone = 'blue', disabled = false }: { children: ReactNode; onClick?: () => void; tone?: 'blue' | 'green' | 'red' | 'soft'; disabled?: boolean }) {
  const tones = {
    blue: 'bg-blue-600 text-white hover:bg-blue-700',
    green: 'bg-emerald-600 text-white hover:bg-emerald-700',
    red: 'bg-rose-600 text-white hover:bg-rose-700',
    soft: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  }
  return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-bold disabled:opacity-50 ${tones[tone]}`}>{children}</button>
}

function PartyModal({ party, categories, branchId, onClose, onSave }: { party?: LedgerParty; categories: Category[]; branchId: string; onClose: () => void; onSave: (party: LedgerParty) => void }) {
  const [categoryId, setCategoryId] = useState(party?.categoryId || categories[0]?.id || '')
  const [type, setType] = useState<LedgerPartyType>(party?.type || 'Staff')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!categoryId) return
    onSave({
      id: party?.id || newId(),
      branchId,
      categoryId,
      name: String(form.get('name')).trim().toUpperCase(),
      type,
      phone: String(form.get('phone') || ''),
      joiningDate: String(form.get('joiningDate') || currentDate()),
      monthlyAmount: Number(form.get('monthlyAmount') || 0),
      dueDay: Math.min(31, Math.max(1, Number(form.get('dueDay') || 1))),
      status: String(form.get('status') || 'Active') as LedgerParty['status'],
      leftDate: String(form.get('leftDate') || '') || undefined,
      notes: String(form.get('notes') || ''),
    })
    onClose()
  }
  return <Modal title={party ? 'Edit Ledger Party' : 'Add Staff / Vendor / Owner'} onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={submit}><Field label="Linked category"><select className={inputClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="Party type"><select className={inputClass} value={type} onChange={(event) => setType(event.target.value as LedgerPartyType)}><option>Staff</option><option>Vendor</option><option>Building Rent</option><option>Other</option></select></Field><Field label="Name"><input name="name" className={inputClass} defaultValue={party?.name} required /></Field><Field label="Phone"><input name="phone" className={inputClass} defaultValue={party?.phone} /></Field><Field label="Joining / start date"><input name="joiningDate" className={inputClass} type="date" defaultValue={party?.joiningDate || currentDate()} required /></Field><Field label={type === 'Staff' ? 'Monthly salary' : type === 'Building Rent' ? 'Monthly building rent' : 'Default monthly amount'}><input name="monthlyAmount" className={inputClass} type="number" min="0" step="0.01" defaultValue={party?.monthlyAmount || 0} /></Field><Field label="Monthly due day"><input name="dueDay" className={inputClass} type="number" min="1" max="31" defaultValue={party?.dueDay || 1} /></Field><Field label="Status"><select name="status" className={inputClass} defaultValue={party?.status || 'Active'}><option>Active</option><option>Left</option><option>Inactive</option></select></Field><Field label="Left / inactive date"><input name="leftDate" className={inputClass} type="date" defaultValue={party?.leftDate || ''} /></Field><Field label="Notes"><input name="notes" className={inputClass} defaultValue={party?.notes || ''} /></Field><div className="md:col-span-2 flex justify-end gap-2"><SmallButton tone="soft" onClick={onClose}>Cancel</SmallButton><button type="submit" disabled={!categoryId} className="min-h-10 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save Party</button></div></form></Modal>
}

export function UnifiedLedgerEntryModal({ branch, categories, parties, onClose, onSubmit }: { branch: Branch; categories: Category[]; parties: LedgerParty[]; onClose: () => void; onSubmit: (input: UnifiedLedgerEntryInput) => void }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '')
  const categoryParties = parties.filter((party) => party.categoryId === categoryId && party.status === 'Active')
  const [partyChoice, setPartyChoice] = useState<string>('__simple__')
  const selectedParty = parties.find((party) => party.id === partyChoice)
  const [newPartyType, setNewPartyType] = useState<LedgerPartyType>('Staff')
  const activeType: LedgerPartyType | 'Simple' = partyChoice === '__new__' ? newPartyType : selectedParty?.type || 'Simple'
  const options = natureOptions(activeType)
  const [nature, setNature] = useState(options[0])
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(currentDate())
  const [period, setPeriod] = useState(currentPeriod())
  const [paymentMode, setPaymentMode] = useState('Cash')
  const [error, setError] = useState('')

  useEffect(() => {
    const nextParties = parties.filter((party) => party.categoryId === categoryId && party.status === 'Active')
    setPartyChoice(nextParties[0]?.id || '__new__')
  }, [categoryId, parties])

  useEffect(() => {
    const nextOptions = natureOptions(activeType)
    setNature(nextOptions[0])
  }, [activeType])

  useEffect(() => {
    if ((nature === 'Salary Due' || nature === 'Rent Due') && selectedParty?.monthlyAmount) setAmount(String(selectedParty.monthlyAmount))
  }, [nature, selectedParty])

  const needsCash = cashNatures.has(nature) || nature.startsWith('Simple ')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const newParty = partyChoice === '__new__' ? {
        name: String(form.get('newPartyName') || ''),
        type: newPartyType,
        phone: String(form.get('newPartyPhone') || ''),
        joiningDate: String(form.get('newPartyJoiningDate') || date),
        monthlyAmount: Number(form.get('newPartyMonthlyAmount') || 0),
        dueDay: Number(form.get('newPartyDueDay') || 1),
        notes: String(form.get('newPartyNotes') || ''),
      } : undefined
      onSubmit({
        categoryId,
        partyId: partyChoice.startsWith('__') ? undefined : partyChoice,
        nature,
        amount: Number(amount),
        date,
        period,
        paymentMode,
        description: String(form.get('description') || ''),
        reference: String(form.get('reference') || '') || undefined,
        remarks: String(form.get('remarks') || '') || undefined,
        newParty,
      })
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Entry could not be saved.')
    }
  }

  if (!categories.length) return <Modal title="Add Entry" onClose={onClose}><div className="grid gap-4"><p className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">Create at least one Finance category first. Then staff, vendor and building ledgers can be linked to that category.</p><div className="flex justify-end"><SmallButton tone="soft" onClick={onClose}>Close</SmallButton></div></div></Modal>

  return <Modal title={`Add Entry · ${branch.name}`} onClose={onClose}><form className="grid gap-4 md:grid-cols-2" onSubmit={submit}><Field label="Category"><select className={inputClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="Staff / vendor / owner"><select className={inputClass} value={partyChoice} onChange={(event) => setPartyChoice(event.target.value)}><option value="__simple__">No party · simple entry</option>{categoryParties.map((party) => <option key={party.id} value={party.id}>{party.name} · {party.type}</option>)}<option value="__new__">+ Add new staff/vendor/owner with this entry</option></select></Field>{partyChoice === '__new__' && <><Field label="New party type"><select className={inputClass} value={newPartyType} onChange={(event) => setNewPartyType(event.target.value as LedgerPartyType)}><option>Staff</option><option>Vendor</option><option>Building Rent</option><option>Other</option></select></Field><Field label="New party name"><input name="newPartyName" className={inputClass} required /></Field><Field label="Phone"><input name="newPartyPhone" className={inputClass} /></Field><Field label="Joining / start date"><input name="newPartyJoiningDate" className={inputClass} type="date" defaultValue={date} /></Field><Field label="Monthly salary / rent"><input name="newPartyMonthlyAmount" className={inputClass} type="number" min="0" step="0.01" defaultValue={0} /></Field><Field label="Due day"><input name="newPartyDueDay" className={inputClass} type="number" min="1" max="31" defaultValue={1} /></Field><Field label="New party notes"><input name="newPartyNotes" className={inputClass} /></Field></>}<Field label="Entry type"><select className={inputClass} value={nature} onChange={(event) => setNature(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></Field><Field label="Amount"><input className={inputClass} type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></Field><Field label="Entry date"><input className={inputClass} type="date" value={date} onChange={(event) => { setDate(event.target.value); if (!period) setPeriod(event.target.value.slice(0, 7)) }} required /></Field><Field label="Month / period"><input className={inputClass} type="month" value={period} onChange={(event) => setPeriod(event.target.value)} required /></Field>{needsCash && <Field label="Payment mode"><select className={inputClass} value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)}><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Card</option></select></Field>}<Field label="Reference optional"><input name="reference" className={inputClass} /></Field><Field label="Description"><input name="description" className={inputClass} placeholder={`${nature}${selectedParty ? ` - ${selectedParty.name}` : ''}`} /></Field><Field label="Remarks optional"><input name="remarks" className={inputClass} /></Field><div className="md:col-span-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"><b>One save only:</b> ledger, payable balance, category, expense and cashbook will be linked automatically according to the selected entry type.</div>{error && <p className="md:col-span-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="md:col-span-2 flex justify-end gap-2"><SmallButton tone="soft" onClick={onClose}>Cancel</SmallButton><button type="submit" className="min-h-10 rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white">Save Entry</button></div></form></Modal>
}

export function AccountsLedgersPanel({ data, branch, updateData, role, currentUser, isAdmin, onAddEntry }: { data: AppData; branch: Branch; updateData: UpdateData; role: Role; currentUser: User; isAdmin: boolean; onAddEntry: () => void }) {
  const categories = data.categories.filter((category) => category.branchId === branch.id)
  const parties = data.ledgerParties.filter((party) => party.branchId === branch.id)
  const entries = data.ledgerEntries.filter((entry) => entry.branchId === branch.id)
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('Active')
  const [selectedPartyId, setSelectedPartyId] = useState(parties[0]?.id || '')
  const [showPartyModal, setShowPartyModal] = useState(false)
  const [editingParty, setEditingParty] = useState<LedgerParty | undefined>()

  useEffect(() => {
    if (!selectedPartyId && parties[0]) setSelectedPartyId(parties[0].id)
  }, [parties, selectedPartyId])

  const partyBalance = (partyId: string) => entries.filter((entry) => entry.partyId === partyId).reduce((sum, entry) => sum + entry.debitAmount - entry.creditAmount, 0)
  const filtered = parties.filter((party) => (categoryFilter === 'All' || party.categoryId === categoryFilter) && (statusFilter === 'All' || party.status === statusFilter))
  const totalPayable = parties.reduce((sum, party) => sum + Math.max(0, partyBalance(party.id)), 0)
  const staffAdvance = parties.filter((party) => party.type === 'Staff').reduce((sum, party) => sum + Math.max(0, -partyBalance(party.id)), 0)
  const paidThisMonth = entries.filter((entry) => entry.date.startsWith(currentPeriod()) && entry.creditAmount > 0 && entry.cashbookId).reduce((sum, entry) => sum + entry.creditAmount, 0)
  const selected = parties.find((party) => party.id === selectedPartyId)
  const selectedEntries = selected ? entries.filter((entry) => entry.partyId === selected.id).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || '')) : []
  let running = 0
  const runningRows = selectedEntries.map((entry) => {
    running += entry.debitAmount - entry.creditAmount
    return { ...entry, running }
  }).reverse()

  const saveParty = (party: LedgerParty) => {
    const exists = data.ledgerParties.some((item) => item.id === party.id)
    updateData(
      (previous) => ({ ...previous, ledgerParties: exists ? previous.ledgerParties.map((item) => item.id === party.id ? party : item) : [party, ...previous.ledgerParties] }),
      exists ? 'Edit Ledger Party' : 'Add Ledger Party',
      'Accounts & Ledgers',
      `${role} ${currentUser.name} ${exists ? 'updated' : 'added'} ${party.type.toLowerCase()} ${party.name}.`,
    )
    setSelectedPartyId(party.id)
  }

  const changeStatus = (party: LedgerParty, status: LedgerParty['status']) => {
    updateData(
      (previous) => ({ ...previous, ledgerParties: previous.ledgerParties.map((item) => item.id === party.id ? { ...item, status, leftDate: status === 'Active' ? undefined : currentDate() } : item) }),
      status === 'Active' ? 'Reactivate Ledger Party' : 'Mark Ledger Party Left',
      'Accounts & Ledgers',
      `${role} ${currentUser.name} changed ${party.name} status to ${status}. Complete ledger history was preserved.`,
    )
  }

  const deleteEntry = (entry: LedgerEntry) => {
    if (!isAdmin || !confirm(`Delete ${entry.nature} of ${inr(entry.amount)}? Linked cashbook and expense rows will also be removed.`)) return
    updateData(
      (previous) => ({
        ...previous,
        ledgerEntries: previous.ledgerEntries.filter((item) => item.id !== entry.id),
        cashbook: previous.cashbook.filter((item) => item.id !== entry.cashbookId),
        expenses: previous.expenses.filter((item) => item.id !== entry.expenseId),
      }),
      'Delete Ledger Entry',
      'Accounts & Ledgers',
      `${role} ${currentUser.name} deleted ${entry.nature} of ${inr(entry.amount)}.`,
    )
  }

  return <div className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">Accounts & Ledgers</h2><p className="text-sm text-slate-500">Staff salary, advances, vendors, ration, milk, water and building rent linked with existing categories.</p></div><div className="flex flex-wrap gap-2"><SmallButton tone="green" onClick={onAddEntry}><Plus size={16} /> Add Entry</SmallButton>{isAdmin && <SmallButton tone="blue" onClick={() => { setEditingParty(undefined); setShowPartyModal(true) }}><Users size={16} /> Add Staff / Vendor</SmallButton>}</div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-lg border border-slate-300 bg-white p-4"><WalletCards className="text-rose-600" /><p className="mt-2 text-sm text-slate-500">Total payable</p><p className="text-2xl font-black text-rose-700">{inr(totalPayable)}</p></div><div className="rounded-lg border border-slate-300 bg-white p-4"><ReceiptText className="text-orange-600" /><p className="mt-2 text-sm text-slate-500">Staff advance / recoverable</p><p className="text-2xl font-black text-orange-700">{inr(staffAdvance)}</p></div><div className="rounded-lg border border-slate-300 bg-white p-4"><WalletCards className="text-emerald-600" /><p className="mt-2 text-sm text-slate-500">Paid this month</p><p className="text-2xl font-black text-emerald-700">{inr(paidThisMonth)}</p></div><div className="rounded-lg border border-slate-300 bg-white p-4"><Building2 className="text-blue-600" /><p className="mt-2 text-sm text-slate-500">Active accounts</p><p className="text-2xl font-black">{parties.filter((party) => party.status === 'Active').length}</p></div></div><div className="flex flex-wrap gap-3"><select className={inputClass} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="All">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Active</option><option>Left</option><option>Inactive</option><option>All</option></select></div><div className="overflow-hidden rounded-lg border border-slate-300 bg-white"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Party</th><th className="p-3">Type</th><th className="p-3">Category</th><th className="p-3">Monthly</th><th className="p-3">Current balance</th><th className="p-3">Advance this month</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{filtered.map((party) => { const balance = partyBalance(party.id); const advance = entries.filter((entry) => entry.partyId === party.id && entry.period === currentPeriod() && entry.nature === 'Advance Given').reduce((sum, entry) => sum + entry.creditAmount, 0); return <tr key={party.id} className="border-t border-slate-100"><td className="p-3 font-bold">{party.name}<div className="text-xs font-normal text-slate-500">{party.phone || '-'}</div></td><td className="p-3">{party.type}</td><td className="p-3">{categories.find((category) => category.id === party.categoryId)?.name || 'Uncategorized'}</td><td className="p-3">{inr(party.monthlyAmount)}</td><td className={`p-3 font-bold ${balance > 0 ? 'text-rose-700' : balance < 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{balance > 0 ? `Dena ${inr(balance)}` : balance < 0 ? `Advance ${inr(balance)}` : 'Clear'}</td><td className="p-3">{inr(advance)}</td><td className="p-3">{party.status}</td><td className="p-3"><div className="flex min-w-max gap-1"><button title="View ledger" onClick={() => setSelectedPartyId(party.id)} className="grid h-8 w-8 place-items-center rounded border border-slate-300"><Eye size={14} /></button>{isAdmin && <><button title="Edit" onClick={() => { setEditingParty(party); setShowPartyModal(true) }} className="grid h-8 w-8 place-items-center rounded border border-slate-300"><Edit3 size={14} /></button>{party.status === 'Active' ? <button title="Mark left/inactive" onClick={() => changeStatus(party, party.type === 'Staff' ? 'Left' : 'Inactive')} className="grid h-8 w-8 place-items-center rounded border border-rose-200 text-rose-600"><UserMinus size={14} /></button> : <button title="Reactivate" onClick={() => changeStatus(party, 'Active')} className="grid h-8 w-8 place-items-center rounded border border-emerald-200 text-emerald-600"><RotateCcw size={14} /></button>}</>}</div></td></tr>})}{!filtered.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No linked staff/vendor accounts yet.</td></tr>}</tbody></table></div></div>{selected && <div className="grid gap-4 rounded-lg border border-slate-300 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black">{selected.name}</h3><p className="text-sm text-slate-500">{selected.type} · Joined/started {showDate(selected.joiningDate)} · Due day {selected.dueDay}</p></div><div className="text-right"><p className="text-xs text-slate-500">Running balance</p><p className={`text-2xl font-black ${partyBalance(selected.id) > 0 ? 'text-rose-700' : partyBalance(selected.id) < 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{partyBalance(selected.id) > 0 ? `Dena ${inr(partyBalance(selected.id))}` : partyBalance(selected.id) < 0 ? `Advance ${inr(partyBalance(selected.id))}` : 'Clear'}</p></div></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Month</th><th className="p-3">Entry</th><th className="p-3">Bill/Salary Due</th><th className="p-3">Paid/Advance/Adjustment</th><th className="p-3">Running balance</th><th className="p-3">Mode</th><th className="p-3">Description</th>{isAdmin && <th className="p-3">Action</th>}</tr></thead><tbody>{runningRows.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="p-3">{showDate(entry.date)}</td><td className="p-3">{showMonth(entry.period)}</td><td className="p-3 font-semibold">{entry.nature}</td><td className="p-3 text-rose-700">{entry.debitAmount ? inr(entry.debitAmount) : '-'}</td><td className="p-3 text-emerald-700">{entry.creditAmount ? inr(entry.creditAmount) : '-'}</td><td className="p-3 font-bold">{entry.running > 0 ? inr(entry.running) : entry.running < 0 ? `-${inr(entry.running)}` : '₹0'}</td><td className="p-3">{entry.paymentMode || '-'}</td><td className="p-3">{entry.description || '-'}</td>{isAdmin && <td className="p-3"><button title="Delete linked entry" onClick={() => deleteEntry(entry)} className="grid h-8 w-8 place-items-center rounded border border-rose-200 text-rose-600"><Trash2 size={14} /></button></td>}</tr>)}{!runningRows.length && <tr><td colSpan={isAdmin ? 9 : 8} className="p-6 text-center text-slate-500">No ledger entries yet. Use Add Entry.</td></tr>}</tbody></table></div></div>}{showPartyModal && <PartyModal party={editingParty} categories={categories} branchId={branch.id} onClose={() => setShowPartyModal(false)} onSave={saveParty} />}</div>
}
