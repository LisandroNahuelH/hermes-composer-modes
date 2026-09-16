#!/usr/bin/env python3
"""Print the hidden note of the newest user row: ``content`` vs ``api_content``.

Composer Modes never writes into the message you typed — the mode note rides the
model-facing bytes only. This reads the two columns back so the claim is verified,
not assumed.

Usage:  python scripts/verify_note.py <hermes home>/state.db
"""
from __future__ import annotations

import sqlite3
import sys

QUERY = (
    "SELECT content, api_content FROM messages "
    "WHERE role = 'user' ORDER BY id DESC LIMIT 1"
)


def main(argv: list[str]) -> int:
    db = argv[1] if len(argv) > 1 else "state.db"
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        print(f"cannot open {db}: {exc}")
        return 2
    try:
        row = con.execute(QUERY).fetchone()
    except sqlite3.Error as exc:
        print(f"query failed: {exc}")
        return 2
    if not row:
        print("no user row yet — send one message with a mode on, then re-run")
        return 1
    content = row[0] or ""
    api = row[1] or ""
    note = api[len(content):]
    print(f"typed      : {content[:100]!r}")
    print(f"model-only : {note[:160]!r}")
    print(f"hidden ok  : {bool(note.strip()) and api.startswith(content)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
