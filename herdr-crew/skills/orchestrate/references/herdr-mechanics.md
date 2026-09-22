# herdr mechanics

## What this file is for

`herdr --skill` and the `--help` text it points to are the command reference. This file
states only what that guide cannot, how herdr-crew composes those commands into a seat;
role, retention and run decisions stay in `roles.md`, `lifecycle.md` and `config.md`.
Where it overrides the guide's default, it says so. Read each id from the JSON that made it.

## The seat launch

No single herdr call creates a seat, starts its command and delivers its brief, so a seat
is this sequence, in which `<seat label>` is `seat: <role> (<agent>)`:

1. **The run's workspace, once per run per server that hosts a seat.**
   `herdr workspace create --cwd <a path that already exists> --label "run: <objective>"
   --no-focus` — the first seat's tree, or a neutral path when that seat's worktree is still to
   be created (step 2), since a `--cwd` that does not exist yet fails the launch. Its tab and
   shell pane (`.result.tab`, `.result.root_pane`) are the first seat's when its tree is that
   path: `herdr tab rename <tab> "<seat label>"`, not a second tab beside an empty one. A
   seat on another machine needs its own, created with `--machine <label>`: ids are
   server-scoped.
2. **One tab per further seat.**
   `herdr tab create --workspace <id> --cwd <the seat's tree> --label "<seat label>" --no-focus`.
   Its pane is `.result.root_pane`. A seat that needs a new worktree uses `herdr worktree create`
   — `--cwd <the source repo> --path <the new tree> --branch <b> --base main --label "<seat
   label>" --no-focus` — in place of this step, never step 1: it opens **two** workspaces, the
   worktree's own and the **source repository's** checkout (`is_linked_worktree: false`). Its
   `--label` names the worktree's **workspace**, so the seat's tab needs the `herdr tab rename`
   step 1 prescribes. `--cwd` is the lever that retargets the **source** repo: without it the
   call resolves its source from the *calling workspace's* repo. Read every id from the
   response, `result.root_pane.pane_id` included.
3. **The seat's command.** `herdr pane run <pane> "<command:>"`, verbatim from the entry —
   re-running a **launch** command into a pane whose foreground process is already that
   agent's TUI delivers its line to the agent as a prompt, the mechanism the undetected
   seat's one-line pointer relies on, so a stray re-run costs a live seat a turn.
4. **Readiness**, on whichever of the two paths below the pane takes.
5. **The model.** `herdr pane read <pane>`, with `--source visible` (the rendered viewport)
   when `model_shows: screen`, must show `expected_model:`;
   `command not found` or another model is a failed launch (`roles.md`).
6. **Dispatch**, sent as below.

## The two readiness paths

herdr answers, live, which path a seat takes: does `herdr agent list` return a record for
the pane? That answer, never a config field, is the discriminator, so a detection manifest
landing later moves a seat to the typed path with no edit anywhere. Detection after `pane
run` is two events, measured: a record appears within about a second (0.6 s, still
`agent_status: unknown`, no session identity, the shell's pane title) and the seat reaches a
settled state (`idle`) at about four seconds (3.8–4.0 s). The first ask, once the record is
there, chooses only the **readiness wait** below; the **send's route** is decided by a second
ask of that same list, made once step 5's model read has shown `expected_model:` on the pane,
since the TUI is demonstrably up by then — and the **completion wait** follows that second
ask too, so the route that delivered the message is the one that can wake it. A pane absent
to that ask is undetected for the send.

**Detected** (a `claude-*` lane, `devin-*`, `pi`): the typed wait below. Detection is not
readiness: a fresh agent's first detected state may be `blocked` on a folder-trust dialog,
which `--dangerously-skip-permissions` does not skip, and it is handled as a `blocked` wake.

**Not detected** (`mcode-*`, which herdr has no detection manifest for):
`herdr pane wait-output <pane> --match '<expected_model:>' --timeout <ms>`, with
`--source visible` when `model_shows: screen`. Every resolved profile carries
`expected_model:` and `model_shows` says where on the pane it appears, so the string that
confirms the model also shows the TUI is up, and existing entries need no edit. Without
`--timeout` the wait has no bound. Caveat: it searches existing output before it polls, so
a seat whose own command line contains its model string matches at once, proving nothing —
wait on output the launch command cannot produce, or exclude the echoed command before
declaring readiness.

## The typed wait

Every `herdr agent wait` herdr-crew issues names the same three settled states, except one
companion wait a detected coordinator needs, which selects `blocked` alone (Completion):

    herdr agent wait <pane> --until done --until idle --until blocked --timeout <ms>

The set is stated here; `roles.md` and `lifecycle.md` step 5 carry the same command.
It is herdr's default set (no `--until` matches any of them), written out, not inherited;
`--until` narrows: without `blocked`, a wait sleeps through a dialog to its timeout, and
only `idle`, `done` and `blocked` are proved settled — `done` does fire for a Claude Code
pane, as `idle` does. `--timeout` bounds it; a timeout is the checkpoint Completion states.

**Every readiness and completion wait runs in the background:** one shell call the host
wakes the session on when it exits (Claude Code: the Bash tool's `run_in_background`), so
it spends no tokens and its `--timeout` can be hours. It still returns once and re-enters
nothing; a round's N items are N such waits, one per pane. A host with no background call
waits in the foreground, `<ms>` inside its cap on one call (Claude Code: 120000 ms default,
600000 max), the call's own timeout covering it: a cut-off wait is neither wake nor timeout.

**A `blocked` wake** means herdr recognised an approval or question dialog. A blocked
agent rejects `herdr agent prompt` with `agent_blocked`, sending nothing, so read the dialog
with `herdr pane read <pane>`, put it to the operator (herdr's guide says to ask first),
give the answer with `herdr agent send-keys <pane> <keys>`, then one fresh bounded wait. A
question written to the report file is not a dialog; it rings that doorbell (Completion).

## Sending a seat a message

This is the one statement of how the orchestrator sends a seat anything (a brief, a fix
task, an answer, a plan approval, a correction); other files say "send" and mean this.

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
observation, so the call stays a dispatch and the completion wait the one long wait. Its
timeout counts from before submission, so it is a few seconds above the five-second gate.

- `agent_prompt_stalled`: no activity was observed within five seconds of submission.
  `herdr agent get <pane>` gives the state. `working`: it started. `blocked`: a `blocked`
  wake. `idle` or `done`: `herdr pane send-keys <pane> enter` submits what sits in the
  composer (`enter` is the submitting key; herdr's help names only `esc`). `unknown`:
  report it to the operator. Never send the prompt again, because a
  stall does not prove the text was not delivered; read a `timeout` the same way.
- `agent_blocked` (nothing was sent) and `blocked` (the turn opened on one) are both a
  `blocked` wake; a cleared `agent_blocked` re-sends the brief with the turn-start check.

## Completion

A seat's result is its report file, at the `REPORT_PATH=` its brief names. Every file the
run keeps is placed outside every seat's worktree, so removing a worktree never takes one.
`done` carries no body, so the file is the contract and the typed state is only the
doorbell. The worker writes everything it says to the orchestrator there (a plan, a
question, an escalation, a late finding, its report) and replaces the file whole
(`briefs.md`); before every message that sends a seat to work, note its hash
(`git hash-object <path>`), empty if absent.

For a detected seat that is not a coordinator (below), the wake is the typed wait above:

- `idle` or `done`, and the file is new (absent at dispatch, or a different hash): read
  it. A plan, a question or a late finding is answered with the seat's next message and
  one fresh bounded wait; an escalation goes to the operator.
- `idle` or `done`, and nothing new: the false wake below, one `herdr pane read`.
- `blocked`: a dialog, handled as above. A timeout: the checkpoint below.

**The two dead ends.** *A timeout is a checkpoint*: one `herdr pane read`, on any wait. The
turn ends with the seat's observed state — stopped, at a dialog, or still at work —
reported to the operator (a coordinator: to the top, in its report file); a further wait on
it is the operator's decision, never the orchestrator's own re-entry. *A false wake* — its
own `pane read` showing a seat still at work (the backgrounded-shell case) — is not a
timeout: the doorbell becomes the report file for the rest of that dispatch, one bounded
background wait, as a coordinator is waited on — never a second typed wait.

**An undetected seat's doorbell is the report file itself**, and so is a coordinator's: a
seat running work of its own in the background (a spine or work-PR session's waits, a lane
driver's subagents) reads `idle` or `done` before its report exists, so a typed wait on it
wakes too soon. The doorbell is one bounded background wait that returns when
`REPORT_PATH`'s hash differs from the one last noted, or at its timeout, polling inside
itself as `pane wait-output` does — not the loop of waits `lifecycle.md` forbids. A **hash
difference** is what wakes it, so a byte-identical replacement (a retained verifier
repeating the same failure, a blocker restated after a clarification) never does: note the
file's identity — inode or mtime — beside the hash, or clear or move the acknowledged
report before a dispatch. A changed file is read as above; a timeout with no new file is
the checkpoint above, read the same one `pane read`, and a dialog it finds is reported with
the rest of the state.

A **detected** coordinator adds one wait the non-coordinator path does not need: a dialog
takes it to `blocked` and it writes no report while the dialog stands, so the doorbell
above would sleep to its timeout. Add one bounded wait beside it,
`herdr agent wait <pane> --until blocked --timeout <ms>`; that `blocked` wake is the dialog
above, handled as any `blocked` wake is.

## Placement

    workspace "run: <objective>"          one per run, closed last
      tab "seat: verifier (<agent>)"      one full-size pane
      workspace "seat: implementer (<agent>)" one per worktree a seat needs, named by
                                              step 2's `--label`; its tab is renamed
        tab "seat: implementer (<agent>)" one full-size pane

One tab per seat and one full-size pane per tab: **herdr-crew places a seat with
`tab create`, never `pane split`**, because panes sharing a tab make a multi-agent screen
unreadable. This overrides `herdr --skill`, whose "Start and coordinate an agent" defaults
to a sibling pane split in the current tab; a seat reading that guide does not split.

The orchestrator is not in that workspace: it stays in the pane the operator launched it
in, and herdr-crew does not move it, because a moved pane takes a new id.

A seat's tree is whatever `--cwd` names, so a seat may sit in another repository: in the
dual-repo case an orchestrator in the AI workspace places an implementer in the canonical
tree — for a worktree seat, step 2's `--cwd` is what makes that true. `--env` (on
`tab create` and `workspace create`) carries only a seat's own scratch, such as
`OSSIFY_SEAT`. A lane's provider variables are invoked by name through `command:`, never
replayed with `--env`: a replayed environment is the silent-reroute defect.

`--trust-repository` on `herdr worktree` grants herdr's per-request Git trust, not Claude
Code's folder-trust dialog; only for a repository the operator verified, never as a retry.

## Teardown

A seat in a tab of the run's workspace is released with `herdr pane close <pane>`. A
worktree seat never is: its workspace holds only its tab and pane, closing that pane may
take the workspace with it or be refused, and that workspace's id is the only selector of
`herdr worktree remove --workspace <id>`, which is its release once its branch's work is
safe: the implementer's after `lifecycle.md` step 12's merged-branch check, the reviewer's
(it edits nothing) once its report file validates (step 8). A refused remove goes to the
operator, never past it with `--force` — and it releases only the worktree's own workspace:
`herdr workspace list` still shows the **source repository's** checkout that step 2's
`worktree create` opened, which the run did not create and the operator's to close — in the
dual-repo case the canonical checkout, the repo step 2's `--cwd` names. The run's own
workspace closes last, `herdr workspace close <id>`, after every workspace linked to it.
Close only what the run created, read every receipt (a failed call is JSON on stderr, exit
status 1), and confirm with `herdr workspace list`, never assume: a last pane's close may
take its tab and workspace too, and a close that finds its target already gone is
information, not failure.

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
