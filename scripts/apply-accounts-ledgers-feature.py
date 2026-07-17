#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parts = [root / f"scripts/.accounts-ledgers-feature-{index}.txt" for index in range(1, 13)]
missing = [str(path.relative_to(root)) for path in parts if not path.exists()]
if missing:
    raise SystemExit("Missing installer source files: " + ", ".join(missing) + ". Run git pull origin main first.")
source = "".join(path.read_text() for path in parts)
exec(compile(source, __file__, "exec"), globals(), globals())
