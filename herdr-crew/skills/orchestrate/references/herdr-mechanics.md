# herdr mechanics

## What this file is for

`herdr --skill` and the `--help` text it points to are the command reference. This file
states only what that guide cannot, how herdr-crew composes those commands into a seat;
role, retention and run decisions stay in `roles.md`, `lifecycle.md` and `config.md`.
Where it overrides the guide's default, it says so. Read each id from the JSON that made it.

## The seat launch

No single herdr call creates a seat, starts its command and delivers its brief; a seat is this sequence, `<seat label>` being `seat: <role> (<agent>)`:

1. **The run's workspace, once per run per server that hosts a seat.**
   `herdr workspace create --cwd <a path that already exists> --label "run: <objective>"
   --no-focus` — the first seat's tree, or a neutral path when that seat's worktree is still to
   be created (step 2; a nonexistent `--cwd` fails the launch). Its tab and shell pane
   (`.result.tab`, `.result.root_pane`) are the first seat's when that path is its tree:
   `herdr tab rename <tab> "<seat label>"`, not a second tab beside an empty one; a
   seat on another machine needs its own, `--machine <label>` — ids are server-scoped.
2. **One tab per further seat.**
   `herdr tab create --workspace <id> --cwd <the seat's tree> --label "<seat label>" --no-focus`.
   Its pane is `.result.root_pane`. A seat that needs a new worktree uses `herdr worktree create`
   — `--cwd <the source repo> --path <the new tree> --branch <b> --base <base-branch> --label
   "<seat label>" --no-focus` — in place of this step, never step 1: it opens **two** workspaces,
   the worktree's own and the **source repository's** checkout (`is_linked_worktree: false`). Its
   `--label` names the worktree's **workspace**, so the seat's tab needs the `herdr tab rename`
   step 1 prescribes. `--cwd` is the lever that retargets the **source** repo: without it the
   call resolves its source from the *calling workspace's* repo. Read every id from the
   response, `result.root_pane.pane_id` included.

   **Guarded seats** (seat-mods): before an implementer, verifier or reviewer seat's command, run
   `export SEAT_MODS_ROLE=<role> SEAT_MODS_ALLOW=<REPORT_PATH's directory>:<its scratch directory>`
   in its pane (`worktree create` takes no `--env`). This binds a coordinator launching its own child
   seats exactly as it binds the top, and every replacement launch. The scratch directory, created
   first, is `<run dir>/scratch/<role>-<n>` — no `:` or space in either directory, as `:` separates
   the list. An ossify implementer's list adds its handoff's directory; a brief with scratch work
   names it `SCRATCH_DIR`. Never a coordinator seat — the spine, close or work-PR session, the doctor
   session, the lane driver — nor the orchestrator, a rotation successor included — and never in
   `settings.json`'s `env`, a shell profile or a `command:` line. The model read of a guarded seat
   also reads the status line for `seat: <role>`; its absence there means no guards — a coordinator
   records that in its report file (to the top), never silently.
3. **The seat's command.** `herdr pane run <pane> "<command:>"`, verbatim from the entry —
   re-running a **launch** command into a pane whose foreground process is already that
   agent's TUI delivers its line as a prompt, the mechanism the undetected seat's one-line
   pointer relies on, so a stray re-run costs a live seat a turn.
4. **Readiness**, on whichever of the two paths below the pane takes.
5. **The model.** `herdr pane read <pane>`, with `--source visible` (the rendered viewport)
   when `model_shows: screen`, must show `expected_model:`; one showing
   `command not found` — or another model — is a failed launch (`roles.md`).
6. **Dispatch**, sent as below.

## The two readiness paths

herdr answers, live, which path a seat takes: whether `herdr agent list` returns a record for
the pane. That answer, never a config field, is the discriminator — a detection manifest
landing later moves a seat to the typed path with no edit anywhere. Detection after `pane
run`: a record at about a second (0.6 s, still `agent_status: unknown`, no session identity)
and a settled state (`idle`) at about four seconds (3.8–4.0 s). The first ask, once the record
is there, chooses only the **readiness wait** below; made once step 5's model read has shown
`expected_model:` on the pane, a second ask of that list decides the **send's route** and with
it the **completion wait**, so the route that delivered the message is the one that can wake
it. A pane absent to that ask is undetected for the send.

**Detected** (a `claude-*` lane, `devin-*`, `pi`): the typed wait below. Detection is not
readiness: a fresh agent's first detected state may be `blocked` on a folder-trust dialog,
which `--dangerously-skip-permissions` does not skip, and it is handled as a `blocked` wake.

**Not detected** (`mcode-*`, which herdr has no detection manifest for):
`herdr pane wait-output <pane> --match '<expected_model:>' --timeout <ms>`, with
`--source visible` when `model_shows: screen`. Every resolved profile carries
`expected_model:`, and `model_shows` says where it appears — so the model string also shows
the TUI is up. Without `--timeout` the wait has no bound. Caveat: it searches existing output
before it polls, so a seat whose own command line contains its model string matches at once —
wait on output the launch command cannot produce, or exclude the echoed command.

## The typed wait

Every `herdr agent wait` herdr-crew issues names the same three settled states, except one
companion wait a detected coordinator needs, which selects `blocked` alone (Completion):

    herdr agent wait <pane> --until done --until idle --until blocked --timeout <ms>

The set is stated here; `roles.md` and `lifecycle.md` step 5 carry the same command.
It is herdr's default set, written out rather than inherited; `--until` narrows: without
`blocked`, a wait sleeps through a dialog to its timeout, and only `idle`, `done` and
`blocked` are proved settled — `done` fires for a Claude Code pane as `idle` does.
`--timeout` bounds it; a timeout is the checkpoint Completion states.

**Every readiness and completion wait runs in the background:** one shell call the host
wakes the session on when it exits (Claude Code: the Bash tool's `run_in_background`), so
it spends no tokens and its `--timeout` can be hours. It still returns once and re-enters
nothing; a round's N items are N such waits, one per pane. A host with no background call
waits in the foreground, `<ms>` inside its cap on one call (Claude Code: 120000 ms default,
600000 max) and cannot arm the heartbeat; a cut-off wait is neither wake nor timeout.

**A `blocked` wake** means herdr recognised an approval or question dialog. A blocked
agent rejects `herdr agent prompt` with `agent_blocked`, sending nothing, so read the dialog
with `herdr pane read <pane>`, put it to the operator (herdr's guide says to ask first),
give the answer with `herdr agent send-keys <pane> <keys>`, then one fresh bounded wait. A
question written to the report file is not a dialog; it rings that doorbell (Completion).

## Sending a seat a message

This is the one statement of how the orchestrator sends a seat anything; other files say "send" and mean this.

- **Detected:** `herdr agent prompt <pane> "<text>"`. herdr prepends nothing: it submits
  the text and Enter as one submission, and what it adds to a seat is environment such as
  `HERDR_PANE_ID`, never prompt text. A message that starts work takes the turn-start
  check below. A local slash command (`/context`, `/clear`) settles without a turn, so it
  is sent plain, without that `--wait`, and its one reply read with `herdr pane read`.
  `brief_delivery: inject` prompts the brief itself; `file` writes it to an absolute path
  the seat can read and prompts one line pointing there.
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
observation, so the call stays a dispatch and the completion wait the one long wait; its
timeout counts from before submission, a few seconds above the five-second gate.

- `agent_prompt_stalled`: no activity within five seconds of submission. `herdr agent get
  <pane>` gives the state. `working`: it started. `blocked`: a `blocked` wake. `idle` or
  `done`: `herdr pane send-keys <pane> enter` submits what sits in the composer (`enter`
  submits; herdr's help names only `esc`). `unknown`: report it to the operator. Never send
  the prompt again — a stall does not prove non-delivery — and read a `timeout` the same way.
- `agent_blocked` (nothing was sent) and `blocked` (the turn opened on one) are both a
  `blocked` wake; a cleared `agent_blocked` re-sends the brief with the turn-start check.

## Completion

A seat's result is its report file, at the `REPORT_PATH=` its brief names; `done` carries
no body, so the file is the contract and the typed state is only the doorbell. Every file
the run keeps is placed outside every seat's worktree, so removing a worktree never takes
one; before every message that sends a seat to work, note what the doorbell compares — its
hash (`git hash-object <path>`), empty if absent, and the file's identity (inode or mtime).
The worker writes everything it says to the orchestrator there (a plan, a question, an
escalation, a late finding, its report) and replaces the file whole (`briefs.md`).

For a detected seat that is not a coordinator (below), the wake is the typed wait above:

- `idle` or `done`, and the file is new (absent at dispatch, or a different hash or
  identity): read it. A plan, a question or a late finding is answered with the seat's next
  message and one fresh bounded wait; an escalation goes to the operator.
- `idle` or `done`, and nothing new: the false wake below, one `herdr pane read`.
- `blocked`: a dialog, handled as above. A timeout: the checkpoint below.

**The two dead ends.** *A timeout is a checkpoint*: one `herdr pane read` — the seat's
observed state, stopped, at a dialog or still at work, reported to the operator (a
coordinator: to the top, in its report file), and a further wait is the operator's decision,
never the orchestrator's own re-entry. *A false wake* — its own `pane read` showing the seat
still at work (the backgrounded-shell case) — is not a timeout: the doorbell becomes the
report file for the rest of that dispatch, never a second typed wait.

**An undetected seat's doorbell is the report file itself**, and so is a coordinator's: a
seat running work of its own in the background (a spine or work-PR session's waits, a lane
driver's subagents) reads `idle` or `done` before its report exists — a typed wait wakes too
soon. The doorbell is one bounded background wait that returns when `REPORT_PATH`'s hash
**or** the identity noted beside it differs from the one last noted, or at its timeout — not
the loop of waits `lifecycle.md` forbids. Both are compared, not merely recorded, so a
byte-identical replacement (a retained verifier repeating the same failure) — same hash, new
inode — still wakes it: the identity noted at dispatch above, or a cleared or moved
acknowledged report before a dispatch. A changed file is read as above; a timeout with no new
file is the checkpoint above, one `pane read`, and a dialog it finds is reported with the rest
of the state.

A **detected** coordinator adds one wait the non-coordinator path does not need: a dialog
takes it to `blocked` and it writes no report while the dialog stands, so the doorbell
above would sleep to its timeout. Add one bounded wait beside it,
`herdr agent wait <pane> --until blocked --timeout <ms>`; that `blocked` wake is the dialog
above, handled as any `blocked` wake is, and it ends the doorbell.
The doorbell's return — a new report or its timeout — ends the companion, so a dispatch
leaves at most one armed wait. An answered dialog re-arms the pair: the fresh bounded wait
after the answer is the doorbell and its companion again, not one wait.

The worker's ping is its brief's line (`briefs.md`): after every report rename, one send, no
`--wait`, no retry, and only when the target is not the `none` sentinel — `herdr agent prompt
<NOTIFY_PANE> '<REPORT READY: <task id> <kind> <path>>'`: one single-quoted literal argument, so
`$` and backticks in the data stay literal (a single quote in it is written `'\''`), `<path>` the
file actually renamed over, and only a parent herdr detects on the worker's server is a target —
every other dispatch carries `none` and keeps the report-file wait and this session's heartbeat as
the whole of its push bound. A failed send changes nothing.

A ping is one way a report announces itself, beside a `Completion` wake and a heartbeat tick,
and the generation check governs all three: a new generation is read, noted, acted on once by
kind, and retires that dispatch's wait and companion; an already-consumed one is not read, not
acted on, retires nothing — a stale same-path ping never cancels the current phase's wait. A
live dialog and the tick's health check are reports of neither kind and still run. A ping whose
path is not this dispatch's `REPORT_PATH` is not delivered — nothing is opened, no other
dispatch is reached — and gets `briefs.md`'s correction request; an unmatched ping is reported.

**The heartbeat.** One bounded background timer of about 15 minutes per session holding any live
herdr-pane dispatch — a typed-wait seat included, not only a report-file wait; a dsh session,
which has no pane, keeps `dsh-driver.md`'s own route — re-armed per tick (herdr has no
scheduler), never a completion wait and never re-entering, restarting or extending one. Per tick,
per live dispatch: the generation check, then —
absent a new report — one health check, never a second (`herdr agent get` where herdr has a
record, else one `herdr pane read`; an errored read is unreadable, not crashed). Working stays
silent but for the tick's one line; blocked takes the dialog procedure above, its own
diagnostic read included; idle, done with no new report, `unknown` or an unreadable seat is
surfaced once per dispatch, not per tick, as observed state and uncertainty — never a failed
task, never a retry. Killed when the last dispatch settles, at teardown and at stand-down,
where the successor arms a fresh one.

## Placement

    workspace "run: <objective>"          one per run, closed last
      tab "seat: verifier (<agent>)"      one full-size pane
      workspace "seat: implementer (<agent>)" one per worktree a seat needs, named by
                                              step 2's `--label`; its tab is renamed
        tab "seat: implementer (<agent>)" one full-size pane

One tab per seat, one full-size pane per tab: **herdr-crew places a seat with `tab create`,
never `pane split`** — panes sharing a tab make a multi-agent screen unreadable — overriding
`herdr --skill`, whose "Start and coordinate an agent" defaults to a sibling split.

The orchestrator is not in that workspace: it stays in the pane the operator launched it
in, and herdr-crew does not move it, because a moved pane takes a new id.

A seat's tree is whatever `--cwd` names, so a seat may sit in another repository: in the
dual-repo case an orchestrator in the AI workspace places an implementer in the canonical
tree — for a worktree seat, step 2's `--cwd` is what makes that true. `--env` (on
`tab create` and `workspace create`) carries only a seat's own scratch, such as
`OSSIFY_SEAT`; a lane's provider variables are invoked by name through `command:`, never
replayed with `--env` — a replayed environment is the silent-reroute defect.

`--trust-repository` on `herdr worktree` grants herdr's per-request Git trust, not Claude
Code's folder-trust dialog; only for a repository the operator verified, never as a retry.

## Teardown

A seat in a tab of the run's workspace is released with `herdr pane close <pane>`; a
worktree seat never is: its workspace holds only its tab and pane, closing that pane may take
the workspace with it or be refused, and its id is the only selector of `herdr worktree remove
--workspace <id>`, its release once its branch's work is safe — the implementer's after
`lifecycle.md` step 12's merged-branch check, the reviewer's (it edits nothing) once its report
file validates (step 8). A refused remove goes to the operator, never `--force`, and it releases
only the worktree's own workspace: `herdr workspace list` still shows the **source repository's**
checkout step 2's `worktree create` opened, which the run did not create and the operator's to
close — in the dual-repo case the canonical checkout. The run's own workspace closes last,
`herdr workspace close <id>`, after every workspace linked to it.
Close only what the run created; read every receipt (a failed call is JSON on stderr, exit 1)
and confirm with `herdr workspace list`, never assume: a last pane's close may take its tab
and workspace too, and a target already gone is information, not failure.

## Machines

A seat runs on the orchestrator's own machine. The config contract declares no machine: a
seat goes elsewhere only when the operator names one, enabled in `herdr machine list`; a
machine that list does not show halts the run, never a guess. Every command for that seat
then carries `herdr --machine <label>`, with its ids discovered there: ids and agent names
are scoped to one server, and `--current` reaches no remote pane. Never consume a path from
a `--machine` reply; resolve the seat's paths on its own machine. Place a seat only on a
machine that stays up and whose filesystem the orchestrator can read: its report file is read
where it is written, so an unopenable `REPORT_PATH` never reports. A connection failure does
not prove a mutation was not applied, so inspect the remote state before retrying.
