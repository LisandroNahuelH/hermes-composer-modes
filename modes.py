"""Mode catalogue — the single source of truth for what each composer mode does.

The desktop half (``desktop/plugin.js``) only ever sends a mode id; every word
the model reads lives here. Notes are per-turn operating instructions delivered
through the ``pre_llm_call`` hook: Hermes merges them into the model-facing
bytes of the current user message (``api_content``) and the durable row, the
bubble, the sidebar preview and the session title keep exactly what was typed.
"""

from __future__ import annotations

import re

__all__ = [
    "MODE_IDS",
    "DEFAULT_MODE",
    "LABELS",
    "NOTES",
    "note_for",
    "is_mode",
    "is_slash_shaped",
]

#: Every mode the composer can be in. ``agent`` is the neutral pass-through.
MODE_IDS = ("ask", "agent", "plan", "debug")

DEFAULT_MODE = "agent"

LABELS = {"ask": "Ask", "agent": "Agent", "plan": "Plan", "debug": "Debug"}

# A leading slash command wins over any mode: an explicit ``/plan`` (or any other
# slash command) must never carry a mode note, or the note lands as an argument of
# the command. Same shape as the desktop's SLASH_COMMAND_RE.
_SLASH_SHAPE_RE = re.compile(r"^/[^\s/]*(?:\s|$)")


def is_slash_shaped(text: str) -> bool:
    """True when *text* is (or starts with) a slash command."""
    return bool(text) and bool(_SLASH_SHAPE_RE.match(text))


def is_mode(value: object) -> bool:
    """True when *value* names a known mode."""
    return isinstance(value, str) and value in MODE_IDS


def note_for(mode: object) -> str | None:
    """The operating note for *mode*, or ``None`` for a pass-through turn."""
    if not is_mode(mode):
        return None
    return NOTES.get(mode)  # type: ignore[arg-type]


# ── Notes (English on purpose: they go straight to the model) ────────────────
#
# ask  — read-only turn. v1 wording, tuned live; the closing sentence is a hard
#        contract: adapt only the A/B/C list, keep the rest verbatim.
# plan — verbatim replica of the core's plan-mode rules (``agent/plan_prompt.py``)
#        plus the plan-craft block, the one-round questions protocol and the
#        ``::plan-approve`` directive the desktop card renders. Re-sync with the
#        core when ``agent/plan_prompt.py`` changes.
# debug — three-phase instrument → reproduce → fix loop that closes with the
#        ``::debug-loop`` directive the desktop card renders.
# agent — no note at all.

ASK_NOTE = (
    "[mode:ask] STRICT ASK MODE — read-only turn. Allowed: reading files, "
    "listing/searching the filesystem, and read-only inspection commands (e.g. cat, head, tail, "
    "grep, find, wc, stat, diff, sha256sum, git status/log/diff/show, version checks) and "
    "equivalent one-shot non-mutating commands. Forbidden — do NOT do any of these, even if asked: "
    "create, edit, rename, move, delete or transform any file; write, patch, copy or redirect "
    "output into files; install packages; run builds, servers or any mutating/background command; "
    "call tools that change state. Your only deliverable is the answer to what the user asked. If "
    "the request needs an action that would change something (A/B/C), answer what you can with the "
    "allowed read-only work, then END your reply with this sentence in Spanish, adapting only the "
    "A/B/C list and keeping the rest verbatim: \"Estoy en modo Ask, solo puedo responder. Si "
    "querés que proceda a A/B/C tenés que pedírmelo en modo Agent.\" Never claim or pretend to "
    "have performed an action you did not perform. If you detect that you already changed "
    "something by mistake, stop, say so plainly, and do not continue."
)

PLAN_RULES = """For this turn, you are in PLAN MODE — planning only.

- Do not implement code.
- Do not edit project files except the plan markdown file itself.
- Do not run mutating terminal commands, commit, push, or perform external
  actions.
- You may inspect the repo or other context with read-only commands/tools
  when needed.
- Your deliverable is a markdown plan saved inside the active workspace under
  `.hermes/plans/YYYY-MM-DD_HHMMSS-<slug>.md` (create the directory if
  needed; Hermes file tools are backend-aware, so this relative path keeps
  the plan with the workspace on local, docker, ssh, modal, and daytona
  backends). If the runtime provides a specific target path, use that exact
  path instead."""

PLAN_CRAFT = """Write the plan for an implementer with zero context for the codebase and
questionable taste. A good plan makes implementation obvious — if someone has
to guess, the plan is incomplete.

Structure (include the sections that are relevant):
- Goal — one sentence.
- Current context / assumptions.
- Architecture / proposed approach — 2-3 sentences.
- Step-by-step tasks. Each task is bite-sized (2-5 minutes of focused work),
  names exact file paths (`src/models/user.py`, not "the model file"),
  includes complete copy-pasteable code where code is needed, and exact
  commands with expected output for verification.
- Tests / validation — for code tasks, follow the TDD cycle per task: write
  the failing test, run it to verify failure, implement minimally, run to
  verify pass, commit.
- Risks, tradeoffs, and open questions.

Principles: DRY, YAGNI, TDD, frequent commits. Avoid vague tasks ("add
authentication"), incomplete code ("add validation here"), and unverifiable
steps ("test it works" — instead: the exact command and its expected output).

Interaction style:
- If the request is clear enough, write the plan directly.
- If it is genuinely underspecified, ask a brief clarifying question instead
  of guessing.
- After saving the plan, reply briefly with what you planned and the saved
  path, and offer to execute it (e.g. via subagent-driven development) —
  but do not start executing in this turn."""

PLAN_ASK = (
    "Before writing the plan: If the request has material ambiguities that would change the plan, "
    "do NOT guess and do NOT ask in prose. First write a questions JSON file under .hermes/plans/ "
    "named <YYYY-MM-DD_HHMMSS>-<slug>-questions.json with your file tool (writing this JSON is part "
    "of planning and is allowed). Format: "
    "{\"title\":\"<short title>\",\"questions\":[{\"q\":\"<question>\",\"options\":[\"<option 1>\","
    "\"<option 2>\"]}]}. Use 1 to 5 questions, each with 2 to 5 short options; the user always gets "
    "an extra free-text answer; skip the questions entirely when everything you need is already "
    "clear. Only ask about material doubts that change the plan — never about things inferible from "
    "the repo or the context — and ask at most ONE round. Write the file FIRST, then end your reply "
    "with ONLY this directive paragraph on its own line and nothing else in that paragraph: "
    "::plan-questions{file=\".hermes/plans/<exact-questions-filename-you-saved>\"} That reply must "
    "NOT contain the plan and NOT the ::plan-approve directive; never paste the JSON into your "
    "reply. When you receive the answers, write and save the plan as usual and end with the "
    "::plan-approve directive."
)

PLAN_CLOSE = (
    "After saving the plan markdown under .hermes/plans/, end your reply with ONLY this directive "
    "paragraph on its own line and nothing else in that paragraph: "
    "::plan-approve{file=\".hermes/plans/<exact-filename-you-saved>\"} Rules: that paragraph holds "
    "only the directive; file is the exact path you saved; do not paste the full plan text inside "
    "the directive."
)

PLAN_NOTE = "[/plan — plan mode]\n\n" + PLAN_RULES + "\n\n" + PLAN_CRAFT + "\n\n" + PLAN_ASK + "\n\n" + PLAN_CLOSE

DEBUG_NOTE = (
    "[mode:debug] DEBUG LOOP mode is active for the user's bug. Phase 0 — INSTRUMENT NOW (before "
    "anything else): add the debug logging/instrumentation the stack allows (a file log, console, "
    "structured dumps) around the suspected area, and modify the project files as needed. Phase 1 — "
    "INSTRUCT: reply with SHORT numbered steps for the user to reproduce the bug and capture "
    "evidence, including WHERE the log lives. Then end your reply with ONLY this directive "
    "paragraph on its own line and nothing else in that paragraph: ::debug-loop{round=\"1\"} — "
    "round starts at 1 and increments on every iteration; that paragraph holds only the directive. "
    "Loop contract: the card under the directive has two buttons. \"I already did the steps, it's "
    "still not working\" sends you a new turn: read the produced logs, diagnose the root cause with "
    "evidence, apply the fix, and reply with the next sequential steps + the next ::debug-loop "
    "directive (round+1). \"Mark as fixed\" sends a cleanup turn: remove ALL the instrumentation "
    "you added and restore the code to its clean state."
)

NOTES = {"ask": ASK_NOTE, "plan": PLAN_NOTE, "debug": DEBUG_NOTE}
