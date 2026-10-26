# molt

Context handoff as a Claude Code mod. Requires Claude Code 2.1.289 or later.

molt watches how full the context window is. It warns the session twice — at 40% and at 50% of
the window — to find a good point and hand off; neither warning stops work. At 65% it tells the
session to write its handoff now, and at 75% only the handoff's own tools run. When the session
names its handoff, molt runs `/clear` in the same pane and seeds the fresh session with that file,
so no successor session is launched and no pane changes. A **child** session — one a launcher
marks with `MOLT_HANDOFF=parent` — is never cleared: it returns its handoff to its parent, which
replaces it. molt works in any terminal or orchestration layer and reads no crew or multiplexer
state; it reads two environment variables.

**On a crew host, install molt with a crew version that marks its child seats**
(0.2.8 or later of the pre-rename line; every `crew` release). An unmarked child is a root and clears itself in place.

## The ladder

| Fill (default) | Root session | Child session (`MOLT_HANDOFF=parent`) |
|---|---|---|
| below 40% | Nothing. The status line shows `molt <fill>%/<handoff threshold>%`. | The same. |
| 40% (`warnPercent`) | Once, after the next tool result (or with the next prompt when the turn ended first), a warning: find a good point to hand off. Work continues. | The same, plus "tell your parent". molt appends `warned 40` to the status file. |
| 50% (`warnAgainPercent`) | Once, a second warning: the handoff is past due. Work continues. | The same; `warned 50`. |
| 65% (`commandPercent`) | Once, after a tool result: finish the step in hand and write the handoff now. At the end of a turn with no `MOLT-HANDOFF:` line, or with one that names a file that does not exist, the Stop reflex blocks the stop and asks again, at most twice. | The same; `handoff required`. |
| 75% (`blockPercent`) | Only Write, Edit, Skill, and Bash whose every command is `git add` or `git commit` run — a leading head word (`if`, `then`, `elif`, `else`, `!`, `{`, `time`) is skipped, a segment that only closes one (`fi`, `}`) is ignored, and a lone `&` splits commands as `;` does (`&&` and the redirections that carry `&` are untouched). A loop head (`while`, `until`, `do`) is not skipped, so a loop stays refused. Every other tool call, reads included, is refused with the instruction and a note on the block. A command substitution in such a Bash call is read as commands of its own and goes through only if each is `git add`, `git commit`, `cat` on its stdin, `date` without `-f`, `printf` or `echo` (The gate, below). | The same. |
| 80% (block + `fallbackMargin`) | molt stops waiting. With no handoff, it writes one: Haiku summarises the transcript into `~/.claude/state/molt/briefs/<id>.md`, above the facts molt extracts itself (files written, commits, issues, the last request). If Haiku fails, the facts alone stand in. molt molts on that brief. | The brief is written and handed off: `handed-off <brief path>`. No clear. |

A warning never blocks a stop. Past 65% only the command is delivered; a warning the session
never received is not sent after it.

The handoff instruction asks the session to write a handoff (where its brief says, else with
`ossify:handoff` where it is installed) and to end its reply with one line:

```
MOLT-HANDOFF: <absolute path of the handoff file>
```

From the first warning on, a turn that ends with that line hands off at the point the session
chose. molt checks that it names a readable file, then:

- **Root:** runs `/clear`, writes the lineage record, and submits one seed prompt: continue from
  the handoff at `<path>` (with `ossify:handoff-resume` where it is installed).
- **Child:** appends `handed-off <path>` to the status file and stops pushing — no more
  warnings, no Stop block. Past the block threshold the gate stays in force; below it, only the
  child's own instructions stop further work. Its parent replaces it.

A relative path resolves against the session's working directory; `~/` resolves against `$HOME`.
Below the first warning (and without `/molt now`) a `MOLT-HANDOFF:` line is ignored, so a quoted
or example line never hands off.

When the turn ends past 65% without a usable marker:

- **No marker line:** the last `.md` file the session wrote or edited past 65% is the handoff.
- **A marker that names no file**, or no marker and no such `.md` file: molt waits while the Stop
  reflex has asks left. Once both asks are spent, or at the fallback threshold whatever the asks,
  molt writes a fallback brief and hands off on that.

A subagent's turn and an interrupted turn never hand off, and a subagent's tool calls are never
gated. A `/clear` you run yourself seeds nothing.

A seeded session gets room before its first warning: the ladder starts at least `minRoomPercent`
points above the fill it started at, with the gaps between the steps kept. The ladder moves up
only as far as keeps the fallback at 99% or below, so a session that starts very full is warned
sooner rather than never gated.

## The gate past the block threshold

Past 75% (`blockPercent`) the gate refuses every tool call except Write, Edit, Skill and a Bash
call whose every command is `git add` or `git commit`. It is a steering gate, not a security
boundary: it only refuses. A call it lets through is not approved; it goes on to the session's
permission mode like any other call. It reads the command text with the shell reader seat-mods
ships, a copy `tests/test-mod-shell-parity.sh` holds identical. A command it cannot read as add or
commit is refused; a form the reader mis-reads goes through (Limits).

- **Command words.** An escaped head (`\git add f`), a named-descriptor prefix
  (`{log}>/tmp/f git add f`) and a redirection glued to a word (`git add f>/dev/null`) read as
  `git add`, and a read behind the same spelling (`\cat huge.log`) is refused. A wrapper named by a
  relative path (`./env git add f`) may be any local program and is refused; `/usr/bin/env` reads as
  `env`. A segment that is only a redirection (`git add f; > out`) names no command and is skipped.
  A redirect after a brace group or a `fi` (`{ git add f; git commit -m m; } >log`) is not a
  command either, so that group is allowed.
- **Heredocs.** A heredoc's delimiter is its word after quote removal, several heredocs on one line
  close in order, a `<<` inside `$((…))`, `((…))` or a `#` comment opens none, and a quoted body is
  text, never read for commands. A command on the opener line after the delimiter is read (the
  exception is in Limits).
- **Substitutions (INNER_OK).** A `$(…)` or backtick span runs before the call does, so it is read
  as commands of its own, in an unquoted heredoc body too. A call with a substitution goes through
  only if every command in it is `git add` or `git commit`, `cat` with no file operand (`-` or
  nothing: its stdin, a heredoc included), `date` without `-f` or `--file`, `printf` or `echo`.
  So `git commit -m "$(cat <<'EOF' … EOF)"` and `git commit -m "release $(date +%F)"` go through.
  Refused: `cat file` and `cat < file`, `$(<file)` (Bash's own file read), `date -f file`, any
  other command (`sed`, `tr`, `git log`), a command word reached by a relative path (`./date`), and
  a substitution nested more than 8 deep.

## Child sessions

A launcher marks a child by exporting, before the session's command:

```bash
export MOLT_HANDOFF=parent MOLT_STATUS_PATH=<a file beside the child's report>
```

`MOLT_HANDOFF` must be exactly `parent` (surrounding spaces trimmed); any other value, or none,
is a root. molt appends one line per event to `MOLT_STATUS_PATH`, as `<ISO time> <event>`:
`warned <n>`, `handoff required`, `handed-off <path>`. Each event rewrites the file with the new
line added; a file that exists but cannot be read is left alone and logged, never truncated.
molt writes nothing there for a root. A file it cannot write is logged once to `molt.log`; the
warning or the handoff goes ahead regardless. The child itself never writes this file — molt's
appends are its own file writes, not tool calls. Who the parent is, how the child tells it, and
how it is replaced are the launcher's and the crew's business, never molt's.

## Under an Agent SDK host (T3 Code)

An Agent SDK host keeps the session id it started and resumes that id when it restarts the
process. A root cleared in place would come back later as its pre-handoff self (#901). So when
`CLAUDE_CODE_ENTRYPOINT` is `sdk-ts` or `sdk-py`, a root hands off as a child does: no `/clear`
and no seed, no more warnings or Stop asks, and the block stays. The warnings and the handoff
command tell the agent to end its reply by sending the operator to a new thread that resumes from
the handoff, and every later prompt in the session repeats that — after a process restart too,
because the handoff path is kept in `sdk-handoff/<id>`. `cli` and `sdk-cli` (`claude -p`)
clear in place as before. A child is a child on every host.

**The stale-resume guard** works on every host. Each seed records the successor under the session
that molted (`successor/<id>.json`). If that session ever runs again — a host or a `claude --resume`
that brings back the pre-molt id — molt toasts and logs it at start, adds a STALE SESSION line to
every prompt, and refuses every tool call except Read, Grep and Glob, even under `/molt off`.
Past the block threshold those reads still run, so the session can find the newest handoff.
`/molt on` in that session lifts the guard and removes the record.

## Settings

Set them in `/config` → molt (the plugin's `userConfig`).

| Setting | Default | Meaning |
|---|---|---|
| `warnPercent` | 40 | Past this fill the session is warned, once, to find a good point to hand off. |
| `warnAgainPercent` | 50 | Past this fill the session is told, once, that the handoff is past due. |
| `commandPercent` | 65 | Past this fill the session is told to write its handoff now. |
| `blockPercent` | 75 | Past this fill only the handoff's tools run. |
| `fallbackMargin` | 5 | At block + this margin, molt stops waiting for a handoff: with none, it writes a fallback brief. |
| `minRoomPercent` | 15 | A seeded session's first warning is this many points above its starting fill, as far as the fallback stays at 99% or below. |
| `manualMaxMolts` | 2 | In manual mode, molt pauses after this many molts in a row with no prompt from you. |
| `instructionsTemplate` | `~/.claude/molt/instructions.md` | What the session is told at the handoff command. `{{percent}}`, `{{command}}` and `{{block}}` are filled in (and 0.1.0's `{{soft}}` and `{{hard}}`, as the same two). |
| `warningTemplate` | `~/.claude/molt/warning.md` | What the session is told at the two warnings. `{{percent}}`, `{{stage}}` (`first` or `second`) and `{{command}}` are filled in. |
| `seedTemplate` | `~/.claude/molt/seed.md` | The one prompt the fresh session receives. `{{path}}` is the handoff. |

The four thresholds and the margin are checked as a set: unless warn < warnAgain < command <
block and block + margin ≤ 99, all five fall back to their defaults, and molt names the problem
in a toast and in `/molt status`. They are never silently clamped. An out-of-range
`minRoomPercent` or `manualMaxMolts` uses its default.

After the template text, molt adds one closing line by kind: a root is told molt clears it and
resumes it in the same pane; a child is told to return the handoff to its parent and stop, and
its warnings add "tell your parent".

### Upgrading from 0.1.0

- `softPercent` is read once as `commandPercent`, and `hardPercent` as `blockPercent`, when the
  new key is unset; molt names the rename in a toast and in `/molt status`. A renamed value that
  breaks the order (0.1.0's default soft of 50 equals the new second warning) sends the whole
  ladder to its defaults, and both problems are named.
- A `~/.claude/molt/instructions.md` that is 0.1.0's default text, byte for byte, is replaced
  with 0.2.0's on first start. An edited one is never touched, so its own closing line ("molt
  then clears this session…") stays, and molt adds its closing line after it: a root reads the
  line twice, and a child reads both "molt then clears" and "return the handoff to your parent".
  Delete that line from an edited file.

## Files

All under `~/.claude/state/molt/`, keyed by session id:

| Path | What it holds |
|---|---|
| `active/<id>` | The active marker: written at start, after a clear, on every prompt, every turn end, and by `/molt now` and `/molt on`; removed at session end, by `/molt off`, and while the session is paused. The crew hooks read it. |
| `lineage/<id>.json` | Written for each seeded session: `{ from, chain, depth, handoff }` — the session it came from, the first session of the chain, how many molts deep it is, and the handoff it resumed from. `autonomic` reads it to carry its mode across a molt. |
| `briefs/<id>.md` | A fallback brief, when molt wrote one. |
| `sdk-handoff/<id>` | Written when a root under an Agent SDK host hands off: the handoff path. A restarted process that resumes the same session reads it, so the session stays handed off. |
| `successor/<id>.json` | Written at each seed for the session that molted: `{ successor, handoff, at }`. The stale-resume guard reads it; `/molt on` in that session removes it. |
| `stage/<id>` | The stage file (0.2.1): `{ stage, percent?, command, block, fallback, at }` — see below. |
| `molt.log` | One line per molt, handoff, pause, refusal and error. |

**The stage file.** `stage` is one of `below`, `warn`, `warnAgain`, `command`, `block`,
`fallback`, or `off` (`/molt off` in this session); `/molt now` publishes `command`. `command`,
`block` and `fallback` are the session's effective thresholds, after a seed raised them; a seeded
session's file carries none until its first response measures where it started. molt
rewrites the file whenever the stage or a threshold changes, at `/molt off`, `/molt on` and
`/molt now`, and when a clear, compact or resume resets the stage. A child writes it too. The
write is best-effort: a failure is logged once and never stops a warning, a handoff or a molt.
`autonomic` reads it for `/autopilot status` and, on Claude Code, to tell molt's own block deny from a
seat guard's. It leaves no turn end to molt: autonomic 0.11.0 judges none (#887).

The three templates are written with their defaults on first start, only where no file exists
(and the one 0.1.0 default above). Edit them freely; an empty or unreadable template falls back
to the default text.

## Commands

| Command | Effect |
|---|---|
| `/molt now` | Treats the session as past the handoff command whatever the fill, and puts the handoff instruction in the prompt box: press Enter to send it. Where the session has no prompt box, the next prompt you send carries it. Below the handoff threshold the instruction's first line says you asked for the handoff, not that the fill is past the threshold (#903); an `instructions.md` you edited with another first line is sent as written. It also lifts a pause and `/molt off`, and brings the active marker back in the same command. |
| `/molt off` | molt stops measuring, warning, blocking, gating and molting in this session, and removes the active marker, so the crew context-ceiling hooks speak again here. |
| `/molt on` | Turns it back on. In a stale session it also lifts the stale-resume guard and removes the successor record. |
| `/molt status` | The fill and the ladder, the mode `autonomic` records, any settings problem, and whether auto-compact runs above the block threshold. |

`/molt now` cannot submit the prompt itself: Claude Code refuses a prompt submitted from a
command's own hook, because it would wait on the turn that hook holds.

## With autonomic

molt reads the session's mode and bell from `autonomic`'s record,
`~/.claude/state/autonomic/sessions/<id>.json`. With no record, or one it cannot read, the
session is in manual mode. The loop guards apply to roots only — a child is never cleared, so it
cannot loop — and differ by mode:

- **Manual.** After `manualMaxMolts` molts in a row with no prompt from you, molt pauses, shows
  a band, names the handoff, and drops the active marker, so a crew's context-ceiling hook
  speaks again. Your next message resumes it and brings the marker back. A message an Agent SDK
  host sends (T3 Code) counts as yours; the seed prompt and other plugin prompts do not. A manual
  pause also rings the record's bell, and while paused, every prompt the agent gets carries a line
  saying the handoff did not happen and you must send a message to resume.
- **Autopilot.** There is no count limit. A molt with no progress since the previous one — no
  Write, Edit or NotebookEdit, and no `git commit` the line runs, made below the first warning —
  pauses the session and rings the record's bell, a shell command run with `AUTONOMIC_MESSAGE` set
  to the reason. The bell never delays the turn end: it is rung and left to finish, killed at the
  engine's 30-second process default if it has not answered, and a failure — a non-zero exit or
  a rejection, the kill included — is logged once. Work past the first warning does not count:
  there the session may write and commit its handoff, which would make every molt look like
  progress.

## With the crews

`crew` stands its
context-ceiling hook down in a session whose active marker exists and is under 24 hours old,
as the pre-rename line has from 0.2.6.
molt owns the context boundary there. Without molt no marker exists, and the crew hook behaves
as before. molt never reads crew state; the crews read molt's marker and mark their children.

## Limits

- **Mods fail open.** If the module does not load or a hook throws, Claude Code skips it and
  nothing is measured, warned or gated. The sign is no `molt` in the status line; the debug log
  (`claude --debug`) names the plugin and the reason. Claude Code also holds installed plugins'
  hooks modules behind a rollout flag (`tengu_plugin_hooks_modules`).
- **Tool output not yet measured is an estimate.** Between responses, molt adds tool output at
  four characters per token to the last measured fill.
- **Auto-compact must sit above the block.** molt does not turn auto-compact off; it stays the
  backstop. If it runs at or below the block threshold, it acts first. `/molt status` checks.
- **Past the block threshold, a heredoc opener line holding a `$(…)`, a backtick or a `${…}` after
  its word keeps the 0.3.7 reading.** The commands after the substitution on that line are not
  read (`git commit -F - <<EOF $(date); cat huge.log`). Inside a substitution such a line is
  read, and so are the substitutions on it.
- **C6, the gate reads shapes, not grammar.** A construct other than the head words of the ladder
  table is refused even when everything in it is `git add` or `git commit`: a loop (`for`, `while`,
  `until`, `select`), `case`, `[[ … ]]`, `(( … ))`, `coproc`, the no-op `:` (`git add f; :`), and
  a function body (`f() { git commit -m m; }`, which only defines the function). A line that is a
  syntax error and runs nothing (`if git add f; git commit -m m`) reads as the commands it spells,
  and passes.
- **A relative command word reads as git outside a substitution.** `./git add f` and
  `bin/git add f` pass, as before; inside a substitution a relative command word is refused.
- **The substitution reader is not a parser,** and in molt a miss lets a read through. A `#` after
  a blank in a quoted string inside a double-quoted `$(…)` hides the rest of the line
  (`git commit -m "$(echo "a # b")" && cat huge.log`), as in molt 0.3.7. A Bash 5.3 funsub,
  `"${ cat huge.log; }"`, is read by no rail. A backslash-newline between `$` and `(`
  (`"$\<newline>(cat huge.log)"`) hides the span. The gate steers: what it misses goes on to the
  session's permission mode and its own care.
- **A `<<` inside an unquoted `$[…]` or a `${…}` still opens a heredoc for the reader** (as in
  seat-mods), though Bash runs it as arithmetic or a pattern. The lines after it read as body, so a
  read there passes the gate: `git add f $[1<<2]` then a newline and `cat huge.log`, and the same
  with `${x/<<a/b}`.
- **`date` with a `$'…'` or `$"…"` flag passes inside a substitution.**
  `git commit -m "$(date $'-f' huge.log)"` and `$(date $"-f" huge.log)` are not refused, though
  `date` reads the file; `-f`, `'-f'`, `"-f"` and `--file` are.
- **A Bash write is not progress unless it commits.** The autopilot loop guard counts Write,
  Edit, NotebookEdit and `git commit`; `sed -i` or `cat >` alone reads as no progress. A
  `git commit` counts only bare, or behind `time`: a `{ … }` segment cannot be told from a
  function definition's body (`f() { git commit -m m; }`, which runs no commit), and one behind
  `if`, `then`, `elif`, `else` or `!` may not run, so neither counts.
- **C7, the progress count reads text, not control flow.** A bare `git commit` counts even when
  the line does not run it or it commits nothing: `false && git commit -m m` (the commit never
  runs), `time false && git commit -m m`, and `git commit -m m || git add f` (the commit may
  fail while the add makes the line succeed). A second command inside a `{ … }` group counts too.
- **Any Agent SDK prompt is a message from you, to molt.** A headless SDK driver that loops a
  root session therefore resets the manual pause count at each prompt, as a worker's ping does
  below; such a loop is bounded only by minimum room. The OMP extension keeps its own count and
  is unchanged (#774).
- **The SDK host check reads one variable.** A session started from a shell that inherited
  `CLAUDE_CODE_ENTRYPOINT=sdk-ts` reads as an SDK host and is not cleared. A molt made before
  0.3.7 wrote no successor record, so its pre-molt session is not guarded. The OMP extension has
  neither change.
- **A worker's ping is a message from you, to molt.** A ping a crew worker types into a top's
  pane (`herdr agent prompt`) reaches molt as a `composer` prompt, so it resets the manual pause
  count; a looping root top is then bounded only by minimum room (#668).
- **A molt runs under the session's permission mode.** Under a mode that asks first, the handoff
  and the resume stop at the first approval (the handoff or resume skill, a `git` check) until
  someone answers. An unattended session needs a mode or allow rules that let those run.
- **On Claude Code, the status line lags one turn after a molt.** Until the seeded session's first turn
  ends, it still shows the old session's fill. On OMP the clear drops the old fill at once (0.3.4).
- **On Claude Code, background waits survive the clear** (probe P6; on OMP the clear cancels them, see OMP below). A root that molts keeps every wait it armed;
  its handoff must list them so the resumed session does not arm them again.
- The Claude Code mod needs Claude Code; on OMP see the OMP section. Codex has no mod runtime.

## OMP

- Since 0.3.0 molt also ships `omp/extension.ts` for omp 18.8.9: the same ladder, texts, gate and handoff rules over `../hooks`, so
  it needs no other install. Only `omp-seat` (the `omp-roles` plugin) loads it, with `-e`; a plain `omp` session is unchanged.
- A root session is cleared with `newSession()` and seeded with the handoff. The first operator prompt is rewritten to an internal
  `/molt-arm` command, which saves the command context that can clear; measured for two cycles in rpc mode. A child
  (`MOLT_HANDOFF=parent`) appends its `warned` and `handed-off` lines to `MOLT_STATUS_PATH` and is never cleared.
- omp defers `session_stop` while a background job is pending and skips it for a todo or compaction continuation (#855), so
  molt also reads the marker at `agent_end` when the settle will continue: from the first warning on, a readable marker molts at
  once. `newSession()` cancels every background job the old session owned, and the seed's last line tells the resumed session to
  re-arm what its handoff lists. `/molt now` sends the instruction as an `aside`, which starts a turn on an idle session.
- There is no manifest UI on OMP: `~/.omp/agent/molt.json` holds the same keys as the settings table below, and a file that is not valid
  JSON falls back to the defaults with a notice. The state files (`~/.claude/state/molt/`) are the ones `autonomic` reads.
- Past the block threshold only `write`, `edit`, `apply_patch`, `ast_edit`, a `skill://` read and `git add` / `git commit` run, with the gate and the substitution rule above.
- Main limit: there is no handoff in `-p` mode (no command context to arm, so the session keeps going, gated). The clear is measured
  in rpc mode only (two cycles); the TUI is unmeasured.

## Tests

```bash
bash molt/run-tests.sh   # claude plugin validate + claude plugin test
```
