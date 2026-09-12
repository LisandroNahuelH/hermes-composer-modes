# Troubleshooting

## Where everything logs

| File | What |
|---|---|
| `%LOCALAPPDATA%\hermes\composer-modes\install.log` | every installer run (console mirrors it) |
| `%LOCALAPPDATA%\hermes\composer-modes\restart.log` | detached backend restarts (pids killed, timestamps) |
| `%LOCALAPPDATA%\hermes\logs\desktop.log` | app + plugin probes (`[cm-pa] …`) |
| `<checkout>\composer-modes-patch-manifest.json` | what the patcher wrote: sha before/after + backup paths |

## Probes (plugin evidence)

In `desktop.log` (tail with `Get-Content … -Tail 500`):

- `[cm-pa] register ver=v12.2 …` — plugin loaded in a window (hot-reload fires on save).
- `[cm-pa] mw v12 derive mode=ask note=1126` — a fresh submit derived a note.
- `[cm-pa] mw v12 pass note=140` — a queued entry drained with its frozen frame.

No `register` line after copying the plugin ⇒ the app is not running (it loads on
next start) or the file did not land in `desktop-plugins\composer-modes\`.

## End-to-end proof (hidden note)

1. Send one message with any mode on.
2. `SELECT id, length(content) AS c, length(api_content) AS a FROM messages ORDER BY id DESC LIMIT 3;`
   (rows live in `state.db` under the Hermes home).
3. Expected: `a = c + 2 + len(note)` (plan/debug), `a = c + 4 + 2*len(note)` (ask),
   `a IS NULL` (agent). If `api_content` is NULL for a mode that should carry a note,
   the channel broke — check the probes (`derive` happened? `note=` length) and the
   installer log before touching anything.

## Installer exits

| Exit | Meaning | Action |
|---|---|---|
| 2 (patch step) | anchors missing (upstream drift) | nothing written; attach the log tail + `git rev-parse HEAD` to a new issue |
| 3 | failed mid-apply, **rolled back clean** | tree is as before; read the log, fix the cause, rerun |
| 4 | rollback incomplete (locked file) | the log lists file(s); restore from the listed `.bak-*` |
| 5 | token present but targets incomplete | a hand-edit happened after patching; do not force |
| 130/3 (script) | another run holds `install.lock` | wait 30 min or delete the stale lock |

## Re-run / reset

```powershell
# idempotent re-apply (also what the Windows task runs)
powershell -NoProfile -ExecutionPolicy Bypass -File "$repo\install\install.ps1" -Repair
# full dry run
powershell -NoProfile -ExecutionPolicy Bypass -File "$repo\install\install.ps1" -WhatIf
# undo everything (hash-verified)
powershell -NoProfile -ExecutionPolicy Bypass -File "$repo\install\uninstall.ps1"
```

## Backend did not pick up the patch

The installer schedules a one-shot task that kills `hermes_cli.main serve` ~45 s
after the run; the app respawns it on the next message. If the note still does not
travel, check `restart.log` (killed?) and `agent.log` for the backend boot
timestamps; then `install.ps1 -Repair` once more and send a fresh message. If
`restart.log` is missing and `schtasks /query /tn HermesComposerModesRestart /v`
shows `267011` (`0x41303`), the task never ran — pre-12.2.2 tasks are blocked on
battery; re-run `install.ps1` (12.2.2+ sets battery-safe flags).

## Hot-reload not firing

The plugin change applies on file save via the app watcher. If the app was closed
during install, it loads on next start. To force: restart the desktop app.

## Still stuck — what to include in an issue

`install.log` tail, `versions.json`, `desktop.log` probe lines, the DB query result
above, and `git -C <checkout> rev-parse HEAD`. No tokens, no personal data.
