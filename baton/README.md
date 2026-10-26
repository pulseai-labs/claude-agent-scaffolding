# baton

A recipe-driven engine. On a systemd timer it launches model sessions on a host when a unit is
due, waits on closed signals (a done-file, a thread's turn end, a PR's checks) at no token cost,
merges a pull request only by the recipe's rule, and notifies on parks, stalls and a host outage.
A merge-stage park on red checks or a conflict names the PR and the failing checks in its notice.
A recipe with a `driver` stage sends the operator only what a driver could not settle (see Driver).
It judges nothing: anything that needs judgment is a session the recipe launches. It ships a CLI,
two claim launchers and a timer, and no skill, so Codex has nothing to load. It runs workers on
T3 Code (the default) or in Orca terminals (see Orca host). Needs `bun`.

## Install

Install the plugin, then link the two executables onto `PATH`:

    ln -sf <plugin root>/bin/baton ~/.local/bin/baton
    ln -sf <plugin root>/bin/omp-t3-claim ~/.local/bin/omp-t3-claim

The timer's unit runs `~/.local/bin/baton tick`, so re-point the symlinks after a plugin update
and the timer follows. `baton timer install` writes `baton.service` and `baton.timer` under
`~/.config/systemd/user` and enables the timer (it ticks 2 min after boot, then every 90 s);
`baton arm` does the same unless it gets `--no-timer`. `baton timer remove` undoes it.
The service keeps `BATON_STATE_DIR` and `BATON_CONFIG` as they were set at install time; change
either and run `baton timer install` again.

## T3 login

The T3 host calls T3's tailnet `/mcp` endpoint with an OAuth token. Run `baton t3 login`: it
registers a client, prints an authorize URL and listens on a loopback port. Run
`t3 auth pairing create` on the T3 host, open the URL with that pairing, and approve **above
read-only**. The code is exchanged the moment the callback arrives and the token is written
(mode 600) to `~/.config/spine-autopilot/t3-token.json`; it is never printed. The token lasts 30
days and the re-approval is manual: `baton t3 token-status` shows the days left.

## Orca host

`"host": "orca"` in the config runs each worker in an Orca terminal instead of a T3 thread; the
default stays `"t3"`. Any other value fails the tick with `config: host must be "t3" or "orca"`.
A thread is a terminal: its id is the terminal handle, and the title ends with `[baton <nonce>]`.
A recipe's `project` (and the example's `ai_project`) names an Orca repo by its display name; none,
or two, with that name refuses the launch. The T3 token-expiry notice is raised on the T3 host only.

Config keys (all optional; the `orca` block sits beside `host`):

- `host`: `"t3"` (default) or `"orca"`.
- `orca.cli`: the `orca` binary, `~` expanded. Default: `orca` when it is on `PATH`, else
  `~/.config/orca/cli/bin/orca` (the timer's unit has no `orca` on its `PATH`).
- `orca.launcher`: the script the terminal runs. Default: baton's own `bin/baton-seat`.

The launcher. The host writes the launch message to a file under `<state>/orca/messages/` and runs
`orca terminal create` with the command `cd '<cwd>' && exec '<launcher>' '<message file>'`; only
those paths reach a shell. `bin/baton-seat` reads the claim for its directory (the same claim file
and keys as `omp-t3-claim`), reads and deletes the message file, and execs
`omp-seat <seat> --via <via> <message>`. It refuses with exit 78, one line on stderr and one in
`<state>/claims/seat.log`, on no claim, a bad claim line, a claim with no seat or via, or a message
file that is missing or 131072 bytes or more; it never starts a seat without its claim.

Status and interrupt. From `orca terminal list` and `orca worktree ps`: a terminal not listed is
`gone`; an agent `working` is `active`; `waiting` or `blocked` is `waiting`; `done` is `completed`
(`interrupted` when Orca says so). A missing agent row or an unknown state is `active`, never
`completed`, and a truncated list is a host outage, never `gone`. Interrupt sends Escape to the
terminal. A session end closes its terminal before the launch directory is released, except a park
(the terminal stays until `unpark` or `disarm`) and an end after `interrupted` (it stays until the
run ends); triage, driver and molt-parent terminals close too.

The blocked park. A worker in `waiting` with no structured question (an omp `ask` dialog shows as
`blocked` with its text but no options) parks at once, on the next tick, and keeps its terminal: no
interrupt, claim and directory stay. The notice reads
`baton <run>/<unit> blocked in <stage> (project <project>): the worker waits on a question — answer it in the worker's terminal — screen: <tail>`.
Answer in the worker's terminal in Orca; when the worker moves on, the park clears itself and the
session is watched again. `baton unpark <run> <unit>` clears it by hand, and `--to <stage>` ends
the session and moves the unit. A stop file wins, `disarm` closes the worker, no driver takes it
and no stall clock runs on it; the run summary counts it as sent to you.

`baton answer <run> <unit> <label>` sends the unit's pending question the option whose label is
exactly `<label>`. rc 0 sent, 2 refused (no live session, no pending request, several questions, a
multi-select, an unknown label, a host with no `respond`), 3 host auth, 4 host down. The triage
brief uses it. Only the T3 host defines `respond`: Orca reports an omp question's text but not its
options, so on Orca a question is the blocked park and the operator's, not triage's.

Loss against T3 (design 4.5). T3 gave omp's picker prompts to the engine as structured requests, so
a triage session could answer them. On Orca it cannot: the worker parks blocked and the operator
answers in the terminal. A T3 request with several questions is now refused by `baton answer`, so
triage writes a note for it instead of answering.

Known limits on Orca (Orca 1.4.238, recorded in the host's fixtures):

- A picker opened between turns (an omp `/review` picker) leaves the agent row `done`, so the worker
  reads `completed`, not blocked.
- An aborted omp turn reads `completed`: Orca does not report `interrupted` for it.
- A worker with a live async subagent stays `working` after Escape until the subagent ends; the
  stall path then closes the terminal, which ends the subagent too.
- After an Orca restart the terminals and their processes survive, but a live worker has no agent
  row until its next hook event and reads `active`: a worker blocked across a restart is caught by
  the stall rule, not the blocked park.
- A process that dies leaves the terminal list and reads `gone`; a `baton-seat` refusal reads the
  same way. Orca has no failure state to map.

## Commands

    baton validate <recipe.json>
    baton arm <recipe.json> --run <id> [--param k=v]... [--no-timer]
    baton status [<run>]            baton report <run>
    baton disarm <run>              baton tick [--run <id>]
    baton unpark <run> [<unit>] [--to <stage>]
    baton answer <run> <unit> <label>
    baton t3 login | token-status | call <tool> <json-object>
    baton timer install|remove

`unpark` acts on a parked unit; a unit that is running (a live session, not parked) is refused
with rc 2.

## Triage

A seat can stop on a prompt no one answers, such as an OMP `/review` picker. The T3 host reports
the thread's pending request. Without a `triage` stage in the recipe, baton logs one `pending`
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
  in <stage>: <reason> — <action>`, with the PR suffix a merge-stage park carries (`driver escalate`).
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

Config is the optional `${BATON_CONFIG:-$HOME/.config/baton/config.json}`; every key is optional:

- `host`: `"t3"` (default) or `"orca"`; `orca.cli` and `orca.launcher` (see Orca host).
- `t3.base`: the T3 `/mcp` URL (default `https://draco-desk.tail71316d.ts.net:8445/mcp`).
- `t3.tokenFile`: the token path, `~` expanded (default `~/.config/spine-autopilot/t3-token.json`).
- `notify`: an argv run with no shell for each notice, `{message}` replaced by the notice text
  and `{key}` by the notice's one-line key (a park's is `<run>/<unit>/park/<at>`), bounded at
  30 s; its failure never fails a tick. Each notice is sent once per key and is always appended
  to `<state>/notify.log`, which is the only sink when `notify` is unset.
- `slots`: per-slot caps on concurrent sessions across all runs (positive integers), over the
  recipe's `slots`, over the defaults `{"session": 2, "build": 1}`.

The `park` event in `events.jsonl` is `{kind, unit, stage, reason}` plus `thread` (the seat's
thread id, when the unit had a session) and, on `second prompt` and `triage gave no answer`,
`questions` (the pending request's questions, JSON-stringified). The driver adds the events
`driver`, `driver resume`, `driver escalate`, `driver stop` and `driver dropped`.

```json
{
  "t3": { "base": "https://draco-desk.tail71316d.ts.net:8445/mcp" },
  "notify": ["notify-send", "baton", "{message}"],
  "slots": { "session": 3 }
}
```

`bin/omp-t3-claim` is the launcher a T3 provider instance points at: it applies the claim for its
working directory and then runs `omp-t3`; with no claim the instance is untouched.

## Example: an ossify spine

`examples/ossify-spine/` is a recipe that runs one planned ossify spine on T3: the detached
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
      --param ai_project=<T3 project title of the AI workspace> \
      --param repo=<canonical root> \
      --param project=<T3 project title of the canonical> \
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
- **The spine PR ack.** On the "merge it by hand" notice, read the PR's needs-you list, then merge
  it; baton sees the merge and runs the second spine close.
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
- A Claude DAG seat would also need T3's MCP wake tools removed; none is in use.
- A seat that clears in place without a handoff line is seen only through the quiet window.
- `findByNonce` depends on the host keeping the thread title (T3) or the terminal title (Orca).
- On Orca: see the known limits under Orca host.
- The 30-day token re-approval is manual.
- A driver's judgment is prose: a driver that picks the wrong result is caught only by the closed
  checks on its result file and by the operator reading the ledger.
- `baton unpark` during a live driver removes its claim but does not interrupt the driver thread or
  release its launch worktree; its later result is ignored.
- A live driver is not watched while the run is parked; it is handled after the run re-arms.
- The driver guard key is `<stage>/<reason>`. A park reason that embeds a varying error message never
  repeats, so only `driver.md`'s prose stops a second driver for the same underlying failure.
