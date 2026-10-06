# Changelog

All notable changes to the `molt` plugin.

## 0.2.1

**The stage file** (#677 F12; `records.ts`, `register.tsx`). molt writes
`~/.claude/state/molt/stage/<id>` — `{ stage, percent?, command, block, fallback, at }`, with the
session's effective thresholds — whenever the stage or a threshold changes, at `/molt off`,
`/molt on` and `/molt now`, and when a clear, compact or resume resets the stage. `autonomic`
0.1.1 reads it to leave the turn end to molt at the command stage, in place of a fill figure kept
equal by hand. A seeded session's file carries no thresholds until its starting fill is
measured. The write is best-effort and logged once on failure.

## 0.2.0

**A warning ladder, and child sessions that hand off to their parent.** 0.1.0 asked for a
handoff at 50% and refused most tools at 65%, which stopped useful work; and it cleared every
session in place, which a crew child cannot resume from when its task is one skill run. 0.2.0
warns first and clears only a root.

- **The ladder** (`config.ts`, `measure.ts`): warn 40, warn again 50, command 65, block 75,
  fallback 80, all settable (`warnPercent`, `warnAgainPercent`, `commandPercent`,
  `blockPercent`, `fallbackMargin`), checked as a set. 0.1.0's soft stage is the command stage
  and its hard stage the block. Minimum room now delays a seeded session's first warning.
- **The warnings** (`register.tsx`, `templates.ts`): each delivered once, after the next tool
  result or with the next prompt when the turn ended first; a warning never blocks a stop, and
  past 65% only the command is delivered. A new `warningTemplate` (`~/.claude/molt/warning.md`)
  holds their text. A `MOLT-HANDOFF:` line counts from the first warning, so a warned session
  hands off at the point it chose.
- **Child sessions**: `MOLT_HANDOFF=parent` (exactly) marks a child. molt never clears it,
  appends `warned <n>`, `handoff required` and `handed-off <path>` to `MOLT_STATUS_PATH`, and
  stops pushing once the handoff is named; past the block threshold the gate stays. A status-file failure is logged once
  and never stops a warning or a handoff. A root writes no status file.
- **Closing lines by kind**: after the template text a root is told molt clears it; a child is
  told to return the handoff to its parent, and its warnings add "tell your parent".
- **A paused session drops its active marker** (#668, first gap), so a crew's context-ceiling
  hook speaks again; a message from you brings it back.
- **Upgrading**: `softPercent` and `hardPercent` are read once as `commandPercent` and
  `blockPercent` and the rename is reported; both stay declared in `userConfig` with no default
  so a saved value still arrives. `commandPercent` and `blockPercent` declare no default either
  (unset means 65 and 75): the host fills every declared default before molt reads its settings,
  so a default there would hide a saved 0.1.0 value. `run-tests.sh` checks the manifest for it. A `~/.claude/molt/instructions.md` that is 0.1.0's default
  byte for byte is replaced on first start; an edited one is kept, and its `{{soft}}` and
  `{{hard}}` still fill.
- **Autopilot progress** counts below the first warning only: past it the session may write and
  commit its handoff.
- **Limit recorded**: a worker's ping reaches molt as a `composer` prompt and resets the manual
  pause count (#668, second gap).

## 0.1.0 — 2026-10-04

First release. Context handoff as a Claude Code mod. Past a soft threshold of the context window
(default 50%), molt asks the session to finish its step and write a handoff. Past a hard threshold
(default 65%), only the handoff's own tools run. When the session names its handoff, molt runs
`/clear` in the same pane and seeds the fresh session with that file, so no successor session is
launched. With no usable handoff once its asks are spent, or at the fallback threshold, molt
writes a brief from the transcript and molts. Loop guards pause a manual session after two molts
with no message from the operator, and an autopilot session (read from `autonomic`'s record) after
a molt with no progress. An active marker lets the crew context-ceiling hooks stand down where
molt runs.

Claude Code only (2.1.289+). Not on Codex, Devin or in the OpenCode bundle.
