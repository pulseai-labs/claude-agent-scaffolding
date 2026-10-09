# Changelog

All notable changes to the `molt` plugin.

## 0.2.5 — 2026-10-09

- **The interim lone-`&` split moved into the shared reader** (#723). The `LONE_AMP`
  pre-pass and its comment, added in 0.2.4, are removed; the split is now part of the shared
  `COMMANDS` declaration, mirrored byte-identically from seat-mods 0.3.2 under the
  shared-reader parity contract. No behaviour change: the 0.2.4 lone-`&` and redirection
  rows pin the shared split unchanged.

## 0.2.4 — 2026-10-09

- **The git reader skips reserved head words, splits on a lone `&`, and counts progress only where
  a commit runs** (#711, `shell.ts` `afterHeads` / `gitSubcommands` / `gitSubcommandsThatRun`;
  review round 1). Before reading a segment's git subcommand the reader skips the head words
  `if then elif else ! { time` — deliberately a subset of the walk seat-mods 0.3.1 ships: a loop
  head (`while`, `until`, `do`) and its closer (`done`) are not skipped, so a loop stays refused
  past the block, where the hard threshold is for wrapping up, and `builtin` is an execution
  prefix, never a head word: nothing behind it is exposed. A segment that only closes a construct
  (`fi`, `}`) or that the walk emptied (a bare `else` or `then`) names no command at all. A lone
  `&` — Bash's third list separator, which the shared `COMMANDS` does not split on — now ends a
  segment, so `! git commit -m m & evil` and `git add f & evil` are refused; `&&` and the
  redirections that carry `&` (`2>&1`, `>&2`, `&>`, `&>>`) are untouched. Both effects were
  fail-closed before: past the block threshold `if git add f; then git commit -m m; fi` was refused
  although every command in it is a git command, and a head-wrapped `git commit` was not counted as
  progress, so the autopilot loop guard could read a committing session as stalled. Progress
  counts a commit only bare, or behind `time`: the `(`/`)` split leaves a `{ … }` segment
  indistinguishable from a function definition's body (`f() { git commit -m m; }` defines the
  function and commits nothing), and behind `if`, `then`, `elif`, `else` or `!` a commit may not
  run — so counting either would hide a stalled loop. The walk is an exact raw head: a
  path-qualified or quoted head word is an ordinary program and stays refused.

## 0.2.3 — 2026-10-09

- **A bell that does not answer no longer holds the turn end** (#665 item 4, `register.tsx`
  `ring`, `pause`). `pause` no longer awaits the bell: `turn.complete` and both loop guards
  return while it is still running. The bound stays the engine's own — 30 s, passed explicitly
  rather than tightened, so a slow bell that completed on 0.2.2 (a remote notify curl) still
  completes and a hung one is still killed. Not silence: the bell still rings with the pause
  text as `AUTONOMIC_MESSAGE`, and a failure is still logged once — `bell failed exit=<n>` for a
  non-zero exit, `bell failed <error>` for a rejection or the timeout kill.
- **`/molt now` rewrites the active marker in the same command** (#665 item 6, `register.tsx`
  `command.run`). Lifting `/molt off` (or a pause) turns the session back on, so the command
  writes the marker there. An absent marker is what makes the crew context-ceiling hooks speak,
  so until the next prompt they went on speaking — and could act on the session — after molt had
  taken it back.

## 0.2.2 — 2026-10-08

- A `<<<` herestring no longer opens a heredoc; mirrored from seat-mods 0.3.0 by the shared shell parity contract (PR #698).
- A path-qualified wrapper such as `/usr/bin/env` is skipped like the bare word; mirrored from seat-mods 0.3.0 by the shared shell parity contract (PR #698).

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
