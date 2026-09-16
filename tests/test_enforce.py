"""Tests for ask-mode enforcement (policy gate, not a sandbox)."""
from __future__ import annotations

import pytest

from enforce import ask_block_message, ask_enforcement_enabled


@pytest.fixture()
def enabled(monkeypatch):
    monkeypatch.delenv("HERMES_COMPOSER_MODES_ASK_ENFORCE", raising=False)


# ── tools ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("tool", ["write_file", "patch", "delegate_task", "memory", "cronjob_manage"])
def test_state_changing_tools_are_blocked(enabled, tool):
    assert ask_block_message(tool, {}) is not None


@pytest.mark.parametrize("tool", ["read_file", "search_files", "web_search", "web_extract", "vision_analyze"])
def test_read_only_tools_pass(enabled, tool):
    assert ask_block_message(tool, {}) is None


@pytest.mark.parametrize("tool", ["file_delete", "repo_create", "image_upload", "save_note"])
def test_mutating_name_shapes_are_blocked(enabled, tool):
    assert ask_block_message(tool, {}) is not None


def test_block_message_names_the_tool_and_the_door_out(enabled):
    message = ask_block_message("write_file", {})
    assert "write_file" in message
    assert "read-only" in message
    assert "Ask closing sentence" in message


# ── terminal ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "command",
    [
        "ls -la",
        "git status --short",
        "git log --oneline -5",
        "cat README.md",
        "sed -n '1,20p' plugin.js",
        "rg --files | head -20",
        "find . -name '*.py'",
        "grep -rn 'note' modes.py",
        "wc -l desktop/plugin.js",
        "python --version",
        "npm ls --depth=0",
        "gh pr view 12",
        "ls | wc -l",
    ],
)
def test_read_only_commands_are_allowed(enabled, command):
    assert ask_block_message("terminal", {"command": command}) is None


@pytest.mark.parametrize(
    "command",
    [
        "rm -rf build",
        "echo hi > file.txt",
        "cat a >> b",
        "mv a b",
        "cp a b",
        "mkdir newdir",
        "touch new.txt",
        "npm install",
        "npm run build",
        "pip install requests",
        "git commit -m x",
        "git checkout -b feature",
        "git apply patch.diff",
        "sed -i 's/a/b/' file.txt",
        "python -c 'open(\"x\",\"w\")'",
        "ls && rm -rf tmp",
        "cat file | tee out.txt",
        "dd if=/dev/zero of=file",
        "find . -name '*.tmp' -delete",
        "hermes plugins install owner/repo",
        "curl -o out.html https://example.com",
        "ls; echo done > log",
        "",
    ],
)
def test_mutating_or_ambiguous_commands_are_blocked(enabled, command):
    assert ask_block_message("terminal", {"command": command}) is not None


def test_terminal_with_missing_command_is_blocked(enabled):
    assert ask_block_message("terminal", {}) is not None
    assert ask_block_message("terminal", None) is not None


def test_unknown_tool_is_left_alone(enabled):
    assert ask_block_message("mystery_tool", {"a": 1}) is None


def test_empty_tool_name_is_ignored(enabled):
    assert ask_block_message("", {}) is None


# ── kill switch ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("value", ["0", "false", "off", "no"])
def test_enforcement_can_be_switched_off(monkeypatch, value):
    monkeypatch.setenv("HERMES_COMPOSER_MODES_ASK_ENFORCE", value)
    assert not ask_enforcement_enabled()
    assert ask_block_message("write_file", {}) is None
    assert ask_block_message("terminal", {"command": "rm -rf dist"}) is None


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", ""])
def test_enforcement_is_on_by_default(monkeypatch, value):
    monkeypatch.setenv("HERMES_COMPOSER_MODES_ASK_ENFORCE", value)
    assert ask_enforcement_enabled()
