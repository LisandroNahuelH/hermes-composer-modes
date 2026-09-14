# desktop-patch — the renderer seam (composer-mode frame + queue freeze)

The queue freeze lives in the desktop renderer (`apps/desktop/src`), so the
installer cannot patch the packaged app: it patches the **sources**, and
`install/build-desktop-seam.ps1` rebuilds the app from them.

| File | What |
|---|---|
| `ops.json` | the seam as 33 anchored search/replace pairs over 14 renderer files |
| `test-ops.json` | the seam's contract tests (4 files) — optional, deep verification |
| `seam/` | the seam tree (full files) — provenance + source of truth for re-anchoring |
| `gen_ops.py` | regenerates the ops from a verified diff (round-trip proven; refuses badly anchored ops) |
| `patch_desktop.py` | transactional patcher: verify → backup → apply → re-verify (create ops for new files) |

## Usage (usually via the installer)

```powershell
$H = "$env:LOCALAPPDATA\hermes"; $R = "$env:USERPROFILE\hermes-composer-modes"
# patch the renderer sources
& "$H\hermes-agent\venv\Scripts\python.exe" "$R\desktop-patch\patch_desktop.py" --repo "$H\hermes-agent"
# deep verification: the contract tests + vitest
& "$H\hermes-agent\venv\Scripts\python.exe" "$R\desktop-patch\patch_desktop.py" --repo "$H\hermes-agent" --set tests
# rebuild + stage (and, unless -NoSwap, schedule the detached swap)
powershell -NoProfile -ExecutionPolicy Bypass -File "$R\install\build-desktop-seam.ps1"
```

Exit codes mirror `core-patch/patch.py`: 0 ok/no-op · 2 anchors missing (nothing
written) · 3 rolled back clean · 4 rollback incomplete · 5 bad state.

## Re-anchoring after upstream drift

Exit 2 = the base moved and some anchors no longer match exactly once. Nothing
was written. Re-anchor against the new base:

```powershell
git clone https://github.com/NousResearch/hermes-agent <clone>
git -C <clone> fetch origin main   # the new base lives here
# regenerate against the shipped seam tree (no seam ref needed):
& python desktop-patch\gen_ops.py --repo <clone> --base origin/main --seam-dir desktop-patch\seam --out-dir <tmp>
# review <tmp>\ops.json vs the committed one, then replace and re-run:
& python desktop-patch\patch_desktop.py --repo $H\hermes-agent --verify-only
```

`gen_ops.py` refuses to emit an op whose `old` block is not unique in the base,
and proves the round-trip (`apply(base) == seam`) for every file before writing.

## Markers and backups

Each applied file ends with `// [composer-modes-desktop-patch]` (or
`<!-- [composer-modes-desktop-patch] -->` in `.md`) for idempotence; backups land
next to each file (`.bak-<stamp>-<rand>`) and the manifest at
`<checkout>\composer-modes-desktop-patch-manifest.json` (tests twin:
`composer-modes-desktop-tests-manifest.json`).
