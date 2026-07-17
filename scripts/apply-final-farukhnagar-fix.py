#!/usr/bin/env python3
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "scripts/apply-ledger-rejoin-corrections.py"

if not BASE.exists():
    raise SystemExit("Base installer is missing. Run git pull origin main first.")

text = BASE.read_text()

for invalid in [
    r"  if p_period !~ '^\\d{4}-\\d{2}$' then",
    r"  if p_period !~ '^\d{4}-\d{2}$' then",
]:
    text = text.replace(invalid, "  if p_period !~ '^[0-9]{4}-[0-9]{2}$' then", 1)
text = text.replace(
    "  v_status text;",
    "  v_status public.payment_obligations.status%TYPE;",
    1,
)

allowed_block = '''ALLOWED_UNTRACKED = {"qa-smoke-report.md", "scripts/qa-smoke-test.mjs"}'''
allowed_replacement = '''ALLOWED_UNTRACKED = {"qa-smoke-report.md", "scripts/qa-smoke-test.mjs", "farukhnagar-ledger-audit.json"}'''
text = text.replace(allowed_block, allowed_replacement, 1)

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
    raise SystemExit("Could not verify the installer working-tree guard.")

assignment = "migration_sql = r'''"
sql_start = text.index(assignment) + len(assignment)
sql_end = text.index("\n'''\n\ntry:", sql_start)
existing_sql = text[sql_start:sql_end]
marker = "-- One-time production correction"
if marker not in existing_sql:
    raise SystemExit("Could not locate the old one-time correction SQL.")
function_sql = existing_sql[:existing_sql.index(marker)]

correction_sql = r"""
-- Exact, audit-backed Farukhnagar correction.
-- Cashbook rows are snapshotted and compared byte-for-byte inside this transaction.
do $$
declare
  v_branch_id constant uuid := 'd179afaa-d5e4-5851-aa17-e7eae926948a';
  v_kapil_id constant uuid := 'dc5628be-088f-55b9-94c4-ff3d05b86739';
  v_harshit_id constant uuid := '1e05ecdd-9bbc-5078-8650-89d4e9734a6f';
  v_azad_id constant uuid := 'd0a6e553-d7d0-5a12-8fab-4ed42274a6e6';
  v_aarzi_id constant uuid := '8e9b6d1e-01fb-59cf-873a-0ab0665f8866';

  v_kapil_obligation constant uuid := 'c0fdc5a1-1c39-40f3-b093-204b55e37364';
  v_kapil_advance constant uuid := '1afd4a16-beb7-44cb-a995-260020e1a65d';

  v_harshit_payment constant uuid := 'e67318c1-fab9-4056-8617-a174447e56b5';
  v_harshit_july_obligation constant uuid := 'df54d45c-4bdc-435d-89e8-fbe8cfc88980';
  v_harshit_august_obligation constant uuid := '9efdc67a-3a93-4038-a112-b3432bcc9744';
  v_harshit_cashbook constant uuid := '163be4b2-5401-40fc-a251-538ddeec6690';

  v_azad_june_payment constant uuid := 'cfb866da-912a-489a-9744-e1958fd06d4e';
  v_transfer_payment constant uuid := '99083fb9-cd0e-4211-ab26-b580dd3d7f2a';
  v_transfer_cashbook constant uuid := 'adbd81bf-b861-468b-a8f6-147c8a40c13f';
  v_azad_june_obligation constant uuid := '3ec9bec8-dc67-4a99-8323-cbd385f19d78';
  v_azad_july_obligation constant uuid := '31d08116-7e1c-42d6-baaf-ae139974876f';
  v_aarzi_june_obligation constant uuid := '7248be09-ede3-453f-998d-bb55edd8f622';
  v_aarzi_july_obligation constant uuid := 'c3fdeef3-63c4-4d79-b710-5bfa449e79aa';

  v_rows integer;
  v_value text;
  v_harshit_cashbook_before jsonb;
  v_transfer_cashbook_before jsonb;
begin
  if not exists (
    select 1 from public.branches
    where id = v_branch_id and upper(trim(name)) = 'PG 95 FARUKHNAGAR'
  ) then
    raise exception 'Audit branch no longer matches PG 95 FARUKHNAGAR';
  end if;

  if not exists (select 1 from public.tenants where id = v_kapil_id and branch_id = v_branch_id and upper(trim(name)) = 'KAPIL') then
    raise exception 'Audited KAPIL tenant no longer matches';
  end if;
  if not exists (select 1 from public.tenants where id = v_harshit_id and branch_id = v_branch_id and upper(trim(name)) = 'HARSHIT KHARI') then
    raise exception 'Audited HARSHIT KHARI tenant no longer matches';
  end if;
  if not exists (select 1 from public.tenants where id = v_azad_id and branch_id = v_branch_id and upper(trim(name)) = 'AZAD IRSHAD') then
    raise exception 'Audited AZAD IRSHAD tenant no longer matches';
  end if;
  if not exists (select 1 from public.tenants where id = v_aarzi_id and branch_id = v_branch_id and upper(trim(name)) = 'AARZI IRSHAD') then
    raise exception 'Audited AARZI IRSHAD tenant no longer matches';
  end if;

  select to_jsonb(c) into v_harshit_cashbook_before
  from public.cashbook_entries c where c.id = v_harshit_cashbook;
  if v_harshit_cashbook_before is null then
    raise exception 'HARSHIT linked cashbook row is missing';
  end if;

  select to_jsonb(c) into v_transfer_cashbook_before
  from public.cashbook_entries c where c.id = v_transfer_cashbook;
  if v_transfer_cashbook_before is null then
    raise exception 'AZAD duplicate-payment linked cashbook row is missing';
  end if;

  if not exists (
    select 1 from public.payment_obligations
    where id = v_kapil_obligation
      and tenant_id = v_kapil_id
      and period = '2026-07'
      and lower(payment_type::text) = 'rent'
  ) then
    raise exception 'Audited KAPIL July obligation is missing';
  end if;

  delete from public.tenant_advances
  where id = v_kapil_advance
    and tenant_id = v_kapil_id
    and period = '2026-07'
    and lower(movement_type::text) = 'used';

  update public.payment_obligations
  set agreed_amount = 5000,
      received_amount = 0,
      advance_applied = 0,
      due_date = date '2026-07-05',
      status = 'Overdue',
      updated_at = now()
  where id = v_kapil_obligation
    and tenant_id = v_kapil_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KAPIL obligation update affected % rows', v_rows;
  end if;

  select month into v_value
  from public.payments
  where id = v_harshit_payment
    and tenant_id = v_harshit_id
    and amount = 6500
    and payment_date = date '2026-07-16'
    and lower(payment_type::text) = 'rent';
  if not found then
    raise exception 'Audited HARSHIT 16/07 payment is missing';
  end if;

  if v_value = '2026-08' then
    update public.payments
    set month = '2026-07',
        description = trim(coalesce(description, '') || ' [Corrected: July rejoin rent]')
    where id = v_harshit_payment;
  elsif v_value <> '2026-07' then
    raise exception 'HARSHIT payment has unexpected rent month %', v_value;
  end if;

  update public.payment_obligations
  set agreed_amount = 6500,
      received_amount = 6500,
      advance_applied = 0,
      due_date = date '2026-07-14',
      status = 'Paid',
      updated_at = now()
  where id = v_harshit_july_obligation
    and tenant_id = v_harshit_id
    and period = '2026-07';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'HARSHIT July obligation update affected % rows', v_rows;
  end if;

  update public.payment_obligations
  set agreed_amount = 6500,
      received_amount = 0,
      advance_applied = 0,
      due_date = date '2026-08-14',
      status = 'Pending',
      updated_at = now()
  where id = v_harshit_august_obligation
    and tenant_id = v_harshit_id
    and period = '2026-08';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'HARSHIT August obligation update affected % rows', v_rows;
  end if;

  update public.tenants
  set due_date = date '2026-08-14',
      rejoin_history = (
        select coalesce(jsonb_agg(
          case when item.value->>'rejoinDate' = '2026-07-14'
            then item.value || jsonb_build_object('dueDate', '2026-07-14')
            else item.value end
          order by item.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(coalesce(public.tenants.rejoin_history, '[]'::jsonb))
          with ordinality as item(value, ordinality)
      )
  where id = v_harshit_id;

  if not exists (
    select 1 from public.payments
    where id = v_azad_june_payment
      and tenant_id = v_azad_id
      and month = '2026-06'
      and amount = 8500
      and payment_date = date '2026-06-22'
  ) then
    raise exception 'AZAD genuine June payment is missing';
  end if;

  select tenant_id::text || '|' || month into v_value
  from public.payments
  where id = v_transfer_payment
    and amount = 8500
    and payment_date = date '2026-06-22'
    and lower(payment_type::text) = 'rent';
  if not found then
    raise exception 'Audited AZAD duplicate payment is missing';
  end if;

  if v_value = v_azad_id::text || '|2026-07' then
    update public.payments
    set tenant_id = v_aarzi_id,
        month = '2026-06',
        description = trim(coalesce(description, '') || ' [Corrected: AARZI IRSHAD June rent]')
    where id = v_transfer_payment;
  elsif v_value <> v_aarzi_id::text || '|2026-06' then
    raise exception 'Transfer payment has unexpected tenant/month %', v_value;
  end if;

  update public.payment_obligations
  set agreed_amount = 8500,
      received_amount = 8500,
      advance_applied = 0,
      status = 'Paid',
      updated_at = now()
  where id = v_azad_june_obligation
    and tenant_id = v_azad_id
    and period = '2026-06';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'AZAD June obligation update affected % rows', v_rows; end if;

  update public.payment_obligations
  set agreed_amount = 8500,
      received_amount = 0,
      advance_applied = 0,
      due_date = date '2026-07-14',
      status = 'Overdue',
      updated_at = now()
  where id = v_azad_july_obligation
    and tenant_id = v_azad_id
    and period = '2026-07';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'AZAD July obligation update affected % rows', v_rows; end if;

  update public.payment_obligations
  set agreed_amount = 8500,
      received_amount = 8500,
      advance_applied = 0,
      status = 'Paid',
      updated_at = now()
  where id = v_aarzi_june_obligation
    and tenant_id = v_aarzi_id
    and period = '2026-06';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'AARZI June obligation update affected % rows', v_rows; end if;

  update public.payment_obligations
  set agreed_amount = 8500,
      received_amount = 0,
      advance_applied = 0,
      due_date = date '2026-07-14',
      status = 'Overdue',
      updated_at = now()
  where id = v_aarzi_july_obligation
    and tenant_id = v_aarzi_id
    and period = '2026-07';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'AARZI July obligation update affected % rows', v_rows; end if;

  update public.tenants
  set due_date = date '2026-07-14'
  where id in (v_azad_id, v_aarzi_id);

  if exists (
    select 1 from public.tenant_advances
    where tenant_id = v_kapil_id and period = '2026-07'
      and lower(movement_type::text) = 'used'
  ) then
    raise exception 'KAPIL unsupported July advance usage still exists';
  end if;

  if not exists (
    select 1 from public.payment_obligations
    where id = v_kapil_obligation
      and agreed_amount = 5000
      and received_amount = 0
      and advance_applied = 0
      and greatest(0, agreed_amount - received_amount - advance_applied) = 5000
  ) then
    raise exception 'KAPIL final July balance is not 5000';
  end if;

  if not exists (
    select 1 from public.payments
    where id = v_harshit_payment and tenant_id = v_harshit_id and month = '2026-07'
  ) then
    raise exception 'HARSHIT payment was not assigned to July';
  end if;
  if not exists (
    select 1 from public.payment_obligations
    where id = v_harshit_july_obligation and received_amount = 6500 and status::text = 'Paid'
  ) then
    raise exception 'HARSHIT July is not paid';
  end if;
  if not exists (
    select 1 from public.payment_obligations
    where id = v_harshit_august_obligation
      and received_amount = 0
      and due_date = date '2026-08-14'
      and status::text = 'Pending'
  ) then
    raise exception 'HARSHIT August pending obligation is incorrect';
  end if;

  if not exists (
    select 1 from public.payments
    where id = v_transfer_payment and tenant_id = v_aarzi_id and month = '2026-06'
  ) then
    raise exception 'AZAD duplicate payment was not transferred to AARZI June';
  end if;
  if not exists (
    select 1 from public.payment_obligations
    where id = v_azad_june_obligation and received_amount = 8500 and status::text = 'Paid'
  ) or not exists (
    select 1 from public.payment_obligations
    where id = v_azad_july_obligation and received_amount = 0
      and due_date = date '2026-07-14' and status::text = 'Overdue'
  ) then
    raise exception 'AZAD final June/July ledger is incorrect';
  end if;
  if not exists (
    select 1 from public.payment_obligations
    where id = v_aarzi_june_obligation and received_amount = 8500 and status::text = 'Paid'
  ) or not exists (
    select 1 from public.payment_obligations
    where id = v_aarzi_july_obligation and received_amount = 0
      and due_date = date '2026-07-14' and status::text = 'Overdue'
  ) then
    raise exception 'AARZI final June/July ledger is incorrect';
  end if;

  if (select to_jsonb(c) from public.cashbook_entries c where c.id = v_harshit_cashbook)
      is distinct from v_harshit_cashbook_before then
    raise exception 'HARSHIT cashbook row changed unexpectedly';
  end if;
  if (select to_jsonb(c) from public.cashbook_entries c where c.id = v_transfer_cashbook)
      is distinct from v_transfer_cashbook_before then
    raise exception 'AZAD/AARZI linked cashbook row changed unexpectedly';
  end if;

  raise notice 'Exact Farukhnagar ledger correction completed; linked cashbook rows are unchanged.';
end;
$$;
"""

new_sql = function_sql + correction_sql
text = text[:sql_start] + new_sql + text[sql_end:]

push_anchor = '    run("npx", "supabase", "db", "push")'
push_index = text.index(push_anchor)
cleanup_start = text.index("    Path(__file__).unlink()", push_index)
commit_line = '    run("git", "commit", "-m", "fix: correct Farukhnagar ledgers and make rejoin rent-safe")'
commit_index = text.index(commit_line, cleanup_start)
cleanup = '''    Path(__file__).unlink()
    for version in range(2, 8):
        (ROOT / f"scripts/apply-ledger-rejoin-corrections-v{version}.py").unlink(missing_ok=True)
    (ROOT / "scripts/audit-farukhnagar-ledgers.py").unlink(missing_ok=True)
    (ROOT / "scripts/apply-final-farukhnagar-fix.py").unlink(missing_ok=True)
    run(
        "git", "add",
        "src/App.tsx",
        "src/lib/database.ts",
        str(MIGRATION.relative_to(ROOT)),
        "scripts/apply-ledger-rejoin-corrections.py",
        "scripts/apply-ledger-rejoin-corrections-v2.py",
        "scripts/apply-ledger-rejoin-corrections-v3.py",
        "scripts/apply-ledger-rejoin-corrections-v4.py",
        "scripts/apply-ledger-rejoin-corrections-v5.py",
        "scripts/apply-ledger-rejoin-corrections-v6.py",
        "scripts/apply-ledger-rejoin-corrections-v7.py",
        "scripts/audit-farukhnagar-ledgers.py",
        "scripts/apply-final-farukhnagar-fix.py",
    )
'''
text = text[:cleanup_start] + cleanup + text[commit_index:]

required = [
    "^[0-9]{4}-[0-9]{2}$",
    "v_status public.payment_obligations.status%TYPE",
    "v_kapil_obligation constant uuid := 'c0fdc5a1-1c39-40f3-b093-204b55e37364'",
    "set agreed_amount = 5000",
    "v_harshit_payment constant uuid := 'e67318c1-fab9-4056-8617-a174447e56b5'",
    "v_transfer_payment constant uuid := '99083fb9-cd0e-4211-ab26-b580dd3d7f2a'",
    "HARSHIT cashbook row changed unexpectedly",
    "AZAD/AARZI linked cashbook row changed unexpectedly",
    "rejoinTenantWithObligation",
    "Cancel Vacating Notice",
]
for item in required:
    if item not in text:
        raise SystemExit(f"Preflight failed; missing: {item}")

migration_preview = new_sql.lower()
if "update public.cashbook_entries" in migration_preview or "delete from public.cashbook_entries" in migration_preview:
    raise SystemExit("Preflight failed: correction SQL may not modify cashbook rows.")
if "sync_rent_obligation_from_entries(v_kapil" in migration_preview:
    raise SystemExit("Preflight failed: KAPIL must not use generic legacy rebuild logic.")

BASE.write_text(text)
runpy.run_path(str(BASE), run_name="__main__")
