#!/usr/bin/env python3
from __future__ import annotations

import py_compile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "scripts/apply-simple-finance-category-accounts.py"
SELF = Path(__file__).resolve()

if not BASE.exists():
    raise SystemExit("Base simple Finance installer is missing. Run git pull origin main first.")

text = BASE.read_text()

# TypeScript uses noUnusedParameters=true. Display the category name so the
# category prop is meaningful and the generated feature passes tsc.
old_heading = '<h3 className="font-black text-slate-900">Staff / Vendor Account</h3>'
new_heading = '<h3 className="font-black text-slate-900">Staff / Vendor Account · {category.name}</h3>'
if text.count(old_heading) != 1:
    raise SystemExit(f"Preflight failed: expected one category summary heading, found {text.count(old_heading)}")
text = text.replace(old_heading, new_heading, 1)

# Successful cleanup should remove both installer scripts and stage both
# deletions, leaving no temporary installer in the production repository.
cleanup_anchor = "    SELF.unlink()\n    run(\n"
cleanup_replacement = "    SELF.unlink()\n    (ROOT / \"scripts/apply-simple-finance-category-accounts-v2.py\").unlink(missing_ok=True)\n    run(\n"
if text.count(cleanup_anchor) != 1:
    raise SystemExit("Preflight failed: installer cleanup anchor changed.")
text = text.replace(cleanup_anchor, cleanup_replacement, 1)

stage_anchor = '        str(SELF.relative_to(ROOT)),\n'
stage_replacement = '        str(SELF.relative_to(ROOT)),\n        "scripts/apply-simple-finance-category-accounts-v2.py",\n'
if text.count(stage_anchor) != 1:
    raise SystemExit("Preflight failed: installer staging anchor changed.")
text = text.replace(stage_anchor, stage_replacement, 1)

required = [
    "openModal('cashbook')",
    "Staff / Vendor Payment",
    "CategoryAccountSummary",
    "Staff / Vendor Account · {category.name}",
    "Only the owner/admin can edit category account settings.",
    "permission_row.permission in ('add_cashbook', 'add_expense')",
    "permission_row.allowed is true",
    "record_category_account_transaction",
    "save_category_account_party",
    "ledger_party_change_history",
    "LEDGER|CATEGORY_ACCOUNT|",
    "ledger_entries_request_id_unique_idx",
    "npm\", \"run\", \"self-test",
    "npm\", \"run\", \"build",
    "npm\", \"run\", \"lint",
]
for marker in required:
    if marker not in text:
        raise SystemExit(f"Preflight failed; missing marker: {marker}")

for forbidden in [
    "<Tabs values={['Cashbook', 'Expenses', 'Ledgers', 'Bill Creator']}",
    "modal === 'accountEntry' && <UnifiedLedgerEntryModal",
    "openModal('accountEntry')",
]:
    # These strings are expected in replacement source literals inside the
    # installer, but must not appear inside generated replacement values.
    # The base installer's own static preflight verifies the final App output.
    if forbidden == "openModal('accountEntry')" and text.count(forbidden) > 2:
        raise SystemExit("Preflight failed: unexpected extra complex Add Entry references.")

# Compile the patched installer text without modifying the working tree.
compiled = compile(text, str(BASE), "exec")
py_compile.compile(str(SELF), doraise=True)

# Execute as the base installer so its ROOT and cleanup paths stay correct.
namespace = {
    "__name__": "__main__",
    "__file__": str(BASE),
    "__package__": None,
}
exec(compiled, namespace)
