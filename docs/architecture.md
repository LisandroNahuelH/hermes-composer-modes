# Architecture

Composer Modes is a **unified Hermes plugin package**: one installable folder that
carries an agent half (Python) and a desktop half (plain-JS ESM), glued by a small
FastAPI router. Nothing outside the package is modified.

```
┌───────────────────────── Hermes desktop (Electron) ──────────────────────────┐
│  composer ── mode button / Shift+Tab ─▶ atom + ctx.storage                   │
│      │                                                                        │
│      │  ComposerMiddleware (composer.middleware)                              │
│      │    await ctx.rest('/mode', {POST})   ← mode staged BEFORE the send     │
│      ▼                                                                        │
│  desktop/plugin.js  (cards, plan reader pane, probes)                        │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ prompt.submit / session RPC
┌──────────────────────────────▼───── Hermes process (serve / gateway) ─────────┐
│  dashboard/plugin_api.py     /api/plugins/composer-modes/…  ⇄ store.py        │
│  __init__.py                                                                  │
│    pre_llm_call   → {"context": note}   → api_content (model-only bytes)      │
│    pre_tool_call  → {"action": "block"} in ask mode                           │
│    /mode command  → default mode                                              │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Why these seams

| Need | Seam used | Why it is the right one |
|---|---|---|
| A per-turn model instruction that the user must not see | `pre_llm_call` returning `{"context": …}` | Hermes composes the current user message's `api_content` from it and replays those exact bytes later, so the durable row, the bubble and the auto-title stay pristine (`agent/turn_context.py`, `compose_user_api_content`). |
| The backend must know the mode before the turn is admitted | `ctx.rest` POST awaited inside the composer middleware | The middleware chain is `await`ed before `onSubmitProp`, so the stage lands before `prompt.submit`. No race, no RPC of our own. |
| The desktop half must reach plugin code | `dashboard/plugin_api.py` → `/api/plugins/<id>/` | The sanctioned namespace: mounted only for enabled user/bundled plugins, reachable from the renderer as `ctx.rest` (namespace-scoped by construction). |
| Ask mode must actually be read-only | `pre_tool_call` returning a block directive | Hermes runs it before approvals and execution; the first valid block wins, and a timed-out callback fails closed. |
| A mode change from any surface | `ctx.register_command('mode', …)` | Plugin commands are dispatchable from the CLI, the TUI, the desktop composer and messaging platforms. |
| The agent must understand the protocol | `ctx.register_skill('modes', …)` | Ships `skills/composer-modes/SKILL.md` as `composer-modes:modes`; explicit loads only. |

## State

`store.py` keeps `{default, sessions: {sid: {mode, updated_at}}}` in
`<hermes home>/plugin-data/composer-modes/state.json` — never inside the install
directory, which `hermes plugins update` replaces. Both halves load the module through
`load_store()`, which keys it in `sys.modules` so one process shares one instance, and
re-reads the file (mtime-checked) when they do not. Sessions untouched for 30 days are
dropped on the next write.

## Verified contracts (checked against Hermes 0.21.3, upstream `bb0c2303`)

* `pre_llm_call` payload: `session_id, task_id, turn_id, user_message,
  conversation_history, is_first_turn, model, platform, parent_session_id, sender_id`.
  A returned string or `{"context": …}` is appended to the current user message's
  model-facing content; the `messages` list is untouched beyond the `api_content` stamp.
* `pre_tool_call` payload: `tool_name, args, session_id, task_id, tool_call_id`.
  Returning `{"action": "block", "message": str}` vetoes the call; the first valid block
  wins; hooks run on a bounded worker and fail closed.
* Unified packages: `plugins/<id>/desktop/plugin.js` is copied by the Electron main
  process into `<hermes home>/desktop-plugins/<id>/` with a `.hermes-package.json`
  marker; a marker-less folder of the same name is a deliberate standalone install and
  is never overwritten.
* `/api/plugins/<id>/` routes are mounted only when the plugin is enabled
  (`plugins.enabled`) and the source is user/bundled.
* `hermes plugins validate <dir>` runs the catalog CI checks locally: manifest fields,
  `requires_hermes`, `requires_env` shape, and a capability probe that imports
  `register()` and compares it against the declared hooks/tools/middleware.

## The desktop half

`desktop/plugin.js` (plain ESM, no build step) registers:

* `composer.actions` — the mode button (cycle on click, `Shift+Tab` via a capture-phase
  window listener; shift-only chords cannot be bound through `KEYBINDS_AREA` because the
  composer is an editable target).
* `composer.middleware` — stage the mode, never rewrite the text.
* `transcript.directives` (`plan-approve`, `plan-questions`, `debug-loop`) — the cards
  that close each loop, with localStorage-mirrored state keyed by a normalized message id
  plus the artifact path, inline panels instead of portal dialogs, and per-button marks.
* Panes — the plan reader (`host.openWorkspace`).

Mode changes funnel through one helper (`applyMode`) so the atom, the storage mirror and
the backend stage can never drift; session switches reset to Agent for the new session.
