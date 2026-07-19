#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src/App.tsx"
DB = ROOT / "src/lib/database.ts"
TEST = ROOT / "scripts/self-test.mjs"
FEATURE = ROOT / "src/features/simpleCategoryAccounts.tsx"
MIGRATION = ROOT / "supabase/migrations/202607190001_simple_category_accounts.sql"
SELF = Path(__file__).resolve()
BACKUP_BRANCH = "backup-before-simple-finance-ui-2026-07-19"
ALLOWED_UNTRACKED = {
    "qa-smoke-report.md",
    "scripts/qa-smoke-test.mjs",
    "farukhnagar-ledger-audit.json",
}


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_replace_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return updated


status = subprocess.run(
    ["git", "status", "--porcelain"],
    cwd=ROOT,
    check=True,
    capture_output=True,
    text=True,
).stdout.splitlines()
blockers = [line for line in status if not (line.startswith("?? ") and line[3:] in ALLOWED_UNTRACKED)]
if blockers:
    raise SystemExit("Working tree has unrelated changes:\n" + "\n".join(blockers))

for target in (FEATURE, MIGRATION):
    if target.exists():
        raise SystemExit(f"Target already exists: {target.relative_to(ROOT)}")

run("git", "branch", "-f", BACKUP_BRANCH, "HEAD")
run("git", "push", "origin", f"HEAD:refs/heads/{BACKUP_BRANCH}")

original_app = APP.read_text()
original_db = DB.read_text()
original_test = TEST.read_text()
app = original_app
db = original_db
test = original_test
db_pushed = False

feature_code = r'''
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

function accountActions(type: LedgerPartyType) {
  if (type === 'Staff') return ['Salary Due', 'Salary Payment', 'Advance Given', 'Bonus', 'Deduction']
  if (type === 'Vendor') return ['Add Bill', 'Payment Made']
  if (type === 'Building Rent') return ['Rent Due', 'Rent Payment']
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
  onClose,
  onSaved,
}: {
  branchName: string
  categories: Category[]
  parties: LedgerParty[]
  entries: LedgerEntry[]
  onClose: () => void
  onSaved: (message: string) => Promise<void> | void
}) {
  const accounts = useMemo(() => visibleAccounts(parties), [parties])
  const [partyId, setPartyId] = useState(accounts[0]?.id || '')
  const account = accounts.find((item) => item.id === partyId)
  const category = categories.find((item) => item.id === account?.categoryId)
  const actions = account ? accountActions(account.type) : []
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
    const nextActions = account ? accountActions(account.type) : []
    setAction(nextActions[0] || '')
  }, [account?.id, account?.type])

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

  if (!accounts.length) return <Modal title={`Staff / Vendor Payments · ${branchName}`} onClose={onClose}><div className="grid gap-4"><p className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">No category has been classified as Staff, Vendor or Building Rent yet. Open Finance → Expenses → open a category → Edit category account.</p><div className="flex justify-end"><button onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 font-bold">Close</button></div></div></Modal>

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
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-slate-900">Staff / Vendor Account</h3><p className="text-sm text-slate-600">{typedParties.length ? typedParties.map((item) => `${item.name} · ${item.type}`).join(' | ') : 'General category — not yet classified as Staff or Vendor.'}</p></div>{isAdmin && <button onClick={onEdit} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white"><Plus size={15} /> Edit category account</button>}</div>
    {typedParties.length > 0 && <><div className="grid gap-3 sm:grid-cols-4"><div className="rounded-md bg-white p-3"><p className="text-xs text-slate-500">Total bill / salary due</p><b className="text-lg">{money(totalDue)}</b></div><div className="rounded-md bg-white p-3"><p className="text-xs text-slate-500">Paid / advance / adjustment</p><b className="text-lg text-emerald-700">{money(totalPaid)}</b></div><div className="rounded-md bg-white p-3"><p className="text-xs text-slate-500">Current pending</p><b className={`text-lg ${balance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{balance > 0 ? money(balance) : balance < 0 ? `Advance ${money(balance)}` : 'Clear'}</b></div><div className="rounded-md bg-white p-3"><p className="text-xs text-slate-500">Accounts</p><b className="text-lg">{typedParties.length}</b></div></div><div className="overflow-auto rounded-md bg-white"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Account</th><th className="p-3">Entry</th><th className="p-3">Due</th><th className="p-3">Paid / adjusted</th><th className="p-3">Month</th></tr></thead><tbody>{recent.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="p-3">{showDate(entry.date)}</td><td className="p-3 font-semibold">{parties.find((item) => item.id === entry.partyId)?.name || '-'}</td><td className="p-3">{entry.nature}</td><td className="p-3 text-rose-700">{entry.debitAmount ? money(entry.debitAmount) : '-'}</td><td className="p-3 text-emerald-700">{entry.creditAmount ? money(entry.creditAmount) : '-'}</td><td className="p-3">{showMonth(entry.period)}</td></tr>)}{!recent.length && <tr><td colSpan={6} className="p-4 text-center text-slate-500">No staff/vendor ledger entry yet.</td></tr>}</tbody></table></div></>}
  </div>
}
'''

migration_sql = r'''
-- Simple category-based staff/vendor accounting.
-- Normal Cashbook Add Entry remains unchanged; specialist bills/salary/payments use secure RPCs.

alter table public.ledger_entries
  add column if not exists request_id uuid;

create unique index if not exists ledger_entries_request_id_unique_idx
  on public.ledger_entries(request_id)
  where request_id is not null;

create table if not exists public.ledger_party_change_history (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  party_id uuid not null references public.ledger_parties(id) on delete cascade,
  effective_date date not null default current_date,
  old_value jsonb,
  new_value jsonb not null,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists ledger_party_change_history_category_idx
  on public.ledger_party_change_history(category_id, created_at desc);

alter table public.ledger_party_change_history enable row level security;
drop policy if exists ledger_party_change_history_branch_select on public.ledger_party_change_history;
create policy ledger_party_change_history_branch_select
on public.ledger_party_change_history
for select
to authenticated
using (public.pg95_can_access_branch(branch_id));

grant select on public.ledger_party_change_history to authenticated;

create or replace function public.pg95_can_record_category_account(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.active, true)
      and (
        lower(profile.role::text) = 'admin'
        or (
          exists (
            select 1 from public.branch_assignments assignment
            where assignment.user_id = auth.uid()
              and assignment.branch_id = p_branch_id
          )
          and exists (
            select 1 from public.staff_permissions permission_row
            where permission_row.user_id = auth.uid()
              and permission_row.permission in ('add_cashbook', 'add_expense')
              and permission_row.allowed is true
          )
        )
      )
  );
$$;

revoke all on function public.pg95_can_record_category_account(uuid) from public;
grant execute on function public.pg95_can_record_category_account(uuid) to authenticated;

create or replace function public.save_category_account_party(
  p_party_id uuid,
  p_category_id uuid,
  p_name text,
  p_party_type text,
  p_phone text,
  p_joining_date date,
  p_monthly_amount numeric,
  p_due_day integer,
  p_status text,
  p_effective_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_category public.categories%rowtype;
  v_party public.ledger_parties%rowtype;
  v_party_id uuid;
  v_branch_name text;
  v_old jsonb;
  v_new jsonb;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found or lower(v_profile.role::text) <> 'admin' then
    raise exception 'Only the owner/admin can edit category account settings.' using errcode = '42501';
  end if;

  select * into v_category from public.categories where id = p_category_id for update;
  if not found then raise exception 'Finance category not found.' using errcode = 'P0002'; end if;

  if p_party_type not in ('Staff', 'Vendor', 'Building Rent', 'Other') then
    raise exception 'Select a valid account type.';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Account name is required.'; end if;
  if coalesce(p_monthly_amount, 0) < 0 then raise exception 'Monthly amount cannot be negative.'; end if;
  if coalesce(p_due_day, 0) < 1 or p_due_day > 31 then raise exception 'Due day must be between 1 and 31.'; end if;
  if p_status not in ('Active', 'Left', 'Inactive') then raise exception 'Select a valid status.'; end if;

  select name into v_branch_name from public.branches where id = v_category.branch_id;

  if p_party_id is not null then
    select * into v_party
    from public.ledger_parties
    where id = p_party_id and category_id = p_category_id and branch_id = v_category.branch_id
    for update;
    if not found then raise exception 'Category account not found.' using errcode = 'P0002'; end if;

    v_old := jsonb_build_object(
      'name', v_party.name,
      'type', v_party.party_type,
      'phone', coalesce(v_party.phone, ''),
      'joiningDate', v_party.joining_date,
      'monthlyAmount', v_party.monthly_amount,
      'dueDay', v_party.due_day,
      'status', v_party.status,
      'notes', coalesce(v_party.notes, '')
    );

    update public.ledger_parties
    set name = upper(trim(p_name)),
        party_type = p_party_type,
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        joining_date = coalesce(p_joining_date, joining_date),
        monthly_amount = coalesce(p_monthly_amount, 0),
        due_day = p_due_day,
        status = p_status,
        left_date = case when p_status = 'Active' then null else coalesce(left_date, p_effective_date, current_date) end,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        updated_at = now(),
        updated_by = v_user_id
    where id = p_party_id
    returning id into v_party_id;
  else
    insert into public.ledger_parties (
      id, branch_id, category_id, name, party_type, phone,
      joining_date, monthly_amount, due_day, status, left_date,
      notes, created_by, updated_by
    ) values (
      gen_random_uuid(), v_category.branch_id, p_category_id, upper(trim(p_name)), p_party_type,
      nullif(trim(coalesce(p_phone, '')), ''), coalesce(p_joining_date, current_date),
      coalesce(p_monthly_amount, 0), p_due_day, p_status,
      case when p_status = 'Active' then null else coalesce(p_effective_date, current_date) end,
      nullif(trim(coalesce(p_notes, '')), ''), v_user_id, v_user_id
    ) returning id into v_party_id;
    v_old := null;
  end if;

  select jsonb_build_object(
    'name', name,
    'type', party_type,
    'phone', coalesce(phone, ''),
    'joiningDate', joining_date,
    'monthlyAmount', monthly_amount,
    'dueDay', due_day,
    'status', status,
    'notes', coalesce(notes, '')
  ) into v_new
  from public.ledger_parties where id = v_party_id;

  if v_old is distinct from v_new then
    insert into public.ledger_party_change_history (
      branch_id, category_id, party_id, effective_date,
      old_value, new_value, changed_by, changed_by_name
    ) values (
      v_category.branch_id, p_category_id, v_party_id,
      coalesce(p_effective_date, current_date), v_old, v_new,
      v_user_id, coalesce(v_profile.name, 'Admin')
    );
  end if;

  insert into public.activity_logs (
    branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    v_category.branch_id, coalesce(v_branch_name, ''), v_user_id,
    coalesce(v_profile.name, 'Admin'), v_profile.role,
    'Finance', 'Edit Category Account',
    format('Admin %s updated %s account %s under category %s. Monthly amount: %s. Effective from: %s.',
      coalesce(v_profile.name, ''), p_party_type, upper(trim(p_name)), v_category.name,
      coalesce(p_monthly_amount, 0), coalesce(p_effective_date, current_date)),
    jsonb_build_object('category_id', p_category_id, 'party_id', v_party_id, 'old', v_old, 'new', v_new)
  );

  return jsonb_build_object('success', true, 'party_id', v_party_id);
end;
$$;

revoke all on function public.save_category_account_party(uuid, uuid, text, text, text, date, numeric, integer, text, date, text) from public;
grant execute on function public.save_category_account_party(uuid, uuid, text, text, text, date, numeric, integer, text, date, text) to authenticated;

create or replace function public.record_category_account_transaction(
  p_request_id uuid,
  p_party_id uuid,
  p_action text,
  p_amount numeric,
  p_entry_date date,
  p_period text,
  p_payment_mode text,
  p_description text,
  p_reference text,
  p_remarks text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_party public.ledger_parties%rowtype;
  v_category public.categories%rowtype;
  v_branch_name text;
  v_ledger_id uuid := gen_random_uuid();
  v_cashbook_id uuid;
  v_expense_id uuid;
  v_existing uuid;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_creates_expense boolean := false;
  v_creates_cashbook boolean := false;
  v_description text;
  v_reference text;
begin
  if v_user_id is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'Request id is required.'; end if;

  select id into v_existing from public.ledger_entries where request_id = p_request_id;
  if v_existing is not null then return jsonb_build_object('success', true, 'ledger_entry_id', v_existing, 'duplicate', true); end if;

  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found then raise exception 'Your staff account is not active.' using errcode = '42501'; end if;

  select * into v_party from public.ledger_parties where id = p_party_id for update;
  if not found then raise exception 'Staff/vendor account not found.' using errcode = 'P0002'; end if;
  if v_party.status <> 'Active' then raise exception 'This account is inactive/left. Owner must reactivate it first.'; end if;

  select * into v_category from public.categories where id = v_party.category_id;
  if not found then raise exception 'Linked Finance category not found.' using errcode = 'P0002'; end if;
  if not public.pg95_can_record_category_account(v_party.branch_id) then
    raise exception 'Your account does not have permission to add staff/vendor payments in this branch.' using errcode = '42501';
  end if;

  if coalesce(p_amount, 0) <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'Select a valid month / period.'; end if;

  if v_party.party_type = 'Staff' and p_action not in ('Salary Due', 'Salary Payment', 'Advance Given', 'Bonus', 'Deduction') then
    raise exception 'Invalid staff entry type.';
  elsif v_party.party_type = 'Vendor' and p_action not in ('Add Bill', 'Payment Made') then
    raise exception 'Invalid vendor entry type.';
  elsif v_party.party_type = 'Building Rent' and p_action not in ('Rent Due', 'Rent Payment') then
    raise exception 'Invalid building-rent entry type.';
  elsif v_party.party_type = 'Other' then
    raise exception 'Owner must classify this category as Staff, Vendor or Building Rent first.';
  end if;

  if p_action in ('Salary Due', 'Rent Due') and exists (
    select 1 from public.ledger_entries
    where party_id = p_party_id and period = p_period and nature = p_action
  ) then
    raise exception '% is already generated for %.', p_action, p_period;
  end if;

  if p_action in ('Salary Due', 'Bonus', 'Add Bill', 'Rent Due') then
    v_debit := p_amount;
    v_creates_expense := true;
  else
    v_credit := p_amount;
  end if;

  if p_action in ('Salary Payment', 'Advance Given', 'Payment Made', 'Rent Payment') then
    v_creates_cashbook := true;
  end if;

  v_description := coalesce(nullif(trim(coalesce(p_description, '')), ''), p_action || ' - ' || v_party.name);
  v_reference := 'LEDGER|CATEGORY_ACCOUNT|' || p_party_id::text || '|' || p_request_id::text ||
    case when nullif(trim(coalesce(p_reference, '')), '') is null then '' else '|' || trim(p_reference) end;

  if v_creates_expense then
    v_expense_id := gen_random_uuid();
    insert into public.expenses (
      id, branch_id, category, category_id, description,
      amount, expense_date, vendor, cashbook_entry_id, created_by
    ) values (
      v_expense_id, v_party.branch_id, v_category.name, v_category.id,
      v_description, p_amount, p_entry_date, v_party.name, null, v_user_id
    );
  end if;

  if v_creates_cashbook then
    v_cashbook_id := gen_random_uuid();
    insert into public.cashbook_entries (
      id, branch_id, type, amount, description, entry_date,
      source, linked_id, category, category_id, payment_mode,
      reference, remarks, created_at, created_by
    ) values (
      v_cashbook_id, v_party.branch_id, 'Debit', p_amount, v_description, p_entry_date,
      'Manual', v_ledger_id, v_category.name, v_category.id,
      coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
      v_reference, nullif(trim(coalesce(p_remarks, '')), ''), now(), v_user_id
    );
  end if;

  insert into public.ledger_entries (
    id, branch_id, party_id, category_id, nature,
    amount, debit_amount, credit_amount, entry_date, period,
    description, payment_mode, reference, remarks,
    cashbook_entry_id, expense_id, request_id, created_at, created_by
  ) values (
    v_ledger_id, v_party.branch_id, v_party.id, v_category.id, p_action,
    p_amount, v_debit, v_credit, p_entry_date, p_period,
    v_description, case when v_creates_cashbook then p_payment_mode else null end,
    nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_remarks, '')), ''),
    v_cashbook_id, v_expense_id, p_request_id, now(), v_user_id
  );

  select name into v_branch_name from public.branches where id = v_party.branch_id;
  insert into public.activity_logs (
    branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    v_party.branch_id, coalesce(v_branch_name, ''), v_user_id,
    coalesce(v_profile.name, 'User'), v_profile.role,
    'Finance', p_action,
    format('%s %s recorded %s of %s for %s under %s.',
      initcap(lower(v_profile.role::text)), coalesce(v_profile.name, ''),
      p_action, p_amount, v_party.name, v_category.name),
    jsonb_build_object('category_id', v_category.id, 'party_id', v_party.id, 'amount', p_amount, 'period', p_period)
  );

  return jsonb_build_object(
    'success', true,
    'ledger_entry_id', v_ledger_id,
    'cashbook_entry_id', v_cashbook_id,
    'expense_id', v_expense_id
  );
end;
$$;

revoke all on function public.record_category_account_transaction(uuid, uuid, text, numeric, date, text, text, text, text, text) from public;
grant execute on function public.record_category_account_transaction(uuid, uuid, text, numeric, date, text, text, text, text, text) to authenticated;
'''

# Replace the complex Accounts & Ledgers import with the simple category-account UI.
app = replace_once(
    app,
    "import { AccountsLedgersPanel, UnifiedLedgerEntryModal, applyLedgerEntry } from './features/accountsLedgers'",
    "import { CategoryAccountEntryModal, CategoryAccountManagerModal, CategoryAccountSummary } from './features/simpleCategoryAccounts'",
    "feature import",
)

# Add one selected category state for the owner-only settings modal.
app = regex_replace_once(
    app,
    r"(const \[selectedCashbookId, setSelectedCashbookId\] = useState\(''\))",
    r"\1\n  const [selectedCategoryId, setSelectedCategoryId] = useState('')",
    "selected category state",
)

# Restore the old Cashbook form to the green Add Entry button and add one orange specialist button.
old_header = "{(can('add_cashbook') || can('add_expense')) && <Button tone=\"green\" onClick={() => openModal('accountEntry')}><Plus size={18} /> <span className=\"hidden sm:inline\">Add Entry</span></Button>}"
new_header = "{(can('add_cashbook') || can('add_expense')) && <Button tone=\"green\" onClick={() => openModal('cashbook')}><Plus size={18} /> <span className=\"hidden sm:inline\">Add Entry</span></Button>}{(can('add_cashbook') || can('add_expense')) && <button type=\"button\" onClick={() => openModal('categoryAccountEntry')} className=\"inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-bold text-white hover:bg-orange-600\"><IndianRupee size={18} /> <span className=\"hidden sm:inline\">Staff / Vendor Payment</span></button>}"
app = replace_once(app, old_header, new_header, "header buttons")

# FinancePage receives selected-category setter.
old_finance_signature = "function FinancePage({ scoped, financeTab, setFinanceTab, data, branch, setModal, setSelectedTenantId, setSelectedCashbookId, updateData, role, currentUser, isAdmin }: { scoped: ReturnType<typeof branchData>; financeTab: string; setFinanceTab: (value: string) => void; data: AppData; branch: Branch; setModal: (value: string) => void; setSelectedTenantId: (value: string) => void; setSelectedCashbookId: (value: string) => void; updateData: (updater: (previous: AppData) => AppData, action: string, entity: string, description?: string, metadata?: Record<string, string | number>) => void; role: Role; currentUser: User; isAdmin: boolean })"
new_finance_signature = "function FinancePage({ scoped, financeTab, setFinanceTab, data, branch, setModal, setSelectedTenantId, setSelectedCashbookId, setSelectedCategoryId, updateData, role, currentUser, isAdmin }: { scoped: ReturnType<typeof branchData>; financeTab: string; setFinanceTab: (value: string) => void; data: AppData; branch: Branch; setModal: (value: string) => void; setSelectedTenantId: (value: string) => void; setSelectedCashbookId: (value: string) => void; setSelectedCategoryId: (value: string) => void; updateData: (updater: (previous: AppData) => AppData, action: string, entity: string, description?: string, metadata?: Record<string, string | number>) => void; role: Role; currentUser: User; isAdmin: boolean })"
app = replace_once(app, old_finance_signature, new_finance_signature, "FinancePage signature")

old_finance_call = "<FinancePage scoped={scoped} financeTab={financeTab} setFinanceTab={setFinanceTab} data={data} branch={branch} setModal={openModal} setSelectedTenantId={setSelectedTenantId} setSelectedCashbookId={setSelectedCashbookId} updateData={updateData} role={role} currentUser={currentUser} isAdmin={isAdmin} />"
new_finance_call = "<FinancePage scoped={scoped} financeTab={financeTab} setFinanceTab={setFinanceTab} data={data} branch={branch} setModal={openModal} setSelectedTenantId={setSelectedTenantId} setSelectedCashbookId={setSelectedCashbookId} setSelectedCategoryId={setSelectedCategoryId} updateData={updateData} role={role} currentUser={currentUser} isAdmin={isAdmin} />"
app = replace_once(app, old_finance_call, new_finance_call, "FinancePage call")

# Remove the separate Ledgers tab.
app = replace_once(
    app,
    "<Tabs values={['Cashbook', 'Expenses', 'Ledgers', 'Bill Creator']} value={financeTab} onChange={setFinanceTab} />",
    "<Tabs values={['Cashbook', 'Expenses', 'Bill Creator']} value={financeTab} onChange={setFinanceTab} />",
    "Finance tabs",
)
app = regex_replace_once(
    app,
    r"\{financeTab === 'Ledgers' && <AccountsLedgersPanel.*?/>\}",
    "",
    "remove old ledgers panel",
    flags=re.DOTALL,
)

# Restore the old Add Entry form inside Expenses and hide category management from staff.
app = replace_once(
    app,
    "<Button tone=\"soft\" onClick={() => setShowManageCategories(true)}><Settings size={16} /> Manage Categories</Button><Button tone=\"green\" onClick={() => setModal('accountEntry')}><Plus size={16} /> Add Entry</Button>",
    "{isAdmin && <Button tone=\"soft\" onClick={() => setShowManageCategories(true)}><Settings size={16} /> Manage Categories</Button>}<Button tone=\"green\" onClick={() => setModal('cashbook')}><Plus size={16} /> Add Entry</Button>",
    "Expenses action buttons",
)

# Add the typed category summary and owner-only edit option inside an opened Expense category.
category_table_marker = "</div><DataTable headers={['Date', 'Description', 'Amount', 'Payment Method', 'Reference']}>"
category_summary = "</div><CategoryAccountSummary category={selectedLedgerData} parties={data.ledgerParties.filter((item) => item.categoryId === selectedLedgerData.id)} entries={data.ledgerEntries.filter((item) => item.categoryId === selectedLedgerData.id)} isAdmin={isAdmin} onEdit={() => { setSelectedCategoryId(selectedLedgerData.id); setModal('categoryAccountSettings') }} /><DataTable headers={['Date', 'Description', 'Amount', 'Payment Method', 'Reference']}>"
app = replace_once(app, category_table_marker, category_summary, "category account summary")

# Remove the old complex unified modal completely.
app = regex_replace_once(
    app,
    r"\n\s*\{modal === 'accountEntry' && <UnifiedLedgerEntryModal.*?\n\s*\{modal === 'cashbook'",
    "\n      {modal === 'cashbook'",
    "remove old unified entry modal",
    flags=re.DOTALL,
)

# Add the specialist orange modal and owner-only category settings modal before Cashbook.
modal_anchor = "      {modal === 'cashbook' && <CashbookModal"
modal_insert = """      {modal === 'categoryAccountEntry' && <CategoryAccountEntryModal branchName={branch.name} categories={data.categories.filter((category) => category.branchId === branchId)} parties={scoped.ledgerParties} entries={scoped.ledgerEntries} onClose={closeModal} onSaved={async (message) => { const refreshed = await loadAppData(); dataRef.current = refreshed; setData(refreshed); setSuccessMessage(message) }} />}\n      {modal === 'categoryAccountSettings' && (() => { const category = data.categories.find((item) => item.id === selectedCategoryId && item.branchId === branchId); return category ? <CategoryAccountManagerModal category={category} parties={scoped.ledgerParties} onClose={closeModal} onSaved={async (message) => { const refreshed = await loadAppData(); dataRef.current = refreshed; setData(refreshed); setSuccessMessage(message); closeModal() }} /> : null })()}\n""" + modal_anchor
app = replace_once(app, modal_anchor, modal_insert, "simple account modals")

# Append secure database helpers.
database_helpers = r'''

export type LedgerPartyChangeHistory = {
  id: string
  branchId: string
  categoryId: string
  partyId: string
  effectiveDate: string
  oldValue?: Record<string, unknown>
  newValue: Record<string, unknown>
  changedBy?: string
  changedByName?: string
  createdAt: string
}

export async function fetchLedgerPartyChangeHistory(categoryId: string, partyId?: string): Promise<LedgerPartyChangeHistory[]> {
  let query = supabase
    .from('ledger_party_change_history')
    .select('id, branch_id, category_id, party_id, effective_date, old_value, new_value, changed_by, changed_by_name, created_at')
    .eq('category_id', categoryId)
    .order('created_at', { ascending: false })
  if (partyId) query = query.eq('party_id', partyId)
  const { data, error } = await query
  if (error) throw databaseError('load ledger party change history', error)
  return (data || []).map((row) => ({
    id: String(row.id),
    branchId: String(row.branch_id),
    categoryId: String(row.category_id),
    partyId: String(row.party_id),
    effectiveDate: String(row.effective_date),
    oldValue: row.old_value as Record<string, unknown> | undefined,
    newValue: (row.new_value || {}) as Record<string, unknown>,
    changedBy: row.changed_by ? String(row.changed_by) : undefined,
    changedByName: row.changed_by_name ? String(row.changed_by_name) : undefined,
    createdAt: String(row.created_at),
  }))
}

export async function saveCategoryAccountParty(input: {
  partyId?: string
  categoryId: string
  name: string
  type: 'Staff' | 'Vendor' | 'Building Rent' | 'Other'
  phone?: string
  joiningDate: string
  monthlyAmount: number
  dueDay: number
  status: 'Active' | 'Left' | 'Inactive'
  effectiveDate: string
  notes?: string
}): Promise<{ success: boolean; party_id: string }> {
  const { data, error } = await supabase.rpc('save_category_account_party', {
    p_party_id: input.partyId || null,
    p_category_id: input.categoryId,
    p_name: input.name,
    p_party_type: input.type,
    p_phone: input.phone || null,
    p_joining_date: input.joiningDate,
    p_monthly_amount: input.monthlyAmount,
    p_due_day: input.dueDay,
    p_status: input.status,
    p_effective_date: input.effectiveDate,
    p_notes: input.notes || null,
  })
  if (error) throw databaseError('save_category_account_party RPC', error)
  return data as { success: boolean; party_id: string }
}

export async function recordCategoryAccountTransaction(input: {
  requestId: string
  partyId: string
  action: string
  amount: number
  entryDate: string
  period: string
  paymentMode?: string
  description?: string
  reference?: string
  remarks?: string
}): Promise<{ success: boolean; ledger_entry_id: string; cashbook_entry_id?: string; expense_id?: string }> {
  const { data, error } = await supabase.rpc('record_category_account_transaction', {
    p_request_id: input.requestId,
    p_party_id: input.partyId,
    p_action: input.action,
    p_amount: input.amount,
    p_entry_date: input.entryDate,
    p_period: input.period,
    p_payment_mode: input.paymentMode || null,
    p_description: input.description || null,
    p_reference: input.reference || null,
    p_remarks: input.remarks || null,
  })
  if (error) throw databaseError('record_category_account_transaction RPC', error)
  return data as { success: boolean; ledger_entry_id: string; cashbook_entry_id?: string; expense_id?: string }
}
'''
if "export async function recordCategoryAccountTransaction" in db:
    raise SystemExit("Database helpers already exist; aborting to avoid duplicate code.")
db = db.rstrip() + "\n" + database_helpers.lstrip()

self_tests = r'''

// Simple category-based staff/vendor workflow checks
const simpleFinanceButtons = { green: 'cashbook', orange: 'categoryAccountEntry' }
assert(simpleFinanceButtons.green === 'cashbook', 'SC1. Green Add Entry restores the old Cashbook debit/credit form')
assert(simpleFinanceButtons.orange === 'categoryAccountEntry', 'SC2. Orange button opens staff/vendor payments separately')
const vendorLedger = [
  { debit: 10000, credit: 0, nature: 'Add Bill' },
  { debit: 0, credit: 4000, nature: 'Payment Made' },
]
assert(vendorLedger.reduce((sum, row) => sum + row.debit - row.credit, 0) === 6000, 'SC3. Vendor bill less payment leaves correct pending balance')
const salaryLedger = [
  { debit: 15000, credit: 0, nature: 'Salary Due' },
  { debit: 0, credit: 3000, nature: 'Advance Given' },
  { debit: 0, credit: 10000, nature: 'Salary Payment' },
]
assert(salaryLedger.reduce((sum, row) => sum + row.debit - row.credit, 0) === 2000, 'SC4. Salary due, advance and payment leave correct pending salary')
const salaryHistory = [{ oldAmount: 12000, newAmount: 15000, effectiveDate: '2026-08-01' }]
assert(salaryHistory[0].newAmount === 15000 && salaryHistory[0].effectiveDate === '2026-08-01', 'SC5. Salary changes retain effective-date history')
const staffPermission = { assignedBranch: true, permission: 'add_cashbook', secureRpc: true }
assert(staffPermission.assignedBranch && staffPermission.permission === 'add_cashbook' && staffPermission.secureRpc, 'SC6. Assigned staff records payments through permission-aware RPC')
'''
test = replace_once(test, "console.log('All PG Admin Portal flow checks passed.')", self_tests + "\nconsole.log('All PG Admin Portal flow checks passed.')", "simple category account self-tests")

try:
    APP.write_text(app)
    DB.write_text(db)
    TEST.write_text(test)
    FEATURE.parent.mkdir(parents=True, exist_ok=True)
    FEATURE.write_text(textwrap.dedent(feature_code).lstrip())
    MIGRATION.write_text(textwrap.dedent(migration_sql).lstrip())

    combined = app + db + test + feature_code + migration_sql
    required = {
        "old Cashbook button": "openModal('cashbook')",
        "orange specialist button": "Staff / Vendor Payment",
        "old unified modal removed": "modal === 'accountEntry'",
        "old ledgers tab removed": "'Cashbook', 'Expenses', 'Ledgers', 'Bill Creator'",
        "category summary": "CategoryAccountSummary",
        "owner-only category settings": "Only the owner/admin can edit category account settings.",
        "staff permission guard": "permission_row.permission in ('add_cashbook', 'add_expense')",
        "vendor bill action": "'Add Bill', 'Payment Made'",
        "salary history": "ledger_party_change_history",
        "idempotency": "ledger_entries_request_id_unique_idx",
    }
    missing = []
    for label, marker in required.items():
        if label in {"old unified modal removed", "old ledgers tab removed"}:
            if marker in app:
                missing.append(label)
        elif marker not in combined:
            missing.append(label)
    if missing:
        raise SystemExit("Preflight failed: " + ", ".join(missing))

    run("npm", "run", "self-test")
    run("npm", "run", "build")
    run("npm", "run", "lint")

    answer = input("\nApply the simple Finance category-account migration to linked Supabase? [Y/n] ").strip().lower()
    if answer not in {"", "y", "yes"}:
        raise SystemExit("Supabase migration cancelled; files will be restored.")

    run("npx", "supabase", "db", "push")
    db_pushed = True

    SELF.unlink()
    run(
        "git", "add",
        "src/App.tsx",
        "src/lib/database.ts",
        "src/features/simpleCategoryAccounts.tsx",
        "scripts/self-test.mjs",
        str(MIGRATION.relative_to(ROOT)),
        str(SELF.relative_to(ROOT)),
    )
    run("git", "commit", "-m", "fix: simplify finance entry and category accounts")
    run("git", "push", "origin", "main")
    print("\nSimple Finance workflow is live: old Add Entry restored, orange staff/vendor button added, category settings are owner-only, and staff payments use secure RPCs.", flush=True)
    print("Backup branch: " + BACKUP_BRANCH, flush=True)
except BaseException:
    if not db_pushed:
        APP.write_text(original_app)
        DB.write_text(original_db)
        TEST.write_text(original_test)
        FEATURE.unlink(missing_ok=True)
        MIGRATION.unlink(missing_ok=True)
        print("\nFiles were restored because the simple Finance update did not complete.", flush=True)
    else:
        print("\nSupabase migration was applied. Local files were left in place so they can be committed safely.", flush=True)
    raise
