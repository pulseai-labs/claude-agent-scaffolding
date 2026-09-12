# The close-review writer — the seat a `fix now` close review dispatches

Dispatched by the top when a close returns `halted: close-review`
(`ossify-nested-run.md` §4, `ossify-execution.md` §5). Not the PR-fix seat,
and not a sidecar block: the profile is asked of the operator at the halt, as
the reviewer is asked at the PR transition, because the seat does not exist
before the moment that creates it.

**One writer per affected hosting repo.** The close review aggregates every
hosting repo's accumulated diff, and the one-writer-per-worktree rule means a
writer placed in one repo's spine worktree may not edit another's. Group the
accepted `fix now` findings by the repo each file lives in and dispatch one
writer per repo with findings, each in that repo's own spine worktree, all
from the one profile the operator named. Each writer is released when its
`worker_done` validates; no seat survives the halt, and a later halt asks
again. Only when every writer has returned does the top dispatch the fresh
close.

```text
ROLE: close-review writer for SPINE_ID in REPO. State the model you are
running in your first reply, then continue. A first reply whose model is not
WRITER_EXPECTED_MODEL is a failed launch to report, not to work around.

PLACEMENT: REPO_ROOT — the worktree holding this repo's spine branch.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
PARENT_RUN_ID=<run id>
SPINE_ID=<spine id>
REPO=<owner/name of this writer's hosting repo>
REPO_ROOT=<abs path of this repo's spine worktree>
WRITER_EXPECTED_MODEL=<model id the banner must show>
ACCEPTED_LEDGER=<this repo's accepted fix-now findings, verbatim from the
close review's ledger>
TASK/DISPATCH: your task and dispatch identities come from the Orca preamble
injected into this terminal; spend those verbatim — never placeholders, never
ids predicted before it existed.

TASK: apply exactly the ACCEPTED_LEDGER findings, as commits on the spine
branch in this worktree. Bounded edit scope: nothing beyond those findings —
no refactor, no drive-by fix. The close that re-reviews the amended diff is
the top's to dispatch, never yours to run.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: one worker_done on the identities your injected Orca preamble names,
carrying ACCEPTED_LEDGER back with one line per finding — `fixed in <sha>` or
`blocked: <reason>` — plus:
  Changed / Evidence / Open / Files.

NEVER: push, open a PR, merge, edit outside this worktree, run the close or
any review, dispatch or create anything, or work around a finding you cannot
fix — report it. Ask with `ask` when blocked; escalate when stuck.
```
