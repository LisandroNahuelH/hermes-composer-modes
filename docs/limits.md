# Limits — what is guaranteed, and where the edges are

Honest list. Everything here was observed, not assumed.

## Delivery

* **The note is append-only.** `pre_llm_call` context is appended to the current user
  message's model-facing content (`content + "\n\n" + …injections`, see
  `compose_user_api_content`). Hermes offers no supported way for a plugin to place
  bytes *before* the user's text, so the v1 "sandwich" (note on both ends) is not
  reproducible without a core change. Ask mode compensates by enforcing read-only on the
  tool side, which is stronger than a leading sentence.
* **One-shot.** The note frames the turn it was staged for. Nothing is replayed on the
  next turn beyond the byte-stable `api_content` of that row.
* **Slash commands are never framed.** A message shaped like `/command …` skips the note
  entirely: appending it would land inside the command's arguments.
* **Queued sends resolve the mode at drain time.** The composer's middleware chain runs
  when a queued message is actually sent, so a mode switch while a message waits changes
  the note that message carries. (Freezing per-entry would need a renderer seam.)
* **Mid-turn steers** (`Enter` while the agent is busy, and the fallback enqueue) do not
  pass through the middleware. They carry whatever mode the backend already holds for the
  session — which is the mode of the last submit or button press, so in practice the mode
  on screen.
* **Subagents** are separate sessions and are not pinned by the parent's mode; the ask
  note forbids delegating mutations, and `delegate_task` itself is blocked in ask mode.

## Enforcement

* **A policy gate, not a sandbox.** `pre_tool_call` blocks declared calls. A malicious
  plugin could ignore hooks entirely, and Hermes has no plugin sandbox.
* **The terminal classifier is fail-closed.** A read-only-looking command that chains a
  write (`ls && rm x`), redirects output (`>`, `>>`, `tee`), or is absent from the
  allow-list is blocked. Expect occasional false positives — the block message tells the
  model to answer and hand off to Agent mode. `HERMES_COMPOSER_MODES_ASK_ENFORCE=0`
  disables the gate.
* **Only `terminal` gets command-level inspection.** Other tools are judged by name; a
  new tool with an unfamiliar name that mutates without a mutating verb in its name will
  pass. Add it to `enforce.DENY_TOOLS` if it matters.

## Desktop half

* **The copy is local to the machine.** `plugins/<id>/desktop/plugin.js` is materialized
  by the running desktop app. Against a remote backend the app cannot read the remote
  `plugins/` tree, so the desktop half must be installed locally as well.
* **Reload is per window.** The file watcher and ⌘K → *Reload desktop plugins* reach the
  main window; a secondary window needs its own reload (or a reopen).
* **Two switches, both off by default.** The Python half needs `plugins.enabled`; the
  desktop half needs the toggle in **Capabilities → Plugins**. Either one off means a
  silent, cosmetic mode button.
* **A marker-less `desktop-plugins/composer-modes/` blocks the copy** — that folder is
  treated as a deliberate standalone install (v1 leftovers look exactly like it).

## Compatibility

* Requires Hermes **>= 0.21.3**: unified agent + desktop packages, `ctx.rest`, the
  `pre_llm_call` context contract, and `pre_tool_call` block directives.
* If the backend half is unreachable (`stage FAIL` in `logs/desktop.log`), the send still
  goes out unchanged — a middleware or hook must never eat a message.
* `hermes plugins update` pulls the package; the desktop copy is refreshed when the
  source `plugin.js` is newer, and removed when the package folder disappears.
