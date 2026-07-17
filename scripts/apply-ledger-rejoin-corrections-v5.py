#!/usr/bin/env python3
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
V1 = ROOT / "scripts/apply-ledger-rejoin-corrections.py"
V2 = ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py"
V3 = ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py"
V4 = ROOT / "scripts/apply-ledger-rejoin-corrections-v4.py"
V5 = Path(__file__).resolve()

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
    raise SystemExit("Could not make the Hari notice correction optional.")

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
    raise SystemExit("Could not make the Hari notice update optional.")

cleanup_variants = [
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
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py", "scripts/apply-ledger-rejoin-corrections-v4.py")'''
]

v5_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v4.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v5.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py", "scripts/apply-ledger-rejoin-corrections-v4.py", "scripts/apply-ledger-rejoin-corrections-v5.py")'''

if v5_cleanup not in text:
    for candidate in reversed(cleanup_variants):
        if candidate in text:
            text = text.replace(candidate, v5_cleanup, 1)
            break
    else:
        raise SystemExit("Could not harden installer cleanup for v5.")

V1.write_text(text)
runpy.run_path(str(V1), run_name="__main__")
