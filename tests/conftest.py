"""Fixtures: load the plugin the way Hermes does, against a throwaway hermes home."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
for _p in (ROOT, TESTS_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

MODULE = "composer_modes_plugin"
STORE = "composer_modes_store"


def _purge() -> None:
    for name in [n for n in list(sys.modules) if n == MODULE or n.startswith(MODULE + ".") or n == STORE]:
        sys.modules.pop(name, None)


@pytest.fixture()
def plugin(tmp_path, monkeypatch):
    """The plugin package, loaded with ``submodule_search_locations`` like the real loader."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    _purge()
    spec = importlib.util.spec_from_file_location(
        MODULE, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[MODULE] = mod
    spec.loader.exec_module(mod)
    yield mod
    _purge()


class FakeCtx:
    """Captures what ``register(ctx)`` wires, without a running Hermes."""

    def __init__(self) -> None:
        self.hooks: dict[str, list] = {}
        self.commands: dict[str, object] = {}
        self.command_meta: dict[str, dict] = {}
        self.skills: dict[str, Path] = {}
        self.tools: dict[str, object] = {}

    def register_hook(self, name, callback):
        self.hooks.setdefault(name, []).append(callback)
        return None

    def register_command(self, name, handler, description="", args_hint="", argument_mode=None):
        self.commands[name] = handler
        self.command_meta[name] = {"description": description, "args_hint": args_hint}
        return None

    def register_skill(self, name, path, description="", frontmatter=None):
        self.skills[name] = Path(path)
        return None

    def register_tool(self, name, toolset, schema, handler, description=""):
        self.tools[name] = handler
        return None


@pytest.fixture()
def ctx(plugin):
    ctx = FakeCtx()
    plugin.register(ctx)
    return ctx
