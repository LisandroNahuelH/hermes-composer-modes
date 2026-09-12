# Automatic updates — the Hermes cronjob

The second guardian. The Windows task (`ensure-task.ps1`) repairs the core after
Hermes updates; this cronjob keeps the repo itself current, so users never fetch
releases by hand.

## Create it (one paste into any Hermes chat)

> Create a **weekly** cronjob named "composer-modes updates" that:
>
> 1. Runs `git -C "<REPO_PATH>" fetch origin --quiet` and compares
>    `git -C "<REPO_PATH>" rev-parse HEAD` with `origin/HEAD`.
> 2. If they differ: `git -C "<REPO_PATH>" pull --ff-only`, then run
>    `powershell -NoProfile -ExecutionPolicy Bypass -File "<REPO_PATH>\install\install.ps1" -Repair`,
>    then read the last 30 lines of
>    `%LOCALAPPDATA%\hermes\composer-modes\install.log`.
> 3. Sends me **one line**: `composer-modes: updated to <version>` /
>    `already current` / `problem: <one-line error>`.
>
> If the pull fails (local edits), report it and change nothing.

Replace `<REPO_PATH>` with the folder where the installer cloned this repo
(the `install/` folder lives there; the agent that installed it knows the path —
ask: *"where did you clone hermes-composer-modes?"*).

## Why two guardians

| Guardian | Watches | Repairs |
|---|---|---|
| Windows task `HermesComposerModesEnsure` | Hermes updates (checkout resets) | re-applies plugin + core patch (`-Repair`) |
| Hermes cronjob (this file) | this repo's releases | pulls the new version, re-runs the installer, notifies |
| `versions.json` | — | the version handshake both use (`plugin_sha256` gate) |

## Manual update (no cronjob)

```powershell
git -C "<REPO_PATH>" pull --ff-only
powershell -NoProfile -ExecutionPolicy Bypass -File "<REPO_PATH>\install\install.ps1"
```

The installer is idempotent: only the delta applies, and the plugin sha256 in
`versions.json` gates the copy.
