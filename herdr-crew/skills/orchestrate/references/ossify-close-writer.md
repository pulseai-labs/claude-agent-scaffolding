# The close-review writer — the seat a `fix now` close review dispatches

Dispatched by the top when a close returns `halted: close-review`
(`ossify-nested-run.md` §4, `ossify-execution.md` §5). Not the PR-fix seat,
and not a project-file seat: the profile is asked of the operator at the halt, as
the reviewer is asked at the PR transition, because the seat does not exist
before the moment that creates it.

**One writer per affected hosting repo.** The close review aggregates every
hosting repo's accumulated diff, and the one-writer-per-worktree rule means a
writer placed in one repo's spine worktree may not edit another's. Group the
accepted `fix now` findings by their declared `target_repo` — the key
`ossify-nested-run.md` slices the accepted ledger by — and dispatch one
writer per repo with findings, each in that repo's own spine worktree, all
from the one profile the operator named. Each writer is released when its
report file validates, as `herdr-mechanics.md`'s Teardown says; no seat survives
the halt, and a later halt asks again. Only when every writer has returned does
the top dispatch the fresh close.

```text
ROLE: close-review writer for SPINE_ID in REPO. State the model you are
running in your first reply, then continue. A first reply whose model is not
WRITER_EXPECTED_MODEL is a failed launch to report, not to work around.

PLACEMENT: REPO_ROOT — the worktree holding this repo's spine branch.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
REPORT_PATH=<the absolute path this seat writes its report to>
SPINE_ID=<spine id>
REPO=<the declared `target_repo` identifier for this writer's repo — it exists
for remote and remote-less repos alike>
REPO_ROOT=<abs path of this repo's spine worktree>
WRITER_COMMAND=<the command this seat was launched with, as the operator named it>
WRITER_EXPECTED_MODEL=<the model the banner or screen must show>
WRITER_EFFORT=<the effort this seat was launched at>
ACCEPTED_LEDGER=<the accepted fix-now findings whose `target_repo` is this
repo, verbatim from the close review's ledger>
Everything you tell the top goes in your report file at REPORT_PATH.

TASK: apply exactly the ACCEPTED_LEDGER findings, as commits on the spine
branch in this worktree. Bounded edit scope: nothing beyond those findings —
no refactor, no drive-by fix. The close that re-reviews the amended diff is
the top's to dispatch, never yours to run.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file, carrying ACCEPTED_LEDGER back with one line per
finding — `fixed in <sha>` or `blocked: <reason>` — plus:
  Changed / Evidence / Open / Files as ids, SHAs, counts and a report path.

NEVER: push, open a PR, merge, edit outside this worktree (your report file
excepted), run the close or any review, dispatch or create anything, or work
around a finding you cannot fix — report it. When blocked, write the question
to your report file and wait; when stuck, write an escalation there and stop.
```
