# herdr mechanics

## What this file is for

`herdr --skill`, with the `--help` text it points to, is the command reference, and every
command's syntax comes from it. This file states only what that guide cannot: how
herdr-crew composes those commands into a seat, from launch through dispatch and
completion to teardown. Role, retention and run decisions stay in `roles.md`,
`lifecycle.md` and `config.md`. Where this file overrides a default in herdr's guide, it
says so. Read every id from the creating command's JSON response; never predict one.

## The seat launch

No single herdr call creates a seat, starts its command and delivers its brief, so a seat
is this sequence, in which `<seat label>` is `seat: <role> (<agent>)`:

1. **The run's workspace, once per run.**
   `herdr workspace create --cwd <first seat's tree> --label "run: <objective>" --no-focus`.
   Its response holds one tab and one shell pane (`.result.tab`, `.result.root_pane`), and
   they are the first seat's: label the tab with `herdr tab rename <tab> "<seat label>"`
   rather than create a second tab beside an empty one.
2. **One tab per further seat.**
   `herdr tab create --workspace <id> --cwd <the seat's tree> --label "<seat label>" --no-focus`.
   Its pane is `.result.root_pane`. A seat that needs a new worktree uses
   `herdr worktree create` in place of this step or step 1. herdr opens the worktree as a
   workspace of its own (`herdr worktree` manages Git worktree-backed workspaces). Read its
   ids from the response; `herdr pane list --workspace <id>` names its pane.
3. **The seat's command.** `herdr pane run <pane> "<command:>"`, the entry's `command:`
   verbatim. It sends the text and Enter in one call.
4. **Readiness**, on whichever of the two paths below the pane takes.
5. **The model.** `herdr pane read <pane>`, with `--source visible` (the rendered viewport)
   when `model_shows: screen`, must show `expected_model:`; `command not found` or another
   model is a failed launch (`roles.md`).
6. **Dispatch**, with the turn-start check below.

## The two readiness paths

herdr answers, live, which path a seat takes: does `herdr agent list` return a record for
the pane? The discriminator is that answer and never a config field, so a detection
manifest that lands later moves a seat from the screen path to the typed path with no edit
anywhere. Detection takes seconds after `pane run` (four, measured on a lane pane). Ask
once those have passed, and treat a pane that is still absent as undetected.

**Detected** (a `claude-*` lane, `devin-*`, `pi`): the typed wait below. Detection is not
readiness. A fresh agent's first detected state may be `blocked` on a folder-trust dialog,
which `--dangerously-skip-permissions` does not skip. The typed wait wakes on it, and it
is handled like any other `blocked` wake.

**Not detected** (`mcode-*`, which herdr has no detection manifest for):
`herdr pane wait-output <pane> --match '<expected_model:>' --timeout <ms>`, with
`--source visible` when `model_shows: screen`. Every resolved profile carries
`expected_model:` and `model_shows` says where on the pane it appears, so the string that
confirms the model also shows the TUI is up, and existing entries need no edit. Without
`--timeout` the wait never ends. One caveat: the wait searches existing output before it
polls, so if the seat's own command line contains its model string, the echoed command
matches at once and the wait proves nothing.

## The typed wait

Every `herdr agent wait` herdr-crew issues, for readiness and for completion alike, names
the same three settled states:

    herdr agent wait <pane> --until done --until idle --until blocked --timeout <ms>

The set is stated here; `roles.md`'s launch and `lifecycle.md` step 5 carry the same
command. It is herdr's default set (no `--until` matches idle, done or blocked), written
out so it is not inherited. `--until` narrows: a wait without `blocked` sleeps through a
dialog to its timeout. `idle` and `done` both mean ready for input, told apart by whether
the completion was seen, and a CLI read does not mark it seen, so an unfocused seat can
settle in either. `unknown` is left out: herdr says it does not prove completion. Without
`--timeout` the wait never ends; with it, a timeout is a checkpoint (`lifecycle.md` step 5).

**A `blocked` wake** means herdr recognised an approval or question dialog. A blocked
agent rejects `herdr agent prompt` with `agent_blocked` before sending any input, so a
dialog is never answered with a prompt. Read it with `herdr pane read <pane>` and put it
to the operator, because herdr's guide says to ask before answering one. Then give the
answer with `herdr agent send-keys <pane> <keys>` and issue one fresh bounded wait. A
question the worker asks in its reply is not a dialog: the seat settles `idle` or `done`
with no new report, which is the missing-report case under Completion.

## Dispatch and the turn-start check

herdr prepends nothing: `herdr agent prompt` submits its text and Enter as one submission,
and what herdr adds to a seat is environment (`HERDR_PANE_ID`, `HERDR_TAB_ID`,
`HERDR_WORKSPACE_ID`), never prompt text. `brief_delivery: inject` prompts the brief itself;
`file` writes it to an absolute path the seat can read and prompts one line pointing there.

Acceptance of input is not the start of a turn; herdr's guide says the same of a
successful submission. The check is herdr's own and runs inside the dispatch call:

    herdr agent prompt <pane> "<brief>" --wait --until working --until blocked --timeout <ms>

When the seat starts from a non-working state, `--wait` requires an observed `working` or
`blocked` within five seconds of submission. `--until working --until blocked` returns at
that first observation, not at the end of the turn, so the call stays a dispatch and the
completion wait stays the one long wait. Its timeout counts from before submission, so
set it in seconds above the five-second gate, never to the task's length. The check
watches from submission, which a later `agent wait --until working` cannot do: a turn can
be past `working` before that wait is issued.

- `agent_prompt_stalled`: the text was accepted but no turn started. Check its state with
  `herdr agent get <pane>`. `working` means it started after all. Anything else:
  `herdr pane send-keys <pane> enter` submits what sits in the composer. Never send the
  prompt again, because a stall does not prove the text was not delivered. A `timeout`
  from this call is read the same way.
- `agent_blocked` (the seat was already at a dialog, and nothing was sent) and `blocked`
  (the turn opened on one) are both handled as a `blocked` wake.

**An undetected seat** is out of reach of every `agent` command, because those accept only
a pane that hosts a detected agent. It is prompted through the pane instead:
`herdr pane run <pane> "<one line>"` sends the line and Enter. Only `agent prompt` is
documented to honour a pane's bracketed-paste mode, so a multi-line brief reaches such a
seat only by `file`. A seat set to `inject` is reported to the operator, not improvised.
This surface has no turn-start check, and its doorbell is the report file (see Completion).

## Completion

A seat's result is its report file, at the `REPORT_PATH=` its brief names. herdr's `done`
carries no body, so the file is the contract and the typed state is only the doorbell.

Before each dispatch, note the file's hash (`git hash-object <path>`), empty if absent.
For a detected seat the wake is the typed wait above. After it:

- `idle` or `done`, and the file is new (absent at dispatch, or a different hash): read it.
- `idle` or `done`, and nothing new: the worker stopped without a report, either with a
  question in its reply or on a failure. This is the missing-report case, and it gets
  one `herdr pane read`. A question is answered by `herdr agent prompt` with the
  turn-start check, followed by one fresh bounded wait.
- `blocked`: a dialog, handled as above.
- A timeout: a checkpoint, and that pane is never re-waited (`lifecycle.md`, step 5).

Whether `done` ever fires for a Claude Code pane is unsettled, so nothing here depends on
it. `idle` is in the set, and the hash tells a new report from an old one at the same path.

**An undetected seat's doorbell is the report file itself**: one bounded shell wait that
returns when `REPORT_PATH`'s hash differs from the one noted at dispatch, or at its timeout:

    end=$((SECONDS + <seconds>))
    while [ "$(git hash-object <REPORT_PATH> 2>/dev/null)" = "<hash at dispatch, or empty>" ] &&
          [ "$SECONDS" -lt "$end" ]; do sleep 5; done

A changed file is the report. This is not the loop of waits `lifecycle.md` forbids, which
is a wait that re-enters the coordinator: one shell call that returns once re-enters
nothing, and `pane wait-output` polls inside itself the same way. A timeout with no new
report is the missing-report case above, and its one `herdr pane read` shows a question
(answered with `herdr pane run`), a stop, or a seat still at work: a checkpoint, never
re-waited.

## Placement

    workspace "run: <objective>"            one per run, created once
      tab "seat: implementer (<agent>)"     one full-size pane
      tab "seat: verifier (<agent>)"        one full-size pane

One workspace per run, one tab per seat and one full-size pane per tab, plus a workspace
for each worktree a seat needs (step 2). **herdr-crew places a seat with `tab create`,
never `pane split`**, because panes sharing a tab make a multi-agent screen unreadable.
This overrides `herdr --skill`, whose "Start and coordinate an agent" defaults to a
sibling pane split in the current tab. A seat reading that guide does not split. The
labels name the run, and the role and agent in each tab.

The orchestrator is not in that workspace. When the run starts it is already running in
the pane the operator launched it in, and herdr-crew does not move it, because a moved
pane takes a new id.

A seat's tree is whatever `--cwd` names, so a seat may sit in a different repository from
the orchestrator: in the dual-repo case, an orchestrator in the AI workspace repo places
an implementer in the canonical tree. `--env` (on `tab create` and `workspace create`)
carries only a seat's own scratch, such as `OSSIFY_SEAT`, and even that belongs to the
launcher `command:` names. A lane's provider variables are invoked by name through
`command:`, never replayed with `--env`: a replayed environment is the silent-reroute
defect.

`--trust-repository` on `herdr worktree` grants herdr's per-request Git trust. It is not
Claude Code's folder-trust dialog and does not answer it. Pass it only for a repository
the operator has verified, and never as a retry for a failed worktree command.

## Teardown

When a seat is released, its pane closes with `herdr pane close <pane>`. At the end of the
run, each workspace herdr-crew opened (the run's, and each worktree's) closes with
`herdr workspace close <id>`. Close only what the run created. Read each receipt rather
than assume it: a failed close returns JSON on stderr with exit status 1, and a pane that
did not close is still a live seat. Removing a worktree's checkout is a job for
`herdr worktree remove`, and only after `lifecycle.md` step 12's merged-branch check.
Never assume a close removed it.

## Machines

A seat runs on the orchestrator's own machine. The config contract declares no machine,
so a seat goes elsewhere only when the operator names one for it, enabled in
`herdr machine list`. A machine that list does not show halts the run, never a guess, as
an undefined seat name does. Every command for that seat then carries
`herdr --machine <label>`, with its ids discovered on that machine: ids and agent names
are scoped to one server, and a local `--current` reaches no remote pane. Never consume a
path from a `--machine` reply; resolve the seat's paths on its own machine. A connection
failure does not prove a mutation was not applied, so inspect the remote state before
retrying. Place a seat only on a machine that stays up for the seat's whole life.
