"""Ask-mode enforcement — the note asks the model; this makes it true.

Ask mode is documented as read-only. A prompt alone is a request, not a
guarantee, so the agent half also vetoes the tool calls that would change
something while a session is in ask mode.

Policy (fail-closed, never fail-silent):

* **Tools** — a fixed deny-list of state-changing tools, plus anything whose
  name matches a mutation verb (write/edit/save/delete/move/install/…).
* **``terminal``** — every command segment must match a read-only allow-list
  and the whole command must be free of redirection and mutating tokens. When
  in doubt the command is blocked: ask mode is read-only by contract, and the
  note tells the model to answer and close with the mandated sentence.

Nothing here is a sandbox: it is a policy gate for a mode the user chose. Set
``HERMES_COMPOSER_MODES_ASK_ENFORCE=0`` to turn it off.
"""

from __future__ import annotations

import os
import re

__all__ = ["ask_enforcement_enabled", "ask_block_message"]

#: Tools that always change state, whatever their arguments look like.
DENY_TOOLS = frozenset(
    {
        "write_file",
        "patch",
        "browser_exec",
        "computer_use",
        "cronjob_manage",
        "process_manage",
        "delegate_task",
        "skill_manage",
        "memory",
        "todo_list",
    }
)

#: Name shapes that mean "this tool mutates something".
_MUTATING_NAME_RE = re.compile(
    r"(?:^|_)(write|edit|save|append|delete|remove|move|copy|create|rename|mkdir|rmdir|"
    r"install|uninstall|upload|publish|deploy|apply_patch|commit|push|format|kill|start|stop|restart|send|post)(?:_|$)",
    re.IGNORECASE,
)

#: Command prefixes that are read-only on their own.
_READ_ONLY_COMMAND_RE = re.compile(
    r"^\s*(?:"
    r"cat|bat|head|tail|less|more|wc|ls|dir|tree|stat|file|du|df|md5sum|sha1sum|sha256sum|"
    r"cksum|pwd|date|whoami|hostname|uname|id|echo|printf|which|type|command -v|"
    r"find|fd|grep|rg|ag|ack|sed\s+-n|awk|sort|uniq|cut|tr|join|paste|nl|column|jq|yq|xmllint|"
    r"diff|cmp|comm|basename|dirname|realpath|readlink|seq|expr|bc|test|\[|true|false|"
    r"git\s+(?:status|log|show|diff|branch|remote|rev-parse|describe|blame|ls-files|ls-tree|"
    r"cat-file|shortlog|tag|stash\s+list|config\s+--get|config\s+--list|name-rev|for-each-ref|"
    r"worktree\s+list|submodule\s+status|fsck|reflog|whatchanged|grep|count-objects)|"
    r"hg\s+(?:status|log|diff|summary)|svn\s+(?:status|info|log|diff)|"
    r"(?:python|python3|node|npm|pnpm|yarn|bun|pip|pip3|uv|cargo|go|dotnet|java|deno|rustc|"
    r"tsc|npx|git|gh|docker|kubectl|hermes)\s+(?:--version|-V|-h|--help)\b|"
    r"npm\s+(?:ls|list|view|info|outdated|why|config\s+get)|"
    r"pnpm\s+(?:ls|list|why|outdated)|"
    r"pip\s+(?:list|show|freeze|check)|"
    r"gh\s+(?:pr\s+(?:view|list|diff|checks)|issue\s+(?:view|list)|repo\s+view|run\s+(?:view|list)|api|auth\s+status)|"
    r"docker\s+(?:ps|images|inspect|logs|version|info)|"
    r"kubectl\s+(?:get|describe|logs|version|config\s+view)|"
    r"systemctl\s+(?:status|list-units|is-active)|"
    r"open|code|explorer|start\s+\"\"|env"
    r")\b"
)

#: Tokens that write, wherever they appear in the command line.
_MUTATING_TOKEN_RE = re.compile(
    r"(?:>>?|\|\s*tee\b|\btee\b|\bdd\b|\btruncate\b|\bshred\b|\bchmod\b|\bchown\b|\bchgrp\b|"
    r"\bumask\b|\bln\b|\bmv\b|\bcp\b|\brm\b|\brmdir\b|\bmkdir\b|\btouch\b|\binstall\b|\brsync\b|"
    r"\bscp\b|\bsed\s+-i|\bperl\s+-i|\bpython\s+-c|\bpython3\s+-c|\bnode\s+-e|\bsudo\b|\bsu\b|"
    r"-delete\b|-exec\b|-execdir\b|-ok\b|-fprint|\btruncate\b|"
    r"\bsystemctl\s+(?:start|stop|restart|enable|disable)\b|\bservice\b|\bgit\s+(?:add|commit|"
    r"push|pull|fetch|merge|rebase|checkout|switch|restore|reset|clean|apply|am|cherry-pick|"
    r"stash(?!\s+list)|tag\s+-|remote\s+(?:add|remove|set-url)|init|clone|config\s+(?!--get|--list))|"
    r"\bnpm\s+(?:i|install|ci|run|test|start|audit\s+fix|publish|link|uninstall)\b|"
    r"\bpnpm\s+(?:i|install|add|remove|run|test|publish)\b|\byarn\s+(?:add|install|run)\b|"
    r"\bpip3?\s+(?:install|uninstall|download)\b|\buv\s+(?:pip|sync|add|remove)\b|"
    r"\bcargo\s+(?:install|build|run|test|add|remove|publish)\b|\bgo\s+(?:build|run|install|test|mod)\b|"
    r"\bdocker\s+(?:run|build|exec|rm|stop|start|compose\s+(?:up|down|build|run))\b|"
    r"\bkubectl\s+(?:apply|delete|create|edit|exec|patch|scale|rollout)\b|"
    r"\bgh\s+(?:pr\s+(?:create|merge|close|comment|edit|checkout)|issue\s+(?:create|close|comment|edit)|"
    r"release\s+create|repo\s+(?:create|delete|clone|fork)|workflow\s+run)\b|"
    r"\bhermes\s+(?:plugins\s+(?:install|remove|enable|disable|update)|cron|config\s+set|update)\b|"
    r"\bdel\b|\berase\b|\brd\s+/|\bren\b|\bmove\b|\bcopy\b|\btype\s+>\b)"
)

#: Shell separators — each segment of a chained command is judged on its own.
_SEGMENT_SPLIT_RE = re.compile(r"(?:&&|\|\||;|\||\n)")


def ask_enforcement_enabled() -> bool:
    """Ask-mode enforcement is on unless explicitly switched off."""
    return str(os.environ.get("HERMES_COMPOSER_MODES_ASK_ENFORCE", "1")).strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _terminal_is_read_only(command: str) -> bool:
    if not command.strip():
        return False
    if _MUTATING_TOKEN_RE.search(command):
        return False
    for segment in _SEGMENT_SPLIT_RE.split(command):
        if not segment.strip():
            continue
        if not _READ_ONLY_COMMAND_RE.match(segment):
            return False
    return True


def ask_block_message(tool_name: str, args: object) -> str | None:
    """The block message for a tool call that ask mode must refuse, or ``None``."""
    if not ask_enforcement_enabled():
        return None
    if not tool_name:
        return None
    name = str(tool_name)
    if name == "terminal":
        command = ""
        if isinstance(args, dict):
            command = str(args.get("command") or "")
        if _terminal_is_read_only(command):
            return None
        return (
            f"[composer-modes] Ask mode is read-only: the terminal command was blocked because "
            f"it is not a read-only inspection. Do the read-only part of the request with the "
            f"tools that are allowed, answer what you can, and end your reply with the mandated "
            f"Ask closing sentence so the user can re-ask in Agent mode."
        )
    if name in DENY_TOOLS or _MUTATING_NAME_RE.search(name):
        return (
            f"[composer-modes] Ask mode is read-only: the tool '{name}' can change state, so the "
            f"call was blocked before it ran. Nothing was written. Answer with the allowed "
            f"read-only work and end your reply with the mandated Ask closing sentence so the "
            f"user can re-ask in Agent mode."
        )
    return None
