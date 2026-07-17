#!/usr/bin/env python3
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
V1 = ROOT / "scripts/apply-ledger-rejoin-corrections.py"
V2 = ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py"
V3 = ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py"
V4 = Path(__file__).resolve()

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

old_hari = """  select count(*) into v_count from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'HARI KISHAN';
  if v_count <> 1 then raise exception 'Expected one HARI KISHAN, found %', v_count; end if;
  select id into v_hari_id from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'HARI KISHAN';"""
new_hari = """  select count(*) into v_count
  from public.tenants
  where branch_id = v_branch_id
    and (
      regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKISHAN%'
      or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKRISHAN%'
      or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKISAN%'
    )
    and (notice is not null or status::text = 'Notice');
  if v_count <> 1 then raise exception 'Expected one notice-bearing Hari Kishan/Krishan tenant, found %', v_count; end if;
  select id into v_hari_id
  from public.tenants
  where branch_id = v_branch_id
    and (
      regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKISHAN%'
      or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKRISHAN%'
      or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKISAN%'
    )
    and (notice is not null or status::text = 'Notice');"""
if old_hari in text:
    text = text.replace(old_hari, new_hari, 1)
elif new_hari not in text:
    raise SystemExit("Could not harden the Hari Kishan/Krishan guarded lookup.")

original_cleanup = '''    Path(__file__).unlink()
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py")'''
v2_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py")'''
v3_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py")'''
v4_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v4.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py", "scripts/apply-ledger-rejoin-corrections-v4.py")'''
if original_cleanup in text:
    text = text.replace(original_cleanup, v4_cleanup, 1)
elif v2_cleanup in text:
    text = text.replace(v2_cleanup, v4_cleanup, 1)
elif v3_cleanup in text:
    text = text.replace(v3_cleanup, v4_cleanup, 1)
elif v4_cleanup not in text:
    raise SystemExit("Could not harden installer cleanup for wrapper files.")

V1.write_text(text)
runpy.run_path(str(V1), run_name="__main__")
