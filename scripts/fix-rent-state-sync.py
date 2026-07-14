#!/usr/bin/env python3
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
app_path = root / "src/App.tsx"
allowed = {"qa-smoke-report.md", "scripts/qa-smoke-test.mjs"}


def run(*args):
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=root, check=True)


status = subprocess.run(
    ["git", "status", "--porcelain"], cwd=root, check=True,
    capture_output=True, text=True,
).stdout.splitlines()
blockers = [line for line in status if not (line.startswith("?? ") and line[3:] in allowed)]
if blockers:
    raise SystemExit("Working tree has unrelated changes:\n" + "\n".join(blockers))

original = app_path.read_text()
text = original

old_anchor = "  const importedPaidMonths = new Set(importedRentPaidMonths[tenant.name.trim().toUpperCase()] || [])\n  for (const period of periodsBetween(joiningMonth, currentMonth)) {\n"
new_anchor = "  const importedPaidMonths = new Set(importedRentPaidMonths[tenant.name.trim().toUpperCase()] || [])\n  const trackedPeriods = [...new Set([\n    ...periodsBetween(joiningMonth, currentMonth),\n    ...[...rentObligations.keys()].filter((period) => period >= joiningMonth),\n  ])].sort()\n  for (const period of trackedPeriods) {\n"

old_fallback = "  const period = nextPeriod(currentMonth)\n  const dueDate = rentDueDateForPeriod(dueAnchor, period)\n  return { period, paidThroughMonth: currentMonth, dueDate, agreed: tenant.monthlyRent, received: 0, advanceApplied: 0, pending: 0, status: (daysUntil(dueDate) <= 3 ? 'Upcoming' : 'Clear') as RentLedgerStatus }\n"
new_fallback = "  const latestTrackedPeriod = trackedPeriods.at(-1) || currentMonth\n  const lastCoveredPeriod = latestTrackedPeriod > currentMonth ? latestTrackedPeriod : currentMonth\n  const period = nextPeriod(lastCoveredPeriod)\n  const dueDate = rentDueDateForPeriod(dueAnchor, period)\n  return { period, paidThroughMonth: lastCoveredPeriod, dueDate, agreed: tenant.monthlyRent, received: 0, advanceApplied: 0, pending: 0, status: (daysUntil(dueDate) <= 3 ? 'Upcoming' : 'Clear') as RentLedgerStatus }\n"

for old, new, label in [
    (old_anchor, new_anchor, "tracked periods"),
    (old_fallback, new_fallback, "fallback period"),
]:
    if text.count(old) != 1:
        raise SystemExit(f"{label}: expected one match, found {text.count(old)}")
    text = text.replace(old, new, 1)

try:
    app_path.write_text(text)
    run("npm", "run", "self-test")
    run("npm", "run", "build")
    run("npm", "run", "lint")
    Path(__file__).unlink()
    run("git", "add", "src/App.tsx", "scripts/fix-rent-state-sync.py")
    run("git", "commit", "-m", "fix: sync tenant rent state with ledger obligations")
    run("git", "push", "origin", "main")
    print("\nTenant list and Payments now follow the first outstanding ledger obligation.")
except Exception:
    app_path.write_text(original)
    raise
