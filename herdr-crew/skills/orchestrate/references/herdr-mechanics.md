# herdr mechanics

## What this file is for

`herdr --skill` and the `--help` text it points to are the command reference. This file
states only what that guide cannot, how herdr-crew composes those commands into a seat;
role, retention and run decisions stay in `roles.md`, `lifecycle.md` and `config.md`.
Where it overrides the guide's default, it says so. Read each id from the JSON that made it.

## The seat launch

No single herdr call creates a seat, starts its command and delivers its brief, so a seat
is this sequence, in which `<seat label>` is `seat: <role> (<agent>)`:

1. **The run's workspace, once per run.**
   `herdr workspace create --cwd <first seat's tree> --label "run: <objective>" --no-focus`.
   Its tab and shell pane (`.result.tab`, `.result.root_pane`) are the first seat's:
   `herdr tab rename <tab> "<seat label>"`, not a second tab beside an empty one.
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
   when `model_shows: screen`, must show `expected_model:`;
   `command not found` or another model is a failed launch (`roles.md`).
6. **Dispatch**, sent as below.

## The two readiness paths

herdr answers, live, which path a seat takes: does `herdr agent list` return a record for
the pane? The discriminator is that answer and never a config field, so a detection
manifest that lands later moves a seat from the screen path to the typed path with no edit
anywhere. Detection takes seconds after `pane run` (four, measured on a lane pane). Ask
once those have passed, and treat a pane that is still absent as undetected.

**Detected** (a `claude-*` lane, `devin-*`, `pi`): the typed wait below. Detection is not
readiness: a fresh agent's first detected state may be `blocked` on a folder-trust dialog,
which `--dangerously-skip-permissions` does not skip, and it is handled as a `blocked` wake.

**Not detected** (`mcode-*`, which herdr has no detection manifest for):
`herdr pane wait-output <pane> --match '<expected_model:>' --timeout <ms>`, with
`--source visible` when `model_shows: screen`. Every resolved profile carries
`expected_model:` and `model_shows` says where on the pane it appears, so the string that
confirms the model also shows the TUI is up, and existing entries need no edit. Without
`--timeout` the wait has no bound. One caveat: the wait searches existing output before it
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
`--timeout` the wait has no bound; with it, a timeout is a checkpoint (`lifecycle.md`
step 5).

**Every readiness and completion wait runs in the background:** one shell call the host
wakes the session on when it exits (Claude Code: the Bash tool's `run_in_background`), so
it spends no tokens and its `--timeout` can be hours. It still returns once and re-enters
nothing; a round's N items are N such waits, one per pane. A host with no background call
waits in the foreground, `<ms>` inside its cap on one call (Claude Code: 120000 ms default,
600000 max), the call's own timeout covering it: a cut-off wait is neither wake nor timeout.

**A `blocked` wake** means herdr recognised an approval or question dialog. A blocked
agent rejects `herdr agent prompt` with `agent_blocked` before sending any input, so read
the dialog with `herdr pane read <pane>`, put it to the operator (herdr's guide says to ask
first), give the answer with `herdr agent send-keys <pane> <keys>`, and issue one fresh
bounded wait. A question the worker writes to its report file is not a dialog: it rings
the doorbell a report does (Completion).

## Sending a seat a message

This is the one statement of how the orchestrator sends a seat anything (a brief, a fix
task, an answer, a plan approval, a correction); other files say "send" and mean this.

- **Detected:** `herdr agent prompt <pane> "<text>"`. herdr prepends nothing: it submits
  the text and Enter as one submission, and what it adds to a seat is environment such as
  `HERDR_PANE_ID`, never prompt text. A message that starts work takes the turn-start
  check below. `brief_delivery: inject` prompts the brief itself; `file` writes it to an
  absolute path the seat can read and prompts one line pointing there.
- **Undetected:** no `agent` command reaches the pane; they accept only a pane hosting a
  detected agent. Write the message to a file the seat can read and send a one-line
  pointer with `herdr pane run <pane> "<line>"` (the line and Enter); only `agent prompt`
  is documented to honour bracketed paste. A seat set to `brief_delivery: inject` is
  reported to the operator. This path has no turn-start check.

**The turn-start check.** Acceptance of input is not the start of a turn, as herdr's guide
says of a successful submission; herdr's own check runs inside the send:

    herdr agent prompt <pane> "<brief>" --wait --until working --until blocked --timeout <ms>

From a non-working state, `--wait` requires an observed `working` or `blocked` within five
seconds of submission, and `--until working --until blocked` returns at that first
observation, so the call stays a dispatch and the completion wait the one long wait. Its
timeout counts from before submission, so it is a few seconds above the five-second gate.

- `agent_prompt_stalled`: no activity was observed within five seconds of submission.
  `herdr agent get <pane>` gives the state. `working`: it started. `blocked`: a `blocked`
  wake. `idle` or `done`: `herdr pane send-keys <pane> enter` submits what sits in the
  composer. `unknown`: report it to the operator. Never send the prompt again, because a
  stall does not prove the text was not delivered; read a `timeout` the same way.
- `agent_blocked` (the seat was already at a dialog, and nothing was sent) and `blocked`
  (the turn opened on one) are both handled as a `blocked` wake.

## Completion

A seat's result is its report file, at the `REPORT_PATH=` its brief names, placed outside
every seat's worktree so that removing a worktree never takes a report. herdr's `done`
carries no body, so the file is the contract and the typed state is only the doorbell.
The worker writes everything it says to the orchestrator there (its plan, a question, an
escalation, a late finding, its report), so before every message that sends a seat to
work, note the file's hash (`git hash-object <path>`), empty if absent.

For a detected seat the wake is the typed wait above. After it:

- `idle` or `done`, and the file is new (absent at dispatch, or a different hash): read
  it. A plan, a question or a late finding is answered with the seat's next message and
  one fresh bounded wait; an escalation goes to the operator.
- `idle` or `done`, and nothing new: the missing-report case, one `herdr pane read`.
- `blocked`: a dialog, handled as above.
- A timeout: a checkpoint, and that pane is never re-waited (`lifecycle.md`, step 5).

Whether `done` ever fires for a Claude Code pane is unsettled, so nothing here depends on
it. `idle` is in the set, and the hash tells a new report from an old one at the same path.

**An undetected seat's doorbell is the report file itself**: one bounded background wait
that returns when `REPORT_PATH`'s hash differs from the one last noted, or at its timeout.
It polls inside itself as `pane wait-output` does, so it is not the loop of waits
`lifecycle.md` forbids. A changed file is read as above. A timeout with no new file is the
missing-report case, whose one `herdr pane read` shows a stop, a dialog or a seat still at
work. With no typed `blocked` here, a dialog goes to the operator, is answered with
`herdr pane send-keys` and gets one fresh bounded wait; a seat still at work is a
checkpoint, never re-waited.

## Placement

    workspace "run: <objective>"            one per run, closed last
      tab "seat: verifier (<agent>)"        one full-size pane
    workspace "<its label>"                 one per worktree a seat needs (step 2)
      tab "seat: implementer (<agent>)"     one full-size pane

One tab per seat and one full-size pane per tab: **herdr-crew places a seat with
`tab create`, never `pane split`**, because panes sharing a tab make a multi-agent screen
unreadable. This overrides `herdr --skill`, whose "Start and coordinate an agent" defaults
to a sibling pane split in the current tab; a seat reading that guide does not split.

The orchestrator is not in that workspace. When the run starts it is already running in
the pane the operator launched it in, and herdr-crew does not move it, because a moved
pane takes a new id.

A seat's tree is whatever `--cwd` names, so a seat may sit in a different repository from
the orchestrator: in the dual-repo case, an orchestrator in the AI workspace repo places
an implementer in the canonical tree. `--env` (on `tab create` and `workspace create`)
carries nothing but a seat's own scratch, such as `OSSIFY_SEAT`. A lane's provider
variables are invoked by name through `command:`, never replayed with `--env`: a replayed
environment is the silent-reroute defect.

`--trust-repository` on `herdr worktree` grants herdr's per-request Git trust. It is not
Claude Code's folder-trust dialog and does not answer it. Pass it only for a repository
the operator has verified, and never as a retry for a failed worktree command.

## Teardown

A seat in a tab of the run's workspace is released with `herdr pane close <pane>`. A
worktree seat never is: its workspace holds only its tab and pane, closing that pane may
take the workspace with it or be refused, and that workspace's id is the only selector of
`herdr worktree remove --workspace <id>`, which is its release once its branch's work is
safe: the implementer's after `lifecycle.md` step 12's merged-branch check, the reviewer's
(it edits nothing) once its report file validates (step 8). A refused remove goes to the
operator, never past it with `--force`. The run's own workspace closes last,
`herdr workspace close <id>`, after every workspace linked to it. Close only what the run
created, read every receipt (a failed call is JSON on stderr, exit status 1), and confirm
with `herdr workspace list`, never assume: a last pane's close may take its tab and
workspace too, and a close that finds its target already gone is information, not failure.

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
