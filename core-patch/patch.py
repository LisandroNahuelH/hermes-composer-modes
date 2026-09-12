#!/usr/bin/env python3
"""composer-modes core patcher — transactional, anchored, reversible.

Applies the composer-modes note-channel seams to a Hermes Agent checkout:

    tui_gateway/prompt_turn.py            note param + ask sandwich
    tui_gateway/methods_prompt.py         note param + session.note.stage RPC + pop/re-stage
    tui_gateway/session_auto_continue.py  note carry through the busy/queue envelope
    agent/turn_context.py                 pristine titles + model-facing note merge
    tui_gateway/AGENTS.md                 documentation section

The operations live in ``ops.json`` next to this file: an ordered list of exact
search/replace pairs per file, generated from a verified diff. The patcher is
all-or-nothing:

  phase A  every anchor must match exactly once (read-only)
  phase B  backup (.bak-<stamp>-<rand>, never overwrites) then write
  phase C  re-verify every target string + ast.parse -> else rollback everything

Exit codes: 0 ok/no-op | 2 anchors missing (nothing written) | 3 failed, rolled back
clean | 4 ROLLBACK INCOMPLETE (files listed) | 5 bad usage/environment.
"""

from __future__ import annotations

import argparse
import ast
import datetime as _dt
import json
import os
import random
import re
import shutil
import sys
from pathlib import Path

TOKEN = "[composer-modes-patch]"
MANIFEST = "composer-modes-patch-manifest.json"
HERE = Path(__file__).resolve().parent


def log(msg: str) -> None:
    print(f"[composer-modes] {msg}", flush=True)


def find_repo(explicit: str | None) -> Path | None:
    cands: list[Path] = []
    if explicit:
        cands.append(Path(explicit))
    else:
        here = Path.cwd()
        for base in [here, *here.parents]:
            if (base / "tui_gateway" / "methods_prompt.py").is_file():
                cands.append(base)
                break
        env = os.environ.get("HERMES_AGENT_DIR")
        if env:
            cands.append(Path(env))
        local = os.environ.get("LOCALAPPDATA")
        if local:
            cands.append(Path(local) / "hermes" / "hermes-agent")
        cands.append(Path.home() / ".hermes" / "hermes-agent")
    for c in cands:
        if (c / "tui_gateway" / "methods_prompt.py").is_file():
            return c
    return None


def load_ops() -> dict[str, list[dict]]:
    return json.loads((HERE / "ops.json").read_text(encoding="utf-8"))


def read_text(p: Path) -> str:
    with p.open(encoding="utf-8", newline="") as fh:
        return fh.read().replace("\r\n", "\n")


def token_line(rel: str) -> str:
    return f"<!-- {TOKEN} -->" if rel.endswith(".md") else f"# {TOKEN}"


def has_token(text: str) -> bool:
    return TOKEN in text


def is_fully_applied(text: str, ops: list[dict]) -> bool:
    return all((op["new"] in text) if op["new"] else True for op in ops)


def missing_anchors(text: str, ops: list[dict]) -> list[int]:
    return [i for i, op in enumerate(ops) if op["old"] and text.count(op["old"]) != 1]


def backup_path(p: Path) -> Path:
    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    for _ in range(50):
        cand = p.with_name(p.name + f".bak-{stamp}-{random.randint(0x1000, 0xFFFF):x}")
        if not cand.exists():
            return cand
    raise RuntimeError(f"could not allocate a backup name next to {p}")


def apply_ops(text: str, ops: list[dict]) -> str:
    for op in ops:
        if op["old"]:
            text = text.replace(op["old"], op["new"], 1)
        else:
            text = text + ("" if text.endswith("\n") else "\n") + op["new"]
    return text


def main() -> int:
    ap = argparse.ArgumentParser(description="composer-modes core patcher")
    ap.add_argument("--repo", help="Hermes Agent checkout (auto-detected when omitted)")
    ap.add_argument("--verify-only", action="store_true", help="phase A only: check anchors, write nothing")
    ap.add_argument("--dry-run", action="store_true", help="alias of --verify-only")
    ap.add_argument("--json", action="store_true", help="machine-readable report on stdout")
    args = ap.parse_args()

    repo = find_repo(args.repo)
    if repo is None:
        log("ERROR: could not locate a Hermes Agent checkout (pass --repo)")
        return 5

    ops_by_file = load_ops()
    report: dict = {"repo": str(repo), "files": {}, "phase": "verify-only" if (args.verify_only or args.dry_run) else "apply"}
    plan: list[tuple[str, list[dict], str, bool]] = []

    # ── phase A — classify + verify every anchor, touch nothing ──
    for rel, ops in ops_by_file.items():
        p = repo / rel
        if not p.is_file():
            report["files"][rel] = {"status": "missing-file"}
            _finish(report, args)
            log(f"ERROR: {rel} not found under {repo}")
            return 5
        text = read_text(p)
        applied = is_fully_applied(text, ops)
        token = has_token(text)
        if applied and token:
            report["files"][rel] = {"status": "already-patched"}
            continue
        if applied and not token:
            # Patched tree that never saw this tool (e.g. arrived via the upstream PR):
            # the only delta is the marker.
            report["files"][rel] = {"status": "ready-token-only"}
            plan.append((rel, [], text, True))
            continue
        if token and not applied:
            report["files"][rel] = {"status": "tampered", "detail": "token present but target strings incomplete"}
            _finish(report, args)
            log(f"ERROR: {rel} carries the patch token but is not fully patched — refusing to guess")
            return 5 if not (args.verify_only or args.dry_run) else 5
        miss = missing_anchors(text, ops)
        if miss:
            report["files"][rel] = {"status": "anchors-missing", "ops": miss}
        else:
            report["files"][rel] = {"status": "ready"}
            plan.append((rel, ops, text, applied))

    pending = [f for f, v in report["files"].items() if v["status"] == "anchors-missing"]
    if pending:
        log("anchors missing — nothing was written (upstream drift? see docs/troubleshooting.md):")
        for f in pending:
            log(f"  - {f}: ops {report['files'][f]['ops']}")
        _finish(report, args)
        return 2
    if not plan:
        log("nothing to do — core already patched")
        report["phase"] = "no-op"
        _finish(report, args)
        return 0
    if args.verify_only or args.dry_run:
        log(f"verify-only OK — {len(plan)} file(s) ready: {', '.join(f for f, *_ in plan)}")
        _finish(report, args)
        return 0

    # ── phase B — backup then write ──
    report["phase"] = "apply"
    written: list[dict] = []
    for rel, ops, text, _ in plan:
        p = repo / rel
        bak = backup_path(p)
        shutil.copy2(p, bak)
        new_text = apply_ops(text, ops)
        if not new_text.endswith("\n"):
            new_text += "\n"
        new_text += token_line(rel) + "\n"
        with p.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write(new_text)
        written.append({"file": rel, "bak": str(bak), "sha_before": _sha(text), "sha_after": _sha(new_text)})
        log(f"{'tokened' if not ops else 'patched'} {rel} (backup: {bak.name})")

    # ── phase C — re-verify everything; rollback on any failure ──
    bad: list[str] = []
    for rel, ops, _, _ in plan:
        p = repo / rel
        text = read_text(p)
        if not (is_fully_applied(text, ops) and has_token(text)):
            bad.append(rel)
        elif rel.endswith(".py"):
            try:
                ast.parse(text)
            except SyntaxError:
                bad.append(rel)
    if bad:
        log("re-verify FAILED — rolling back the files written in this run")
        unrestored: list[str] = []
        for entry in written:
            p = repo / entry["file"]
            try:
                shutil.copy2(entry["bak"], p)
                if _sha(read_text(p)) != entry["sha_before"]:
                    unrestored.append(entry["file"])
            except Exception as exc:  # noqa: BLE001 - report, never crash mid-rollback
                unrestored.append(f"{entry['file']} ({exc})")
        report["rollback"] = {"failed_files": bad, "unrestored": unrestored}
        _finish(report, args)
        if unrestored:
            log("ROLLBACK INCOMPLETE — restore these by hand:")
            for u in unrestored:
                log(f"  - {u}")
            return 4
        log("rolled back clean — tree is exactly as before this run")
        return 3

    manifest = {
        "tool": "hermes-composer-modes/core-patch",
        "patched_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "files": written,
    }
    (repo / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    log(f"all good — manifest written to {repo / MANIFEST}")
    _finish(report, args)
    return 0


def _sha(text: str) -> str:
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _finish(report: dict, args: argparse.Namespace) -> None:
    if args.json:
        report["token"] = TOKEN
        print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
