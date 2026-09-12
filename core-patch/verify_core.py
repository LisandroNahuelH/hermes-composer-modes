#!/usr/bin/env python3
"""composer-modes core verification gate.

Confirms a Hermes Agent checkout carries the composer-modes seams:
every file patched (token + target strings), every .py parses, and the two
touched gateway modules import cleanly with the target interpreter.

Exit codes: 0 verified | 1 problems found | 5 environment/usage.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import subprocess
import sys
from pathlib import Path

TOKEN = "[composer-modes-patch]"
HERE = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser(description="composer-modes core verification")
    ap.add_argument("--repo", required=True, help="Hermes Agent checkout to verify")
    ap.add_argument("--python", help="interpreter for the import gate (default: <repo>/venv)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    repo = Path(args.repo)
    ops_by_file = json.loads((HERE / "ops.json").read_text(encoding="utf-8"))
    report: dict = {"repo": str(repo), "checks": {}, "ok": True}

    def fail(name: str, detail: str) -> None:
        report["checks"][name] = {"ok": False, "detail": detail}
        report["ok"] = False

    def ok(name: str, detail: str = "") -> None:
        report["checks"][name] = {"ok": True, "detail": detail}

    files_ok = True
    for rel, ops in ops_by_file.items():
        p = repo / rel
        if not p.is_file():
            fail(f"file:{rel}", "missing")
            files_ok = False
            continue
        text = p.open(encoding="utf-8").read()
        if TOKEN not in text:
            fail(f"token:{rel}", "patch token not found")
            files_ok = False
        missing = [i for i, op in enumerate(ops) if op["new"] and op["new"] not in text]
        if missing:
            fail(f"targets:{rel}", f"missing target ops {missing}")
            files_ok = False
        if rel.endswith(".py"):
            try:
                ast.parse(text)
            except SyntaxError as exc:
                fail(f"syntax:{rel}", str(exc))
                files_ok = False
    if files_ok:
        ok("files", "5/5 patched, tokens + targets + syntax")

    py = Path(args.python) if args.python else repo / "venv" / "Scripts" / "python.exe"
    if not py.is_file():
        py = repo / "venv" / "bin" / "python"
    if not py.is_file():
        fail("import-gate", f"interpreter not found at {py} (pass --python)")
    else:
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        proc = subprocess.run(
            [str(py), "-c", "import tui_gateway.methods_prompt, tui_gateway.prompt_turn, tui_gateway.session_auto_continue; import agent.turn_context"],
            cwd=str(repo), env=env, capture_output=True, text=True, timeout=120)
        if proc.returncode == 0:
            ok("import-gate", f"{py} imported the patched modules")
        else:
            fail("import-gate", (proc.stderr or proc.stdout or "").strip()[-400:])

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        for name, entry in report["checks"].items():
            print(f"[{'ok' if entry['ok'] else 'FAIL'}] {name} {entry['detail']}".rstrip())
        print("VERIFIED" if report["ok"] else "PROBLEMS FOUND")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
