# Verification

Three layers: what the repo proves by itself, what the running Hermes proves, and what
only a live turn proves. Run them in that order and report real output.

## 1. Repository gates (no Hermes needed)

```bash
node --check desktop/plugin.js            # the desktop half parses as plain ESM
node scripts/smoke_desktop_half.mjs       # loads it with SDK stubs: wires + stages, never rewrites
python -m pytest -c tests/pytest.ini      # 103 tests: modes, store, enforcement, wiring, API
hermes plugins validate .                 # manifest + capability probe against register()
```

`hermes plugins validate` is the same check the catalog CI runs: manifest fields,
`requires_hermes`, and a probe that imports `register()` in isolation and compares what
it wired against `provides_hooks` in `plugin.yaml`. A mismatch fails the entry.

## 2. Install gates (running Hermes)

```bash
H="$LOCALAPPDATA/hermes"                      # or $HERMES_HOME

hermes plugins install composer-modes && hermes plugins enable composer-modes
hermes plugins list | grep composer-modes     # expect: enabled, source = the catalog/repo

# agent half loaded (one line per register)
grep -aF 'composer-modes]' "$H/logs/desktop.log" | tail -2

# backend routes mounted in the chat's process
grep -aF 'Mounted plugin API routes: /api/plugins/composer-modes/' "$H/logs/"*.log | tail -1

# desktop half materialized (the marker is the proof it came from the package)
ls "$H/desktop-plugins/composer-modes/"
cat "$H/desktop-plugins/composer-modes/.hermes-package.json"
```

If the desktop half is missing: check for a marker-less `desktop-plugins/composer-modes/`
folder (v1 leftover — it blocks the copy by design), remove it, then reload plugins in the
app (⌘K → *Reload desktop plugins*).

## 3. Live turn (the conclusive one)

**a. The note is hidden.** Send one message with a non-agent mode on, then read the row:

```bash
python scripts/verify_note.py "$H/state.db"
```

Expected: `content` is exactly what was typed (no note, no prefix), `api_content` is
longer by the note (and its framing separators). `hidden ok: True` is the pass condition: a
mode whose note never arrives is indistinguishable from Agent inside the turn, so this read-back
is the only honest proof the plugin worked.

**b. Ask mode blocks a mutation.** In ask mode, ask for a file change. Expected: the
agent reports a `[composer-modes] Ask mode is read-only …` block and the file is
untouched. The plugin logs the veto:

```bash
grep -aF 'ask-block' "$H/logs/desktop.log" | tail -3
```

**c. The desktop half is alive.** Its probes are the only observability channel on a
packaged build (`console.error` is the one level that reaches the log):

```bash
grep -aF '[cm-pa]' "$H/logs/desktop.log" | tail -20
```

| Probe | Means |
|---|---|
| `register ver=v13.1 …` | the desktop half loaded (version + window) |
| `stage ok mode=ask sid=…` | the backend accepted the mode for that session. The `sid` must be the session id the core uses (`YYYYMMDD_HHMMSS_xxxxxx`), never a short runtime tile id — a runtime id here is the one failure that looks like success |
| `stage FAIL …` | backend unreachable — the send still went out unchanged |
| `mw v13 mode=…` | the middleware ran for a submit |
| `auto-reset …->agent` | the plan/debug card landed and the mode returned to Agent |

**d. Session isolation.** Two sessions, different modes, one message each: each row's
`api_content` note must match its own session's mode.

## Reporting

Report the real values (version, probe lines, the two byte counts, the block message). Do
not paste a checklist you did not run; if a step cannot run, say which and why.
