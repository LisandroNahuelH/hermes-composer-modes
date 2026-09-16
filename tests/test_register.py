"""Tests for ``register(ctx)`` — the wiring the agent half actually ships."""
from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path

from conftest import ROOT, FakeCtx

from modes import ASK_NOTE


def test_register_wires_hooks_command_and_skill(ctx):
    assert ctx.hooks["pre_llm_call"] and ctx.hooks["pre_tool_call"]
    assert "mode" in ctx.commands
    assert ctx.command_meta["mode"]["args_hint"] == "<ask|agent|plan|debug>"
    assert "modes" in ctx.skills
    assert ctx.skills["modes"].is_file()


def test_ask_mode_frames_the_turn_with_the_note(ctx, plugin):
    store = plugin.store.load_store(plugin.PLUGIN_NAME)
    store.set_mode("sess-1", "ask")
    result = ctx.hooks["pre_llm_call"][0](session_id="sess-1", user_message="what does this do?")
    assert result == {"context": ASK_NOTE}


def test_agent_mode_adds_nothing(ctx):
    assert ctx.hooks["pre_llm_call"][0](session_id="sess-agent", user_message="hi") is None


def test_slash_commands_are_never_framed(ctx, plugin):
    plugin.store.load_store(plugin.PLUGIN_NAME).set_mode("sess-2", "plan")
    assert ctx.hooks["pre_llm_call"][0](session_id="sess-2", user_message="/plan ship it") is None
    assert ctx.hooks["pre_llm_call"][0](session_id="sess-2", user_message="ship it") is not None


def test_a_failing_hook_never_breaks_the_turn(ctx, plugin, monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("store exploded")

    monkeypatch.setattr(plugin.store.ModeStore, "get_mode", boom)
    assert ctx.hooks["pre_llm_call"][0](session_id="s", user_message="hi") is None


def test_ask_mode_blocks_writes_and_allows_reads(ctx, plugin):
    store = plugin.store.load_store(plugin.PLUGIN_NAME)
    store.set_mode("sess-3", "ask")
    blocked = ctx.hooks["pre_tool_call"][0](tool_name="write_file", args={"path": "a"}, session_id="sess-3")
    assert blocked["action"] == "block"
    assert "write_file" in blocked["message"]
    assert ctx.hooks["pre_tool_call"][0](tool_name="read_file", args={}, session_id="sess-3") is None


def test_agent_mode_never_blocks(ctx):
    assert ctx.hooks["pre_tool_call"][0](tool_name="write_file", args={}, session_id="sess-x") is None


def test_mode_command_sets_the_default(ctx, plugin):
    out = ctx.commands["mode"]("plan")
    assert "plan" in out
    assert plugin.store.load_store(plugin.PLUGIN_NAME).get_default() == "plan"
    assert "ask" in ctx.commands["mode"]("")  # bare /mode reports the state
    assert "Unknown" in ctx.commands["mode"]("banana")
    assert plugin.store.load_store(plugin.PLUGIN_NAME).get_default() == "plan"


def test_mode_command_accepts_off(ctx, plugin):
    ctx.commands["mode"]("off")
    assert plugin.store.load_store(plugin.PLUGIN_NAME).get_default() == "agent"


def test_dashboard_api_shares_the_store(ctx, plugin):
    """The REST half the desktop talks to writes the SAME state the hooks read."""
    pytest = __import__("pytest")
    pytest.importorskip("fastapi")
    spec = importlib.util.spec_from_file_location(
        "composer_modes_api_probe", ROOT / "dashboard" / "plugin_api.py"
    )
    assert spec and spec.loader
    api = importlib.util.module_from_spec(spec)
    sys.modules["composer_modes_api_probe"] = api
    spec.loader.exec_module(api)

    written = asyncio.run(api.write_mode({"session_id": "sess-api", "mode": "debug"}))
    assert written["ok"] is True and written["mode"] == "debug"
    state = asyncio.run(api.state())
    assert state["sessions"]["sess-api"] == "debug"
    # the agent half sees it through its own store instance (file-backed)
    assert plugin.store.load_store(plugin.PLUGIN_NAME).get_mode("sess-api") == "debug"
    assert ctx.hooks["pre_llm_call"][0](session_id="sess-api", user_message="go") is not None

    bad = asyncio.run(api.write_mode({"session_id": "sess-api", "mode": "banana"}))
    assert bad.status_code == 400
    dropped = asyncio.run(api.reset({"session_id": "sess-api"}))
    assert dropped["mode"] == "agent"
