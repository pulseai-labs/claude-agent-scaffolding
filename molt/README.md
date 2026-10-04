# molt

Context handoff as a Claude Code mod. Requires Claude Code 2.1.289 or later.

Past a soft threshold of the context window (default 50%), molt asks the session to finish its
step and write a handoff. Past a hard threshold (default 65%), only the handoff's own tools run.
When the session names its handoff, molt runs `/clear` in the same pane and seeds the fresh
session with that file, so no successor session is launched and no pane changes. It works in any
terminal or orchestration layer, and it reads no crew or multiplexer state.

**Do not install molt on a host that runs a crew top (herdr-crew, paseo-crew, orca-crew) until the
crew rotation rewrite lands (#659).** Background waits survive a mod-run `/clear` and deliver into
the resumed session, which does not know them; a crew top that molts could arm its waits a second
time and fire a close or a merge twice.

## How a molt runs

| Fill | What molt does |
|---|---|
| below soft | Nothing. The status line shows `molt <fill>%/<soft>%`. |
| soft | Once per session, after a tool result, the handoff instruction rides along as context (the nudge). At the end of a turn with no `MOLT-HANDOFF:` line, or with one that names a file that does not exist, the Stop reflex blocks the stop and asks again, at most twice. |
| hard | Only Write, Edit, Skill, and Bash made only of `git add` and `git commit` run. Every other tool call, reads included, is refused with the instruction and a note on the hard limit. |
| fallback (hard + margin) | molt stops waiting. With no handoff, it writes one: Haiku summarises the transcript into `~/.claude/state/molt/briefs/<id>.md`, above the facts molt extracts itself (files written, commits, issues, the last request). If Haiku fails, the facts alone stand in. |

The instruction asks the session to write a handoff (with `ossify:handoff` where it is installed)
and to end its reply with one line:

```
MOLT-HANDOFF: <absolute path of the handoff file>
```

At the end of that turn, molt checks that the file exists, runs `/clear`, writes the lineage
record, and submits one seed prompt: continue from the handoff at `<path>` (with
`ossify:handoff-resume` where it is installed). A relative path resolves against the session's
working directory; `~/` resolves against `$HOME`. Below soft (and without `/molt now`) a
`MOLT-HANDOFF:` line is ignored, so a quoted or example line never clears the session.

When the turn ends past soft without a usable marker:

- **No marker line:** the last `.md` file the session wrote or edited past soft is the handoff.
- **A marker that names no file**, or no marker and no such `.md` file: molt waits while the Stop
  reflex has asks left. Once both asks are spent, or at the fallback threshold whatever the asks,
  molt writes a fallback brief and molts on that.

A subagent's turn and an interrupted turn never molt, and a subagent's tool calls are never
gated. A `/clear` you run yourself seeds nothing.

A seeded session gets room before it can molt again: its soft threshold is at least
`minRoomPercent` points above the fill it started at, with the gaps to hard and fallback kept.
The thresholds move up only as far as keeps fallback at 99% or below, so a session that starts
very full is asked for a handoff sooner rather than never gated.

## Settings

Set them in `/config` → molt (the plugin's `userConfig`).

| Setting | Default | Meaning |
|---|---|---|
| `softPercent` | 50 | Past this fill the session is asked to finish its step and write a handoff. |
| `hardPercent` | 65 | Past this fill only the handoff's tools run. |
| `fallbackMargin` | 5 | At hard + this margin, molt stops waiting for a handoff: with none, it writes a fallback brief and molts. |
| `minRoomPercent` | 15 | A seeded session's soft threshold is this many points above its starting fill, as far as fallback stays at 99% or below. |
| `manualMaxMolts` | 2 | In manual mode, molt pauses after this many molts in a row with no prompt from you. |
| `instructionsTemplate` | `~/.claude/molt/instructions.md` | What the session is told at soft. `{{percent}}`, `{{soft}}` and `{{hard}}` are filled in. |
| `seedTemplate` | `~/.claude/molt/seed.md` | The one prompt the fresh session receives. `{{path}}` is the handoff. |

The three thresholds are checked as a set: unless soft < hard and hard + margin ≤ 99, all three
fall back to their defaults, and molt names the problem in a toast and in `/molt status`. They
are never silently clamped. An out-of-range `minRoomPercent` or `manualMaxMolts` uses its default.

## Files

All under `~/.claude/state/molt/`, keyed by session id:

| Path | What it holds |
|---|---|
| `active/<id>` | The active marker: written at start, after a clear, on every prompt and every turn end; removed at session end and by `/molt off`. The crew hooks read it. |
| `lineage/<id>.json` | Written for each seeded session: `{ from, chain, depth, handoff }` — the session it came from, the first session of the chain, how many molts deep it is, and the handoff it resumed from. `autonomic` reads it to carry its mode across a molt. |
| `briefs/<id>.md` | A fallback brief, when molt wrote one. |
| `molt.log` | One line per molt, pause, refusal and error. |

The two templates are written with their defaults on first start, only where no file exists.
Edit them freely; an empty or unreadable template falls back to the default text.

## Commands

| Command | Effect |
|---|---|
| `/molt now` | Treats the session as past soft whatever the fill, and puts the handoff instruction in the prompt box: press Enter to send it. Where the session has no prompt box, the next prompt you send carries it. It also lifts a pause and `/molt off`. |
| `/molt off` | molt stops measuring, nudging, blocking, gating and molting in this session, and removes the active marker, so the crew context-ceiling hooks speak again here. |
| `/molt on` | Turns it back on. |
| `/molt status` | The fill and the three thresholds, the mode `autonomic` records, any settings problem, and whether auto-compact runs above the hard threshold. |

`/molt now` cannot submit the prompt itself: Claude Code refuses a prompt submitted from a
command's own hook, because it would wait on the turn that hook holds.

## With autonomic

molt reads the session's mode and bell from `autonomic`'s record,
`~/.claude/state/autonomic/sessions/<id>.json`. With no record, or one it cannot read, the
session is in manual mode. The loop guards differ by mode:

- **Manual.** After `manualMaxMolts` molts in a row with no prompt from you, molt pauses, shows
  a band, and names the handoff. Your next message resumes it. The seed prompt does not count as
  a message from you.
- **Autopilot.** There is no count limit. A molt with no progress since the previous one — no
  Write, Edit or NotebookEdit, and no `git commit`, made below soft — pauses the session and rings
  the record's bell, a shell command run with `AUTONOMIC_MESSAGE` set to the reason. Work past
  soft does not count: there the session writes and commits the handoff itself, which would make
  every molt look like progress.

## With the crews

`herdr-crew` 0.2.6, `paseo-crew` 0.1.5 and `orca-crew` 0.8.2 and later stand their
context-ceiling hooks down in a session whose active marker exists and is under 24 hours old.
molt owns the context boundary there. Without molt no marker exists, and the crew hooks behave
as before. molt never reads crew state; the crews read molt's marker.

Crew rotation itself (a successor launched in a new tab) is unchanged in this release. Rewriting
it as an in-place molt is #659 — until then, see the warning at the top.

## Limits

- **Mods fail open.** If the module does not load or a hook throws, Claude Code skips it and
  nothing is measured, nudged or gated. The sign is no `molt` in the status line; the debug log
  (`claude --debug`) names the plugin and the reason. Claude Code also holds installed plugins'
  hooks modules behind a rollout flag (`tengu_plugin_hooks_modules`).
- **Tool output not yet measured is an estimate.** Between responses, molt adds tool output at
  four characters per token to the last measured fill.
- **Auto-compact must sit above hard.** molt does not turn auto-compact off; it stays the
  backstop. If it runs at or below the hard threshold, it acts first. `/molt status` checks.
- **A Bash write is not progress unless it commits.** The autopilot loop guard counts Write,
  Edit, NotebookEdit and `git commit`; `sed -i` or `cat >` alone reads as no progress.
- **A molt runs under the session's permission mode.** Under a mode that asks first, the handoff
  and the resume stop at the first approval (the handoff or resume skill, a `git` check) until
  someone answers. An unattended session needs a mode or allow rules that let those run.
- **The status line lags one turn after a molt.** Until the seeded session's first turn ends, it
  still shows the old session's fill.
- **Background waits survive the clear** (probe P6). See the warning at the top.
- Claude Code only. Codex, OpenCode and Devin have no mod runtime.

## Tests

```bash
bash molt/run-tests.sh   # claude plugin validate + claude plugin test
```
