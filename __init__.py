"""Composer Modes — the agent half.

Four modes (ask / agent / plan / debug) chosen in the Hermes desktop composer.
The desktop half sends only the mode id; everything the model reads is built
here and delivered through the ``pre_llm_call`` hook, which Hermes merges into
the model-facing bytes of the current turn (``api_content``) only — the durable
row, the bubble, the sidebar preview and the auto-title keep exactly what was
typed.

Registered surface
------------------
``pre_llm_call``    the active mode's operating note rides the turn (one-shot)
``pre_tool_call``   ask mode is enforced read-only (state-changing calls vetoed)
``/mode``           ``/mode ask|agent|plan|debug`` sets the default mode
``composer-modes:modes``  a skill describing the mode protocol (opt-in load)
``dashboard/plugin_api.py``  the REST namespace the desktop half talks to
"""

from __future__ import annotations

from pathlib import Path

from . import enforce
from .modes import DEFAULT_MODE, LABELS, MODE_IDS, is_mode, is_slash_shaped, note_for
from .store import load_store

__all__ = ["register"]

PLUGIN_NAME = "composer-modes"
VERSION = "2.0.0"
_SKILL_PATH = Path(__file__).parent / "skills" / "composer-modes" / "SKILL.md"


def _emit(message: str) -> None:
    """Best-effort diagnostic — never let logging break a turn."""
    try:
        print(f"[{PLUGIN_NAME}] {message}", flush=True)
    except Exception:
        pass


def register(ctx):  # noqa: ANN001 - PluginContext from hermes_cli.plugins
    """Wire the hooks, the ``/mode`` command and the shipped skill."""
    store = load_store(PLUGIN_NAME)

    # ── the mode note travels with the turn, hidden in api_content ───────────
    def on_pre_llm_call(session_id: str = "", user_message=None, platform: str = "", **kwargs):
        try:
            mode = store.get_mode(session_id)
            note = note_for(mode)
            if not note:
                return None
            text = user_message if isinstance(user_message, str) else ""
            if is_slash_shaped(text.strip()):
                return None
            author = ""
            if isinstance(user_message, dict):  # rich content shape — never frame it
                author = str(user_message.get("author") or "")
                if author and author != "user":
                    return None
            _emit(f"note mode={mode} session={session_id or '-'} chars={len(note)}")
            return {"context": note}
        except Exception as exc:  # a hook must never break a turn
            _emit(f"pre_llm_call failed: {exc!r}")
            return None

    ctx.register_hook("pre_llm_call", on_pre_llm_call)

    # ── ask mode is read-only, not only in the prompt ────────────────────────
    def on_pre_tool_call(tool_name: str = "", args=None, session_id: str = "", **kwargs):
        try:
            if store.get_mode(session_id) != "ask":
                return None
            message = enforce.ask_block_message(tool_name, args)
            if message:
                _emit(f"ask-block tool={tool_name} session={session_id or '-'}")
                return {"action": "block", "message": message}
        except Exception as exc:
            _emit(f"pre_tool_call failed: {exc!r}")
        return None

    ctx.register_hook("pre_tool_call", on_pre_tool_call)

    # ── /mode on every surface (CLI, TUI, desktop composer, messaging) ──────
    def on_mode_command(raw_args: str = "") -> str:
        arg = (raw_args or "").strip().split()[0].lower() if (raw_args or "").strip() else ""
        if not arg or arg in {"?", "help", "status"}:
            return (
                f"Composer modes: {' | '.join(MODE_IDS)} — default is '{store.get_default()}'. "
                f"Use /mode <id> to change it. In the desktop app the mode button sets it per session."
            )
        if arg in {"off", "none", "normal"}:
            arg = "agent"
        if not is_mode(arg):
            return f"Unknown mode '{arg}'. Known modes: {', '.join(MODE_IDS)}."
        store.set_default(arg)
        return (
            f"Default composer mode set to '{LABELS.get(arg, arg)}' ({arg}). "
            f"Sessions with their own mode keep it — change that in the desktop composer."
        )

    ctx.register_command(
        "mode",
        on_mode_command,
        description="Set the default composer mode (ask | agent | plan | debug).",
        args_hint="<ask|agent|plan|debug>",
    )

    # ── the protocol as a loadable skill (explicit skill_view only) ─────────
    try:
        if _SKILL_PATH.is_file():
            ctx.register_skill(
                "modes",
                _SKILL_PATH,
                description="How Composer Modes frames a turn (ask / plan / debug protocol).",
            )
    except Exception as exc:
        _emit(f"skill registration skipped: {exc!r}")

    _emit(
        f"register ver=v{VERSION} default={store.get_default()} "
        f"modes={','.join(MODE_IDS)} enforce={enforce.ask_enforcement_enabled()}"
    )


# Keep the module-level name importable for the API half / tests.
__all__.append("DEFAULT_MODE")
