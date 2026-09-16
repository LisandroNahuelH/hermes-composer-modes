"""Tests for the shared mode store (per-session pins + default + persistence)."""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import store as store_mod  # noqa: E402


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_data_dir", lambda name: tmp_path / name)
    sys.modules.pop(store_mod.STORE_MODULE_NAME, None)
    inst = store_mod.ModeStore("composer-modes-test")
    yield inst
    sys.modules.pop(store_mod.STORE_MODULE_NAME, None)


def test_unknown_sessions_fall_back_to_the_default(store):
    assert store.get_default() == "agent"
    assert store.get_mode("sess-1") == "agent"
    assert store.get_mode(None) == "agent"


def test_session_pins_are_independent(store):
    store.set_mode("sess-1", "ask")
    store.set_mode("sess-2", "plan")
    assert store.get_mode("sess-1") == "ask"
    assert store.get_mode("sess-2") == "plan"
    assert store.get_mode("sess-3") == "agent"


def test_set_mode_without_a_session_writes_the_default(store):
    store.set_mode(None, "debug")
    assert store.get_default() == "debug"
    assert store.get_mode("brand-new") == "debug"


def test_state_survives_a_reload(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_data_dir", lambda name: tmp_path / name)
    first = store_mod.ModeStore("composer-modes-test")
    first.set_mode("sess-9", "ask")
    first.set_default("plan")
    second = store_mod.ModeStore("composer-modes-test")
    assert second.get_mode("sess-9") == "ask"
    assert second.get_mode("other") == "plan"
    payload = json.loads((tmp_path / "composer-modes-test" / "state.json").read_text(encoding="utf-8"))
    assert payload["default"] == "plan"
    assert payload["sessions"]["sess-9"]["mode"] == "ask"


def test_an_external_write_is_picked_up(store, tmp_path):
    path = tmp_path / "composer-modes-test" / "state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": 1, "default": "agent", "sessions": {"s": {"mode": "debug", "updated_at": 9e9}}}),
        encoding="utf-8",
    )
    assert store.get_mode("s") == "debug"


def test_corrupt_state_degrades_to_the_default(store, tmp_path):
    path = tmp_path / "composer-modes-test" / "state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{not json", encoding="utf-8")
    assert store.get_mode("s") == "agent"


def test_invalid_modes_are_rejected(store):
    with pytest.raises(ValueError):
        store.set_mode("s", "banana")


def test_clear_session_drops_only_that_pin(store):
    store.set_mode("s", "ask")
    store.clear_session("s")
    assert store.get_mode("s") == "agent"


def test_snapshot_shape(store):
    store.set_mode("s", "plan")
    snap = store.snapshot()
    assert snap["sessions"]["s"] == "plan"
    assert snap["default"] == "agent"


def test_load_store_is_a_singleton_per_process(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_data_dir", lambda name: tmp_path / name)
    sys.modules.pop(store_mod.STORE_MODULE_NAME, None)
    a = store_mod.load_store("composer-modes-test")
    b = store_mod.load_store("composer-modes-test")
    assert a is b
    sys.modules.pop(store_mod.STORE_MODULE_NAME, None)


def test_module_reloads_without_error(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_data_dir", lambda name: tmp_path / name)
    importlib.reload(store_mod)
