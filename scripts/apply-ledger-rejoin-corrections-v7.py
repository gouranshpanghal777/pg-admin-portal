#!/usr/bin/env python3
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
V1 = ROOT / "scripts/apply-ledger-rejoin-corrections.py"
VERSIONS = [ROOT / f"scripts/apply-ledger-rejoin-corrections-v{i}.py" for i in range(2, 8)]

if not V1.exists():
    raise SystemExit("Base ledger correction installer is missing. Run git pull origin main first.")

text = V1.read_text()

# Portable PostgreSQL rent-period validation.
for invalid in [r"  if p_period !~ '^\\d{4}-\\d{2}$' then", r"  if p_period !~ '^\d{4}-\d{2}$' then"]:
    text = text.replace(invalid, "  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then", 1)
if "  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then" not in text:
    raise SystemExit("Could not verify the portable rent-period validation.")

# Enum-safe obligation status variable.
text = text.replace("  v_status text;", "  v_status public.payment_obligations.status%TYPE;", 1)
if "  v_status public.payment_obligations.status%TYPE;" not in text:
    raise SystemExit("Could not verify enum-safe obligation status handling.")

# Permit only this installer source to be modified by previous failed wrappers.
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
    raise SystemExit("Could not verify installer working-tree safety guard.")

# Hari notice correction must never block financial corrections.
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

# Kapil is a legacy ledger row: preserve its stored ₹1,000 received amount and
# remove only the unsupported ₹1,000 advance usage. Rebuilding from payments
# would incorrectly erase the legacy received amount and show ₹6,000 pending.
if "  v_kapil_balance numeric;" not in text:
    text = text.replace("  v_kapil_due date;", "  v_kapil_due date;\n  v_kapil_balance numeric;", 1)

kapil_start = text.index("  -- KAPIL:")
harshit_start = text.index("  -- HARSHIT:", kapil_start)
kapil_block = """  -- KAPIL: preserve the legacy received amount and remove only unsupported advance usage.
  select due_date into v_kapil_due
  from public.payment_obligations
  where tenant_id = v_kapil_id and period = '2026-07' and lower(payment_type::text) = 'rent'
  order by created_at nulls last, id
  limit 1;
  if v_kapil_due is null then
    raise exception 'KAPIL July 2026 rent obligation not found';
  end if;

  delete from public.tenant_advances
  where tenant_id = v_kapil_id
    and period = '2026-07'
    and lower(movement_type::text) = 'used';

  update public.payment_obligations
  set advance_applied = 0
  where tenant_id = v_kapil_id
    and period = '2026-07'
    and lower(payment_type::text) = 'rent';

  select greatest(0, agreed_amount - received_amount - advance_applied)
    into v_kapil_balance
  from public.payment_obligations
  where tenant_id = v_kapil_id
    and period = '2026-07'
    and lower(payment_type::text) = 'rent'
  order by created_at nulls last, id
  limit 1;

  if v_kapil_balance is null or abs(v_kapil_balance - 5000) > 0.01 then
    raise exception 'KAPIL post-check failed. Expected July balance 5000, calculated %', coalesce(v_kapil_balance::text, 'missing');
  end if;

"""
text = text[:kapil_start] + kapil_block + text[harshit_start:]

# The user explicitly selected the duplicate Azad payment for transfer to Aarzi.
# Do not reject that row merely because current tenant master rent differs.
amount_guard = """    if abs(v_transfer_amount - v_aarzi_rent) > 0.01 then
      raise exception 'Transfer payment amount % does not match AARZI monthly rent %', v_transfer_amount, v_aarzi_rent;
    end if;

"""
text = text.replace(amount_guard, "", 1)

# Successful cleanup removes all temporary wrappers, including v7.
cleanup_anchor = '    Path(__file__).unlink()\n'
cleanup_start = text.index(cleanup_anchor, text.index('    run("npx", "supabase", "db", "push")'))
commit_line = '    run("git", "commit", "-m", "fix: correct Farukhnagar ledgers and make rejoin rent-safe")'
commit_index = text.index(commit_line, cleanup_start)
cleanup_block = text[cleanup_start:commit_index]
final_cleanup = '''    Path(__file__).unlink()
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v2.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v3.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v4.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v5.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v6.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-ledger-rejoin-corrections-v7.py").unlink(missing_ok=True)
    run("git", "add", "src/App.tsx", "src/lib/database.ts", str(MIGRATION.relative_to(ROOT)), "scripts/apply-ledger-rejoin-corrections.py", "scripts/apply-ledger-rejoin-corrections-v2.py", "scripts/apply-ledger-rejoin-corrections-v3.py", "scripts/apply-ledger-rejoin-corrections-v4.py", "scripts/apply-ledger-rejoin-corrections-v5.py", "scripts/apply-ledger-rejoin-corrections-v6.py", "scripts/apply-ledger-rejoin-corrections-v7.py")
'''
text = text[:cleanup_start] + final_cleanup + text[commit_index:]

# End-to-end static preflight. No database command runs if any known-bad logic remains.
checks = {
    "portable period guard": "  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then",
    "enum-safe status": "  v_status public.payment_obligations.status%TYPE;",
    "legacy-safe Kapil update": "  set advance_applied = 0",
    "Kapil balance post-check": "abs(v_kapil_balance - 5000)",
    "optional Hari lookup": "Hari Kishan notice correction skipped",
    "optional Hari action": "if v_hari_id is not null then",
    "v7 cleanup": "apply-ledger-rejoin-corrections-v7.py",
}
for label, marker in checks.items():
    if marker not in text:
        raise SystemExit(f"Preflight failed: {label} is missing.")
if "v_result := public.sync_rent_obligation_from_entries(v_kapil_id" in text:
    raise SystemExit("Preflight failed: Kapil still uses destructive payment-table rebuild logic.")
if "Transfer payment amount % does not match AARZI monthly rent" in text:
    raise SystemExit("Preflight failed: obsolete Azad/Aarzi amount guard remains.")
if "cashbook_entries\n  set" in text.lower() or "delete from public.cashbook_entries" in text.lower():
    raise SystemExit("Preflight failed: migration must not modify cashbook rows.")

V1.write_text(text)
runpy.run_path(str(V1), run_name="__main__")
