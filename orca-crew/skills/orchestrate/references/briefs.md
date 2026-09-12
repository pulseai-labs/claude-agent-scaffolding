# Briefs

A brief is the whole contract the worker will ever see. The worker has no orchestration
context, may be launched where the project's rules do not load, and receives Orca's
injected preamble plus this text and nothing else. Every brief carries, in this order:

1. Role, and "state your model in your first reply".
2. Placement: absolute worktree path, branch, base branch.
3. The task, plus any project rule the worker's location will not load, pasted verbatim.
4. The `worker_done` body shape, and the forbidden actions for the role.
5. `ask` for a blocking question, `escalation` when stuck. A policy refusal is reported,
   never retried around.
6. Planned implementer only: the plan gate.

Angle brackets are slots. Fill every slot; delete nothing else.

**An activated ossify spine has four briefs of its own** — spine session, item
implementer, item verifier, and the correction message — in
`references/ossify-briefs.md`. They do not replace the five below, which still govern
every other dispatch; the item verifier there reuses this file's verifier CLAIMS body
verbatim rather than restating it.

## Planned implementer (`claude-glm`)

```text
ROLE: implementer. State the model you are running in your first reply, then continue.

PLACEMENT: worktree <abs-path>, branch <branch>, base <base-branch>. Use git -C for every
git command; cd does not persist.

TASK: <objective in two or three sentences, with the acceptance criteria and the test
command that proves them>.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

PLAN GATE: before your first edit, send your plan with `orca orchestration ask` (files to
touch, order, tests first) and wait for the reply. Implement only what the reply approves.

DONE: commit on <branch> with messages written to a file and `git commit -F`; push;
open the PR from the worktree with `gh pr create --repo <owner/repo> --base
<base-branch> --head <branch>`. Then send worker_done with this body:
  Changed: <what, in prose>
  Evidence: <each test command and its result, verbatim>
  PR: <number and head SHA>
  Open: <anything unfinished or uncertain>
  Files: <paths>

NEVER: merge, delete a branch, force-push, edit files outside the worktree, or run any
subagent. Ask with `orca orchestration ask` when blocked; send `escalation` when stuck.
If a tool or policy refuses you, report it verbatim and stop that step.
```

## Fast implementer (`claude-glm-flash`)

```text
ROLE: implementer. State the model you are running in your first reply, then continue.

PLACEMENT: worktree <abs-path>, branch <branch>, base <base-branch>. Use git -C for every
git command; cd does not persist.

TASK: <one bounded change, with the exact test command that proves it>.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: commit with a message written to a file and `git commit -F`; push; <open the PR
from the worktree with `gh pr create --repo <owner/repo> --base <base-branch> --head
<branch> | push to the existing PR>. Then send worker_done with this body:
  Changed / Evidence / PR / Open / Files, as in the planned brief.

NEVER: merge, delete a branch, force-push, edit files outside the worktree, or run any
subagent. Ask when blocked; escalate when stuck; report refusals verbatim.
```

## Reviewer (`claude-glm-flash`)

```text
ROLE: reviewer. State the model you are running in your first reply, then continue.

PLACEMENT: worktree <abs-path> checked out at PR <number>'s head <sha>.

TASK: run `/code-review <number> <level>` — the level the orchestrator decided, not
one you pick; outside an activated ossify spine the level is `medium` unless the
orchestrator names another. Your first reply must state the model you are running; it is expected to
be <expected-model>, and a mismatch is a failed launch to report, not to work around.
Let the review finish, then send worker_done with
`Findings: none` on a clean review, else every finding in this body, one per line:
  <file>:<line> | P0|P1|P2|P3 | <claim in one sentence>
followed by:
  Reviewed head: <sha>
  Summary: <two sentences>

NEVER: edit any file, post anything to GitHub, or run a second review. Your findings
travel only in worker_done. If `/code-review` refuses or errors, report its output
verbatim and stop. Use `ask` for a blocking question and `escalation` when stuck.
```

## Verifier (`claude-glm` at high)

```text
ROLE: verifier, read-only. State the model you are running in your first reply, then
continue.

PLACEMENT: <worktree abs-path or repo path>, at <ref or sha>.

CLAIMS:, a numbered list the orchestrator fills from the work item's spec:
  1. <acceptance criterion or requirement>: <how to check>
  2. The diff matches the requirement: read the requirement, then the diff.
  3. When the item adds or changes a test: that test fails when the item's implementation
     edits, not the test, are reverted in a disposable worktree; when no test is added or
     changed, delete this claim (never `cannot determine`).

DONE: send worker_done with one report, one line per claim, then the caveats:
  1. <claim>: pass | fail | cannot determine — <evidence, commands and output verbatim>
  `Cannot determine` counts as fail; the suite on the head is not a claim (its
  check-runs were read before dispatch). Caveats: <what the check could not see>

NEVER: commit or push, or edit a tracked file outside the mutation check. That check
may temporarily edit one — in the disposable worktree, reverted before the report.
Scratch output is fine — write it, never commit it — and run in a disposable
worktree. Any other write: stop and escalate instead.
```

## Fix-round brief (retained implementer, after disposition)

Attach it to the same terminal with `worker-start --task <next_task_id> --terminal
<handle>` so Orca transfers the task's ownership with the terminal. The body is the
fast-implementer brief with this TASK:

```text
TASK: work PR <number> to zero unresolved review threads. Inputs, in priority order:
  1. Disposition: <list>. Fix every item on it as dispositioned; defer or reject
     nothing on it yourself.
  2. Every unresolved GitHub review thread on the PR, including bot reviews that arrive
     after each push. Count them with GraphQL reviewThreads, not the REST list.
  3. Review bodies and top-level PR conversation comments — reviewThreads does not
     return them — re-fetched after each push.
Fix a class in one commit, not one comment at a time. Push after each class. Resolve
threads only after the fix is on the head the reviewer can see. Every thread ends
fixed, deferred with a comment linking the tracked issue, or rejected with the
evidence; P0 and P1 are never deferred.
<With ossify installed replace this TASK with: run `/ossify:work-pr <number>
--repo-root <worktree holding the PR branch>`; the disposition above is a third finding
signal; stop at work-pr's merge ask and put its ledger in worker_done —
except inside a work-PR session, whose fix seat works the fix list only
and would otherwise open a second merge loop inside the one that briefed it.>
```

A finding that arrives after the disposition is not on that list: return it through
the blocking `orca orchestration ask` and wait, resolving only on the orchestrator's
reply; outside the TASK block so the ossify replacement keeps it.

## Correction request (one `send`, no new session)

A malformed, incomplete, or wrongly-shaped report from a live session is corrected in
place, never by a new session: one `send` to that session, nothing else.

```text
Your worker_done for <task-id> is malformed or incomplete: <the missing or wrong
field, and what is wrong with it>. Send the exact shape wanted: <the field, restated
from your brief>. No other work; return the corrected body via `orca orchestration ask`.
```

If one `send` does not fix the report, that is an `escalation`.
