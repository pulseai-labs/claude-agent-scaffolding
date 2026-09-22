# Briefs

A brief is the whole contract the worker will ever see. The worker has no orchestration
context, may be launched where the project's rules do not load, and herdr delivers this
text verbatim (`herdr-mechanics.md`) — no preamble, nothing prepended, nothing else.
Every brief carries, in this order:

1. Role, and "state your model in your first reply".
2. Placement: the absolute path the seat sits in — a worktree or a repo path — and, where
   relevant, the ref or SHA it sits at; the worktree templates carry branch and base
   besides.
3. The task, plus any project rule the worker's location will not load, pasted verbatim.
4. The report file's shape — a temp file in the same directory renamed over the path,
   never in pieces — and the forbidden actions for the role.
5. Where the worker speaks: a blocking question is written to the report file, then it
   waits; an escalation is written there, then it stops. A policy refusal is reported,
   never retried around.
6. Planned implementer only: the plan gate.

Angle brackets are slots. Fill every slot; delete nothing else. The `SEAT_` lines are
the operator's approved seat, copied into the brief at launch; a worker that finds its
model is not `SEAT_EXPECTED_MODEL` reports a failed launch and stops.

The report file is replaced whole, never appended to in pieces: the orchestrator's
doorbell is that file's hash (`herdr-mechanics.md`), and it reads a change as a finished
report. Write the new content to a temp file in the same directory, then rename it over
the path: the rename is the atomic step, and opening the path is not — it truncates the
file before the content lands, and the doorbell can fire on that truncation and parse
half a report. No tool here documents an atomic rename, so the requirement is the
writer's, not the tool's. A plan, a question and a final report all replace the file the
same way.

## A template is a whole contract

**A template is a whole contract.** Every brief template this plugin ships is complete
on its own: no template is defined as "take template X and replace lines Y and Z", and
no template's required content is defined only by reference to another file. Where a
coordinator constructs a child brief, the dispatch it receives carries the child
template it will construct, verbatim.

The rule's operative form is the dispatch matrix:

| Coordinator | Child briefs it constructs | Its dispatch must carry, verbatim |
|---|---|---|
| Spine session (activated) | item implementer, item verifier, correction | `ossify-briefs.md`'s three item bodies, and any body they instantiate |
| Work-PR session | reviewer, PR-fix (fix round), correction | `briefs.md`'s reviewer, fix-round and correction bodies |
| Lane driver (default `run-spine`) | none — its helpers are ossify's subagents | nothing beyond its own brief and `REPORT_PATH` |
| Close session, Doctor session | none | nothing beyond their own brief and `REPORT_PATH` |

Nine dispatched templates live in this file: the generic five — planned implementer,
fast implementer, reviewer, verifier, fix round — and the four dedicated dispatch
templates the ossify dispatches use: lane driver, doctor dispatch, direct work-item,
non-spine close. The correction-request template is a send, not a session, so it carries
no seat.

**An activated ossify spine has four briefs of its own** — spine session, item
implementer, item verifier, and the correction message — in
`references/ossify-briefs.md`. They do not replace the nine here, which still govern
every other dispatch; the item verifier's CLAIMS is this file's verifier CLAIMS body,
filled into its brief by the coordinator, and `ossify-briefs.md` does not restate it.

## Planned implementer

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: implementer. State the model you are running in your first reply, then continue.

PLACEMENT: worktree <abs-path>, branch <branch>, base <base-branch>. Use git -C for every
git command; cd does not persist.

TASK: <objective in two or three sentences, with the acceptance criteria and the test
command that proves them>.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

PLAN GATE: before your first edit, write your plan (files to touch, order, tests first)
to your report file at REPORT_PATH, then wait. Implement only what the orchestrator's
reply approves.

DONE: commit on <branch> with messages written to a file and `git commit -F`; push;
open the PR from the worktree with `gh pr create --repo <owner/repo> --base
<base-branch> --head <branch>`. Then write your report file with this body:
  Changed: <commit SHAs and the count of files touched>
  Evidence: <each test command with its pass and fail counts; full output in the report>
  PR: <number and head SHA>
  Open: <issue or finding ids, one per line>
  Files: <paths touched, plus any separate file holding longer narrative>

NEVER: merge, delete a branch, force-push, edit files outside the worktree, or run any
subagent — your report file at REPORT_PATH is the one exception outside it, as the ossify
briefs say. When blocked, write the question to your report file and wait; when stuck,
write an escalation there and stop.
If a tool or policy refuses you, report it verbatim and stop that step.
```

## Fast implementer

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: implementer. State the model you are running in your first reply, then continue.

PLACEMENT: worktree <abs-path>, branch <branch>, base <base-branch>. Use git -C for every
git command; cd does not persist.

TASK: <one bounded change, with the exact test command that proves it>.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: commit with a message written to a file and `git commit -F`; push; <open the PR
from the worktree with `gh pr create --repo <owner/repo> --base <base-branch> --head
<branch> | push to the existing PR>. Then write your report file with this body:
  Changed / Evidence / PR / Open / Files as ids, SHAs, counts and a report path.

NEVER: merge, delete a branch, force-push, edit files outside the worktree, or run any
subagent — your report file at REPORT_PATH is the one exception outside it. When blocked,
write the question to your report file and wait; when stuck, write an escalation there and
stop; report refusals verbatim.
```

## Reviewer

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: reviewer. State the model you are running in your first reply, then continue.

PLACEMENT: worktree <abs-path> checked out at PR <number>'s head <sha>.

TASK: run `/code-review <number> <level>` — the level the orchestrator decided, not
one you pick; outside an activated ossify spine the level is `medium` unless the
orchestrator names another. Your first reply must state the model you are running; it is expected to
be SEAT_EXPECTED_MODEL, and a mismatch is a failed launch to report, not to work around.
Let the review finish, then write your report file carrying, in this order:
`Findings: none` on a clean review, or else every finding in this body, one per line
  <file>:<line> | P0|P1|P2|P3 | <claim in one sentence>
then, in either case:
  Reviewed head: <sha>
  Summary: <two sentences>
The head line is not optional on a clean review: nothing ties a verdict to a SHA
without it.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

NEVER: edit any file other than your report file, post anything to GitHub, or run a second
review. Your findings
travel only in your report file. If `/code-review` refuses or errors, report its output
verbatim and stop. A blocking question goes in your report file, then wait; an
escalation goes there too, then stop.
```

## Verifier (read-only)

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: verifier, read-only. State the model you are running in your first reply, then
continue.

PLACEMENT: <worktree abs-path or repo path>, at <ref or sha>.

CLAIMS:, a numbered list the orchestrator fills from the work item's spec:
  1. <acceptance criterion or requirement>: <how to check>
  2. The diff matches the requirement: read the requirement, then the diff.
  3. When the item adds or changes a test: that test fails when the item's implementation
     edits, not the test, are reverted in a disposable worktree; when no test is added or
     changed, delete this claim (never `cannot determine`).

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file, one line per claim, then the caveats:
  1. <claim>: pass | fail | cannot determine — <evidence, commands and output verbatim>
  `Cannot determine` counts as fail; the suite on the head is not a claim (its
  check-runs were read before dispatch). Caveats: <what the check could not see>

NEVER: commit or push, or edit a tracked file outside the mutation check. That check
may temporarily edit one — in the disposable worktree, reverted before the report.
Scratch output is fine — write it, never commit it — and run in a disposable
worktree. Any other write: stop, and write an escalation to your report file instead.
```

## Fix round (retained implementer, after disposition)

Attach it to the same pane by sending it this brief (`herdr-mechanics.md` says how) —
there is no attach or ownership-transfer call; the same session simply receives its
next brief. It carries its own seat lines, TASK, completion body and NEVER line, and no
part of it is rebuilt from another template's.

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: implementer, fix round. State the model you are running in your first reply, then
continue.

PLACEMENT: worktree <abs-path>, branch <branch>, base <base-branch>. Use git -C for every
git command; cd does not persist.

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
signal; stop at work-pr's merge ask and put its ledger in your report file —
except inside a work-PR session, whose fix seat works the fix list only
and would otherwise open a second merge loop inside the one that briefed it.>
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

A finding that arrives after the disposition is not on that list: write it to your
report file and wait, resolving it only once the orchestrator's answer arrives.

DONE: commit with a message written to a file and `git commit -F`; push to the PR's
branch. Then write your report file with this body:
  Changed / Evidence / PR / Open / Files as ids, SHAs, counts and a report path.

NEVER: merge, delete a branch, force-push, edit files outside the worktree, or run any
subagent — your report file at REPORT_PATH is the one exception outside it. When blocked,
write the question to your report file and wait; when stuck, write an escalation there and
stop; report refusals verbatim.
```

That last rule sits after the TASK block, so the ossify replacement and a work-PR
session's fix brief both keep it: the one clause a coordinator removes is the
replacement, never the paragraph.

## Lane driver (the default `run-spine` lane)

Dispatched to one session, which is ossify's orchestrator for that spine rather than an
implementer: its `ROLE` line is the lane driver's. It carries no `RUN_JSON` and no
`MECHANICS` identity — those belong to the activated spine brief — and orders no teardown
of item pairs: the default lane creates none.

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: lane driver for ossify spine <spine id> — ossify's orchestrator for that spine, not an
implementer. State the model you are running in your first reply, then continue.

PLACEMENT: <the tree the lane runs from — abs path>.

TASK: dispatch `/ossify:run-spine <spine id>` and let it drive. You hold the state lock,
commit at each close, and merge at the barrier; the round's items are not yours to
implement.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file with this body:
  Spine: <spine id>
  Rounds: <each round's items and their state — closed | active | halted>
  Barrier: <the barrier's result>
  Merged: <the SHAs you merged, one per line>

NEVER: run a second review — ossify's own gates are the lane's review; edit ossify's
contract or any other plugin; work an item yourself. Running this lane's subagents and
merging at the barrier are this seat's job, not forbidden ones. When blocked, write the
question to your report file and wait; when stuck, write an escalation there and stop;
report refusals verbatim.
```

## Doctor dispatch

One dispatch, one session. The operator's `/ossify:doctor` surface arguments ride in the
TASK verbatim. What the dispatch may write is ossify's contract, and this file does not
adjudicate it: the brief states only what the seat returns.

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: doctor session. State the model you are running in your first reply, then continue.

PLACEMENT: <the tree the dispatch runs from — abs path>.

TASK: <the operator's dispatch verbatim, its surface arguments included>.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file carrying that dispatch's own result, verbatim. Never a
`commit …; push; open the PR` line: this dispatch's result is its own.
NEVER: commit, push, open a PR, or merge. Questions and escalations go in your report
file, not to the operator: when blocked, write the question there and wait; when stuck,
write an escalation there and stop; report refusals verbatim.
```

## Direct work-item

A `/ossify:work-item <handoff path>` the operator asked for directly, with no activated
spine: no SEATS row is involved and the brief is this file's own. The unit it runs may be
read-only, so the brief never orders a commit, push or PR.

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: implementer, direct work item. State the model you are running in your first reply,
then continue.

PLACEMENT: worktree <the handoff's worktree — abs path>, branch <branch>, base
<base-branch>. Use git -C for every git command; cd does not persist.

TASK: run `/ossify:work-item <handoff path>` — the operator's command, verbatim — and let it
complete; its contract binds you and decides what this unit writes or stages. Never commit,
push or open a PR on its behalf: the unit may be read-only.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file carrying that work item's own result, verbatim — its
structured return. Never a commit, push or PR line.
NEVER: commit, push, open a PR, or merge; edit files outside this worktree; or run any
subagent — your report file at REPORT_PATH is the one exception outside it. When blocked,
write the question to your report file and wait; when stuck, write an escalation there and
stop; report refusals verbatim.
```

## Non-spine close

A `/ossify:close r1` or `r1.s2.w3` the operator asked for directly. Close-shaped, and it
carries no `SPINE_ID`: that identity belongs to the spine close brief in
`ossify-pr-briefs.md`, a different dispatch.

```text
SEAT_COMMAND=<the command this seat was launched with, verbatim from agents.md>
SEAT_EXPECTED_MODEL=<the model the banner or screen must show>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the effort this seat was launched at>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
ROLE: close session. State the model you are running in your first reply, then continue.

PLACEMENT: <the tree the close runs from — abs path>.

TASK: run `/ossify:close <id>` — the operator's command, verbatim — and let it complete or
halt. Whatever it hands off, you do not drive.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file carrying exactly one of three results: every PR the close
returned — one line per PR, `<repo> #<number> <url>`; the single word `closed` when it
recorded with no PR open; or `halted: <step> — <evidence>` when it stopped, naming the
failing step and repo and, on its own line, what it had already opened:
`opened: <repo> #<n> <url> …` or `opened: none` — a close can halt after opening in one
repo, and hiding those PRs strands them. Never a `commit …; push; open the PR` line of your
own.
NEVER: create a seat, merge, re-invoke `/ossify:close`, or open a PR of your own — a halt
settles this dispatch, and a remediated one is a fresh session the orchestrator dispatches.
Questions go up in your report file: when blocked, write the question there and wait; when
stuck, write an escalation there and stop; report refusals verbatim.
```

## Correction request (one send, no new session)

A malformed, incomplete, or wrongly-shaped report from a live session is corrected in
place, never by a new session: one send to that session, nothing else.

```text
Your report file for <task id> is malformed or incomplete: <the missing or wrong
field, and what is wrong with it>. The exact shape wanted: <the field, restated
from your brief>. No other work; rewrite your report file at <REPORT_PATH>, then stop
— the orchestrator waits and rereads it.
```

If one send does not fix the report, it goes to the operator.
