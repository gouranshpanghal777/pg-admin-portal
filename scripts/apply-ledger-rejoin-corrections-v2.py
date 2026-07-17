#!/usr/bin/env python3
from pathlib import Path
import runpy

root = Path(__file__).resolve().parents[1]
v1 = root / "scripts/apply-ledger-rejoin-corrections.py"
v2 = Path(__file__).resolve()

if not v1.exists():
    raise SystemExit("Base ledger correction installer is missing. Run git pull origin main first.")

text = v1.read_text()
old_status = "  v_status text;"
new_status = "  v_status public.payment_obligations.status%TYPE;"
if text.count(old_status) != 1:
    raise SystemExit(f"status type hardening: expected one match, found {text.count(old_status)}")
text = text.replace(old_status, new_status, 1)

old_cleanup = '''    Path(__file__).unlink()
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py")'''
new_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py")'''
if text.count(old_cleanup) != 1:
    raise SystemExit(f"wrapper cleanup hardening: expected one match, found {text.count(old_cleanup)}")
text = text.replace(old_cleanup, new_cleanup, 1)
v1.write_text(text)

runpy.run_path(str(v1), run_name="__main__")
