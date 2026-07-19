#!/usr/bin/env python3
from __future__ import annotations

import py_compile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "scripts/apply-staff-readiness-hardening.py"
SELF = Path(__file__).resolve()

if not BASE.exists():
    raise SystemExit("Base staff-readiness installer is missing. Run git pull origin main first.")

text = BASE.read_text()

old_backup = 'run("git", "push", "origin", f"refs/remotes/origin/{BACKUP_BRANCH}:refs/heads/{BACKUP_BRANCH}")'
new_backup = '''backup_check = subprocess.run(
    ["git", "ls-remote", "--exit-code", "--heads", "origin", BACKUP_BRANCH],
    cwd=ROOT,
    capture_output=True,
    text=True,
)
if backup_check.returncode != 0:
    run("git", "push", "origin", f"HEAD^:refs/heads/{BACKUP_BRANCH}")
else:
    print(f"Backup branch verified: {BACKUP_BRANCH}", flush=True)'''
if text.count(old_backup) != 1:
    raise SystemExit(f"Backup preflight marker changed; found {text.count(old_backup)} matches.")
text = text.replace(old_backup, new_backup, 1)

cleanup_anchor = "    SELF.unlink()\n    run(\n"
cleanup_replacement = "    SELF.unlink()\n    (ROOT / \"scripts/apply-staff-readiness-hardening-v2.py\").unlink(missing_ok=True)\n    run(\n"
if text.count(cleanup_anchor) != 1:
    raise SystemExit("Cleanup anchor changed.")
text = text.replace(cleanup_anchor, cleanup_replacement, 1)

stage_anchor = '        str(SELF.relative_to(ROOT)),\n'
stage_replacement = '        str(SELF.relative_to(ROOT)),\n        "scripts/apply-staff-readiness-hardening-v2.py",\n'
if text.count(stage_anchor) != 1:
    raise SystemExit("Staging anchor changed.")
text = text.replace(stage_anchor, stage_replacement, 1)

required = [
    "record_manual_cashbook_entry_v2",
    "pg95_staff_readiness_probe",
    "cashbook_entries_request_id_unique_idx",
    "Payment cannot exceed current pending balance",
    "Only the owner/admin can generate salary/rent dues",
    "Staff password (hidden)",
    "actions/setup-node@v4",
    "Backup branch verified",
]
for marker in required:
    if marker not in text:
        raise SystemExit(f"Final preflight missing marker: {marker}")

compile(text, str(BASE), "exec")
py_compile.compile(str(SELF), doraise=True)

namespace = {
    "__name__": "__main__",
    "__file__": str(BASE),
    "__package__": None,
}
exec(compile(text, str(BASE), "exec"), namespace)
