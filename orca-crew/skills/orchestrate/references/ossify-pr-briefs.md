# ossify spine PR briefs — the close and the work-PR sessions

The two briefs the PR lane needs (`ossify-execution.md` §2, `ossify-nested-run.md`
§4). Same rules as `briefs.md`: a brief is the whole contract its reader will ever
see, angle brackets are slots, fill every slot and delete nothing else.

> **Editing note.** Asserted to contain no subagent invocation form
> (`tests/test-ossify-spine-contract.sh`). Say the prohibition; never paste the
> call shape.

---

## Close session (one fresh terminal per dispatch, created by the top)

It creates nothing and returns a list. Dispatched fresh every time: for the
ceremony, again for every halt remediated, and once for the record pass — only
the successful record pass is single and conditional.

```text
ROLE: ossify spine close for SPINE_ID. State the model you are running in your
first reply, then continue. A first reply whose model is not
CLOSE_EXPECTED_MODEL is a failed launch to report, not to work around.

PLACEMENT: <abs path of the worktree the spine's lane ran from>.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
PARENT_RUN_ID=<run id>
SPINE_ID=<spine id>
CLOSE_EXPECTED_MODEL=<model id the banner must show>
CLOSE_REVIEW_LEDGER=<verbatim ledger from the first close, or "none">
TASK/DISPATCH: your task and dispatch identities come from the Orca preamble
injected into this terminal; spend those verbatim — never placeholders, never
ids predicted before it existed.

TASK: run `/ossify:close SPINE_ID` and let it complete or halt. Whatever it hands
off, you do not drive: if it opens PRs and halts, that halt is your result.
The ceremony's own steps are yours to perform, including
the close review the ceremony itself runs over the accumulated diff before any PR
opens — that is `/ossify:close` doing its job, not a `/code-review` you dispatch.
Its findings are yours to report, never to fix: a `fix now` disposition ends this
dispatch as `halted: close-review — <ledger>` carrying each finding, its decision
and the reason; the top dispatches the writer and a fresh close. On a record
pass, write the accepted findings CLOSE_REVIEW_LEDGER carries into the
retrospective's carried-and-lessons section, by class.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: one worker_done on the identities your injected Orca preamble names,
carrying exactly one of three results: EVERY PR the close opened — one line per hosting repo, `<repo>
#<number> <url>`; the single word `closed` when it recorded the spine with no PR
open; or `halted: <step> — <evidence>` when it stopped, naming the failing step and
repo and, on its own line, what it had already opened: `opened: <repo> #<n> <url> …`
or `opened: none`. A multi-repo close can open in one repo and halt on the next:
a halt that hides those PRs strands them, and the top settles it without
advancing the lifecycle. Whenever the
close review ran, carry its ledger verbatim too — each finding, its decision and
the reason: the record pass runs in a different session and cannot
reconstruct it, and the close-review halt's evidence is that ledger.
Then:
  Changed / Evidence / Open / Files.

NEVER: create a terminal, merge, ask the operator anything (questions go up to
the top with `ask`), or re-invoke `/ossify:close` yourself — a halt settles
this dispatch, and once the blocker is remediated
the top dispatches a fresh close session. Report a refusal verbatim.
```

---

## Work-PR session (one fresh terminal per returned PR)

Created by the top **in that PR's hosting-repo worktree** — the one the close
landed from — so REPO_ROOT is the path this terminal already sits in, never a
fixed canonical path. Launched from the sidecar's ratified Work-PR-session
block with the top's merge-executor assignment and PRIOR_REVIEW, it owns both
PR seats inside a child Run of its own.

```text
ROLE: work-PR session for PR PR_NUMBER in PR_REPO, and coordinator of its two
seats. State the model you are running in your first reply, then continue.
A first reply whose model is not WORKPR_EXPECTED_MODEL is a failed launch to
report, not to work around.

PLACEMENT: REPO_ROOT — the worktree holding this PR's branch.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
PARENT_RUN_ID=<run id>
PR_REPO=<owner/repo>
PR_NUMBER=<number>
REPO_ROOT=<abs path of this terminal's worktree>
WORKPR_EXPECTED_MODEL=<model id the banner must show>
REVIEWER_COMMAND=<exact launch command>
REVIEWER_EXPECTED_MODEL=<model id the banner must show>
REVIEWER_EFFORT=<exact launch argument>
REVIEW_LEVEL=<the /code-review level the top decided>
PRFIX_COMMAND=<exact launch command>
PRFIX_EXPECTED_MODEL=<model id the banner must show>
PRFIX_EFFORT=<exact launch argument>
PRIOR_REVIEW=<the prior dispatch's durable review record — ran, reviewed head,
clean/findings state, summary, ledger/comment refs — or "none">
MERGE_EXECUTOR=<session|operator — the top's explicit assignment>
STOPPING_RULE=<the rule agreed before the PR opened>
TASK/DISPATCH: your task and dispatch identities come from the Orca preamble
injected into this terminal; spend those verbatim — never placeholders, never
ids predicted before it existed. Capture them, and PARENT_RUN_ID, before
binding your child Run.

TASK: drive PR_NUMBER to a merge on the top's word.
  1. Capture your own preamble identities and PARENT_RUN_ID, then bind a CHILD
     Run for your two seats. Every seat's task-create, worker-start, dispatch
     and check names --run <child run id>; every question for the top names
     --run PARENT_RUN_ID.
  2. Decide your startup branches BEFORE any seat exists. MERGE_EXECUTOR must
     read exactly `session` or `operator` — a missing, invalid or unknown
     assignment is asked upward and nothing is created. Then branch on PRIOR_REVIEW:
     `none` means the top dispatched you onto a PR no earlier
     work-PR dispatch has covered — an initial run, and step 3 creates the
     reviewer. A record whose reviewed head equals the current PR head is a
     resumed run: skip only step 3's reviewer creation — the review already
     ran — and enter step 4 with the record and its unresolved findings as
     your disposition baseline. A record whose reviewed head differs is a
     resumed run on a moved head: re-fetch the GitHub signals; the prior
     review and its unresolved findings still baseline the disposition. A
     record inconsistent with the PR's live state — wrong PR, a referenced
     ledger that does not exist — is neither: `ask` the top and create
     nothing. You did not open this PR; the record and the dispatch decide.
  3. Initial runs only: create the reviewer FIRST, from REVIEWER_COMMAND at
     REVIEWER_EFFORT, confirm REVIEWER_EXPECTED_MODEL from its banner and
     first reply, and brief it to run `/code-review PR_NUMBER REVIEW_LEVEL`.
     Read the findings from its worker_done; it posts nothing itself, so that
     body is the only copy. Validate it against the reviewer brief's schema —
     `Findings: none` with `Reviewed head:` and `Summary:`, or finding lines
     plus both — before you pass anything on; on a malformed body send
     ONE bounded correction request to that reviewer and re-validate, and
     escalate a second malformed body to the top. Compare the reviewed head
     to the current PR head: a mismatch makes the review historical — re-fetch
     the GitHub signals on the current head rather than commissioning another,
     and absent or untriaged signals never satisfy the merge gate.
  4. THEN run `/ossify:work-pr $PR_NUMBER --repo-root $REPO_ROOT` — initial
     runs carrying those findings in as its disposition inputs,
     resumed runs carrying the PRIOR_REVIEW baseline. It owns the whole
     review-fix-merge loop, so starting it first would let it reach its merge
     ask on pre-existing signals with your review never run. In this seat its "drive the fixes" is a
     dispatch to the PR-fix seat — you edit nothing yourself — and its merge ask
     is the `ask` to the top in step 6.
  5. Disposition every finding — the reviewer's, the bot threads, and the
     review bodies and top-level PR comments that `reviewThreads` does not
     return — post the ledger, file deferrals as tracked issues in PR_REPO, and
     dispatch fix tasks to a PR-fix seat — briefed from `briefs.md`'s fix-round
     brief but **without the ossify replacement clause**, which would start a
     second review-fix-merge loop with a merge ask of its own inside this one; it
     works the fix list you give it, pushes, and returns `fixed in <sha>` per
     finding, never running work-pr and never asking for a merge — created from
     PRFIX_COMMAND at PRFIX_EFFORT — confirm PRFIX_EXPECTED_MODEL from its banner
     and first reply before the first fix task; a mismatch is a failed launch
     to ask about, never to work around. The delegated review ran once,
     on the head it was briefed with, and that seat is
     released after its worker_done validates. Each push moves the head under
     that verdict: before the next disposition round,
     re-fetch the GitHub review signals and the thread state on the new head —
     the bots review every push, so the current-head verdict is there to be read
     rather than re-commissioned.
     A finding that arrives after the disposition ledger exists — a
     post-disposition P0/P1 included — returns through the blocking `ask`
     before any seat acts on it; you never fix it yourself and never defer it
     silently. Relay ONE batched summary per round to the top; STOPPING_RULE
     decides when fixing stops.
  6. When the gate is clean, `ask` the top for the merge word. MERGE_EXECUTOR
     is the top's explicit assignment, not something you infer — never parse
     permission settings, never probe by attempting a merge. On `session`: on
     the reply, re-fetch the whole gate set once more and
     merge bound to the named SHA, as a merge commit. On `operator`: your ask
     names the operator as executor, the approved SHA and the merge-commit
     convention; on the reply you re-fetch the gates, the operator's landing
     is a merge commit on that same SHA — never a squash or rebase — and you
     confirm and report the resulting merge SHA, surfacing any deviation
     rather than adopting it. Either way a later permission denial is
     surfaced verbatim, never bypassed. Then release both seats — you are
     exempt from any record-pass hold, but the spine branch and spine worktree
     are the top's to hold, never yours to delete.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: one worker_done on the identities your injected Orca preamble names,
returning PR_REPO, PR_NUMBER and every ledger comment id, plus one of two outcomes: the merge SHA; or
`open: <PR url> at <head sha>` when the word you were relayed was wait or leave
open. On the open shape, persist the review record with it — whether the
delegated review ran, its reviewed head, its clean/findings state and summary,
and the durable ledger/comment references — the next fresh work-PR dispatch
receives that record as PRIOR_REVIEW, with fresh dispatch identities even
though the review state is reused. Both settle this dispatch and release both
seats — checkable artifacts, never narrative. On the open shape the top does
not advance to the record pass, and a
later merge is a new work-PR dispatch, not a resumption of this one.
Then: Changed / Evidence / Open / Files.

NEVER: talk to the operator — every question goes up to the top; squash; merge
without the top's relayed word; delete a branch; or dispatch a second review —
one delegated review per PR, exactly as `roles.md` and step 8 have it.
```
