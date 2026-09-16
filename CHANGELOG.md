# Changelog

## 2.0.1 — 2026-09-16

**The mode note now reaches the turn — the stage targets the session id the core uses.**

- **fix (desktop half)**: the composer middleware staged the mode against
  `host.state.focusedSessionId`, the runtime *tile* id (`$focusedRuntimeId`). The core fires
  `pre_llm_call` with the stored session id (`agent.session_id`), so the store lookup never
  matched, `get_mode()` answered with the default (`agent`) and no note was ever delivered —
  silently, because from inside a turn "Agent" and "a lost note" look identical. One helper
  (`backendSid()`) now resolves `focusedStoredSessionId` first and falls back to the runtime id
  for shells that do not expose it; the session-change reset stages through the same helper.
- **observability**: the boot `caps` probe prints both ids, so a wrong staging identity is
  visible in `logs/desktop.log` instead of invisible.
- **test**: `scripts/smoke_desktop_half.mjs` asserts the staged `session_id` (red before the fix:
  `staged "sess-runtime" — must stage the stored session id`) and the runtime fallback.
- **verified live** (Hermes 0.21.3): with the fix, `ask`, `plan` and `debug` each frame their
  turn and `agent` stays unframed; `verify_note.py` reports `hidden ok: True` with the typed
  bytes untouched.

## 2.0.0 — 2026-09-16

**The plugin is now a real Hermes plugin package — no core patch, no renderer rebuild.**

- **packaging**: the repository root IS the plugin (`plugin.yaml`, `__init__.py`,
  `modes.py`, `store.py`, `enforce.py`, `dashboard/`, `desktop/`, `skills/`). The v1
  patch pipeline is retired from the tree (history: commit `3d5042e`), so the shipped
  plugin contains no core patch, no installer and nothing that replaces its own files.
- **delivery v13**: the mode travels through supported seams only. The desktop half
  stages the mode with `ctx.rest POST /api/plugins/composer-modes/mode` (awaited inside
  the composer middleware, so the backend knows the mode before the turn is admitted) and
  the agent half returns the note from `pre_llm_call`, which Hermes merges into the
  turn's model-facing bytes (`api_content`) only. `draft.note` and `session.note.stage`
  are gone; the typed text is never rewritten.
- **ask enforcement**: `pre_tool_call` now vetoes state-changing calls in ask mode —
  a deny-list of tools plus any mutating tool name, and a fail-closed read-only
  classifier for `terminal`. `HERMES_COMPOSER_MODES_ASK_ENFORCE=0` disables it.
- **state**: per-session modes in `<hermes home>/plugin-data/composer-modes/state.json`,
  shared by the hooks, the `/mode` command and the REST half, with a 30-day TTL.
- **surfaces**: `/mode ask|agent|plan|debug` works from the CLI, the TUI, the desktop
  composer and messaging platforms; the protocol also ships as a loadable skill
  (`composer-modes:modes`).
- **desktop half**: `desktop/plugin.js` (v13.0) keeps the mode button, `Shift+Tab`
  cycling, the plan approval/questions cards, the plan reader pane and the debug loop
  card, and routes every mode change through one `applyMode` helper (atom + storage +
  backend stage).
- **tests**: `tests/` — 104 pytest cases over modes, store, enforcement, wiring and the
  REST half; `tests/pytest.ini` pins the rootdir (the package needs a root
  `__init__.py`, which pytest cannot import as a package parent).
- **docs**: README/AGENTS/architecture/limits/verification rewritten for the package;
  catalog metadata added (`requires_hermes >= 0.21.3`, declared hooks).

## 12.3.2 — 2026-09-15

- **core-patch**: forward-port the drifted `tui_gateway/AGENTS.md` anchor to upstream
  `afe06f21f4` (2026-09-13) — the base grew a "New event" paragraph between the RPC note
  and `## Key surfaces`; the seam's per-turn-note section now documents the `note` param
  after it. Gates: `patch.py --verify-only` 20/20 anchors, `verify_core.py` VERIFIED,
  import-gate green.
- **desktop-patch**: forward-port four drifted anchors — the `session-tile-actions.ts` and
  `use-prompt-actions/index.ts` import blocks (upstream added `SLASH_COMMAND_RE`,
  `JsonRpcGatewayError`, moved `stripAnsi`, added `ChatMessage`) and the
  `steer-arrival-order.test.tsx` harness (`RpcEvent` → `GatewayEvent`) — plus a full
  refresh of the shipped seam tree to the new base. `gen_ops.py` regenerates all ops
  (32 source + 13 test) with the round-trip proven against the checkout
  (`apply(base) == seam`, byte for byte). Seam gates: `patch_desktop.py --verify-only`
  clean on both sets, the four contract suites green (79/79, vitest).
- **rebuild**: the seam app builds from the patched sources (renderer entry chunk
  changes; the rest of the bundle is byte-identical to stock) and the packaged
  `win-unpacked` swap carries it.

## 12.3.1 - 2026-09-14

- **plugin (v12.3)**: composer mode button UI - the version tag to its right is
  gone; the version now lives in the hover tooltip. The button sits next to the
  model pill in the composer's right cluster and no longer shrinks or wraps
  (`shrink-0` + `whitespace-nowrap`). `VER` is now `v12.3`.
## 12.3.0 - 2026-09-12

- **desktop-patch/**: the desktop-renderer seam (composer-mode frame + per-entry
  queue freeze) now ships in this repo - 14 renderer files as anchored ops
  (`ops.json`, 33 ops) plus the contract tests (`test-ops.json`), generated by
  `gen_ops.py` from a verified diff (round-trip proven byte-for-byte) and applied
  by `patch_desktop.py` (verify -> backup -> apply -> re-verify; create ops for
  new files). The seam tree is kept under `desktop-patch/seam/` for re-anchoring.
- **installer**: new desktop seam step (`install/build-desktop-seam.ps1`):
  applies the ops, rebuilds the app with the checkout toolchain
  (`npm run build` + `electron-builder --dir` into a staging dir), verifies the
  staged build (Hermes.exe + the `fromQueue` renderer marker), stages
  `win-unpacked.new` and schedules the detached `desktop-swap.ps1` (close ->
  backup -> swap -> relaunch). `install.ps1` runs it by default
  (`-SkipDesktopSeam` to skip; a missing node/npm degrades gracefully), and the
  6 h guardian heals both the sources and the app after Hermes updates.
  `uninstall.ps1` restores the renderer sources from its manifest and swaps the
  newest pre-seam app build back.
- **docs**: the pipeline is self-contained (no dependency on any upstream
  branch); the seam is also mirrored upstream as PR #108242 (optional).

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
