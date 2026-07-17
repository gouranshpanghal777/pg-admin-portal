#!/usr/bin/env python3
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
V1 = ROOT / "scripts/apply-ledger-rejoin-corrections.py"
V2 = ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py"
V3 = Path(__file__).resolve()

if not V1.exists():
    raise SystemExit("Base ledger correction installer is missing. Run git pull origin main first.")

text = V1.read_text()

old_status_type = "  v_status text;"
new_status_type = "  v_status public.payment_obligations.status%TYPE;"
if old_status_type in text:
    text = text.replace(old_status_type, new_status_type, 1)
elif new_status_type not in text:
    raise SystemExit("Could not verify the payment-obligation status type hardening.")

old_guard = '''blockers = [line for line in status if not (line.startswith("?? ") and line[3:] in ALLOWED_UNTRACKED)]'''
new_guard = '''allowed_tracked = {"scripts/apply-ledger-rejoin-corrections.py"}
blockers = [
    line for line in status
    if not (
        (line.startswith("?? ") and line[3:] in ALLOWED_UNTRACKED)
        or (line[:2] in {" M", "M "} and line[3:] in allowed_tracked)
    )
]'''
if old_guard in text:
    text = text.replace(old_guard, new_guard, 1)
elif new_guard not in text:
    raise SystemExit("Could not harden the installer working-tree guard.")

original_cleanup = '''    Path(__file__).unlink()
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py")'''
v2_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py")'''
v3_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py")'''
if original_cleanup in text:
    text = text.replace(original_cleanup, v3_cleanup, 1)
elif v2_cleanup in text:
    text = text.replace(v2_cleanup, v3_cleanup, 1)
elif v3_cleanup not in text:
    raise SystemExit("Could not harden installer cleanup for wrapper files.")

V1.write_text(text)
runpy.run_path(str(V1), run_name="__main__")
