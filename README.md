<div align="center">

# Composer Modes for Hermes Agent

**Switch how Hermes thinks — without touching what you typed.**

Four composer modes, one keystroke each. The mode's operating note reaches the
model, never your bubble, your transcript, or your session titles.

`MIT` · `macOS / Linux / Windows` · `Plugin v2.0.1` · `Hermes >= 0.21.3`

</div>

---

## What it is

Composer Modes adds a mode button to the Hermes **desktop** composer:

| Mode | What it does |
|---|---|
| **Ask** | Read-only turn. The agent may read and inspect; it must not change anything, and it closes with a clear sentence telling you to re-ask in Agent mode. State-changing tool calls are **blocked**, not just discouraged. |
| **Agent** | The default. Full toolset, nothing added. |
| **Plan** | Planning only. The plan is saved under `.hermes/plans/` and the reply ends with an inline **Plan card** (Implement / Modify / Read plan / Copy path). |
| **Debug** | A guided loop: instrument → numbered reproduction steps → *still broken?* → fix → *Mark as fixed* cleans the instrumentation up. |

One package, two halves:

```bash
hermes plugins install composer-modes      # ← the whole thing, no patches
hermes plugins enable composer-modes
```

* **agent half** (Python) — `plugin.yaml`, `__init__.py`, `modes.py`, `store.py`, `enforce.py`
* **desktop half** (plain-JS ESM plugin) — `desktop/plugin.js`, copied by the app itself
  into `$HERMES_HOME/desktop-plugins/composer-modes/`
* **backend bridge** — `dashboard/plugin_api.py`, mounted at
  `/api/plugins/composer-modes/` and reached by the desktop half through `ctx.rest`
* **skill** — `skills/composer-modes/SKILL.md`, loadable as `composer-modes:modes`

No core patch, no renderer rebuild, no guardian task: everything rides supported
plugin surfaces of Hermes.

## The hidden-note channel

Every mode attaches a short operating note ("this turn is read-only", "plan rules",
"debug loop contract") to the turn it frames. The note rides Hermes' own per-turn
sidecar: the agent half returns it from the `pre_llm_call` hook, and Hermes merges it
into the **model-facing bytes** of the current user message (`api_content`) only.

```
composer ── POST /mode ──▶ agent half (mode store)     ← which session this turn belongs to
   │                            │
   ▼                            ▼
prompt.submit ──▶ turn ──▶ pre_llm_call ──▶ api_content (the model reads the note)
                                    └──────▶ content (you read your own words)
```

* What you typed is what your bubble, the transcript, the sidebar preview and the
  session title show — byte for byte.
* The note is one-shot: it frames the turn it was staged for and nothing else.
* Slash commands are never framed — a `/plan …` you type stays exactly that.

## Ask mode is enforced, not merely requested

While a session is in ask mode the plugin vetoes the tool calls that would change
something (`pre_tool_call` → `{"action": "block"}`):

* a deny-list of state-changing tools (`write_file`, `patch`, `delegate_task`,
  `memory`, `cronjob_manage`, `process_manage`, …) plus any tool name shaped like a
  mutation (`*_delete`, `*_create`, `*_upload`, …);
* `terminal`: every command segment must match a read-only allow-list (`cat`, `ls`,
  `grep`/`rg`, `git status|log|diff|show`, `wc`, `diff`, version checks, pipes between
  them) and the command must contain no redirection or mutating token. When in doubt it
  is blocked — ask mode is read-only by contract.

Nothing here is a sandbox: it is a policy gate for a mode the user chose. Switch it off
with `HERMES_COMPOSER_MODES_ASK_ENFORCE=0` in the Hermes process environment.

## Switching modes

* **Desktop** — the mode button in the composer, or `Shift+Tab` to cycle through
  Ask → Agent → Plan → Debug.
* **Anywhere** — `/mode ask|agent|plan|debug` sets the default mode for sessions that
  have no mode of their own (CLI, TUI, desktop, messaging platforms).

## Requirements

* Hermes Agent **>= 0.21.3** (the unified agent + desktop package layout and
  `ctx.rest` for the desktop half).
* The desktop half is app-level: the app copies it out of the installed package and
  loads it through the normal desktop-plugin pipeline (hot reload included). Like the
  Python half, it stays disabled until you turn it on — **Capabilities → Plugins** for
  the UI half, `plugins.enabled` for the Python half.

## Limits (honest ones)

* **The note is append-only.** Hermes injects hook context after the user message, so a
  mode note rides the end of the turn. (The v1 patch could sandwich it before *and*
  after; that seam belongs upstream. The whole v1 pipeline — core patch, renderer seam,
  installers — is retired from the tree and recoverable from history at commit `3d5042e`.)
* **Queued sends follow the mode at drain time.** The composer's middleware chain runs
  when a queued message actually goes out, so switching modes while a message waits
  changes the mode it travels with.
* **Mid-turn steers** (plain Enter while the agent is busy) are sent by the desktop
  directly; they carry whatever mode the backend already knows for that session.
* **The backend half must be reachable.** It runs inside the same Hermes process as the
  chat. If it is disabled or unreachable, the button still switches but no note travels:
  the desktop half degrades silently and leaves a probe in `logs/desktop.log`.
* Ask mode is a policy gate, not an OS sandbox — a malicious plugin could ignore it. It
  exists to make an honest mode honest.

## Verify it works

```bash
hermes plugins validate .                                  # manifest + declared capabilities
python -m pytest -c tests/pytest.ini                       # the shipped suite (no Hermes needed)
hermes plugins list | grep composer-modes                  # after installing
```

End-to-end recipe (hidden note in `api_content`, ask-mode block, desktop-half probes):
[`docs/verification.md`](docs/verification.md).

## Repository map

```
plugin.yaml     agent-half manifest (name, hooks, platforms, requires_hermes)
__init__.py     register(ctx): the two hooks, the /mode command, the shipped skill
modes.py        mode ids, labels and the operating notes (single source of truth)
store.py        per-session mode state (file-backed, thread-safe, plugin-data/)
enforce.py      the ask-mode policy gate (deny-list + terminal classifier)
dashboard/      plugin_api.py — the REST namespace the desktop half talks to
desktop/        plugin.js — mode button, plan card, plan reader pane, debug loop card
skills/         the mode protocol as a loadable skill
scripts/        verify_note.py + smoke_desktop_half.mjs (repository gates)
tests/          pytest suite (103 tests)
docs/           architecture, limits, verification
```

Run the tests with `python -m pytest -c tests/pytest.ini`. The pytest config lives in
`tests/` on purpose: the plugin needs an `__init__.py` at the repository root, and
pytest turns a parent directory that has one into a package it cannot import.

## Uninstall

```bash
hermes plugins remove composer-modes
```

The desktop half is removed with the package (the app drops its copy), and the mode
state lives in `<hermes home>/plugin-data/composer-modes/state.json` if you want to
delete it by hand.

## Credits

Built by [@LisandroNahuelH](https://github.com/LisandroNahuelH) with the Hermes Agent
desktop plugin SDK. MIT licensed — use it, fork it, ship it.
