# legacy/ — the v1 install pipeline (superseded, kept for reference)

Everything in this folder belonged to **Composer Modes v1** (up to v12.3.2), when the
hidden-note delivery needed changes inside Hermes itself:

- `core-patch/` — an anchored, transactional patch over five core Python files
  (`prompt.submit` `note` param, `session.note.stage`, the ask sandwich, pristine titles).
- `desktop-patch/` + `seam/` — anchored renderer ops rebuilt into the Electron app
  (per-entry queue freeze, the middleware chain running on steer/redirect paths).
- `install/` — the PowerShell installer, the desktop-seam builder, the staged app swap,
  the Windows guardian task (`HermesComposerModesEnsure`) and the weekly update cronjob.
- `docs/` — the v1 architecture, limits and troubleshooting notes.
- `plugin/` — the v1 standalone desktop plugin (`plugin.js` v12.3).
- `versions.json` — the v1 release pins (`plugin_sha256`, patch ids, min base commit).

**None of it is needed anymore.** The v13 package in the repository root delivers the
same behaviour through supported plugin surfaces only:

| v1 (patched) | v13 (plugin package) |
|---|---|
| `prompt.submit { note }` merged in core | `pre_llm_call` returns `{"context": note}` (Hermes owns the `api_content` sidecar) |
| `session.note.stage` RPC (core patch) | `POST /api/plugins/composer-modes/mode` from the desktop half |
| ask enforced by prompt text | `pre_tool_call` blocks state-changing calls |
| ask "+ note before and after the text" (sandwich) | note appended once (the append-only injection Hermes supports out of the box) |
| per-entry queue freeze | planned: the mode is staged at submit time; the queue drain re-stages |
| core patch + app rebuild + guardian task | `hermes plugins install` + `hermes plugins enable` |

The files stay in the repository for archaeology and because the guardian task and the
weekly cronjob still reference them on machines installed before v13. **Do not run the
installer on a machine that has the v13 package installed** — it would re-patch the core
and overwrite the standalone desktop copy the package owns.

The upstream seam (an opaque per-turn `note` on `prompt.submit`, plus the sandwich) is
still worth upstreaming on its own merits; that is a separate PR against
`NousResearch/hermes-agent`, not part of this plugin.
