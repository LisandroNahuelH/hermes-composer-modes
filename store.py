"""Per-session composer modes — one small JSON file shared by every half.

The agent half (hooks + the ``/mode`` command) and the plugin backend
(``dashboard/plugin_api.py``, which the desktop half talks to over ``ctx.rest``)
are two modules loaded under different names. Both reach the SAME store through
:func:`load_store`, which keys the module in ``sys.modules`` so a single process
shares one in-memory dict, and falls back to the file (mtime-checked) when the
two halves live in different processes.

State lives in ``<hermes home>/plugin-data/<name>/state.json`` — never in the
plugin's own install directory, which ``hermes plugins update`` replaces.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

__all__ = ["DEFAULT_MODE", "ModeStore", "load_store", "STORE_MODULE_NAME"]

STORE_MODULE_NAME = "composer_modes_store"

DEFAULT_MODE = "agent"
_VALID_MODES = ("ask", "agent", "plan", "debug")

#: Sessions untouched for this long are dropped on the next write.
SESSION_TTL_SECONDS = 30 * 24 * 3600


def _data_dir(name: str) -> Path:
    """``<hermes home>/plugin-data/<name>/`` — profile-aware, plugin-owned."""
    try:  # inside Hermes: the canonical helper resolves the active profile
        from plugins.plugin_storage import plugin_data_dir  # type: ignore

        return Path(plugin_data_dir(name))
    except Exception:
        pass
    home = os.environ.get("HERMES_HOME") or str(Path.home() / ".hermes")
    root = Path(home) / "plugin-data" / name
    root.mkdir(parents=True, exist_ok=True)
    return root


class ModeStore:
    """Thread-safe, file-backed mode state.

    Shape on disk::

        {"version": 1, "default": "agent",
         "sessions": {"<session id>": {"mode": "ask", "updated_at": 1726500000.0}}}
    """

    def __init__(self, name: str = "composer-modes", ttl_seconds: int = SESSION_TTL_SECONDS) -> None:
        self.name = name
        self.ttl_seconds = ttl_seconds
        self._lock = threading.RLock()
        self._path = _data_dir(name) / "state.json"
        self._default = DEFAULT_MODE
        self._sessions: dict[str, dict[str, Any]] = {}
        self._mtime = 0.0
        self._load(force=True)

    # ── persistence ──────────────────────────────────────────────────────────
    def _load(self, force: bool = False) -> None:
        with self._lock:
            try:
                stat = self._path.stat()
            except OSError:
                return
            if not force and stat.st_mtime == self._mtime:
                return
            self._mtime = stat.st_mtime
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
            except Exception:
                data = {}
            default = data.get("default")
            self._default = default if default in _VALID_MODES else DEFAULT_MODE
            sessions = data.get("sessions")
            self._sessions = {
                str(sid): {
                    "mode": rec.get("mode"),
                    "updated_at": float(rec.get("updated_at") or 0.0),
                }
                for sid, rec in (sessions.items() if isinstance(sessions, dict) else [])
                if isinstance(rec, dict) and rec.get("mode") in _VALID_MODES
            }

    def _save(self) -> None:
        with self._lock:
            now = time.time()
            cutoff = now - self.ttl_seconds
            self._sessions = {
                sid: rec for sid, rec in self._sessions.items() if rec["updated_at"] >= cutoff
            }
            payload = {"version": 1, "default": self._default, "sessions": self._sessions}
            try:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self._path.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
                os.replace(tmp, self._path)
                self._mtime = self._path.stat().st_mtime
            except OSError:
                pass  # never raise into a hook: a read-only home still answers reads

    # ── reads ────────────────────────────────────────────────────────────────
    def get_mode(self, session_id: str | None) -> str:
        """Mode for *session_id*, falling back to the default mode."""
        with self._lock:
            self._load()
            if session_id:
                rec = self._sessions.get(str(session_id))
                if rec and rec.get("mode") in _VALID_MODES:
                    return str(rec["mode"])
            return self._default

    def get_default(self) -> str:
        with self._lock:
            self._load()
            return self._default

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            self._load()
            return {
                "default": self._default,
                "sessions": {sid: rec["mode"] for sid, rec in self._sessions.items()},
            }

    # ── writes ───────────────────────────────────────────────────────────────
    def set_mode(self, session_id: str | None, mode: str) -> str:
        """Pin *mode* to *session_id* (no session id pins the default for new ones)."""
        if mode not in _VALID_MODES:
            raise ValueError(f"unknown mode: {mode!r}")
        with self._lock:
            self._load()
            if session_id:
                self._sessions[str(session_id)] = {"mode": mode, "updated_at": time.time()}
            else:
                self._default = mode
            self._save()
            return mode

    def set_default(self, mode: str) -> str:
        with self._lock:
            self._load()
            self._default = mode if mode in _VALID_MODES else DEFAULT_MODE
            self._save()
            return self._default

    def clear_session(self, session_id: str) -> None:
        with self._lock:
            self._load()
            self._sessions.pop(str(session_id), None)
            self._save()


def load_store(name: str = "composer-modes") -> ModeStore:
    """Return the process-wide store (one instance per plugin name per process)."""
    existing = sys.modules.get(STORE_MODULE_NAME)
    store = getattr(existing, "_STORE", None) if existing is not None else None
    if isinstance(store, ModeStore):
        return store
    store = ModeStore(name)
    if existing is None:  # loaded standalone (tests, another process)
        holder = sys.modules.setdefault(STORE_MODULE_NAME, sys.modules[__name__])
        setattr(holder, "_STORE", store)
    else:
        setattr(existing, "_STORE", store)
    return store
