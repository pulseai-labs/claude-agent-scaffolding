# Changelog

All notable changes to the `molt` plugin.

## 0.5.0 — 2026-10-28

The `autonomic` plugin is retired (#948).

- **The autopilot branch is gone: no no-progress guard, no bell, no mode line; the unattended
  pause is unchanged.** molt no longer reads `autonomic`'s per-session record. The pause after
  `manualMaxMolts` unattended molts now applies in every session (a stale autopilot record no
  longer exempts it or turns it into a no-progress pause), and it rings nothing. `/molt status`
  has no `mode (...)` line. The progress count and its on-disk file are removed, as is
  `PAUSED_NO_PROGRESS`. The stage file stays: `seat-mods` reads it (#929).
- Tests: the bell and autopilot tests are removed; new tests pin that a stale autopilot record
  molts, that the unattended pause fires with no record and rings nothing, and that status has no
  mode line, on both the Claude Code and OMP glue.

## 0.4.1 — 2026-10-27

#933, the follow-ups from PR #932's review.

- **A turn-end request accepted in a session that has since moved on no longer stops the new
  session's request.** molt kept one waiting request per process, so a request the host accepted
  but never ran (after a `/clear` or a resume) stopped every later request in that process. A
  waiting request now stops only its own session, and when it arrives late it is still dropped.
  An arriving request is matched to its own session's first, since two sessions' texts are often equal.
  Known limit: a request the host accepts and never runs in the same session still stops that
  session's next request.
- **`run-tests.sh` fails when its `classic.*` check cannot read `hooks/`** (grep exit 2). It passed
  silently before.
- **The README lists the follow-up turn's known limits** (`claude -p`, an unprobed Agent SDK host),
  which only the CHANGELOG held.
- Tests: the kit's `followUp` runs molt's submitted request as its own turn. New tests pin that
  this turn molts on a marker, asks once more with no handoff, and neither asks nor spends a request
  when it is interrupted, fails or is refused. A test pins that a sibling plugin throwing at
  `session.end` does not stop the seed. "A resume in place resets the stage" keeps the session id.
- Comments that cited the review process now give the reason.

## 0.4.0 — 2026-10-27

#929: molt works on org accounts. Claude Code skips a plugin's `classic.*` hooks there, with no
error, so molt's warnings, its turn-end handoff request and its seed after a molt never ran.
molt registers no `classic.*` hook now, on any host.

- **The turn-end request is a follow-up turn.** Past the command threshold, a turn that ends with
  no usable `MOLT-HANDOFF:` line gets one prompt from molt once it is over: the instruction, or the
  missing-file text naming the path. At most twice per window, as the Stop block was; then the
  fallback brief. Not on an interrupted turn, a subagent's, or one that ended in an API error or a
  refusal. One request waits at a time; one that arrives in another session or during a molt is
  dropped. A refused request is logged.
- **The warnings ride the tool result** (`tool.call`'s model-only `context`), once each, as they
  rode `classic.PostToolUse`. A subagent's result and a refused call carry none.
- **Window resets come from the session events:** a `/clear` or a resume from `session.end`, a
  compact (not a subagent's) from `session.compact`. The missing templates are written at
  `session.start`.
- **The seed goes out when molt's own `/clear` resolves** under a new session id, before anything
  that can fail, instead of at the next SessionStart.
- **`run-tests.sh` refuses a `classic.*` hook registration** in `hooks/`.
- Known limits: under `claude -p` the printed result is the request's reply; an Agent SDK host
  (`sdk-ts`, `sdk-py`) is asked by follow-up like any root, which was not probed live; a block
  that another plugin raised at `classic.Stop` is no longer joined to molt's request.

## 0.3.8 — 2026-10-26

Batch 5 (#724, #702), molt's half: the shell reader the gate shares with seat-mods. molt is a steering
gate: it only refuses, and a miss is a read that reaches a nearly full window.

- **Past the block threshold the gate reads commands inside `$(…)` and backticks** (C1), in an
  unquoted heredoc body too. A call with a substitution goes through only if every command in it is
  `git add` or `git commit`, `cat` with no file operand (its stdin, a heredoc included), `date`
  without `-f` or `--file`, `printf` or `echo` (`INNER_OK`). So `git commit -m "$(cat <<'EOF' … EOF)"`
  and `git commit -m "release $(date +%F)"` still go through. `git commit -m "$(cat huge.log)"`,
  `cat < file`, `$(<file)`, `date -f file`, any other command, a relative-path command word
  (`./date`) and a substitution nested more than 8 deep are refused.
- **Heredocs, command words and glued redirections are read closer to the way Bash reads them** (C2
  to C4). An opener line's tail is read, a delimiter is its word after quote removal, and a `<<` in
  `$((…))`, `((…))` or a comment opens none, so a read behind them is refused. Inside a `$(…)` a
  heredoc also closes, as in Bash 5.3, at a line that starts with its delimiter and holds a `)`
  after it, so the `EOF)` commit form goes through and a read after it is refused. `\git add f`,
  `{log}>/tmp/f git add f` and `git add f>/dev/null` read as `git add` and now go through; their
  ruled siblings (`\cat huge.log`) are refused. `./env git add f` is refused: a wrapper named by a
  relative path may be any local program. A redirect after a brace group or a `fi`, and a segment
  that is only a redirection, are not commands, so `{ git add f; git commit -m m; } >log` and
  `git add f; > out` go through. `<<E'OF'` with a body line `E` was refused and is allowed.
- **Shared reader.** `COMMANDS`, `HEREDOC`, `QUOTED`, `WRAPPERS`, `blankHeredocs`,
  `substitutionSpans`, `blank`, `commandOf`, `tokensOf`, `gitOf`, `substitutionsOf` and
  `SUBSTITUTION_TOO_DEEP` are byte-identical to seat-mods 0.10.0's `hooks/rules.ts`, held by
  `tests/test-mod-shell-parity.sh`.
- **`/molt now` below the handoff threshold no longer says the fill is "past" it** (#903). On
  Claude Code the instruction's built-in first line read "Context is at 3% of the window, past
  molt's handoff threshold (65%)". When `/molt now` forces the stage and the fill is below the
  command threshold, the first line now says "Context is at 3% of the window, and the operator
  asked for a handoff now", as the OMP glue has since 0.3.3; at or above the threshold the line is
  unchanged. Only the built-in line is swapped: an `instructions.md` you edited with another
  first line is sent as written. Both glues now take the two lines from `hooks/templates.ts`.
- **README.** The stage-file paragraph no longer says `autonomic` reads it to leave the turn end to
  molt (#887): autonomic 0.11.0 (PR #886) removed the turn-end judge and the molt yield, and reads
  the file only for `/autopilot status` and, on Claude Code, to tell molt's block deny from a seat
  guard's. The two code comments that said the same are corrected.
- **Still limits, now written down in the README.** C6 (the gate reads shapes, not grammar: loops,
  `case`, `[[`, `((`, `:` and function bodies are refused; a syntax error reads as the commands it
  spells) and C7 (the progress count reads text, not control flow) are unchanged. A heredoc opener
  line holding a substitution keeps the 0.3.7 reading, so a read after it stays hidden; so do a `#`
  after a blank in a quoted string inside `"$(…)"`, a Bash 5.3 funsub, a backslash-newline between
  `$` and `(`, a `<<` inside an unquoted `$[…]` or a `${…}` (it opens a heredoc for the reader) and
  `date $'-f' file` inside a substitution. `./git add f` outside a substitution still passes.

## 0.3.7 — 2026-10-24

- **Under an Agent SDK host a root is not cleared** (#901). T3 Code drives Claude Code through the Agent SDK
  and stores the session id it started. After molt's `/clear` the thread showed the new session, but when T3
  later restarted the process (after an idle gap) it resumed the original id, so the operator talked to the
  context from before the handoff. With `CLAUDE_CODE_ENTRYPOINT` set to `sdk-ts` or `sdk-py`, a root now hands
  off as a child does: no clear and no seed, no more warnings or Stop asks, the block stays. The warnings and the
  handoff command tell the agent to send the operator to a new thread with the handoff, and each later prompt
  repeats it. The path is kept in `~/.claude/state/molt/sdk-handoff/<id>`, so a restarted process that resumes
  the same session stays handed off. `cli` and `sdk-cli` (`claude -p`) still clear in place; a child is still a child.
- **A resumed session that already molted is stale** (#901). Each seed writes
  `~/.claude/state/molt/successor/<old id>.json` (`{ successor, handoff, at }`). When that session runs again,
  molt toasts and logs it at start, adds a STALE SESSION line to every prompt, and refuses every tool call but
  Read, Grep and Glob, `/molt off` or not; past the block threshold those reads still run. `/molt on` in that session lifts the guard and removes the record.

## 0.3.6 — 2026-10-22

- **Manual: an Agent SDK prompt is a message from the operator** (#774, operator ruling 2026-10-22). T3 Code
  drives Claude Code through the Agent SDK, so every message the operator types reaches molt as an `sdk`
  prompt. The manual count reset only on `composer` or `bridge`, so in T3 a session paused after two molts
  and the operator's replies never resumed it. An `sdk` prompt now resets the count and lifts the pause.
  A plugin prompt (a seed, a status turn) still does not.
- **A pause reaches the agent and the operator.** A pause showed only in the band, a toast and the status
  line, which an SDK host never draws. The agent now gets a context line at each prompt while paused: the
  handoff did not happen, and the operator must send a message. A manual pause also rings the record's
  bell, as an autopilot pause does, read by a new `recordBell` (`parseAutonomic` stays identical to seat-mods' copy).

## 0.3.5 — 2026-10-18

- **Naming: the crew references say `crew`** (crew 0.3.0's rename, spec §4.6). The two README
  lines that name the launcher marking a child seat and the crew context-ceiling hook this
  plugin displaces now name `crew`. No behaviour changes.

## 0.3.4 — 2026-10-17

- **OMP: the status meter follows the window** (#842). After a clear-and-seed, molt's status line kept the old
  session's percent (`molt 40%/65%` beside OMP's own 17%). The meter was redrawn with a fresh reading only at
  `session_stop` and `agent_end`, and omp defers or skips `session_stop` while a background job or a todo continuation is pending. Now
  every reading redraws the meter, and a new window (a clear-and-seed, a session switch, a compaction) shows `molt`
  until its first reading.

## 0.3.3 — 2026-10-17

- **OMP: a top with background jobs pending can molt** (#855). omp defers `session_stop` while a background job is
  pending, and skips it for a todo or compaction continuation. It reports both as `agent_end` with `willContinue`.
  molt now also reads the `MOLT-HANDOFF` marker there. From the first warning on, a readable marker molts at once,
  since an omp clear cancels the session's jobs anyway. A terminal settle still goes to `session_stop`, which keeps
  the block reflex and the fallback brief.
- **OMP: the seed says the jobs are gone.** omp's `newSession()` cancels every background job the old session owned.
  The seed now ends with one line telling the resumed session to re-arm each wait and heartbeat its handoff lists.
- **OMP: `/molt now` starts a turn.** The instruction goes out as an `aside`, which starts a turn on an idle session.
  Before, a `steer` sat in the queue until something else started a turn. Below the handoff threshold, its first
  line says the operator asked for a handoff, not that the fill is "past" the threshold.

## 0.3.2 — 2026-10-14

- **Internal: one copy of each shared rule** (#783). `MAX_STOP_BLOCKS` and the shared notice texts live in the pure
  modules (`hooks/gate.ts`, `hooks/templates.ts`), and both glues import them. No behaviour change.

## 0.3.1 — 2026-10-13

- **The autopilot progress count survives a module reload** (#713). `/reload-plugins` reloads `hooks/register.tsx`, so the
  count fell to 0 and the next autopilot molt paused as "no progress" although the session had written files. The count is
  kept on disk too, per session (`~/.claude/state/molt/progress/<id>`, best-effort, a failed write logged once): the loop
  guard reads the session's file when the module count is 0, `seed` removes the outgoing session's file, and `session.end`
  removes the ending session's. A `/compact` keeps the file, as it keeps the count.
- **A failed notice write never aborts a pause** (#665). A refused notice write (another mod, or the state store) threw out
  of `pause()` before its toast, status line, bell and log, so the operator learned nothing. `setNotice` is best-effort now,
  logged once per process.
- **`/molt status` measures before it reports** while molt is on (off, it shows the last fill measured), and the seed redraws the status line for the session it seeded (#665).
- **A `.md` written while `/molt off` is not a handoff candidate**, and a **compact returns a seeded session to the plain
  ladder** instead of keeping the thresholds its start fill raised (#665).
- **The fallback brief claims only what the transcript shows** (#665): its headings are now "Files the session wrote or
  tried to write" and "Commit commands the session tried to run" — the transcript carries a Write's arguments and a Bash command,
  never their results.

## 0.3.0 — 2026-10-13

- **molt on OMP** (omp 18.8.9). `omp/extension.ts` maps omp's events onto the same ladder: `omp/core.ts` runs molt's pure modules
  over a `MoltIO` seam, so every threshold, text and rule stays in `hooks/` (one copy). Loaded only by `omp-seat`
  (`omp-roles`) with `-e`; the manifest declares no `omp.extensions`, so a plain `omp` session is unchanged.
- A root session is cleared with `newSession()` and seeded with the handoff (the `session_stop` trigger; the first operator prompt
  arms the route through an internal `/molt-arm` command). A child (`MOLT_HANDOFF=parent`) appends `warned` and `handed-off`
  lines to `MOLT_STATUS_PATH`. The fallback brief runs an ephemeral turn from `session_stop` under a 25 s deadline (omp gives that
  handler 30 s); a slow or hung turn falls to the facts-only brief.
- Settings come from `~/.omp/agent/molt.json` (same keys as `userConfig`; invalid JSON falls back to the defaults with a notice).
- Live evidence on omp 18.8.9 with DeepSeek V4.1 Flash: all four stages, two clear-and-seed cycles in one process (a handoff
  the session wrote, and the fallback brief), a child's status file, a manual-mode pause. Known limits: no `-p` handoff; the clear
  is measured in rpc mode only (TUI unmeasured); omp 18.8.9's sendUserMessage returns nothing, so a
  seed the host rejects after newSession() is not seen (the handoff file stays on disk and its path is in molt's log);
  the no-progress count is one per process, as in the Claude Code mod, not per session; the pause is one per process, as in the Claude Code mod. The Claude Code mod is unchanged.

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
