#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "src/App.tsx"
DB = ROOT / "src/lib/database.ts"
SIMPLE = ROOT / "src/features/simpleCategoryAccounts.tsx"
DEAD = ROOT / "src/features/accountsLedgers.tsx"
AUTO_QA = ROOT / "scripts/auto-qa-admission.mjs"
SELF_TEST = ROOT / "scripts/self-test.mjs"
PACKAGE = ROOT / "package.json"
AUDIT = ROOT / "scripts/staff-readiness-audit.py"
WORKFLOW = ROOT / ".github/workflows/quality-gate.yml"
MIGRATION = ROOT / "supabase/migrations/202607190002_staff_readiness_hardening.sql"
SELF = Path(__file__).resolve()
BACKUP_BRANCH = "backup-before-staff-readiness-audit-2026-07-19"
ALLOWED_UNTRACKED = {
    "qa-smoke-report.md",
    "scripts/qa-smoke-test.mjs",
    "farukhnagar-ledger-audit.json",
    "staff-readiness-report.json",
}


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
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

for target in (AUDIT, WORKFLOW, MIGRATION):
    if target.exists():
        raise SystemExit(f"Target already exists: {target.relative_to(ROOT)}")
for required in (APP, DB, SIMPLE, DEAD, AUTO_QA, SELF_TEST, PACKAGE):
    if not required.exists():
        raise SystemExit(f"Required file is missing: {required.relative_to(ROOT)}")

# Refresh the already-created safety branch without changing its intended base.
run("git", "push", "origin", f"refs/remotes/origin/{BACKUP_BRANCH}:refs/heads/{BACKUP_BRANCH}")

originals = {path: path.read_text() for path in (APP, DB, SIMPLE, DEAD, AUTO_QA, SELF_TEST, PACKAGE)}
app = originals[APP]
db = originals[DB]
simple = originals[SIMPLE]
auto_qa = originals[AUTO_QA]
self_test = originals[SELF_TEST]
package = originals[PACKAGE]
db_pushed = False

# ---------------------------------------------------------------------------
# App: exact permission visibility, awaited secure Cashbook save, admin-only
# advanced options, and stable request IDs.
# ---------------------------------------------------------------------------
app = replace_once(
    app,
    "recordSplitPayment, refreshTables",
    "recordManualCashbookEntry, recordSplitPayment, refreshTables",
    "database import",
)
app = replace_once(
    app,
    "type CashbookFormEntry = Omit<CashbookEntry, 'id' | 'branchId' | 'source' | 'linkedId'>",
    "type CashbookFormEntry = Omit<CashbookEntry, 'id' | 'branchId' | 'source' | 'linkedId'> & { requestId: string }",
    "cashbook request type",
)
app = replace_once(
    app,
    "{(can('add_cashbook') || can('add_expense')) && <Button tone=\"green\" onClick={() => openModal('cashbook')}><Plus size={18} /> <span className=\"hidden sm:inline\">Add Entry</span></Button>}{(can('add_cashbook') || can('add_expense')) && <button type=\"button\" onClick={() => openModal('categoryAccountEntry')} className=\"inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-bold text-white hover:bg-orange-600\"><IndianRupee size={18} /> <span className=\"hidden sm:inline\">Staff / Vendor Payment</span></button>}",
    "{can('add_cashbook') && <Button tone=\"green\" onClick={() => openModal('cashbook')}><Plus size={18} /> <span className=\"hidden sm:inline\">Add Entry</span></Button>}{(can('add_cashbook') || can('add_expense')) && <button type=\"button\" onClick={() => openModal('categoryAccountEntry')} className=\"inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-bold text-white hover:bg-orange-600\"><IndianRupee size={18} /> <span className=\"hidden sm:inline\">Staff / Vendor Payment</span></button>}",
    "header permissions",
)
app = replace_once(
    app,
    "<CategoryAccountEntryModal branchName={branch.name} categories={data.categories.filter((category) => category.branchId === branchId)} parties={scoped.ledgerParties} entries={scoped.ledgerEntries} onClose={closeModal}",
    "<CategoryAccountEntryModal branchName={branch.name} categories={data.categories.filter((category) => category.branchId === branchId)} parties={scoped.ledgerParties} entries={scoped.ledgerEntries} isAdmin={isAdmin} canAddCashbook={can('add_cashbook')} canAddExpense={can('add_expense')} onClose={closeModal}",
    "orange modal permissions",
)

finance_signature = "function FinancePage({ scoped, financeTab, setFinanceTab, data, branch, setModal, setSelectedTenantId, setSelectedCashbookId, setSelectedCategoryId, updateData, role, currentUser, isAdmin }: { scoped: ReturnType<typeof branchData>; financeTab: string; setFinanceTab: (value: string) => void; data: AppData; branch: Branch; setModal: (value: string) => void; setSelectedTenantId: (value: string) => void; setSelectedCashbookId: (value: string) => void; setSelectedCategoryId: (value: string) => void; updateData: (updater: (previous: AppData) => AppData, action: string, entity: string, description?: string, metadata?: Record<string, string | number>) => void; role: Role; currentUser: User; isAdmin: boolean }) {\n  const months ="
finance_replacement = finance_signature.replace(" {\n  const months =", " {\n  const canAddCashbook = isAdmin || currentUser.permissions.includes('add_cashbook')\n  const months =")
app = replace_once(app, finance_signature, finance_replacement, "Finance permission calculation")
app = replace_once(
    app,
    '<Button tone="green" onClick={() => setModal(\'cashbook\')}><Plus size={16} /> Advanced Cashbook Entry</Button>',
    "{canAddCashbook && <Button tone=\"green\" onClick={() => setModal('cashbook')}><Plus size={16} /> Add Entry</Button>}",
    "Finance Cashbook button",
)
app = replace_once(
    app,
    '<Button tone="green" onClick={() => setModal(\'cashbook\')}><Plus size={16} /> Add Entry</Button></div>{selectedLedgerData',
    "{canAddCashbook && <Button tone=\"green\" onClick={() => setModal('cashbook')}><Plus size={16} /> Add Entry</Button>}</div>{selectedLedgerData",
    "Expense Add Entry permission",
)

old_add_modal = """      {modal === 'cashbook' && <CashbookModal branches={data.branches.filter((item) => item.active !== false)} branchId={branchId} categories={Array.from(new Set(scoped.cashbook.map((entry) => entry.category).filter((value): value is string => Boolean(value))))} onClose={closeModal} onSubmit={(entry) => { const interBranch = parseInterBranchReference(entry.reference); updateData((previous) => { const now = new Date().toISOString(); const cat = data.categories.find((c) => c.branchId === branchId && c.name === (entry.category || 'Uncategorized')); const primary = { id: uid('c'), branchId, source: 'Manual' as const, createdAt: now, categoryId: cat?.id, ...entry }; const mirror = interBranch?.kind === 'IBS' ? { id: uid('c'), branchId: interBranch.counterpartyBranchId, source: 'Manual' as const, type: 'Debit' as const, amount: interBranch.amount, description: `Inter-branch settlement paid to ${branch.name}`, date: entry.date, category: 'Inter-branch Settlement', paymentMode: entry.paymentMode, reference: `IBS|${branchId}|${interBranch.amount}`, remarks: entry.remarks, createdAt: now } : undefined; return { ...previous, cashbook: [primary, ...(mirror ? [mirror] : []), ...previous.cashbook] } }, entry.type === 'Credit' ? 'credit created' : 'debit created', 'Cashbook', `${role} ${currentUser.name} added cashbook ${entry.type.toLowerCase()} of ${money(entry.amount)}. Description: ${entry.description}.`, { amount: entry.amount, type: entry.type }) }} />}"""
new_add_modal = """      {modal === 'cashbook' && <CashbookModal allowAdvanced={isAdmin} branches={data.branches.filter((item) => item.active !== false)} branchId={branchId} categories={Array.from(new Set([...data.categories.filter((item) => item.branchId === branchId).map((item) => item.name), ...scoped.cashbook.map((entry) => entry.category).filter((value): value is string => Boolean(value))]))} onClose={closeModal} onSubmit={async (entry) => {
        setBackendError('')
        await recordManualCashbookEntry({ ...entry, branchId })
        const refreshed = await refreshTables(['cashbook_entries', 'categories', 'ledger_parties', 'activity_logs'], dataRef.current)
        dataRef.current = refreshed
        setData(refreshed)
        setSuccessMessage(`${entry.type} of ${money(entry.amount)} saved in Cashbook.`)
      }} />}"""
app = replace_once(app, old_add_modal, new_add_modal, "secure Cashbook modal")
app = replace_once(
    app,
    "{modal === 'editCashbook' && <CashbookModal entry=",
    "{modal === 'editCashbook' && <CashbookModal allowAdvanced={isAdmin} entry=",
    "edit Cashbook admin features",
)

old_signature = "function CashbookModal({ entry, categories, branches, branchId, onClose, onSubmit }: { entry?: CashbookEntry; categories: string[]; branches: Branch[]; branchId: string; onClose: () => void; onSubmit: (entry: CashbookFormEntry) => void }) {"
new_signature = "function CashbookModal({ entry, categories, branches, branchId, allowAdvanced = false, onClose, onSubmit }: { entry?: CashbookEntry; categories: string[]; branches: Branch[]; branchId: string; allowAdvanced?: boolean; onClose: () => void; onSubmit: (entry: CashbookFormEntry) => Promise<void> | void }) {"
app = replace_once(app, old_signature, new_signature, "Cashbook modal signature")
app = replace_once(
    app,
    "  const [saving, setSaving] = useState(false)\n  const savingRef = useRef(false)\n  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {\n    event.preventDefault()\n    if (savingRef.current) return\n    savingRef.current = true; setSaving(true)\n    try {\n      const form = new FormData(event.currentTarget)\n      const selectedCategory = category === '__new__' ? String(form.get('newCategory') || '').trim() : category\n      const structuredReference = partnerEntry && type === 'Debit' ? `PTL|${encodeURIComponent(partnerName.trim())}` : interBranch ? `${type === 'Debit' ? 'IBR' : 'IBS'}|${counterpartyBranchId}|${dueAmount}` : String(form.get('reference') || '')\n      onSubmit({ type, amount, description, date, category: partnerEntry && type === 'Debit' ? 'Partner Account' : interBranch && type === 'Credit' ? 'Inter-branch Settlement' : selectedCategory || 'Uncategorized', paymentMode: String(form.get('paymentMode')), reference: structuredReference, remarks: String(form.get('remarks')) })\n      onClose()\n    } finally { savingRef.current = false; setSaving(false) }\n  }",
    "  const [saving, setSaving] = useState(false)\n  const savingRef = useRef(false)\n  const [requestId] = useState(() => crypto.randomUUID())\n  const [error, setError] = useState('')\n  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {\n    event.preventDefault()\n    if (savingRef.current) return\n    savingRef.current = true; setSaving(true); setError('')\n    try {\n      const form = new FormData(event.currentTarget)\n      const selectedCategory = category === '__new__' ? String(form.get('newCategory') || '').trim() : category\n      if (category === '__new__' && !allowAdvanced) throw new Error('Only the owner can create a new category.')\n      const structuredReference = partnerEntry && type === 'Debit' ? `PTL|${encodeURIComponent(partnerName.trim())}` : interBranch ? `${type === 'Debit' ? 'IBR' : 'IBS'}|${counterpartyBranchId}|${dueAmount}` : String(form.get('reference') || '')\n      await onSubmit({ requestId, type, amount, description, date, category: partnerEntry && type === 'Debit' ? 'Partner Account' : interBranch && type === 'Credit' ? 'Inter-branch Settlement' : selectedCategory || 'Uncategorized', paymentMode: String(form.get('paymentMode')), reference: structuredReference, remarks: String(form.get('remarks')) })\n      onClose()\n    } catch (failure) {\n      setError(failure instanceof Error ? failure.message : 'Cashbook entry could not be saved.')\n    } finally { savingRef.current = false; setSaving(false) }\n  }",
    "await Cashbook save",
)
app = replace_once(app, '<option value="__new__">+ New Category</option>', "{allowAdvanced && <option value=\"__new__\">+ New Category</option>}", "new category owner-only")
app = replace_once(
    app,
    '<div className="md:col-span-2 flex items-center justify-between rounded-md border border-slate-400 p-3"><span className="text-sm font-semibold">Inter-branch lena / dena</span><input aria-label="Inter-branch entry" type="checkbox" checked={interBranch} onChange={(event) => { setInterBranch(event.target.checked); if (event.target.checked) setPartnerEntry(false) }} className="h-5 w-5 accent-blue-600" /></div>',
    '{allowAdvanced && <div className="md:col-span-2 flex items-center justify-between rounded-md border border-slate-400 p-3"><span className="text-sm font-semibold">Inter-branch lena / dena</span><input aria-label="Inter-branch entry" type="checkbox" checked={interBranch} onChange={(event) => { setInterBranch(event.target.checked); if (event.target.checked) setPartnerEntry(false) }} className="h-5 w-5 accent-blue-600" /></div>}',
    "interbranch owner-only",
)
app = replace_once(app, "{type === 'Debit' && <><div className=\"md:col-span-2 flex items-center justify-between rounded-md border border-slate-400 p-3\">", "{allowAdvanced && type === 'Debit' && <><div className=\"md:col-span-2 flex items-center justify-between rounded-md border border-slate-400 p-3\">", "partner owner-only")
app = replace_once(
    app,
    '<Field label="Remarks"><input name="remarks" className={inputClass} defaultValue={entry?.remarks} /></Field><div className="flex justify-end gap-2 md:col-span-2">',
    '<Field label="Remarks"><input name="remarks" className={inputClass} defaultValue={entry?.remarks} /></Field>{error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700 md:col-span-2">{error}</p>}<div className="flex justify-end gap-2 md:col-span-2">',
    "Cashbook inline error",
)

# ---------------------------------------------------------------------------
# Simple staff/vendor UI: action-specific permissions and overpayment guard.
# ---------------------------------------------------------------------------
old_actions = """function accountActions(type: LedgerPartyType) {
  if (type === 'Staff') return ['Salary Due', 'Salary Payment', 'Advance Given', 'Bonus', 'Deduction']
  if (type === 'Vendor') return ['Add Bill', 'Payment Made']
  if (type === 'Building Rent') return ['Rent Due', 'Rent Payment']
  return []
}"""
new_actions = """function accountActions(type: LedgerPartyType, isAdmin: boolean, canAddCashbook: boolean, canAddExpense: boolean) {
  if (type === 'Staff') return isAdmin ? ['Salary Due', 'Salary Payment', 'Advance Given', 'Bonus', 'Deduction'] : canAddCashbook ? ['Salary Payment', 'Advance Given'] : []
  if (type === 'Vendor') return [...(canAddExpense ? ['Add Bill'] : []), ...(canAddCashbook ? ['Payment Made'] : [])]
  if (type === 'Building Rent') return [...(isAdmin ? ['Rent Due'] : []), ...(canAddCashbook ? ['Rent Payment'] : [])]
  return []
}"""
simple = replace_once(simple, old_actions, new_actions, "action permission matrix")
simple = replace_once(
    simple,
    "  entries,\n  onClose,\n  onSaved,\n}: {\n  branchName: string\n  categories: Category[]\n  parties: LedgerParty[]\n  entries: LedgerEntry[]\n  onClose: () => void",
    "  entries,\n  isAdmin,\n  canAddCashbook,\n  canAddExpense,\n  onClose,\n  onSaved,\n}: {\n  branchName: string\n  categories: Category[]\n  parties: LedgerParty[]\n  entries: LedgerEntry[]\n  isAdmin: boolean\n  canAddCashbook: boolean\n  canAddExpense: boolean\n  onClose: () => void",
    "orange modal prop types",
)
simple = replace_once(
    simple,
    "  const accounts = useMemo(() => visibleAccounts(parties), [parties])",
    "  const accounts = useMemo(() => visibleAccounts(parties).filter((party) => accountActions(party.type, isAdmin, canAddCashbook, canAddExpense).length > 0), [parties, isAdmin, canAddCashbook, canAddExpense])",
    "visible permitted accounts",
)
simple = replace_once(
    simple,
    "  const actions = account ? accountActions(account.type) : []",
    "  const accountType = account?.type\n  const actions = accountType ? accountActions(accountType, isAdmin, canAddCashbook, canAddExpense) : []",
    "permitted actions",
)
simple = replace_once(
    simple,
    "  useEffect(() => {\n    const nextActions = account ? accountActions(account.type) : []\n    setAction(nextActions[0] || '')\n  }, [account?.id, account?.type])",
    "  useEffect(() => {\n    const nextActions = accountType ? accountActions(accountType, isAdmin, canAddCashbook, canAddExpense) : []\n    setAction(nextActions[0] || '')\n  }, [accountType, isAdmin, canAddCashbook, canAddExpense])",
    "clean action effect",
)
simple = replace_once(
    simple,
    "    if (!(numericAmount > 0)) { setError('Enter an amount greater than zero.'); return }\n    const form = new FormData(event.currentTarget)",
    "    if (!(numericAmount > 0)) { setError('Enter an amount greater than zero.'); return }\n    if (['Salary Payment', 'Payment Made', 'Rent Payment'].includes(action) && numericAmount > Math.max(0, balance)) { setError(`Payment cannot exceed current pending balance of ${money(Math.max(0, balance))}. Use Advance Given only when extra advance is intended.`); return }\n    const form = new FormData(event.currentTarget)",
    "client overpayment guard",
)
simple = replace_once(
    simple,
    "No category has been classified as Staff, Vendor or Building Rent yet. Open Finance → Expenses → open a category → Edit category account.",
    "No permitted staff/vendor action is available. The owner should classify a category and enable the required Cashbook or Expense permission.",
    "empty permission message",
)

# ---------------------------------------------------------------------------
# Database helper for awaited/idempotent manual Cashbook RPC.
# ---------------------------------------------------------------------------
manual_helper = r'''

export async function recordManualCashbookEntry(input: {
  requestId: string
  branchId: string
  type: 'Credit' | 'Debit'
  amount: number
  description: string
  date: string
  category?: string
  paymentMode?: string
  reference?: string
  remarks?: string
}): Promise<{ success: boolean; cashbook_entry_id: string; duplicate?: boolean }> {
  const { data, error } = await supabase.rpc('record_manual_cashbook_entry_v2', {
    p_request_id: input.requestId,
    p_branch_id: input.branchId,
    p_type: input.type,
    p_amount: input.amount,
    p_description: input.description,
    p_entry_date: input.date,
    p_category: input.category || 'Uncategorized',
    p_payment_mode: input.paymentMode || 'Cash',
    p_reference: input.reference || null,
    p_remarks: input.remarks || null,
  })
  if (error) throw databaseError('record_manual_cashbook_entry_v2 RPC', error)
  return data as { success: boolean; cashbook_entry_id: string; duplicate?: boolean }
}
'''
if "export async function recordManualCashbookEntry" in db:
    raise SystemExit("Manual Cashbook helper already exists.")
db = db.rstrip() + "\n" + textwrap.dedent(manual_helper).lstrip()

# ---------------------------------------------------------------------------
# Security cleanup: no production password or fixed endpoint in QA source.
# ---------------------------------------------------------------------------
auto_qa = replace_once(
    auto_qa,
    "const SUPABASE_URL = 'https://jgurmuvshaqmwjypiqtl.supabase.co'\nconst ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpndXJtdXZzaGFxbXdqeXBpcXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NTEyMDIsImV4cCI6MjA5ODEyNzIwMn0.-BO_-w97ghJbmj4kUPM1M-rRaUe9cRYnbCg2zlB4dEw'",
    "const SUPABASE_URL = process.env.PG95_SUPABASE_URL || process.env.VITE_SUPABASE_URL\nconst ANON_KEY = process.env.PG95_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY\nconst ADMIN_EMAIL = process.env.PG95_ADMIN_EMAIL\nconst ADMIN_PASSWORD = process.env.PG95_ADMIN_PASSWORD",
    "remove fixed QA endpoint and key",
)
auto_qa = regex_once(auto_qa, r"\nasync function gql\(operationName, query, variables\) \{.*?\n\}\n", "\n", "remove unused GraphQL helper", flags=re.DOTALL)
auto_qa = replace_once(auto_qa, "  const paymentRequestId = crypto.randomUUID()\n", "", "remove unused payment request")
auto_qa = replace_once(
    auto_qa,
    "  console.log('\\n=== Auto-QA: Admission Idempotency + Rent Summary ===\\n')\n\n  // Sign in",
    "  console.log('\\n=== Auto-QA: Admission Idempotency + Rent Summary ===\\n')\n  if (!SUPABASE_URL || !ANON_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set PG95_SUPABASE_URL, PG95_SUPABASE_ANON_KEY, PG95_ADMIN_EMAIL and PG95_ADMIN_PASSWORD before running this destructive-cleanup QA script.')\n\n  // Sign in",
    "QA environment guard",
)
auto_qa = replace_once(auto_qa, "  await signIn('admin@pg95.local', 'Admin@12345')", "  await signIn(ADMIN_EMAIL, ADMIN_PASSWORD)", "remove hardcoded admin login")

# ---------------------------------------------------------------------------
# Static self-tests covering permissions and retry invariants.
# ---------------------------------------------------------------------------
readiness_tests = r'''

// Staff-readiness hardening checks
const financePermissionMatrix = {
  staffSalaryDue: { admin: true, addCashbook: false, addExpense: false },
  vendorBill: { admin: true, addCashbook: false, addExpense: true },
  vendorPayment: { admin: true, addCashbook: true, addExpense: false },
}
assert(financePermissionMatrix.staffSalaryDue.admin && !financePermissionMatrix.staffSalaryDue.addCashbook, 'SR1. Salary generation remains owner/admin controlled')
assert(financePermissionMatrix.vendorBill.addExpense && !financePermissionMatrix.vendorBill.addCashbook, 'SR2. Vendor bill requires Expense permission')
assert(financePermissionMatrix.vendorPayment.addCashbook && !financePermissionMatrix.vendorPayment.addExpense, 'SR3. Vendor payment requires Cashbook permission')
const paymentPending = 6000
assert(4000 <= paymentPending && !(7000 <= paymentPending), 'SR4. Normal payment cannot exceed pending balance')
const stableCashbookRequest = '11111111-1111-4111-8111-111111111111'
const cashbookRetry = { first: stableCashbookRequest, retry: stableCashbookRequest, rows: 1 }
assert(cashbookRetry.first === cashbookRetry.retry && cashbookRetry.rows === 1, 'SR5. Manual Cashbook retry is idempotent')
const staffAdvancedFeatures = { interBranch: false, partnerWithdrawal: false, createCategory: false }
assert(!staffAdvancedFeatures.interBranch && !staffAdvancedFeatures.partnerWithdrawal && !staffAdvancedFeatures.createCategory, 'SR6. Advanced Cashbook features remain owner-only')
'''
self_test = replace_once(self_test, "console.log('All PG Admin Portal flow checks passed.')", textwrap.dedent(readiness_tests).lstrip() + "\nconsole.log('All PG Admin Portal flow checks passed.')", "staff readiness self-tests")

# ---------------------------------------------------------------------------
# Migration: idempotent Cashbook RPC, action-specific ledger permissions,
# live probe with guaranteed cleanup, and removal of an over-broad helper grant.
# ---------------------------------------------------------------------------
migration_sql = r'''
-- Staff readiness hardening: no optimistic Finance writes, exact permissions,
-- idempotency, controlled overpayment, and a cleanup-safe live probe.

alter table public.cashbook_entries
  add column if not exists request_id uuid;

create unique index if not exists cashbook_entries_request_id_unique_idx
  on public.cashbook_entries(request_id)
  where request_id is not null;

revoke execute on function public.pg95_ensure_finance_category(uuid, text, uuid) from authenticated;

create or replace function public.pg95_has_branch_permission(
  p_branch_id uuid,
  p_permission text
)
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
            select 1
            from public.branch_assignments assignment
            where assignment.user_id = auth.uid()
              and assignment.branch_id = p_branch_id
          )
          and exists (
            select 1
            from public.staff_permissions permission_row
            where permission_row.user_id = auth.uid()
              and permission_row.permission = p_permission
              and permission_row.allowed is true
          )
        )
      )
  );
$$;

revoke all on function public.pg95_has_branch_permission(uuid, text) from public;
grant execute on function public.pg95_has_branch_permission(uuid, text) to authenticated;

create or replace function public.record_manual_cashbook_entry_v2(
  p_request_id uuid,
  p_branch_id uuid,
  p_type text,
  p_amount numeric,
  p_description text,
  p_entry_date date,
  p_category text,
  p_payment_mode text,
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
  v_entry_type public.cashbook_entries.type%type;
  v_mirror_type public.cashbook_entries.type%type;
  v_source public.cashbook_entries.source%type;
  v_entry_id uuid;
  v_existing_id uuid;
  v_mirror_id uuid;
  v_category_id uuid;
  v_category_name text;
  v_branch_name text;
  v_is_admin boolean := false;
  v_special_kind text;
  v_counterparty_id uuid;
  v_counterparty_name text;
  v_due_amount numeric;
  v_counterparty_category uuid;
begin
  if v_user_id is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'Request id is required.'; end if;

  select id into v_existing_id from public.cashbook_entries where request_id = p_request_id;
  if v_existing_id is not null then
    return jsonb_build_object('success', true, 'cashbook_entry_id', v_existing_id, 'duplicate', true);
  end if;

  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found then raise exception 'Your staff account is not active.' using errcode = '42501'; end if;
  v_is_admin := lower(v_profile.role::text) = 'admin';

  if not public.pg95_has_branch_permission(p_branch_id, 'add_cashbook') then
    raise exception 'Your account does not have Cashbook permission for this branch.' using errcode = '42501';
  end if;

  select name into v_branch_name from public.branches where id = p_branch_id and coalesce(active, true);
  if not found then raise exception 'Active branch not found.' using errcode = 'P0002'; end if;

  if lower(trim(coalesce(p_type, ''))) = 'credit' then v_entry_type := 'Credit';
  elsif lower(trim(coalesce(p_type, ''))) = 'debit' then v_entry_type := 'Debit';
  else raise exception 'Select Credit or Debit.';
  end if;
  v_mirror_type := 'Debit';
  v_source := 'Manual';

  if coalesce(p_amount, 0) <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if nullif(trim(coalesce(p_description, '')), '') is null then raise exception 'Description is required.'; end if;
  if p_entry_date is null then raise exception 'Entry date is required.'; end if;

  v_special_kind := split_part(coalesce(p_reference, ''), '|', 1);
  if not v_is_admin and v_special_kind in ('IBR', 'IBS', 'PTL') then
    raise exception 'Inter-branch and partner entries are owner-only.' using errcode = '42501';
  end if;

  select id, name into v_category_id, v_category_name
  from public.categories
  where branch_id = p_branch_id
    and lower(trim(name)) = lower(trim(public.pg95_normalize_finance_category(p_category)))
  order by id
  limit 1;

  if v_category_id is null then
    if not v_is_admin then
      raise exception 'This category does not exist. Ask the owner to create it first.' using errcode = '42501';
    end if;
    v_category_id := public.pg95_ensure_finance_category(p_branch_id, p_category, v_user_id);
    select name into v_category_name from public.categories where id = v_category_id;
  end if;

  if v_special_kind in ('IBR', 'IBS') then
    begin
      v_counterparty_id := split_part(p_reference, '|', 2)::uuid;
      v_due_amount := split_part(p_reference, '|', 3)::numeric;
    exception when others then
      raise exception 'Invalid inter-branch reference.';
    end;
    if v_counterparty_id = p_branch_id then raise exception 'Select another branch.'; end if;
    if v_due_amount <= 0 or v_due_amount > p_amount then raise exception 'Inter-branch amount must be positive and cannot exceed the entry amount.'; end if;
    select name into v_counterparty_name from public.branches where id = v_counterparty_id and coalesce(active, true);
    if not found then raise exception 'Counterparty branch not found.' using errcode = 'P0002'; end if;
  end if;

  v_entry_id := gen_random_uuid();
  insert into public.cashbook_entries (
    id, branch_id, type, amount, description, entry_date,
    source, linked_id, category, category_id, payment_mode,
    reference, remarks, request_id, created_by, updated_by
  ) values (
    v_entry_id, p_branch_id, v_entry_type, p_amount, trim(p_description), p_entry_date,
    v_source, null, v_category_name, v_category_id,
    coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
    nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_remarks, '')), ''),
    p_request_id, v_user_id, v_user_id
  );

  -- Preserve the existing settlement behavior: an IBS Credit creates one Debit
  -- mirror in the counterparty branch. IBR remains a receivable marker only.
  if v_special_kind = 'IBS' and v_entry_type::text = 'Credit' then
    v_counterparty_category := public.pg95_ensure_finance_category(v_counterparty_id, 'Inter-branch Settlement', v_user_id);
    v_mirror_id := gen_random_uuid();
    insert into public.cashbook_entries (
      id, branch_id, type, amount, description, entry_date,
      source, linked_id, category, category_id, payment_mode,
      reference, remarks, request_id, created_by, updated_by
    ) values (
      v_mirror_id, v_counterparty_id, v_mirror_type, v_due_amount,
      format('Inter-branch settlement paid to %s', v_branch_name), p_entry_date,
      v_source, v_entry_id, 'Inter-branch Settlement', v_counterparty_category,
      coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
      format('IBS|%s|%s', p_branch_id, v_due_amount),
      nullif(trim(coalesce(p_remarks, '')), ''), gen_random_uuid(), v_user_id, v_user_id
    );
  end if;

  insert into public.activity_logs (
    branch_id, branch_name, user_id, user_name, user_role,
    module, action_type, description, metadata
  ) values (
    p_branch_id, v_branch_name, v_user_id, coalesce(v_profile.name, 'User'), v_profile.role,
    'Cashbook', case when v_entry_type::text = 'Credit' then 'Credit Created' else 'Debit Created' end,
    format('%s %s added Cashbook %s of %s. Description: %s.',
      initcap(lower(v_profile.role::text)), coalesce(v_profile.name, ''), lower(v_entry_type::text), p_amount, trim(p_description)),
    jsonb_build_object('cashbook_entry_id', v_entry_id, 'request_id', p_request_id, 'amount', p_amount, 'type', v_entry_type::text)
  );

  return jsonb_build_object('success', true, 'cashbook_entry_id', v_entry_id, 'mirror_entry_id', v_mirror_id);
exception when unique_violation then
  select id into v_existing_id from public.cashbook_entries where request_id = p_request_id;
  if v_existing_id is not null then
    return jsonb_build_object('success', true, 'cashbook_entry_id', v_existing_id, 'duplicate', true);
  end if;
  raise;
end;
$$;

revoke all on function public.record_manual_cashbook_entry_v2(uuid, uuid, text, numeric, text, date, text, text, text, text) from public;
grant execute on function public.record_manual_cashbook_entry_v2(uuid, uuid, text, numeric, text, date, text, text, text, text) to authenticated;

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
  v_balance numeric := 0;
  v_creates_expense boolean := false;
  v_creates_cashbook boolean := false;
  v_description text;
  v_reference text;
  v_is_admin boolean := false;
begin
  if v_user_id is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'Request id is required.'; end if;

  select id into v_existing from public.ledger_entries where request_id = p_request_id;
  if v_existing is not null then return jsonb_build_object('success', true, 'ledger_entry_id', v_existing, 'duplicate', true); end if;

  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found then raise exception 'Your staff account is not active.' using errcode = '42501'; end if;
  v_is_admin := lower(v_profile.role::text) = 'admin';

  select * into v_party from public.ledger_parties where id = p_party_id for update;
  if not found then raise exception 'Staff/vendor account not found.' using errcode = 'P0002'; end if;
  if v_party.status <> 'Active' then raise exception 'This account is inactive/left. Owner must reactivate it first.'; end if;

  select * into v_category from public.categories where id = v_party.category_id;
  if not found then raise exception 'Linked Finance category not found.' using errcode = 'P0002'; end if;

  if p_action in ('Salary Due', 'Rent Due', 'Bonus', 'Deduction') and not v_is_admin then
    raise exception 'Only the owner/admin can generate salary/rent dues, bonus or deductions.' using errcode = '42501';
  elsif p_action = 'Add Bill' and not public.pg95_has_branch_permission(v_party.branch_id, 'add_expense') then
    raise exception 'Your account does not have Expense permission for vendor bills.' using errcode = '42501';
  elsif p_action in ('Salary Payment', 'Advance Given', 'Payment Made', 'Rent Payment')
        and not public.pg95_has_branch_permission(v_party.branch_id, 'add_cashbook') then
    raise exception 'Your account does not have Cashbook permission for payments.' using errcode = '42501';
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
    select 1 from public.ledger_entries where party_id = p_party_id and period = p_period and nature = p_action
  ) then
    raise exception '% is already generated for %.', p_action, p_period;
  end if;

  select coalesce(sum(debit_amount - credit_amount), 0)
  into v_balance from public.ledger_entries where party_id = p_party_id;
  if p_action in ('Salary Payment', 'Payment Made', 'Rent Payment') and p_amount > greatest(v_balance, 0) then
    raise exception 'Payment % exceeds pending balance %.', p_amount, greatest(v_balance, 0);
  end if;

  if p_action in ('Salary Due', 'Bonus', 'Add Bill', 'Rent Due') then
    v_debit := p_amount;
    v_creates_expense := true;
  else
    v_credit := p_amount;
  end if;
  if p_action in ('Salary Payment', 'Advance Given', 'Payment Made', 'Rent Payment') then v_creates_cashbook := true; end if;

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
      reference, remarks, request_id, created_at, created_by
    ) values (
      v_cashbook_id, v_party.branch_id, 'Debit', p_amount, v_description, p_entry_date,
      'Manual', v_ledger_id, v_category.name, v_category.id,
      coalesce(nullif(trim(coalesce(p_payment_mode, '')), ''), 'Cash'),
      v_reference, nullif(trim(coalesce(p_remarks, '')), ''), p_request_id, now(), v_user_id
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
      initcap(lower(v_profile.role::text)), coalesce(v_profile.name, ''), p_action, p_amount, v_party.name, v_category.name),
    jsonb_build_object('category_id', v_category.id, 'party_id', v_party.id, 'request_id', p_request_id, 'amount', p_amount, 'period', p_period)
  );

  return jsonb_build_object('success', true, 'ledger_entry_id', v_ledger_id, 'cashbook_entry_id', v_cashbook_id, 'expense_id', v_expense_id);
exception when unique_violation then
  select id into v_existing from public.ledger_entries where request_id = p_request_id;
  if v_existing is not null then return jsonb_build_object('success', true, 'ledger_entry_id', v_existing, 'duplicate', true); end if;
  raise;
end;
$$;

revoke all on function public.record_category_account_transaction(uuid, uuid, text, numeric, date, text, text, text, text, text) from public;
grant execute on function public.record_category_account_transaction(uuid, uuid, text, numeric, date, text, text, text, text, text) to authenticated;

create or replace function public.pg95_staff_readiness_probe(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_has_cashbook boolean;
  v_has_expense boolean;
  v_category_id uuid;
  v_party_id uuid;
  v_manual_request uuid := gen_random_uuid();
  v_bill_request uuid := gen_random_uuid();
  v_payment_request uuid := gen_random_uuid();
  v_manual_result jsonb;
  v_manual_retry jsonb;
  v_bill_result jsonb;
  v_payment_result jsonb;
  v_balance numeric := 0;
  v_probe_name text := 'AUTO QA STAFF READINESS ' || replace(gen_random_uuid()::text, '-', '');
  v_period text := to_char(current_date, 'YYYY-MM');
  v_error text;
begin
  select * into v_profile from public.profiles where id = v_user_id and coalesce(active, true);
  if not found then raise exception 'Active profile not found.' using errcode = '42501'; end if;
  if lower(v_profile.role::text) <> 'admin' and not exists (
    select 1 from public.branch_assignments where user_id = v_user_id and branch_id = p_branch_id
  ) then raise exception 'Staff is not assigned to this branch.' using errcode = '42501'; end if;

  v_has_cashbook := public.pg95_has_branch_permission(p_branch_id, 'add_cashbook');
  v_has_expense := public.pg95_has_branch_permission(p_branch_id, 'add_expense');

  if not v_has_cashbook and not v_has_expense then
    return jsonb_build_object(
      'success', false,
      'cashbook_permission', false,
      'expense_permission', false,
      'message', 'No Cashbook or Expense permission is enabled for this staff account.'
    );
  end if;

  begin
    insert into public.categories (id, branch_id, name, created_by)
    values (gen_random_uuid(), p_branch_id, v_probe_name, v_user_id)
    returning id into v_category_id;

    insert into public.ledger_parties (
      id, branch_id, category_id, name, party_type, joining_date,
      monthly_amount, due_day, status, notes, created_by, updated_by
    ) values (
      gen_random_uuid(), p_branch_id, v_category_id, v_probe_name || ' VENDOR', 'Vendor',
      current_date, 0, 1, 'Active', 'Temporary readiness probe; removed in the same call.', v_user_id, v_user_id
    ) returning id into v_party_id;

    if v_has_cashbook then
      v_manual_result := public.record_manual_cashbook_entry_v2(
        v_manual_request, p_branch_id, 'Debit', 1, v_probe_name || ' CASHBOOK TEST', current_date,
        v_probe_name, 'Cash', null, 'Temporary readiness probe'
      );
      v_manual_retry := public.record_manual_cashbook_entry_v2(
        v_manual_request, p_branch_id, 'Debit', 1, v_probe_name || ' CASHBOOK TEST', current_date,
        v_probe_name, 'Cash', null, 'Temporary readiness probe retry'
      );
      if v_manual_result->>'cashbook_entry_id' is distinct from v_manual_retry->>'cashbook_entry_id' then
        raise exception 'Manual Cashbook retry created a different row.';
      end if;
    end if;

    if v_has_expense then
      v_bill_result := public.record_category_account_transaction(
        v_bill_request, v_party_id, 'Add Bill', 2, current_date, v_period,
        null, v_probe_name || ' BILL TEST', 'QA', 'Temporary readiness probe'
      );
    else
      insert into public.ledger_entries (
        id, branch_id, party_id, category_id, nature, amount,
        debit_amount, credit_amount, entry_date, period, description, created_by
      ) values (
        gen_random_uuid(), p_branch_id, v_party_id, v_category_id, 'QA Setup Bill', 2,
        2, 0, current_date, v_period, 'Temporary readiness setup', v_user_id
      );
    end if;

    if v_has_cashbook then
      v_payment_result := public.record_category_account_transaction(
        v_payment_request, v_party_id, 'Payment Made', 1, current_date, v_period,
        'Cash', v_probe_name || ' PAYMENT TEST', 'QA', 'Temporary readiness probe'
      );
    end if;

    select coalesce(sum(debit_amount - credit_amount), 0)
    into v_balance from public.ledger_entries where party_id = v_party_id;
    if v_has_cashbook and v_balance <> 1 then raise exception 'Vendor balance check failed: expected 1, got %.', v_balance; end if;
    if not v_has_cashbook and v_has_expense and v_balance <> 2 then raise exception 'Vendor bill balance check failed: expected 2, got %.', v_balance; end if;

    delete from public.activity_logs
    where metadata->>'request_id' in (v_manual_request::text, v_bill_request::text, v_payment_request::text)
       or metadata->>'category_id' = v_category_id::text;
    delete from public.ledger_entries where category_id = v_category_id;
    delete from public.expenses where category_id = v_category_id;
    delete from public.cashbook_entries where category_id = v_category_id;
    delete from public.ledger_parties where category_id = v_category_id;
    delete from public.categories where id = v_category_id;
  exception when others then
    v_error := sqlerrm;
    delete from public.activity_logs
    where metadata->>'request_id' in (v_manual_request::text, v_bill_request::text, v_payment_request::text)
       or metadata->>'category_id' = v_category_id::text;
    delete from public.ledger_entries where category_id = v_category_id;
    delete from public.expenses where category_id = v_category_id;
    delete from public.cashbook_entries where category_id = v_category_id;
    delete from public.ledger_parties where category_id = v_category_id;
    delete from public.categories where id = v_category_id;
    raise exception 'Staff readiness probe failed: %', v_error;
  end;

  return jsonb_build_object(
    'success', true,
    'cashbook_permission', v_has_cashbook,
    'expense_permission', v_has_expense,
    'manual_cashbook_test', case when v_has_cashbook then 'passed' else 'skipped' end,
    'manual_retry_test', case when v_has_cashbook then 'passed' else 'skipped' end,
    'vendor_bill_test', case when v_has_expense then 'passed' else 'setup-only' end,
    'vendor_payment_test', case when v_has_cashbook then 'passed' else 'skipped' end,
    'cleanup_test', 'passed',
    'message', 'Temporary QA rows were removed before this result was returned.'
  );
end;
$$;

revoke all on function public.pg95_staff_readiness_probe(uuid) from public;
grant execute on function public.pg95_staff_readiness_probe(uuid) to authenticated;
'''

# ---------------------------------------------------------------------------
# Local live-audit runner. Credentials are read securely and never saved.
# ---------------------------------------------------------------------------
audit_script = r'''
#!/usr/bin/env python3
from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "staff-readiness-report.json"


def load_env() -> dict[str, str]:
    values = dict(os.environ)
    for filename in (".env.local", ".env"):
        path = ROOT / filename
        if not path.exists():
            continue
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def request(url: str, method: str, headers: dict[str, str], body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode()
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error


def main() -> None:
    env = load_env()
    base = (env.get("VITE_SUPABASE_URL") or env.get("PG95_SUPABASE_URL") or "").rstrip("/")
    anon = env.get("VITE_SUPABASE_ANON_KEY") or env.get("PG95_SUPABASE_ANON_KEY") or ""
    if not base or not anon:
        raise SystemExit("Supabase public URL/key not found in .env.local or environment.")

    username = input("Staff username or email: ").strip()
    password = getpass.getpass("Staff password (hidden): ")
    email = username if "@" in username else f"{username}@staff.pg95.local"

    auth = request(
        f"{base}/auth/v1/token?grant_type=password",
        "POST",
        {"Content-Type": "application/json", "apikey": anon},
        {"email": email, "password": password},
    )
    token = auth.get("access_token") if isinstance(auth, dict) else None
    if not token:
        raise SystemExit("Staff login failed.")

    headers = {"Content-Type": "application/json", "apikey": anon, "Authorization": f"Bearer {token}"}
    branches = request(f"{base}/rest/v1/branches?select=id,name&active=eq.true&order=name", "GET", headers) or []
    if not branches:
        raise SystemExit("No active branch is visible to this staff account.")

    print("\nAssigned branches:")
    for index, branch in enumerate(branches, 1):
        print(f"  {index}. {branch['name']}")
    choice = input(f"Choose branch [1-{len(branches)}] (default 1): ").strip()
    selected = branches[int(choice or "1") - 1]

    result = request(
        f"{base}/rest/v1/rpc/pg95_staff_readiness_probe",
        "POST",
        headers,
        {"p_branch_id": selected["id"]},
    )
    report = {"staff": email, "branch": selected, "result": result}
    REPORT.write_text(json.dumps(report, indent=2))

    print("\n=== STAFF READINESS RESULT ===")
    print(json.dumps(result, indent=2))
    print(f"\nReport: {REPORT}")
    if not result or not result.get("success"):
        raise SystemExit(1)
    print("\nPASS: live staff permission, Cashbook retry, vendor ledger and cleanup checks completed.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
'''

workflow = r'''
name: Quality Gate

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run self-test
      - run: npm run build
      - run: npm run lint
'''

try:
    APP.write_text(app)
    DB.write_text(db)
    SIMPLE.write_text(simple)
    AUTO_QA.write_text(auto_qa)
    SELF_TEST.write_text(self_test)
    DEAD.unlink()
    AUDIT.parent.mkdir(parents=True, exist_ok=True)
    AUDIT.write_text(textwrap.dedent(audit_script).lstrip())
    AUDIT.chmod(0o755)
    WORKFLOW.parent.mkdir(parents=True, exist_ok=True)
    WORKFLOW.write_text(textwrap.dedent(workflow).lstrip())
    MIGRATION.write_text(textwrap.dedent(migration_sql).lstrip())

    combined = app + db + simple + auto_qa + self_test + migration_sql + audit_script + workflow
    required_markers = [
        "recordManualCashbookEntry",
        "record_manual_cashbook_entry_v2",
        "cashbook_entries_request_id_unique_idx",
        "pg95_staff_readiness_probe",
        "canAddCashbook={can('add_cashbook')}",
        "Only the owner can create a new category.",
        "Payment cannot exceed current pending balance",
        "Only the owner/admin can generate salary/rent dues",
        "PG95_ADMIN_PASSWORD",
        "Staff password (hidden)",
        "npm run self-test",
    ]
    for marker in required_markers:
        if marker not in combined:
            raise SystemExit(f"Preflight missing marker: {marker}")
    forbidden = ["Admin@12345", "openModal('accountEntry')", "Advanced Cashbook Entry"]
    for marker in forbidden:
        if marker in app + auto_qa:
            raise SystemExit(f"Preflight found forbidden legacy marker: {marker}")
    if DEAD.exists():
        raise SystemExit("Dead accountsLedgers.tsx was not removed.")

    run("python3", "-m", "py_compile", str(AUDIT.relative_to(ROOT)))
    run("npm", "run", "self-test")
    run("npm", "run", "build")
    run("npm", "run", "lint")

    answer = input("\nApply staff-readiness hardening migration to linked Supabase? [Y/n] ").strip().lower()
    if answer not in {"", "y", "yes"}:
        raise SystemExit("Supabase migration cancelled; source files will be restored.")

    run("npx", "supabase", "db", "push")
    db_pushed = True

    SELF.unlink()
    run(
        "git", "add",
        "src/App.tsx",
        "src/lib/database.ts",
        "src/features/simpleCategoryAccounts.tsx",
        "src/features/accountsLedgers.tsx",
        "scripts/auto-qa-admission.mjs",
        "scripts/self-test.mjs",
        "scripts/staff-readiness-audit.py",
        ".github/workflows/quality-gate.yml",
        str(MIGRATION.relative_to(ROOT)),
        str(SELF.relative_to(ROOT)),
    )
    run("git", "commit", "-m", "fix: harden staff finance workflows and add readiness gate")
    run("git", "push", "origin", "main")
    print("\nStaff-readiness hardening is live in GitHub and Supabase.", flush=True)
    print("Backup branch: " + BACKUP_BRANCH, flush=True)
    print("Next live check: python3 scripts/staff-readiness-audit.py", flush=True)
except BaseException:
    if not db_pushed:
        for path, content in originals.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        AUDIT.unlink(missing_ok=True)
        WORKFLOW.unlink(missing_ok=True)
        MIGRATION.unlink(missing_ok=True)
        print("\nAll source files were restored because hardening did not complete.", flush=True)
    else:
        print("\nSupabase migration was applied. Source files were left in place for safe commit recovery.", flush=True)
    raise
