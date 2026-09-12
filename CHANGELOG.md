# Changelog

## 12.2.3 — 2026-09-12

- **core-patch**: an announced `agent` frame no longer adopts a staged twin. The staged
  channel (v12.2 parity, one slot per session) could hold a queued ask/plan/debug note
  that a later agent send then picked up, stamping it with a foreign mode. `prompt.submit`
  now drops the staged twin when the submit announces `mode=agent` (explicit frames for
  other modes and stageless legacy flows are unchanged).

## 12.2.2 — 2026-09-12

- **installer**: the one-shot backend-restart task (`install.ps1`, `uninstall.ps1`) is now
  created battery-safe (`DisallowStartIfOnBatteries=false`, `StopIfGoingOnBatteries=false`,
  `StartWhenAvailable=true`). Plain `schtasks` defaults blocked it on laptops — the task
  never ran (`0x41303`), so the post-install backend restart silently stalled until the
  next Hermes update. The guardian task was already battery-safe.

## 12.2.1 — 2026-09-12

- **core-patch**: forward-port the three drifted anchors to upstream `1c671bea`
  (2026-09-12): `prompt_turn` `_run_prompt_submit` signature (Collective-Wisdom
  revert upstream), the `session.note.stage` insertion point (new `_CLIENT_SURFACES`
  block), and the refusal re-stage tail (`client_surface` rewrite). Plugin
  unchanged (v12.2). Gates: `patch.py --verify-only` 20/20 anchors,
  `verify_core.py` VERIFIED on the refreshed base.

## 12.2.0 — 2026-09-11

First public release.

- **Plugin** v12.2: Ask · Agent · Plan · Debug modes; hidden per-turn notes;
  plan-approve / debug-loop / plan-questions cards; plan reader pane; `[cm-pa]`
  probes. “Stages always”: works with the upstream desktop seam **and** stock
  builds (via `session.note.stage`, one-shot, TTL 30 s).
- **Core seam** (`core-patch/`): note param + 8 KiB cap, staged-note channel with
  pop-on-every-submit and re-stage on refused submits, Ask sandwich
  (primacy + recency), queue/busy note carry, pristine session titles. Shipped as
  20 replay-tested search/replace ops with a transactional patcher.
- **Installer**: preflight ladders (home / checkout / python), plugin sha256 gate,
  per-file backups + manifest, verify gate, detached backend restart, idempotent
  `-Repair`, full `-WhatIf` dry run, lock guard.
- **Guardians**: Windows task `HermesComposerModesEnsure` (logon + every 6 h) and
  the Hermes update cronjob recipe.
- **Uninstaller**: hash-verified restore with `.bak-*` and `git checkout` fallbacks.
- **Docs**: AGENTS.md runbook, architecture, limits, troubleshooting, security.
