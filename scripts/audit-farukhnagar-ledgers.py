#!/usr/bin/env python3
"""Read-only Farukhnagar ledger audit.

This script executes one SELECT statement against the linked Supabase project via
`supabase db query --linked`. It never inserts, updates, deletes, or applies a
migration. The resulting JSON report is written locally for review.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "farukhnagar-ledger-audit.json"

SQL = r"""
with target_branch as (
  select b.id, b.name
  from public.branches b
  where lower(b.name) like '%farukhnagar%'
  order by b.id
  limit 1
),
target_tenants as (
  select
    t.id,
    t.branch_id,
    t.name,
    t.monthly_rent,
    t.joining_date,
    t.due_date,
    t.status::text as status,
    t.notice,
    t.left_details,
    t.rejoin_history,
    t.paid_this_month
  from public.tenants t
  join target_branch b on b.id = t.branch_id
  where upper(trim(t.name)) in ('KAPIL', 'AZAD IRSHAD', 'AARZI IRSHAD')
     or upper(trim(t.name)) like 'HARSHIT%'
     or lower(t.name) like '%hari%'
     or t.notice is not null
     or t.status::text = 'Notice'
),
target_payments as (
  select p.*
  from public.payments p
  where p.tenant_id in (select id from target_tenants)
    and (
      p.payment_date between date '2026-06-01' and date '2026-08-31'
      or p.month in ('2026-06', '2026-07', '2026-08')
    )
),
target_cashbook as (
  select c.*
  from public.cashbook_entries c
  where c.linked_id in (select id from target_payments)
)
select jsonb_build_object(
  'generated_at', now(),
  'branch', (
    select to_jsonb(b) from target_branch b
  ),
  'tenants', coalesce((
    select jsonb_agg(to_jsonb(t) order by t.name, t.id)
    from target_tenants t
  ), '[]'::jsonb),
  'obligations', coalesce((
    select jsonb_agg(to_jsonb(o) order by o.tenant_id, o.period, o.created_at nulls last, o.id)
    from public.payment_obligations o
    where o.tenant_id in (select id from target_tenants)
      and o.period in ('2026-06', '2026-07', '2026-08')
      and lower(o.payment_type::text) = 'rent'
  ), '[]'::jsonb),
  'advances', coalesce((
    select jsonb_agg(to_jsonb(a) order by a.tenant_id, a.movement_date, a.created_at nulls last, a.id)
    from public.tenant_advances a
    where a.tenant_id in (select id from target_tenants)
      and (a.period in ('2026-06', '2026-07', '2026-08') or a.period is null)
  ), '[]'::jsonb),
  'payments', coalesce((
    select jsonb_agg(to_jsonb(p) order by p.tenant_id, p.payment_date, p.created_at nulls last, p.id)
    from target_payments p
  ), '[]'::jsonb),
  'cashbook_links', coalesce((
    select jsonb_agg(to_jsonb(c) order by c.entry_date, c.created_at nulls last, c.id)
    from target_cashbook c
  ), '[]'::jsonb)
) as audit;
"""


def main() -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as handle:
        handle.write(SQL)
        sql_path = Path(handle.name)

    try:
        command = [
            "npx",
            "supabase",
            "db",
            "query",
            "--linked",
            "-o",
            "json",
            "-f",
            str(sql_path),
        ]
        print("Running read-only Supabase audit...", flush=True)
        result = subprocess.run(
            command,
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

        raw = result.stdout.strip()
        rows = json.loads(raw)
        if not isinstance(rows, list) or len(rows) != 1 or "audit" not in rows[0]:
            raise RuntimeError(f"Unexpected query output: {raw[:500]}")

        report = rows[0]["audit"]
        REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")

        tenants = report.get("tenants", [])
        obligations = report.get("obligations", [])
        payments = report.get("payments", [])
        advances = report.get("advances", [])
        cashbook = report.get("cashbook_links", [])

        print("\nREAD-ONLY AUDIT COMPLETE")
        print(f"Report: {REPORT}")
        print(f"Tenants: {len(tenants)}")
        print(f"Rent obligations: {len(obligations)}")
        print(f"Payments: {len(payments)}")
        print(f"Advance movements: {len(advances)}")
        print(f"Linked cashbook rows: {len(cashbook)}")
        print("\nNo database rows were changed. Upload farukhnagar-ledger-audit.json here.")
    finally:
        sql_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
