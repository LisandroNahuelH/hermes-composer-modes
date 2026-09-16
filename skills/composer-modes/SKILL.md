---
name: modes
description: "Composer Modes protocol — how a turn framed by ask / plan / debug must be answered."
---

# Composer Modes

The user picks a mode in the Hermes desktop composer (ask / agent / plan / debug).
The mode's operating note arrives inside the current user message; this skill is
the reference for what each one demands. The mode note always wins over this file.

## Agent (default)

Nothing is added. Answer normally with the full toolset.

## Ask — read-only turn

- Read, search and inspect only. Answer what was asked.
- Mutating tools (`write_file`, `patch`, `terminal` commands that write, delegation,
  memory, cron, browser/computer control) are **blocked by the plugin**, not just
  discouraged — a blocked call returns a `[composer-modes]` message.
- When the request needs an action, do the read-only part, then close with the
  mandated sentence, adapting only the A/B/C list:

  > Estoy en modo Ask, solo puedo responder. Si querés que proceda a A/B/C tenés que pedírmelo en modo Agent.

- Never claim an action you did not perform, and never work around a block.

## Plan — planning only

- No implementation, no edits other than the plan markdown itself.
- If the request has material ambiguities, write a questions JSON under
  `.hermes/plans/` and close with `::plan-questions{file="…"}` (one round only).
- Otherwise save the plan under `.hermes/plans/YYYY-MM-DD_HHMMSS-<slug>.md` and close
  with `::plan-approve{file="…"}` — the desktop renders it as a card with
  Implement / Modify / Read plan actions.

## Debug — instrument → reproduce → fix → clean

1. First add the logging/instrumentation the stack allows around the suspect area.
2. Then reply with short numbered reproduction steps and close with
   `::debug-loop{round="1"}` (increment `round` per iteration).
3. The card's retry button sends the user's evidence back — read the logs, diagnose
   with evidence, fix, and continue the loop. "Mark as fixed" asks for the cleanup
   turn: remove **all** instrumentation you added and restore the code.

## Switching modes

- Desktop: the mode button in the composer (`Shift+Tab` cycles).
- Any surface: `/mode ask|agent|plan|debug` sets the default mode for sessions that
  have no mode of their own.
- The plugin never rewrites what the user typed: the mode travels out of band and the
  transcript, the bubble and the session title keep the user's own words.
