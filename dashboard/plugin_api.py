"""Composer Modes backend — the REST namespace the desktop half talks to.

Mounted by Hermes at ``/api/plugins/composer-modes/`` whenever the plugin is
enabled (user plugins get their backend imported only when they are in
``plugins.enabled``). The desktop half reaches it with ``ctx.rest``, which is
scoped to this namespace by construction and profile-aware.

Routes
------
``GET  /state``              every known session mode + the default
``GET  /mode?session_id=…``  the mode that will frame the next turn
``POST /mode``               ``{session_id?, mode}`` — pin a session (or the default)
``POST /reset``              ``{session_id}`` — drop a session's pin
``GET  /health``             liveness + version

The state itself lives in ``store.py`` beside this file and is shared with the
agent half (same process) through a file-backed, mtime-checked store.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse

PLUGIN_NAME = "composer-modes"
VERSION = "2.0.1"
STORE_MODULE = "composer_modes_store"
_PLUGIN_DIR = Path(__file__).resolve().parent.parent

MODES = ("ask", "agent", "plan", "debug")
DEFAULT_MODE = "agent"

router = APIRouter()


def _store():
    """The shared mode store (same module object as the agent half when possible)."""
    mod = sys.modules.get(STORE_MODULE)
    if mod is None or not hasattr(mod, "load_store"):
        spec = importlib.util.spec_from_file_location(STORE_MODULE, _PLUGIN_DIR / "store.py")
        if spec is None or spec.loader is None:  # pragma: no cover - defensive
            raise RuntimeError("composer-modes: cannot load store.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[STORE_MODULE] = mod
        spec.loader.exec_module(mod)
    return mod.load_store(PLUGIN_NAME)


def _clean_session_id(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:200]


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "plugin": PLUGIN_NAME, "version": VERSION}


@router.get("/state")
async def state() -> dict:
    snapshot = _store().snapshot()
    return {
        "ok": True,
        "version": VERSION,
        "modes": list(MODES),
        "default": snapshot["default"],
        "sessions": snapshot["sessions"],
        "enforce_ask": True,
    }


@router.get("/mode")
async def read_mode(session_id: Optional[str] = None) -> dict:
    store = _store()
    sid = _clean_session_id(session_id)
    return {"ok": True, "session_id": sid, "mode": store.get_mode(sid), "default": store.get_default()}


@router.post("/mode")
async def write_mode(body: Optional[dict] = None) -> Any:
    """Pin a mode. Body: ``{"session_id": "...", "mode": "ask"}``.

    ``mode: "default"`` (or a missing ``session_id``) writes the default instead
    of pinning a session.
    """
    payload = body if isinstance(body, dict) else {}
    mode = str(payload.get("mode") or "").strip().lower()
    sid = _clean_session_id(payload.get("session_id"))
    if mode == "default" or (not sid and mode):
        mode = mode or DEFAULT_MODE
    if mode not in MODES:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": f"unknown mode {mode!r}", "modes": list(MODES)},
        )
    try:
        store = _store()
        if sid:
            store.set_mode(sid, mode)
        else:
            store.set_default(mode)
    except Exception as exc:  # never 500 into the composer
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})
    return {"ok": True, "session_id": sid, "mode": mode, "default": store.get_default()}


@router.post("/reset")
async def reset(body: Optional[dict] = None) -> dict:
    """Drop a session's pin so it falls back to the default mode."""
    payload = body if isinstance(body, dict) else {}
    sid = _clean_session_id(payload.get("session_id"))
    store = _store()
    if sid:
        store.clear_session(sid)
    return {"ok": True, "session_id": sid, "mode": store.get_mode(sid) if sid else store.get_default()}
