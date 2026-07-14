#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "src/App.tsx"
MIGRATION_PATH = ROOT / "supabase/migrations/202607140006_fix_tenant_edit_role_enum.sql"
ALLOWED_UNTRACKED = {"qa-smoke-report.md", "scripts/qa-smoke-test.mjs"}


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def assert_clean_enough() -> None:
    lines = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    blockers: list[str] = []
    for line in lines:
        if line.startswith("?? ") and line[3:] in ALLOWED_UNTRACKED:
            continue
        blockers.append(line)
    if blockers:
        raise RuntimeError("Working tree has unrelated changes:\n" + "\n".join(blockers))


def main() -> None:
    assert_clean_enough()
    original_app = APP_PATH.read_text()
    migration_existed = MIGRATION_PATH.exists()
    original_migration = MIGRATION_PATH.read_text() if migration_existed else ""

    try:
        app = original_app
        app = replace_once(
            app,
            "  const [rentBalance, setRentBalance] = useState(rentState.pending)\n",
            "  const [rentBalanceInput, setRentBalanceInput] = useState(String(rentState.pending))\n",
            "rent balance input state",
        )
        app = replace_once(
            app,
            "    const balanceChanged = Math.abs(rentBalance - rentState.pending) > 0.009\n",
            "    const rentBalance = Number(rentBalanceInput || 0)\n    const balanceChanged = Math.abs(rentBalance - rentState.pending) > 0.009\n",
            "rent balance parsing",
        )
        old_input = "        <Field label=\"Current rent balance\"><input className={inputClass} type=\"number\" min=\"0\" step=\"0.01\" inputMode=\"decimal\" value={rentBalance} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setRentBalance(Math.max(0, Number(event.target.value)))} required /></Field>\n"
        new_input = "        <Field label=\"Current rent balance\"><input className={inputClass} type=\"text\" inputMode=\"decimal\" pattern=\"[0-9]*[.]?[0-9]{0,2}\" value={rentBalanceInput} onFocus={(event) => event.currentTarget.select()} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => { const next = event.target.value; if (next === '' || /^\\d*\\.?\\d{0,2}$/.test(next)) setRentBalanceInput(next.replace(/^0+(?=\\d)/, '')) }} required /></Field>\n"
        app = replace_once(app, old_input, new_input, "rent balance editable input")
        APP_PATH.write_text(app)

        MIGRATION_PATH.write_text(
            "-- Cast the tenant-edit audit role to the activity_logs app_role enum.\n"
            "-- No tenant, payment, cashbook, invoice or ledger rows are changed here.\n\n"
            "do $$\n"
            "declare\n"
            "  v_definition text;\n"
            "  v_signature regprocedure := 'public.edit_tenant_with_rent_adjustment(uuid,text,text,text,uuid,integer,date,numeric,numeric,text,numeric,date,text,text,text,numeric,date,boolean,boolean)'::regprocedure;\n"
            "  v_old text := 'coalesce(v_actor_name, ''Admin''), lower(v_actor_role), ''Tenants'', ''Edit Tenant''';\n"
            "  v_new text := 'coalesce(v_actor_name, ''Admin''), lower(v_actor_role)::public.app_role, ''Tenants'', ''Edit Tenant''';\n"
            "begin\n"
            "  select pg_get_functiondef(v_signature) into v_definition;\n\n"
            "  if position(v_new in v_definition) > 0 then\n"
            "    return;\n"
            "  end if;\n\n"
            "  if position(v_old in v_definition) = 0 then\n"
            "    raise exception 'Expected tenant edit activity role expression was not found';\n"
            "  end if;\n\n"
            "  execute replace(v_definition, v_old, v_new);\n"
            "end\n"
            "$$;\n\n"
            "grant execute on function public.edit_tenant_with_rent_adjustment(uuid, text, text, text, uuid, integer, date, numeric, numeric, text, numeric, date, text, text, text, numeric, date, boolean, boolean) to authenticated;\n"
        )

        run("npm", "ci")
        run("npm", "run", "self-test")
        run("npm", "run", "build")
        run("npm", "run", "lint")

        Path(__file__).unlink()
        run(
            "git",
            "add",
            "src/App.tsx",
            "supabase/migrations/202607140006_fix_tenant_edit_role_enum.sql",
            "scripts/fix-tenant-ledger-edit-bugs.py",
        )
        run("git", "commit", "-m", "fix: tenant rent balance input and role enum save")
        run("git", "push", "origin", "main")
        run("npx", "supabase", "db", "push")
        print("\nTenant ledger edit hotfix validated, pushed and migrated successfully.")
    except Exception:
        APP_PATH.write_text(original_app)
        if migration_existed:
            MIGRATION_PATH.write_text(original_migration)
        elif MIGRATION_PATH.exists():
            MIGRATION_PATH.unlink()
        raise


if __name__ == "__main__":
    main()
