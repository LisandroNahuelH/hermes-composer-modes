# AGENTS.md — the composer-modes runbook (read me before touching anything)

You are an agent asked to install **Composer Modes for Hermes Agent** from this repo.
Follow this file top to bottom. It is self-contained: repo layout, exact commands,
expected output, and what to do when something fails.

**Supported upstream base:** `NousResearch/hermes-agent` @ `1c671bea` (2026-09-12),
core patch `repo-2026-09-12-V4`. Upstream moves fast: if `patch.py` reports
`anchors missing`, port the failing ops to the new base (pattern: CHANGELOG 12.2.1;
re-run `patch.py --verify-only` until 20/20 anchors match) — never hand-edit the
five core files.

**Windows-only (v1).** If you are on macOS/Linux: stop. Run `bash install/install.sh`
(which refuses), and tell the user the port is not shipped yet. Do not hand-patch.

## 0. Preflight — verify, then stop or continue

Check every line. If any fails, **stop and report exactly which one** (do not improvise):

```powershell
# OS
[System.Environment]::OSVersion.Platform   # expect Win32NT
# git present
git --version                              # any 2.x
# Hermes home + agent checkout (the installer ladders these too)
Test-Path "$env:LOCALAPPDATA\hermes\hermes-agent\tui_gateway\methods_prompt.py"   # True expected
# python for the checklist window (the installer picks the venv itself)
Test-Path "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\python.exe"         # True expected
```

If the checkout lives elsewhere (profile, custom home), note it — every command below
takes the same paths the installer detects; pass `-HermesHome`/`-AgentDir` explicitly
when you have to.

## 1. Clone to a stable path

```powershell
$repo = Join-Path $env:USERPROFILE 'hermes-composer-modes'
if (Test-Path $repo) { git -C $repo pull --ff-only } else { git clone <REPO_URL> $repo }
```

Stable matters: the Windows task and the update cronjob reference this path later.
**Remember `$repo`** — you will reuse it in step 5 and the report.

## 2. Dry run (writes nothing)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$repo\install\install.ps1" -WhatIf
```

Expected tail: `done plugin=whatif core=<unchanged|patched> restart=<skipped|whatif>` and
exit code 0. If preflight fails (exit 2), report the message verbatim.

## 3. Install (the real run)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$repo\install\install.ps1"
if ($LASTEXITCODE -ne 0) { Write-Host "installer failed: $LASTEXITCODE (see below)" }
```

**Read the log** — the authoritative record (the console mirrors it):

```powershell
Get-Content "$env:LOCALAPPDATA\hermes\composer-modes\install.log" -Tail 40
```

Expected on a fresh install: `plugin installed`, `core patch exit=0` (+ `patched …`
lines), `verify exit=0`, backend restart `scheduled`.

**Expected “self-kill”**: when the core changed, the installer schedules a one-shot
task that kills the backend ~45 s later; the app respawns it on the next message.
If your own turn dies right after step 3, that is this restart, not a failure — the
install already finished (log written) before the restart runs. Wait, then continue.
The restart task is battery-safe since 12.2.2 — older installs (`0x41303`) never ran it
on battery.

## 4. Guardian task

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$repo\install\ensure-task.ps1"
schtasks /query /tn HermesComposerModesEnsure | Select-String HermesComposerModesEnsure
```

Expected: `task registered: HermesComposerModesEnsure (logon +30s, then every 6h)`
and the query echoing the task. This is what re-applies the patch after Hermes
updates.

## 5. Update cronjob (second guardian)

Open `$repo\install\cronjob.md`, take the paste-block, replace `<REPO_PATH>` with the
real `$repo`, and create the cronjob in Hermes (weekly). The job pulls this repo,
re-runs the installer, and sends the user one line.

## 6. Verification checklist (prove it works, then report)

```powershell
$H = "$env:LOCALAPPDATA\hermes"
# 6a. core gate
& "$H\hermes-agent\venv\Scripts\python.exe" "$repo\core-patch\verify_core.py" --repo "$H\hermes-agent" --python "$H\hermes-agent\venv\Scripts\python.exe"
#    expect: VERIFIED (exit 0)
# 6b. plugin loaded (app open): last register probe
Get-Content "$H\logs\desktop.log" -Tail 500 | Select-String 'composer-modes.*register' | Select-Object -Last 1
#    expect a line with ver=v12.2 (or the version in versions.json)
# 6c. hidden note end-to-end (optional but conclusive)
#    Ask the user to send ONE message with any mode on, then:
#    - read the newest row:  SELECT content, api_content FROM messages ORDER BY id DESC LIMIT 1;
#      (state.db under the Hermes home) -> api_content is longer than content by exactly
#      the note (+2 framing chars; Ask mode adds the note on both ends: +4 + 2*note_len)
```

Report to the user, in their language, as a short table: installed version,
plugin probe line, core `VERIFIED`, task registered, cronjob created, and the
one-liner for the live test result.

## Failure protocol

| Symptom | Meaning | Do |
|---|---|---|
| installer exit 2 | preflight failed (no home/checkout/python) | report the exact message; nothing was touched |
| `core patch exit=2` | anchors missing = upstream drift | **nothing was written**; open an issue with the log tail + `git -C <checkout> rev-parse HEAD` |
| `core patch exit=5` | token present but targets incomplete (edited after patching) | do not force; report; ask the user before restoring backups |
| `verify exit=1` | verification failed after patching | the patcher **rolled back automatically** and the backend was NOT restarted; report the log |
| `ROLLBACK INCOMPLETE (exit 4)` | restore failed (locked file) | the log lists the file(s); restore them from the listed `.bak-*`; then report |
| installer exit 3 | another run holds the lock | wait 30 min or rerun later; it is a no-op guard, not an error |
| task never ran (`0x41303`/`267011` in `schtasks /query /v`) | pre-12.2.2 restart tasks are blocked on battery | recreate via `install.ps1` (12.2.2+ is battery-safe), or clear the battery condition by hand |

Never edit the five patched files by hand to “make it work”, never delete the
manifest, and never re-run the installer with `--force` flags that do not exist.

## Manual path (for the user, if they prefer)

```powershell
git clone <REPO_URL> "$env:USERPROFILE\hermes-composer-modes"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\hermes-composer-modes\install\install.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\hermes-composer-modes\install\ensure-task.ps1"
```

Then `install/cronjob.md` for the updater, and `install/uninstall.ps1` to undo everything.

## What you must not do

- Do not patch anything outside: the 5 core files, the plugin folder, the state dir
  (`%LOCALAPPDATA%\hermes\composer-modes\`), the scheduled task, the cronjob.
- Do not hand-edit the core for “fixes” — drift is handled by reporting, not patching.
- Do not run the installer twice in parallel (the lock guards you; respect exit 3).
