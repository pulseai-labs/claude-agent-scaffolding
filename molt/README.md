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

**On a crew host, install molt with a crew version that marks its child seats** (herdr-crew 0.2.8
or later). An unmarked child is a root and clears itself in place. paseo-crew (#666) and
orca-crew (#667) do not mark their children yet.

## The ladder

| Fill (default) | Root session | Child session (`MOLT_HANDOFF=parent`) |
|---|---|---|
| below 40% | Nothing. The status line shows `molt <fill>%/<handoff threshold>%`. | The same. |
| 40% (`warnPercent`) | Once, after the next tool result (or with the next prompt when the turn ended first), a warning: find a good point to hand off. Work continues. | The same, plus "tell your parent". molt appends `warned 40` to the status file. |
| 50% (`warnAgainPercent`) | Once, a second warning: the handoff is past due. Work continues. | The same; `warned 50`. |
| 65% (`commandPercent`) | Once, after a tool result: finish the step in hand and write the handoff now. At the end of a turn with no `MOLT-HANDOFF:` line, or with one that names a file that does not exist, the Stop reflex blocks the stop and asks again, at most twice. | The same; `handoff required`. |
| 75% (`blockPercent`) | Only Write, Edit, Skill, and Bash made only of `git add` and `git commit` run. Every other tool call, reads included, is refused with the instruction and a note on the block. | The same. |
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
  warnings, no Stop block. The block stays in force, so the child does no more work; its parent
  replaces it.

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

## Child sessions

A launcher marks a child by exporting, before the session's command:

```bash
export MOLT_HANDOFF=parent MOLT_STATUS_PATH=<a file beside the child's report>
```

`MOLT_HANDOFF` must be exactly `parent` (surrounding spaces trimmed); any other value, or none,
is a root. molt appends one line per event to `MOLT_STATUS_PATH`, as `<ISO time> <event>`:
`warned <n>`, `handoff required`, `handed-off <path>`. It never reads the file back or truncates
it, and writes nothing there for a root. A file it cannot write is logged once to `molt.log`; the
warning or the handoff goes ahead regardless. The child itself never writes this file — molt's
appends are its own file writes, not tool calls. Who the parent is, how the child tells it, and
how it is replaced are the launcher's and the crew's business, never molt's.

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
  with 0.2.0's on first start. An edited one is never touched.

## Files

All under `~/.claude/state/molt/`, keyed by session id:

| Path | What it holds |
|---|---|
| `active/<id>` | The active marker: written at start, after a clear, on every prompt and every turn end; removed at session end, by `/molt off`, and while the session is paused. The crew hooks read it. |
| `lineage/<id>.json` | Written for each seeded session: `{ from, chain, depth, handoff }` — the session it came from, the first session of the chain, how many molts deep it is, and the handoff it resumed from. `autonomic` reads it to carry its mode across a molt. |
| `briefs/<id>.md` | A fallback brief, when molt wrote one. |
| `molt.log` | One line per molt, handoff, pause, refusal and error. |

The three templates are written with their defaults on first start, only where no file exists
(and the one 0.1.0 default above). Edit them freely; an empty or unreadable template falls back
to the default text.

## Commands

| Command | Effect |
|---|---|
| `/molt now` | Treats the session as past the handoff command whatever the fill, and puts the handoff instruction in the prompt box: press Enter to send it. Where the session has no prompt box, the next prompt you send carries it. It also lifts a pause and `/molt off`. |
| `/molt off` | molt stops measuring, warning, blocking, gating and molting in this session, and removes the active marker, so the crew context-ceiling hooks speak again here. |
| `/molt on` | Turns it back on. |
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
  speaks again. Your next message resumes it and brings the marker back. The seed prompt does
  not count as a message from you.
- **Autopilot.** There is no count limit. A molt with no progress since the previous one — no
  Write, Edit or NotebookEdit, and no `git commit`, made below the first warning — pauses the
  session and rings the record's bell, a shell command run with `AUTONOMIC_MESSAGE` set to the
  reason. Work past the first warning does not count: there the session may write and commit its
  handoff, which would make every molt look like progress.

## With the crews

`herdr-crew` 0.2.6, `paseo-crew` 0.1.5 and `orca-crew` 0.8.2 and later stand their
context-ceiling hooks down in a session whose active marker exists and is under 24 hours old.
molt owns the context boundary there. Without molt no marker exists, and the crew hooks behave
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
- **A Bash write is not progress unless it commits.** The autopilot loop guard counts Write,
  Edit, NotebookEdit and `git commit`; `sed -i` or `cat >` alone reads as no progress.
- **A worker's ping is a message from you, to molt.** A ping a crew worker types into a top's
  pane (`herdr agent prompt`) reaches molt as a `composer` prompt, so it resets the manual pause
  count; a looping root top is then bounded only by minimum room (#668).
- **A molt runs under the session's permission mode.** Under a mode that asks first, the handoff
  and the resume stop at the first approval (the handoff or resume skill, a `git` check) until
  someone answers. An unattended session needs a mode or allow rules that let those run.
- **The status line lags one turn after a molt.** Until the seeded session's first turn ends, it
  still shows the old session's fill.
- **Background waits survive the clear** (probe P6). A root that molts keeps every wait it armed;
  its handoff must list them so the resumed session does not arm them again.
- Claude Code only. Codex, OpenCode and Devin have no mod runtime.

## Tests

```bash
bash molt/run-tests.sh   # claude plugin validate + claude plugin test
```
