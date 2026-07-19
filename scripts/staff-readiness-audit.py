#!/usr/bin/env python3
from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "staff-readiness-report.json"


def load_env() -> dict[str, str]:
    values = dict(os.environ)
    for filename in (".env.local", ".env"):
        path = ROOT / filename
        if not path.exists():
            continue
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def request(url: str, method: str, headers: dict[str, str], body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode()
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error


def main() -> None:
    env = load_env()
    base = (env.get("VITE_SUPABASE_URL") or env.get("PG95_SUPABASE_URL") or "").rstrip("/")
    anon = env.get("VITE_SUPABASE_ANON_KEY") or env.get("PG95_SUPABASE_ANON_KEY") or ""
    if not base or not anon:
        raise SystemExit("Supabase public URL/key not found in .env.local or environment.")

    username = input("Staff username or email: ").strip()
    password = getpass.getpass("Staff password (hidden): ")
    email = username if "@" in username else f"{username}@staff.pg95.local"

    auth = request(
        f"{base}/auth/v1/token?grant_type=password",
        "POST",
        {"Content-Type": "application/json", "apikey": anon},
        {"email": email, "password": password},
    )
    token = auth.get("access_token") if isinstance(auth, dict) else None
    if not token:
        raise SystemExit("Staff login failed.")

    headers = {"Content-Type": "application/json", "apikey": anon, "Authorization": f"Bearer {token}"}
    branches = request(f"{base}/rest/v1/branches?select=id,name&active=eq.true&order=name", "GET", headers) or []
    if not branches:
        raise SystemExit("No active branch is visible to this staff account.")

    print("\nAssigned branches:")
    for index, branch in enumerate(branches, 1):
        print(f"  {index}. {branch['name']}")
    choice = input(f"Choose branch [1-{len(branches)}] (default 1): ").strip()
    selected = branches[int(choice or "1") - 1]

    result = request(
        f"{base}/rest/v1/rpc/pg95_staff_readiness_probe",
        "POST",
        headers,
        {"p_branch_id": selected["id"]},
    )
    report = {"staff": email, "branch": selected, "result": result}
    REPORT.write_text(json.dumps(report, indent=2))

    print("\n=== STAFF READINESS RESULT ===")
    print(json.dumps(result, indent=2))
    print(f"\nReport: {REPORT}")
    if not result or not result.get("success"):
        raise SystemExit(1)
    print("\nPASS: live staff permission, Cashbook retry, vendor ledger and cleanup checks completed.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
