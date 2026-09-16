#!/usr/bin/env python3
"""Generate the desktop-patch ops from a verified diff (base -> seam).

Run inside a clone that carries both refs:

    python gen_ops.py --repo <clone> --base main --seam feat-update

Writes ``ops.json`` (renderer/lib sources) and ``test-ops.json`` (the seam's
contract tests) to --out-dir (default: next to this script). Every op is an exact {old, new}
search/replace pair carrying three lines of context; a brand-new file becomes
a single ``{"create": true}`` op holding the full content. The generator
refuses an op whose ``old`` block is not unique in the base revision, and
PROVES the round-trip: applying the ops to the base revision reproduces the
seam revision byte for byte (any failure = nothing written, exit 1).

Re-anchoring after upstream drift: refresh the refs in the clone, re-run, and
review the diff of the two generated ops files.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEST_RE = re.compile(r"\.(test|spec)\.[tj]sx?$", re.I)


def git(repo: Path, *args: str) -> str:
    r = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_ops(diff_text: str) -> list[dict]:
    """One op per hunk: old = context+removed, new = context+added."""
    ops: list[dict] = []
    old: list[str] = []
    new: list[str] = []
    in_hunk = False

    def flush() -> None:
        nonlocal old, new
        if old or new:
            ops.append({"old": "".join(old), "new": "".join(new)})
        old, new = [], []

    for line in diff_text.splitlines(keepends=True):
        if line.startswith("@@"):
            flush()
            in_hunk = True
            continue
        if not in_hunk:
            continue
        if line.startswith("\\"):
            raise RuntimeError("diff carries a no-newline marker; handle it manually")
        if line.startswith("+"):
            new.append(line[1:])
        elif line.startswith("-"):
            old.append(line[1:])
        elif line.startswith(" "):
            old.append(line[1:])
            new.append(line[1:])
        # anything else (e.g. "diff --git", "index") between hunks of one file
        # cannot happen with a single-file, two-tree diff: ignore defensively.
    flush()
    return ops


def main() -> int:
    ap = argparse.ArgumentParser(description="composer-modes desktop-patch ops generator")
    ap.add_argument("--repo", required=True, help="clone carrying both refs")
    ap.add_argument("--base", default="main", help="base ref (default: main)")
    ap.add_argument("--seam", default="feat-update", help="seam ref (default: feat-update)")
    ap.add_argument("--seam-dir", help="read the seam side from a directory of files (e.g. desktop-patch/seam) instead of a ref")
    ap.add_argument("--out-dir", help="write ops.json/test-ops.json here (default: next to this script)")
    ap.add_argument("--path", default="apps/desktop", help="path filter (default: apps/desktop)")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    out_dir = Path(args.out_dir).resolve() if args.out_dir else HERE
    src: dict[str, list[dict]] = {}
    tests: dict[str, list[dict]] = {}

    if args.seam_dir:
        seam_root = Path(args.seam_dir).resolve()
        files = sorted(
            str(f.relative_to(seam_root)).replace("\\", "/")
            for f in seam_root.rglob("*")
            if f.is_file() and str(f.relative_to(seam_root)).replace("\\", "/").startswith(args.path)
        )
    else:
        files = [
            f
            for f in git(repo, "diff", "--name-only", args.base, args.seam, "--", args.path).splitlines()
            if f.strip()
        ]
    if not files:
        print("no files changed between the refs", file=sys.stderr)
        return 1

    failures: list[str] = []
    for rel in files:
        try:
            base_text = git(repo, "show", f"{args.base}:{rel}")
            is_new = False
        except RuntimeError:
            base_text = ""
            is_new = True
        if args.seam_dir:
            seam_text = (Path(args.seam_dir).resolve() / rel).read_text(encoding="utf-8")
        else:
            seam_text = git(repo, "show", f"{args.seam}:{rel}")

        if is_new:
            # brand-new file: full-content create op
            ops = [{"create": True, "old": "", "new": seam_text}]
        elif args.seam_dir:
            diff = "".join(
                difflib.unified_diff(
                    base_text.splitlines(keepends=True),
                    seam_text.splitlines(keepends=True),
                    n=3,
                )
            )
            ops = parse_ops(diff)
        else:
            diff = git(repo, "diff", "--no-color", "--unified=3", args.base, args.seam, "--", rel)
            ops = parse_ops(diff)

        # round-trip proof
        text = base_text
        ok = True
        for op in ops:
            if op.get("create"):
                text = op["new"]
                continue
            n = text.count(op["old"])
            if n != 1:
                failures.append(f"{rel}: anchor not unique (count={n})")
                ok = False
                break
            text = text.replace(op["old"], op["new"], 1)
        if ok and sha(text) != sha(seam_text):
            failures.append(f"{rel}: round-trip differs from the seam revision")
            ok = False
        if not ok:
            continue

        (tests if TEST_RE.search(rel) else src)[rel] = ops

    if failures:
        print("FAILED — nothing written:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1

    for name, payload in (("ops.json", src), ("test-ops.json", tests)):
        out = out_dir / name
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        total = sum(len(v) for v in payload.values())
        print(f"wrote {out.name}: {len(payload)} file(s), {total} op(s)")
        for rel, ops in payload.items():
            print(f"  {rel}  ({len(ops)} op{'s' if len(ops) != 1 else ''})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
