#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "scripts/apply-performance-audit-fix.py"
SELF = Path(__file__).resolve()


def run(*args: str) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def main() -> None:
    spec = importlib.util.spec_from_file_location("pg95_performance_installer", ORIGINAL)
    if spec is None or spec.loader is None:
        raise SystemExit("Unable to load the performance installer.")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    strict_replace_once = module.replace_once

    def compatible_replace(text: str, old: str, new: str, label: str) -> str:
        if label == "remove export log redownload":
            count = text.count(old)
            if count < 1:
                raise SystemExit(
                    f"{label}: expected at least one match, found {count}. No files were committed."
                )
            print(f"Applying {label} to {count} matching blocks.", flush=True)
            return text.replace(old, new)
        return strict_replace_once(text, old, new, label)

    module.replace_once = compatible_replace
    module.main()

    # The original installer commits its own deletion after a successful run.
    # Remove this compatibility wrapper in a separate tiny cleanup commit.
    if SELF.exists():
        SELF.unlink()
        run("git", "add", "scripts/apply-performance-audit-fix-v2.py")
        run("git", "commit", "-m", "chore: remove temporary performance installer wrapper")
        run("git", "push", "origin", "main")


if __name__ == "__main__":
    main()
