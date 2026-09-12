# Architecture — how a mode reaches the model, and nothing else

## The problem

A “mode” (Ask / Plan / Debug) is an operating instruction for the turn. Naively you
append it to the message text — and it pollutes everything that reads the message:
the bubble, the durable transcript, sidebar previews, session auto-titles, logs.
Composer Modes exists to carry that instruction **out of band**.

## The channel

```
┌──────────┐   cycle (Shift+Tab / click)   ┌──────────────────────────────┐
│ composer │ ────────────────────────────▶ │ plugin: mode + note derived   │
└──────────┘                               └──────────────┬───────────────┘
                                                          │
              ┌───────────────────────────────────────────┴────────────────┐
              │ new desktop builds (upstream seam): note rides the submit  │
              │ frame  {text, attachments, mode, note, fromQueue}          │
              │ stock builds: session.note.stage (one-shot, TTL 30 s)      │
              └───────────────────────────┬────────────────────────────────┘
                                          ▼
                                prompt.submit { ..., note }
                                          │
                    gateway: note = explicit or staged  (cap 8 KiB)
                                          │
                     ┌────────────────────┴─────────────────────┐
                     │ durable row / transcript: content         │  ← you, untouched
                     │ model-facing payload:     api_content     │  ← note merged here only
                     └──────────────────────────────────────────┘
```

**Invariant:** `api_content` is the only field the note ever touches, and the durable
`content` stays byte-identical to what the user typed. Ask mode is additionally
**sandwiched** (note prepended to the run message *and* kept in the trailing slot)
for primacy + recency — `run_message = _prepend_note(run_message, note)`, gated on
the `[mode:ask]` head.

## Size formulas (verification recipe)

| Mode | `api_content` |
|---|---|
| agent | `NULL` (no note travels) |
| plan / debug | `content + 2 + len(note)` |
| ask | `content + 4 + 2 * len(note)` (sandwich) |

Check with: `SELECT content, api_content FROM messages ORDER BY id DESC LIMIT 1;`
(rows live in `state.db` under the Hermes home).

## The five patched files (the “core seam”)

| File | Seam |
|---|---|
| `tui_gateway/methods_prompt.py` | `note` param + cap; `session.note.stage` RPC (TTL 30 s); pop-on-every-submit + re-stage on refused submits; busy path carries the note |
| `tui_gateway/prompt_turn.py` | `note` threaded into the turn; Ask sandwich |
| `tui_gateway/session_auto_continue.py` | note carried through the background queue envelope (last note wins) |
| `agent/turn_context.py` | one-shot consume → merged into `api_content` only; session auto-titles read the pristine override first |
| `tui_gateway/AGENTS.md` | the documented contract |

All edits ship as **exact search/replace pairs in `core-patch/ops.json`** (20 ops),
generated from a verified diff and replay-tested: applying the ops to the pristine
base reproduces the shipped tree byte-for-byte. `core-patch/patch.py` enforces
verify → backup → apply → re-verify → (rollback on failure), and stamps each file
with `[composer-modes-patch]` for idempotence.

## Plugin map (`plugin/composer-modes/plugin.js`)

- **Modes**: Ask (green) · Agent (neutral) · Plan (blue) · Debug (red); cycle via
  `Shift+Tab` or the composer button; state persisted in `ctx.storage`.
- **Middleware** (`composer.middleware`, order 10): derives `{mode, note}` per fresh
  submit and returns it on the draft; drains (`fromQueue`) pass through untouched;
  also stages the note best-effort via `session.note.stage` (v11 parity for stock
  shells) — the same code serves both builds.
- **Cards**: `::plan-approve` (Implement / Modify / Read plan / Copy path) and
  `::debug-loop` (rounds, *Mark as fixed* cleanup), plus the `::plan-questions`
  dialog; plan reader as a right-docked workspace pane.
- **Probes**: `[cm-pa]` lines in `desktop.log` (`register`, `mw v12 derive`,
  `mw v12 pass`, `cycle …`) — the runtime evidence trail used by troubleshooting.

## Guardians

```
install.ps1 ──▶ plugin copy (sha-gated)  ──▶ hot-reloads in the running app
            ──▶ core patch (transactional) ──▶ verify gate ──▶ detached backend restart
            └─▶ ensure-task.ps1 ──▶ Windows task (logon+30s, every 6h, install.ps1 -Repair)
                                   ✔ heals after Hermes updates reset the checkout
cronjob.md ──▶ Hermes cronjob (weekly) ──▶ git pull + install.ps1 -Repair + one-line notice
```

The installer never kills the backend inline (the installing agent *is* that
backend): the restart is a one-shot scheduled task with a ~45 s fuse.

## Social preview (how the product is seen)

`assets/social-preview.png` (1280×640) is the GitHub Open Graph / social preview
and the README header. It is **drawn in HTML/SVG**, not by an image model, so every
string stays exact.

Visual story, left-to-right:

1. Four mode chips (Ask green / Agent gray / Plan blue / Debug red).
2. `Shift+Tab` (⇧⇥) as the cycle.
3. A **pristine user bubble** plus a **ghost note** (`this turn is read-only`) on a
   dashed thread into the model — the hidden sidecar, not the transcript.
4. Wordmark + tagline: “Switch how Hermes thinks — without touching what you typed.”

Palette matches the plugin: background `#0b0e14→#141926`, coral `#ff7a59→#ffb199`,
glass `rgba(255,255,255,0.04)`. `assets/banner.svg` remains the small 820×220 mark.
