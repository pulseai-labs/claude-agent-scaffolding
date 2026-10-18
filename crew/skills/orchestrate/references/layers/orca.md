# orca — the layer

`orca skills get orca-cli` and the `--help` text it points to are the command reference.
This file states only what that guide cannot, how crew composes those commands into a seat;
role, retention and run decisions stay in `roles.md`, `lifecycle.md`, `config.md` and
`completion.md`. Where it overrides the guide's default, it says so. Read each id from the
JSON that made it. Every layer file implements the same named steps; the shared files name
them, hold the rules and never carry a command, and this is the file
`references/layers/<layer>.md` resolves to on `layer: orca`.

## Health

`orca status --json` answers whether the app and its runtime are up; its runtime id is the
incarnation `Identity` records. Failing, it is a refused run (`SKILL.md` §7). The heartbeat's
per-tick read is `orca terminal show --terminal <h> --json`; an errored read is unreadable,
not crashed (`completion.md`).

## Identity

A seat's own address is `ORCA_TERMINAL_HANDLE`, the create receipt's
`.result.terminal.handle`; the run file records it with `ORCA_WORKTREE_ID` and
`ORCA_RUNTIME_SOURCE_INCARNATION` so a resume can tell a handle is stale: on an incarnation
mismatch the seat is lost — relaunch or rebind it from its report file and branch, never
from a `terminal list` match. `terminal show` also answers the stand-down read, and carries
no agent session id for the shell receipt it was probed with — said no wider; a seat's
session id comes from the agent itself, and with none returned, none is written. A command
against a handle the runtime no longer holds fails `terminal_handle_stale`. Trap: `--title`
does not stick for a shell — a seat label is never read back from the title; record the
handle.

## Run workspace

Orca has no workspace above the worktree: seats hang off worktrees (`Seat worktree`). The
run's state where the app shows it: `orca worktree set --worktree <sel> --comment "run:
<objective>" --workspace-status in-progress`. `orca worktree list` covers every host it can
reach and marks hosts under `not covered` — an empty answer from one is no evidence it
holds none. Teardown reads `terminal list --worktree <sel>`.

## Seat worktree

A new tree: `orca worktree create --repo id:<repo-id> --name <name> --base-branch <b>
--no-parent --setup skip --json` → `.result.worktree.id` = `<repoId>::<path>`, the path
under `~/orca/workspaces/<repo>/<name>` (not the repo's `.worktrees/`), branch
`refs/heads/<github-user>/<name>`. Selectors `id:<…>` / `path:<dir>` / `name:<…>`; `path:`
is what avoids `terminal_worktree_mismatch` when a call addresses a tree other than the
caller's — the name comes from the design spec and was not probed. `worktree create` also
opens a default shell terminal no probe made; `Teardown` closes it with the worktree-wide
close.

## Seat launch

The sequence, not one call: `orca terminal create --worktree <sel> --title "seat: <role>
(<agent>)" --command '<export …>; <lane>' --json`, then read the handle from the receipt
(`Identity`). The export is `roles.md`'s launch environment, typed before the lane:
`export SEAT_MODS_ROLE=<role> SEAT_MODS_ALLOW=<report dir>:<scratch> MOLT_HANDOFF=parent MOLT_STATUS_PATH=<REPORT_PATH>.molt-status AUTONOMIC_LEDGER=<ledger> AUTONOMIC_PAIN_PATH=<REPORT_PATH>.autonomic-pain; <lane>`
The lane is a shell **function**, and Orca types `--command` into the terminal's interactive
shell, so it resolves; `exec <lane>` fails and leaves a shell. The model read: the rendered
screen where `model_shows: screen` must show `expected_model:`, and the same read carries
the status line `seat: <role>` (`roles.md`).

## Readiness

A fresh seat is up when `Wait`'s wait satisfies, asked with a timeout; on the probed lane it
satisfied only with the TUI up (0.62 s), and slower lanes were not measured. No send before
this wait: a brief typed during TUI start-up is lost. An unsatisfied wait alone does not say
why — a missing process, a slow launch, or an interactive blocker; one screen read tells
them apart, and only a missing process is a failed launch. `satisfied: false` with a
`blockedReason` is a latched dialog — the blocked wake.

## Send

PING_SEND=orca terminal send --terminal <that terminal> --enter --text

This is the one statement of how the orchestrator sends a seat anything; the slot a brief's
`PING:` and `MOLT:` lines carry, filled by the dispatcher. **Probed on one host only** — a
seat-on-another-host ping to the top was not probed; what was tested across hosts is the
top's own wait and read on the remote seat (`Machines`). Turn-start proof:
`--wait-submit <s>` → `turn_started` in `prompt.stages`; a timeout returns the queued
receipt and never resends, and an ambiguous transport failure is reissued with
`--retry-request <id>`, never the text resent. A stalled or timed-out send is never sent
again (`roles.md`) — read the state it left. A local slash command settles without a turn:
sent without the turn-start proof, its reply read with the screen read.

## Read

`orca terminal read --terminal <h> --screen --json` → `.result.terminal.tail[]`, with
`source`, `oldestCursor`/`nextCursor`/`latestCursor`/`limited`. The default read is the
accumulated stream — repainted lines stack as fragments — and the rendered read is the
screen frame; the two are mutually exclusive. A receipt's JSON can hold raw newlines: never
chain `jq` with `&&` blindly — a parse failure silently drops every later step. No read is
licensed by the layer; the shared files say which reads a turn may spend.

## Wait

One settled state, `tui-idle`, and it marks the end of a turn, not of the work — the seat
backgrounded its work and ended the turn (the wait woke 35.6 s early). One wait:
`orca terminal wait --terminal <h> --for tui-idle --timeout-ms <ms> --json`; run that wait
as a background job so the host wakes the session on exit (`completion.md`). A timeout is
the checkpoint `completion.md` states; `satisfied: false` with a `blockedReason` is the
dialog; a satisfied wait with no new report is the false wake. A coordinator's doorbell is
its report file (`completion.md`); the companion beside it is this same wait — the dialog
arrives as its `satisfied: false` — and any other return of that companion is no dialog.

## Completion signal

`tui-idle` is this layer's typed state; the report file is the contract and the doorbell's
rules are `completion.md`'s. The health read is `terminal show` (`Health`); a seat the
runtime no longer holds is read through its report file.

## Teardown

A run-owned disposable worktree: `orca terminal close --worktree <sel> --all` — closes every
terminal that worktree owns, the default tab `worktree create` opened included; a per-handle
close would leave it — then `orca worktree rm --worktree <sel>`, and confirm with
`orca terminal list --worktree <sel>`. `worktree rm` also attempts the local branch delete,
retaining branches it cannot prove merged. An existing or shared checkout: per seat handle
only — `orca terminal close --terminal <h>`, never `--all` there. A refused remove goes to
the operator (`roles.md`).

## Machines

`orca host list` names what this host can target and what to pass; every call for a seat on
another machine carries `--environment <name>` — its handles belong to it. `--host` means
`ssh:<id>` or `runtime:<env-id>`: a different kind of target, and the common way to get an
empty answer is passing one where the other belongs. On a host crew does not control: create
the terminal with no `--command`, read until the shell prompt shows, clear any start-up
prompt (`n` + Enter on the Mac's zsh update question), then send the seat command and verify
the agent and its environment — Orca injects `--command` at create, so no post-create wait
protects it.

## Host: OMP

An OMP top runs this skill as written, with the substitutions stated once with the skill
(`SKILL.md` §3): the send-as-text mapping, the hooks note, the `Agent` ban and the
enrolled-authority envelope. This layer adds its own: omp's bash async job
(`async.enabled`, on by default) — pass `timeout: 0` on every one and never `name:` — so
`--timeout-ms` bounds the wait; its result returns to the session as a turn, so every
readiness and completion wait runs as one.
