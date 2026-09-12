# Limits — what is guaranteed, and where the edges are

Read this before promising anything to a user.

## Platform

- **Windows-only (v1).** The patch flow is verified on Windows 10/11 only.
  `install/install.sh` refuses cleanly on macOS/Linux so agents stop instead of
  improvising. A port is future work.
- **Default Hermes home.** The installer ladders `-HermesHome` → `HERMES_HOME` →
  `%LOCALAPPDATA%\hermes` → `~\.hermes`. The legacy `~\.hermes` folder often exists
  as an empty shell — detection requires a real `hermes-agent` checkout or
  `config.yaml`, not mere existence. Multi-profile desktop setups beyond the active
  home are out of scope for v1.

## The note channel

- **The note is an instruction, not a sandbox.** Ask mode is enforcement *by
  operating note* (strict wording + mandated closing line). Hard tool-gating per
  mode would live in the core's turn logic and is out of scope here.
- **Staged notes expire (TTL 30 s)** and are popped on every submit; a refused
  submit hands the popped note back. Editing the core by hand can create states the
  patcher refuses to guess about (exit 5) — by design.
- **Cap 8 KiB** per note (gateway-side sanitize + truncate).
- **One note slot per session.** Two submits racing within the TTL window share the
  slot semantics (last stage wins); plugins derive the note per submit, so this is
  theoretical for normal use.

## Build matrix (the queue freeze)

| Scenario | What works |
|---|---|
| New desktop build (upstream seam) + this core patch | everything: frame carries the note, queue **freezes it per entry** — switching modes mid-queue changes nothing |
| Stock desktop build + this core patch | single sends and the busy/queue carry via `session.note.stage`; the *perfect per-entry freeze* is the seam's job and ships upstream |
| Stock everything (no patch) | modes are cosmetic — the note cannot travel. The installer refuses nothing; the plugin degrades silently (documented, detectable via probes) |

## Hermes updates

- Updates reset/refresh the `hermes-agent` checkout and can drop the patch.
  The Windows task re-applies it (logon + every 6 h). If the task is disabled, run
  `install.ps1 -Repair` once.
- If upstream moved the patched regions, the patch **fails loudly (exit 2) and
  writes nothing** — the guardians will keep retrying on schedule. Open an issue
  with the log so `ops.json` gets re-anchored for the new base.
- The plugin itself lives outside the checkout (`desktop-plugins\`) and survives
  updates; the update cronjob keeps it current via the sha-gated copy.

## Known non-goals (v1)

- No macOS/Linux installer, no auto-update without the cronjob, no desktop-side
  (TS) patching — that seam requires rebuilding the app and is exactly what the
  upstream PR carries.
- No telemetry. Nothing phones home, ever.
