#!/usr/bin/env python3
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
app = root / "src/App.tsx"
database = root / "src/lib/database.ts"
self_test = root / "scripts/self-test.mjs"
feature = root / "src/features/accountsLedgers.tsx"
migration = root / "supabase/migrations/202607170002_accounts_ledgers.sql"

# Recover only the exact generated state left by the earlier broken preflight.
interrupted = (
    feature.exists()
    and migration.exists()
    and app.exists()
    and database.exists()
    and self_test.exists()
    and "ledgerParties: LedgerParty[]" in app.read_text()
    and "'ledger_parties'" in database.read_text()
    and "AL1. Staff salary due" in self_test.read_text()
)
if interrupted:
    print("Recovering files left by the interrupted Accounts & Ledgers preflight...", flush=True)
    subprocess.run(
        ["git", "restore", "--", "src/App.tsx", "src/lib/database.ts", "scripts/self-test.mjs"],
        cwd=root,
        check=True,
    )
    feature.unlink(missing_ok=True)
    migration.unlink(missing_ok=True)

parts = [root / f"scripts/.accounts-ledgers-feature-{index}.txt" for index in range(1, 13)]
missing = [str(path.relative_to(root)) for path in parts if not path.exists()]
if missing:
    raise SystemExit("Missing installer source files: " + ", ".join(missing) + ". Run git pull origin main first.")
source = "".join(path.read_text() for path in parts)
exec(compile(source, __file__, "exec"), globals(), globals())
