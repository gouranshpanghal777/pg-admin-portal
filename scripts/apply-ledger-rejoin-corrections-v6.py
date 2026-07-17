#!/usr/bin/env python3
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
V1 = ROOT / "scripts/apply-ledger-rejoin-corrections.py"
V2 = ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py"
V3 = ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py"
V4 = ROOT / "scripts/apply-ledger-rejoin-corrections-v4.py"
V5 = ROOT / "scripts/apply-ledger-rejoin-corrections-v5.py"
V6 = Path(__file__).resolve()

if not V1.exists():
    raise SystemExit("Base ledger correction installer is missing. Run git pull origin main first.")

text = V1.read_text()

# 1) PostgreSQL regex must use a portable digit class. The prior raw-string
# escaping produced ^\\d... in SQL, which rejects valid values such as 2026-07.
invalid_period_variants = [
    r"  if p_period !~ '^\\d{4}-\\d{2}$' then",
    r"  if p_period !~ '^\d{4}-\d{2}$' then",
]
valid_period_guard = "  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then"
if valid_period_guard not in text:
    replaced = False
    for candidate in invalid_period_variants:
        if candidate in text:
            text = text.replace(candidate, valid_period_guard, 1)
            replaced = True
            break
    if not replaced:
        raise SystemExit("Could not locate the invalid rent-period regex for correction.")

# 2) Keep enum assignment type-safe.
old_status_type = "  v_status text;"
new_status_type = "  v_status public.payment_obligations.status%TYPE;"
if old_status_type in text:
    text = text.replace(old_status_type, new_status_type, 1)
elif new_status_type not in text:
    raise SystemExit("Could not verify payment-obligation status type hardening.")

# 3) Allow only the installer file itself to be modified by earlier wrappers.
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
    raise SystemExit("Could not verify installer working-tree guard.")

# 4) Hari notice cancellation is optional and must never block the four
# financial corrections.
exact_hari = """  select count(*) into v_count from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'HARI KISHAN';
  if v_count <> 1 then raise exception 'Expected one HARI KISHAN, found %', v_count; end if;
  select id into v_hari_id from public.tenants where branch_id = v_branch_id and upper(trim(name)) = 'HARI KISHAN';"""

fuzzy_hari = """  select count(*) into v_count
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

optional_hari = """  select count(*) into v_count
  from public.tenants
  where branch_id = v_branch_id
    and (
      regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKISHAN%'
      or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKRISHAN%'
      or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKISAN%'
    )
    and (notice is not null or status::text = 'Notice');

  if v_count = 1 then
    select id into v_hari_id
    from public.tenants
    where branch_id = v_branch_id
      and (
        regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKISHAN%'
        or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKRISHAN%'
        or regexp_replace(upper(coalesce(name, '')), '[^A-Z0-9]+', '', 'g') like '%HARIKISAN%'
      )
      and (notice is not null or status::text = 'Notice');
  elsif v_count = 0 then
    v_hari_id := null;
    raise notice 'Hari Kishan notice correction skipped: no matching notice-bearing tenant is currently stored.';
  else
    v_hari_id := null;
    raise notice 'Hari Kishan notice correction skipped: multiple possible notice-bearing tenants were found.';
  end if;"""

if exact_hari in text:
    text = text.replace(exact_hari, optional_hari, 1)
elif fuzzy_hari in text:
    text = text.replace(fuzzy_hari, optional_hari, 1)
elif optional_hari not in text:
    raise SystemExit("Could not verify optional Hari notice lookup.")

old_hari_action = """  -- HARI KISHAN: continuing tenant, cancel the active vacating notice only.
  update public.tenants
  set status = 'Active', notice = null
  where id = v_hari_id;

  if exists (select 1 from public.tenants where id = v_hari_id and (status::text <> 'Active' or notice is not null)) then
    raise exception 'HARI KISHAN notice cancellation post-check failed';
  end if;"""
new_hari_action = """  -- HARI KISHAN: cancel only when the guarded lookup found one current notice record.
  if v_hari_id is not null then
    update public.tenants
    set status = 'Active', notice = null
    where id = v_hari_id;

    if exists (select 1 from public.tenants where id = v_hari_id and (status::text <> 'Active' or notice is not null)) then
      raise exception 'HARI KISHAN notice cancellation post-check failed';
    end if;
  end if;"""
if old_hari_action in text:
    text = text.replace(old_hari_action, new_hari_action, 1)
elif new_hari_action not in text:
    raise SystemExit("Could not verify optional Hari notice update.")

# 5) Final cleanup removes every temporary installer version in the successful
# commit, including this one.
cleanup_markers = [
    '''    Path(__file__).unlink()
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py")''',
    '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py")''',
    '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py")''',
    '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v4.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py", "scripts/apply-ledger-rejoin-corrections-v4.py")''',
    '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v4.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v5.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py", "scripts/apply-ledger-rejoin-corrections-v4.py", "scripts/apply-ledger-rejoin-corrections-v5.py")''',
]
final_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v4.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v5.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v6.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py", "scripts/apply-ledger-rejoin-corrections-v4.py", "scripts/apply-ledger-rejoin-corrections-v5.py", "scripts/apply-ledger-rejoin-corrections-v6.py")'''
if final_cleanup not in text:
    for marker in reversed(cleanup_markers):
        if marker in text:
            text = text.replace(marker, final_cleanup, 1)
            break
    else:
        raise SystemExit("Could not verify final installer cleanup block.")

# Static preflight: never call db push with the broken regex still present.
if r"^\\d{4}-\\d{2}$" in text or r"^\d{4}-\d{2}$" in text:
    raise SystemExit("Preflight failed: invalid PostgreSQL rent-period regex is still present.")
if valid_period_guard not in text:
    raise SystemExit("Preflight failed: portable rent-period validation is missing.")
if optional_hari not in text or new_hari_action not in text:
    raise SystemExit("Preflight failed: optional Hari notice handling is missing.")
if new_status_type not in text:
    raise SystemExit("Preflight failed: enum-safe obligation status type is missing.")

V1.write_text(text)
runpy.run_path(str(V1), run_name="__main__")
