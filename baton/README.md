# baton

A recipe-driven engine. On a systemd timer it launches model sessions on a host when a unit is
due, waits on closed signals (a done-file, a thread's turn end, a PR's checks) at no token cost,
merges a pull request only by the recipe's rule, and notifies on parks, stalls and a host outage.
A merge-stage park on red checks or a conflict names the PR and the failing checks in its notice.
A recipe with a `driver` stage sends the operator only what a driver could not settle (see Driver).
It judges nothing: anything that needs judgment is a session the recipe launches. It ships a CLI,
a claim launcher, a timer and one skill (see Skill). It runs workers in Orca terminals (see Orca
host). Needs `bun`.

## Install

Install the plugin, then link `baton` onto `PATH`:

    ln -sf <plugin root>/bin/baton ~/.local/bin/baton

`bin/baton-seat` is not linked: the Orca host runs it from the plugin root (see Orca host). The
timer's unit runs `~/.local/bin/baton tick`, so re-point the symlink after a plugin update and the
timer follows. `baton timer install` writes `baton.service` and `baton.timer` under
`~/.config/systemd/user` and enables the timer (it ticks 2 min after boot, then every 90 s);
`baton arm` does the same unless it gets `--no-timer`. `baton timer remove` undoes it.
The service keeps `BATON_STATE_DIR` and `BATON_CONFIG` as they were set at install time; change
either and run `baton timer install` again.

## Orca host

Orca is the only host: each worker runs in an Orca terminal. No `host` key, or `"host": "orca"`,
selects it; any other value, `"t3"` included (the T3 host was removed in 0.6.0), fails `arm` and
the tick with `config: host must be "orca"`. A thread is a terminal: its id is the terminal handle,
and the title ends with `[baton <nonce>]`.
A recipe's `project` (and the example's `ai_project`) names an Orca repo by its display name; none,
or two, with that name refuses the launch.

Config keys (all optional; the `orca` block sits beside `host`):

- `host`: `"orca"`, the default and the only value.
- `orca.cli`: the `orca` binary, `~` expanded. Default: `orca` when it is on `PATH`, else
  `~/.config/orca/cli/bin/orca` (the timer's unit has no `orca` on its `PATH`).
- `orca.launcher`: the script the terminal runs. Default: baton's own `bin/baton-seat`.

The launcher. The host writes the launch message to a file under `<state>/orca/messages/` and runs
`orca terminal create` with the command
`cd '<cwd>' && BATON_STATE_DIR='<state dir>' exec '<launcher>' '<message file>'` (an Orca terminal
inherits orca-serve's environment, not the timer's); only those paths reach a shell.
`bin/baton-seat` reads the claim baton wrote for its directory (the seat and via keep their
`OMP_T3_SEAT` and `OMP_T3_VIA` names; see Known limits), reads and deletes the message file, and
execs
`omp-seat <seat> --via <via> <message>`. It refuses with exit 78, one line on stderr and one in
`<state>/claims/seat.log`, on no claim, a bad claim line, a claim with no seat or via, a message
file that is missing or 131072 bytes or more, or an `omp-seat` it cannot run (the message file
stays); it never starts a seat without its claim. A run's message files left behind are removed
when the run finishes and on `baton disarm`.

Status and interrupt. From `orca terminal list` and `orca worktree ps`: a terminal not listed is
`gone` only when `orca terminal read` confirms it (a terminal-gone error or status `exited`), and a
host outage otherwise; an agent `working` is `active`; `waiting` or `blocked` is `waiting`; `done`
is `completed` (`interrupted` when Orca says so). A missing agent row or an unknown state is
`active`, never `completed`, and a truncated list, or one that does not cover the local host, is a
host outage, never `gone`. Interrupt sends Escape to the terminal. A session end closes its
terminal before the launch directory is released, except a park (the terminal stays until `unpark`
or `disarm`) and an end after `interrupted` (it stays until the run ends); triage, driver and
molt-parent terminals close too.

The blocked park. A worker in `waiting` with no structured question (an omp `ask` dialog shows as
`blocked` with its text but no options) parks at once, on the next tick, and keeps its terminal: no
interrupt, claim and directory stay. The notice reads
`baton <run>/<unit> blocked in <stage> (project <project>): the worker waits on a question — answer it in the worker's terminal — screen: <tail>`.
The tail is the screen's last 12 non-empty lines, at most 1500 characters. When the screen holds a
live picker (see Answering a blocked park) whose question line is not among them, as an omp `ask`
box is taller than the tail, the tail starts with it: `<question> | … | <last lines>`.
Answer in the worker's terminal in Orca; when the worker moves on, the park clears itself and the
session is watched again. `baton unpark <run> <unit>` clears it by hand, and `--to <stage>` ends
the session and moves the unit. A stop file wins, `disarm` closes the worker, no driver takes it
and no stall clock runs on it; the run summary counts it as sent to you.

`baton answer <run> <unit> <label>` sends the unit's pending question the option whose label is
exactly `<label>`. rc 0 sent, 2 refused (no live session, no pending request, several questions, a
multi-select, an unknown label, a host with no `respond`), 3 host auth, 4 host down. The triage
brief uses it. Orca defines no `respond`: it reports an omp question's text but not its options,
so `baton answer` refuses there (rc 2) and a question is the blocked park and the operator's, not
triage's. The command and the host interface's optional `respond` stay for a host that can answer.

Known limits on Orca (Orca 1.4.238, recorded in the host's fixtures):

- A picker opened between turns (an omp `/review` picker) leaves the agent row `done`, so the worker
  reads `completed`, not blocked.
- An aborted omp turn reads `completed`: Orca does not report `interrupted` for it.
- Escape aborts a plain omp turn, but a worker in an `ask` dialog or with a live async subagent may
  keep running after it (a subagent keeps the worker `working` until it ends). The first stall ends
  the session and closes its terminal, but a park (the second stall, or a stop file) keeps the
  terminal, so such a worker can keep running until `unpark` or `disarm`.
- `baton disarm` leaves live (non-parked) workers running; their terminals and per-launch
  worktrees stay until you close them by hand.
- After an Orca restart the terminals and their processes survive, but a live worker has no agent
  row until its next hook event and reads `active`: a worker blocked across a restart is caught by
  the stall rule, not the blocked park.
- A process that dies leaves the terminal list and reads `gone`; a `baton-seat` refusal reads the
  same way. Orca has no failure state to map, so a `thread gone` park's notice ends with
  `— if the launcher refused it, the reason is in <state>/claims/seat.log` (the absolute path).
- The question is kept in a blocked park's screen tail only for a picker `baton screen` can parse;
  a screen of any other shape gets the plain last lines.

## Answering a blocked park

A blocked park's worker waits on a picker baton cannot answer through the host. Two commands let
a caller (the operator, or a bridge acting on the operator's tap) answer it from outside the Orca
terminal, with keys checked against a fresh screen:

    baton screen <run> <unit>
    baton answer <run> <unit> --park <at> --screen <n> <label>
    baton answer <run> <unit> --park <at> --screen-text <text> --question <line>

`baton screen` prints one JSON line, `{"park_at", "thread", "screen", "picker"}`: the park's `at`
(the last part of its notice key), the worker's terminal, its screen read now, and the picker parsed
from it, `{"kind", "question", "options": [{"n", "label"}], "other"}` or `null`. It reads only:
no lock, nothing sent. rc 2 when the run is disarmed or done, the unit is not in a blocked park, an
`unpark --to` is in flight, the unit's session is not the park's thread, or the host has no
`screen`; 3 host auth, 4 host down.

Two picker kinds are known, as omp v18.11.3 draws them: `omp-ask` (the `ask` tool's box, headed
`Ask`, `○` rows, an `Other (type your own)` row last, which `other` numbers and `options` leaves
out) and `numbered` (omp's `/review` box, `Review Mode`, rows `<n>. <label>`; its question is the box
title). Only a box followed by a `⏎ select` footer is live: the `ask` call above it, an answered
picker and the free-text box read as no picker.

`--screen` selects option `<n>` and `--screen-text` types `<text>` through the Other row. Both run
under the store lock, read the screen again, and send keys only when every check passes; each
failed check is rc 2 with one line `baton answer: <reason>` and nothing sent:

- the run is disarmed or done; the unit is missing, not in a blocked park, has an `unpark --to` in
  flight, or its session is not the park's thread;
- `--park` is not the unit's park `at` (the park was cleared and a new one opened);
- the host has no `screen` or no `keys`;
- the screen shows no live picker;
- `--screen`: option `<n>` is not labelled exactly `<label>`;
- `--screen-text`: the picker's question line is not exactly `<line>`, the picker has no Other row,
  or `<text>` is empty or holds a control byte (any byte below 0x20, and 0x7f: an Enter, an Escape
  or a tab would act on the terminal, not arrive as the answer).

The keys are fixed per kind: Up once per row (the Other row counted; Up stops at row 1), Down to
the row, Enter, in one send. Free text is three sends: to the Other row and Enter, the text, Enter.
An answer records `{"kind": "answered", "unit", "screen": n, "label"}` or
`{"kind": "answered", "unit", "screen_text": true}`; the text itself is not logged. rc 64 for any
other argument shape; the three-argument `baton answer <run> <unit> <label>` is unchanged.

Known limits:

- A picker of any other shape reads as no picker, and both answer forms refuse it. Answer it in the
  terminal.
- `--screen-text` needs an Other row, so it works on `omp-ask` only.
- The numbered `/review` picker rarely reaches a blocked park on Orca: a picker opened between turns
  leaves the agent row `done` (see Known limits on Orca).
- The free-text sends are not checked between each other: a host failure after the first leaves the
  free-text box open, and the answer is rc 4 with no event.
- The check and the send are separate Orca calls: a picker that changes between the read and the
  send gets keys meant for the one read.

## Skill

`running-a-spine-on-baton` is for a project's orchestrator session asked to run a planned ossify
spine on baton. It runs a read-only preflight, shows the exact `baton arm` command for the
example recipe with where each value came from, arms it only on the operator's yes, and then
spends no tokens on the run: questions reach the phone through bot-on-openbot, and status is
read only when the operator asks. It points here for the commands and the runbook. Claude Code
only: baton has no Codex manifest.

## Commands

    baton validate <recipe.json>
    baton arm <recipe.json> --run <id> [--param k=v]... [--no-timer]
    baton status [<run>]            baton report <run>
    baton disarm <run>              baton tick [--run <id>]
    baton unpark <run> [<unit>] [--to <stage>]
    baton answer <run> <unit> <label>
    baton answer <run> <unit> --park <at> --screen <n> <label>
    baton answer <run> <unit> --park <at> --screen-text <text> --question <line>
    baton screen <run> <unit>
    baton timer install|remove

`unpark` acts on a parked unit; a unit that is running (a live session, not parked) is refused
with rc 2.

## Triage

A seat can stop on a prompt no one answers, such as an OMP `/review` picker. Triage runs only on a
host that reports the thread's pending request as a structured question. Orca does not, so on Orca
a stuck seat is the blocked park or the stall rule, and a `triage` stage never launches; the stage
stays for a host that does. Without a `triage` stage in the recipe, baton logs one `pending`
event per request and the stall clock runs as before. With one, the clock pauses and baton
launches a single triage session per request id per stage visit (`triage` event). The recipe's
`triage` stage takes the launch fields plus `note_file` and `stall_minutes` (default 10); its
message may use `{pending.thread}`, `{pending.request}`, `{pending.questions}` and
`{pending.stage}` (`note_file` may not). `stop_file`, `watch`, `before` and `after_launch` are
accepted there and ignored; no other stage may then be named `triage`. The triage session does one of three things:

- **Answers** the prompt with `baton answer <run> <unit> <label>` (one question, one option, by its
  exact label): the seat goes on (`triage answered`). A refusal, such as a request with several
  questions, means the triage writes a note.
- **Writes the note file**: baton relaunches the seat (`triage relaunch`) and the brief tells it
  to read the note first. A relaunch counts toward the two-stall park, but is logged as
  `triage relaunch`, so `report`'s `stall` count leaves it out.
- **Writes the stop file**: the unit parks `stop`, as for any stop.

Parks and how to clear them:

- **`second prompt`**: the seat asked again after its triage. Read the thread, decide, then
  `baton unpark <run> <unit>`. A plain unpark keeps the unit's triaged request ids, so the
  relaunched seat's next prompt parks `second prompt` again. Use
  `baton unpark <run> <unit> --to <stage>` to start a fresh stage visit with a fresh triage.
- **`triage gave no answer`**: the triage ended with no answer, note or stop. Check its thread,
  then unpark the same way.
- **`stop` written by triage**: handle it as any stop (see the runbook below).

`unpark --to` and `disarm` clear a live triage and release its claim. `baton report` counts
`triage`, `triage answered` and `triage relaunch`.

## Driver

A recipe may carry one top-level `driver` stage (`kind: "driver"`). It takes the launch fields
(like `triage`, with `stall_minutes` as its time limit, default 10) plus `state_file`,
`result_file` and `ledger` (paths rendered with the unit's scope), `clearing` (a non-empty list of
names the driver may report having cleared) and `resume_to` (park stage to the stages a resume may
enter). Its message may use `{driver.stage}`, `{driver.reason}` and `{driver.launch}` (the launch's
number, `<n>` of its nonce `<run>/<unit>/driver/<n>`). `state_file` and `result_file` must contain
`{run.dir}` or `{run.id}` and `{unit.id}`, `result_file` must contain `{driver.launch}`, and the two
must differ, so a result is read only for the launch that wrote it; both may use `{driver.launch}`, the ledger (which may be shared) may not. `session`-only fields
(`outcomes`, `handoff`, `slots`, `stop_file`, `before`, `after_launch`, `watch` and the like) are
refused, and a recipe with a driver cannot name a stage `driver`.

With a driver, a park no longer sends its notice. Step 7 of the tick writes the unit's state file
(the run, the units, this park, the events since the stage entry) and launches one driver session
for it (`driver` event). The driver takes no slot and has its own claim. When it ends, baton reads
the result file rendered for that launch once (a valid one is then removed; a refused one is kept):

- `{"result":"resume","to"?:..,"cleared":..,"ledger":{..}}`: the unit is unparked in place, or into
  `to` (allowed by `resume_to` for the park's stage); `cleared` must be in `clearing`
  (`driver resume`). A unit that parks again with the same stage and reason after a driver resumed it
  goes straight to the operator.
- `{"result":"escalate","action":..,"ledger":{..}}`: the one park notice, `baton <run>/<unit> parked
  in <stage>: <reason> — <action>`, with the suffixes the park's own notice would carry: a merge-stage
  park's PR, a failed hook, the `thread gone` note (see State and config, Orca host) (`driver escalate`).
- `{"result":"stop","reason":..,"ledger":{..}}`: the run parks, `driver stop: <reason>` (`driver stop`).

`ledger` is `{q, a, why, rejected}`, all non-empty; baton appends it as one line to the recipe's
ledger file. A missing, unreadable or refused result (no file, not JSON, an unknown result, an empty
`action` or `reason`, a `cleared` or `to` not allowed, a bad ledger) or a driver that fails to launch
is an escalate whose action names the cause. A driver past its time limit is interrupted; the
`driver dropped` event names that cause, and with no result file the action reads `driver gave no
valid result (no result file)`. `unpark`
and `disarm` drop a live driver and release its claim. Without a `driver` stage every park sends its
notice, as before.

A run that finishes sends one silent summary line: units, merged PRs, parks and how they were
settled, drivers, wall time and the ledger path.

The example recipe's driver (`briefs/driver.md`) settles two parks only: a red `land` whose failing
checks are all outside the item's changed files (re-run once), and a `correct` park at the dispatch
cap with a used-up `correction.txt`. A `user:` walk, a change on `main`, a merge or any doubt goes
to the operator.

## State and config

State lives in `${BATON_STATE_DIR:-~/.local/state/baton}`: `runs/<id>/run.json` and
`events.jsonl`, `claims/` (one env file per launch directory, plus `lookup.log`), `launch/`
(per-launch worktrees), `notify.log`, and a `lock`.

`run.json` is baton's own state; every command and the tick refuse one whose top-level shape baton
never writes: not a JSON object, an `id` other than the run's directory name, a `status` other than
`armed`, `parked`, `disarmed` or `done`, or `units` that is not an object of objects each keyed by
its own `id` (an array of units, say). The error names the run and the field, for example
`run r1: run.json: units is not an object`; the file is left as it is. Copy a run directory only
with its `id` changed to match, and never turn `units` into an array (`jq '.units |= map(..)'`
does).

Config is the optional `${BATON_CONFIG:-$HOME/.config/baton/config.json}`; every key is optional:

- `host`: `"orca"` (the default and only value); `orca.cli` and `orca.launcher` (see Orca host).
- `notify`: an argv run with no shell for each notice, `{message}` replaced by the notice text
  and `{key}` by the notice's one-line key (a park's is `<run>/<unit>/park/<at>`), bounded at
  30 s; its failure never fails a tick. Each notice is sent once per key and is always appended
  to `<state>/notify.log`, which is the only sink when `notify` is unset.
- `slots`: per-slot caps on concurrent sessions across all runs (positive integers), over the
  recipe's `slots`, over the defaults `{"session": 2, "build": 1}`.

The `park` event in `events.jsonl` is `{kind, unit, stage, reason}` plus `thread` (the seat's
thread id, when the unit had a session); on `second prompt` and `triage gave no answer`,
`questions` (the pending request's questions, JSON-stringified; left off when there are none); and
on `before failed`, `after_launch failed` and `run failed`, `hook` (the failed hook's 1-based place
in its list) and `argv` (its rendered argv). Those three parks' notices end with
` — hook <n>: <argv joined by spaces>`, cut to 120 characters, after the PR a merge-stage park
names; an escalated driver notice carries the same suffixes. The driver adds the events
`driver`, `driver resume`, `driver escalate`, `driver stop` and `driver dropped`.

```json
{
  "notify": ["notify-send", "baton", "{message}"],
  "slots": { "session": 3 }
}
```

## Example: an ossify spine

`examples/ossify-spine/` is a recipe that runs one planned ossify spine in Orca terminals: the detached
run-spine lane queues each round's work items, an implementer per item, gap re-entry, close and
correction, ordered merges onto the spine branch, the spine PR's review rounds, and the spine
close. The briefs it names are prose; `common.md` is read first by every seat.

Copy the example outside the plugin cache first, and pass that copy's `briefs` path: a plugin
update moves the cache, and a run armed on the old path would lose its briefs.

    mkdir -p ~/baton-recipes
    cp -r <plugin root>/examples/ossify-spine ~/baton-recipes/ossify-spine
    baton arm ~/baton-recipes/ossify-spine/recipe.json --run r0-s6 \
      --param spine=r0.s6 \
      --param spine_branch=<output of: oss branch_name <spine> <slug>> \
      --param spine_dir=<absolute AI-workspace spine directory> \
      --param ai_root=<AI workspace root> \
      --param ai_project=<Orca repo display name of the AI workspace> \
      --param repo=<canonical root> \
      --param project=<Orca repo display name of the canonical> \
      --param state_file=<output of: oss state_path, run in the AI workspace root> \
      --param oss=<absolute path of <ossify plugin root>/bin/oss> \
      --param briefs=$HOME/baton-recipes/ossify-spine/briefs \
      --param via=omp-deepseek-cpa

Each unit's files live in `<state>/runs/<run>/out/<unit>/`. Operator runbook:

- **A stop parks the unit.** Read its `stop` file, write the ruling into the work item handoff's
  `## Clarifications` (or into the file the stop names), delete the `stop` file, then
  `baton unpark <run> <unit>`. If the stop file is still there, `unpark` renames it to
  `<path>.consumed-<iso>`, so it does not park the unit again.
- **After a gap stop**, send the item back to its implementer: `baton unpark <run> <wi> --to implement`.
- **A reversal before the spine merges**: write it to `out/spine-pr/operator.md`, then
  `baton unpark <run> spine-pr --to spine_work`; that round does it first and then removes the file.
- **A spine PR conflict parks `spine-pr`** in `spine_wait`. Resolve it on the spine branch in the
  canonical root (merge the base in; never rebase or force-push), push, delete
  `out/spine-pr/review.md`, then `baton unpark <run> spine-pr --to spine_review`.
- **The spine PR ack.** On the "passed review … merge it" notice, read the PR's needs-you list, then
  merge it (the phone's Merge button, or by hand); baton sees the merge and runs the second spine close.
- **`--to spine_work` is refused while `spine-pr` has a live session** (a review is running): wait
  for the review to end, then unpark.
- **A `land` park** names its reason. `run failed`: the canonical root is not on the spine branch
  (or the fast-forward failed); check the spine branch out there, then `baton unpark <run> <wi>`.
  `outcome`: the item PR's checks are red or it conflicts; fix it on the item branch, then unpark.
  `pr closed`: reopen the PR and unpark, or finish the item by hand. `not landed`: the PR merged
  but its head is not on the spine branch (a squash or rebase); the recipe cannot record that
  landing, so finish the item by hand.
- **A run-level park** (`invalid record …`): fix or remove the record file, then `baton unpark <run>`.
- **A seat stopped mid-work leaves its worktree dirty.** work-item's Gate 3 refuses a dirty
  worktree on a plain `unpark` of `implement`, and a correction's packet no longer matches the
  staged tree: clean the worktree, or finish the work by hand, before you unpark.
- **A cheap build**: implementers and corrections hold the `build` slot (1 by default), so they run
  one at a time. Raise `slots.build` in the config to run more at once.

## Known limits

- A stage whose `cwd` is a project root starts by default in a detached per-launch worktree, not
  at the root, so its brief must name the paths it works in, and writes to tracked files there
  are lost on `release`. A stage that needs the real checkout sets `launch_dir: "root"`.
- While a `launch_dir: "root"` session runs, a hand-started thread at that root reads its claim.
  A hand-started thread bound to a baton launch directory or a live item worktree also reads that
  claim.
- A coordinator seat still has bash (`crontab`, background `sleep`); its brief governs.
- A seat that clears in place without a handoff line is seen only through the quiet window.
- `findByNonce` depends on Orca keeping the terminal title.
- On Orca: see the known limits under Orca host.
- The claim keys keep their T3-era names, `OMP_T3_SEAT` and `OMP_T3_VIA`: renaming them would break
  recipes already staged. A staged recipe that still sets the retired `OMP_T3_DROP_T3_MCP` passes
  it to the seat as a plain variable that nothing reads.
- A driver's judgment is prose: a driver that picks the wrong result is caught only by the closed
  checks on its result file and by the operator reading the ledger.
- `baton unpark` during a live driver removes its claim but does not interrupt the driver thread or
  release its launch worktree; its later result is ignored.
- A live driver is not watched while the run is parked; it is handled after the run re-arms.
- The driver guard key is `<stage>/<reason>`. A park reason that embeds a varying error message never
  repeats, so only `driver.md`'s prose stops a second driver for the same underlying failure.
