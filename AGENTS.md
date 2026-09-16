# AGENTS.md — the composer-modes runbook (read me before touching anything)

You are an agent working on **Composer Modes for Hermes Agent**: a *unified plugin
package* (agent half in Python + desktop half in plain-JS ESM) for the Hermes desktop
composer. This file is the runbook: layout, install, verification, failure protocol.

**No core patch, no renderer rebuild.** The v1 pipeline that used to patch Hermes itself
(core patch, renderer seam, installers, guardian task) is retired: it is gone from the
tree and recoverable from history at commit `3d5042e` (`git show 3d5042e:install/install.ps1`).
Never reintroduce a core patch here — the package ships without them by design.

## 0. Preflight

```bash
hermes --version                    # >= 0.21.3 (unified package + ctx.rest)
node --check desktop/plugin.js       # desktop half parses
python -m pytest -c tests/pytest.ini # shipped suite, no Hermes needed
hermes plugins validate .            # manifest + declared capabilities
```

Windows note: run the terminal through Git Bash; pass `C:/…` paths (not `/c/…`) to
native tools like `node`, `python`, `git`.

## 1. Repository map

```
plugin.yaml       agent-half manifest (name, hooks, platforms, requires_hermes)
__init__.py       register(ctx): pre_llm_call, pre_tool_call, /mode, shipped skill
modes.py          mode ids + the operating notes (single source of truth)
store.py          per-session mode state — plugin-data/composer-modes/state.json
enforce.py        ask-mode policy gate (tool deny-list + terminal classifier)
dashboard/        manifest.json + plugin_api.py → /api/plugins/composer-modes/
desktop/plugin.js the desktop half (mode button, cards, plan reader pane)
skills/composer-modes/SKILL.md  the protocol, loadable as composer-modes:modes
scripts/verify_note.py          read the hidden note back out of state.db
tests/            pytest suite (config in tests/pytest.ini — rootdir on purpose)
docs/             architecture.md, limits.md, verification.md
```

## 2. Install (the whole thing)

```bash
hermes plugins install composer-modes      # catalog entry (or owner/repo before merge)
hermes plugins enable composer-modes
```

* The agent half lands in `<hermes home>/plugins/composer-modes/`.
* The desktop half is copied by the Electron main process into
  `<hermes home>/desktop-plugins/composer-modes/` (marker `.hermes-package.json`) and
  loads through the normal desktop-plugin pipeline. A standalone folder of the same name
  **without** the marker blocks that copy on purpose — remove it first if it is a v1
  leftover.

## 3. Verification checklist (prove it, then report)

```bash
H="$LOCALAPPDATA/hermes"

# 3a. agent half loaded — the plugin logs one line per register
grep -aF 'composer-modes]' "$H/logs/desktop.log" | tail -3      # ... register ver=v2.0.0 ...

# 3b. backend routes mounted (same process as the chat)
grep -aF 'Mounted plugin API routes: /api/plugins/composer-modes/' "$H/logs/"*.log | tail -2

# 3c. desktop half materialized + loaded
ls "$H/desktop-plugins/composer-modes/"                          # plugin.js + .hermes-package.json
grep -aF '[cm-pa]' "$H/logs/desktop.log" | tail -5               # register v13 + probes

# 3d. hidden note, end to end (conclusive): send one message in a non-agent mode, then
python scripts/verify_note.py "$H/state.db"
#    typed bytes stay yours; the model-only tail is the mode note.

# 3e. ask enforcement: ask for a file change in ask mode → the turn reports a
#     [composer-modes] block, and the file is untouched.
```

Report the real values — never paste a checklist you did not run.

## 4. Failure protocol

| Symptom | Meaning | Do |
|---|---|---|
| `hermes plugins list` shows the plugin "not enabled" | allow-list gate | `hermes plugins enable composer-modes` |
| no `register ver=` line in `desktop.log` | agent half not loaded | check the enable list, then `grep -ai "plugin" logs/desktop.log \| tail` |
| no `Mounted plugin API routes` line | backend not mounted (disabled, or already imported before enabling) | enable the plugin, restart the backend (`hermes serve` child of the app) |
| desktop half missing under `desktop-plugins/` | a standalone folder of the same name exists (v1 leftover) | delete that folder, then reload plugins in the app (⌘K → Reload desktop plugins) |
| mode button visible but no note reaches the model | backend unreachable from the desktop half | probes: `grep -aF '[cm-pa] stage' logs/desktop.log` shows `stage FAIL …` with the error |
| ask mode blocks a command the user wanted | the terminal classifier is fail-closed | read the block message; ask in Agent mode, or set `HERMES_COMPOSER_MODES_ASK_ENFORCE=0` |
| `hermes plugins validate .` fails on declared hooks | manifest drifted from `register()` | fix `plugin.yaml` to match what `__init__.py` registers — never the other way around |

## 5. Changing the code

* One rule per change; keep `modes.py` the only place a mode's words live.
* After any change: `node --check desktop/plugin.js` (if touched),
  `python -m pytest -c tests/pytest.ini`, `hermes plugins validate .`.
* Bump `VERSION` in `__init__.py`, `dashboard/plugin_api.py`, `plugin.yaml`,
  `dashboard/manifest.json` and `desktop/plugin.js`'s `VER` together.
* Commit style: `feat|fix|docs|test|chore(scope): …`. The catalog pins a commit SHA —
  a released version must be a pushed commit, and the catalog entry bumped in a
  separate PR against `NousResearch/hermes-agent` (`plugin-catalog/composer-modes.yaml`).

## 6. What you must not do

* Do not reintroduce a core patch or a renderer rebuild — this package ships without
  them by design.
* Do not write the operating notes into `draft.text`: the note must only ever ride the
  model-facing bytes (`api_content`), never the bubble or the transcript.
* Do not let a hook or the desktop half raise into the host: hooks return `None` on
  failure, the middleware returns the draft unchanged.
