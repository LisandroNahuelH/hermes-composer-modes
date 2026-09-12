# Security policy & threat model

## What this project changes on your machine

| Surface | Path | Change |
|---|---|---|
| Plugin | `%LOCALAPPDATA%\hermes\desktop-plugins\composer-modes\plugin.js` | one file installed (previous version backed up) |
| Core seam | 5 files in your `hermes-agent` checkout | anchored edits, listed in [`docs/architecture.md`](docs/architecture.md) |
| Backups | next to each patched file | `.bak-<stamp>-<rand>` (never overwritten) |
| Manifest | `<checkout>\composer-modes-patch-manifest.json` | sha256 before/after + backup paths |
| State | `%LOCALAPPDATA%\hermes\composer-modes\` | `install.log`, `restart.log`, `install.lock`, launcher VBS |
| Scheduler | task `HermesComposerModesEnsure` (+ one-shot `…Restart`) | runs the installer `-Repair` |

Nothing else is read or written. No network calls except `git` (clone/pull) and the
Hermes cronjob you opt into. No telemetry, no analytics, no env vars.

## Guarantees

1. **All-or-nothing patching.** Anchors are verified before the first write; on any
   failure the patcher restores every file it touched and exits non-zero. A
   half-patched core (which could break the gateway) is designed out.
2. **Reversible.** `install/uninstall.ps1` verifies the current file hashes against
   the manifest before restoring the backups.
3. **Pinned.** The plugin copy is gated by the sha256 in `versions.json`.
4. **Loud on drift.** If upstream Hermes changes the patched regions, the installer
   fails with exit 2 and writes nothing — it never guesses.

## Trust model

This repo asks an agent to patch your Hermes checkout. Treat it with the same care
as any installer:

- Read the code. The whole patch surface is `core-patch/ops.json` (20 exact
  search/replace pairs) plus `core-patch/patch.py` (~230 lines) — small enough to
  audit in one sitting.
- Prefer running the installer yourself if you do not want an agent doing it.
- The installer logs everything to `install.log`; keep it.

## Reporting a vulnerability

Open a GitHub issue with `security` in the title. Include the `install.log` tail,
your `versions.json`, and `git -C <checkout> rev-parse HEAD`. Do not include
tokens or personal data.

## Out of scope

- The upstream Hermes project itself (report upstream).
- Third-party forks that re-host this repo's files — verify the sha256 in
  `versions.json` against the source you cloned.
