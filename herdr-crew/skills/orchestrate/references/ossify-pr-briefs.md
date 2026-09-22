# ossify spine PR briefs — the close and the work-PR sessions

The two briefs the PR lane needs. Same rules as `briefs.md`: a brief is the
whole contract its reader will ever see — fill every slot, delete nothing else.

> **Editing note.** Asserted to contain no subagent invocation form (`tests/test-ossify-spine-contract.sh`).
> Say the prohibition; never paste the call shape.

---

## Close session (one fresh seat per dispatch, created by the top)

It creates nothing, returns a list; only the successful record pass is single and conditional.

```text
ROLE: ossify spine close for SPINE_ID. State the model you are running in
your first reply, then continue. A first reply whose model is not
CLOSE_EXPECTED_MODEL is a failed launch to report, not to work around.

PLACEMENT: <abs path of the worktree the spine's lane ran from>.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — never in pieces
SPINE_ID=<spine id>
CLOSE_COMMAND=<the command this seat was launched with, from its machine entry>
CLOSE_EXPECTED_MODEL=<the model the banner or screen must show>
CLOSE_EFFORT=<the effort this seat was launched at>
CLOSE_REVIEW_LEDGER=<every close review's ledger for this spine, oldest first,
verbatim — or "none">
Everything you tell the top goes in your report file at REPORT_PATH.

TASK: run `/ossify:close SPINE_ID` and let it complete or halt. Whatever it hands
off, you do not drive: if it opens PRs and halts, that halt is your result. The
ceremony's own steps are yours to perform, including
the close review the ceremony itself runs over the accumulated diff before any PR
opens — `/ossify:close` doing its job, not a `/code-review` you dispatch. Its
findings are yours to report, never to fix: ossify keeps that review advisory —
it halts no ceremony gate — but this dispatch is stricter, and a `fix now`
disposition ends this dispatch as `halted: close-review — <ledger>`,
carrying each finding, its `target_repo`, its decision and the reason; the top
dispatches the writer — per `ossify-close-writer.md`, one per affected hosting
repo — and a fresh close. On a record pass, write the accepted findings
CLOSE_REVIEW_LEDGER carries into the retrospective's carried-and-lessons
section, by class.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file, carrying exactly one of three results: EVERY PR the close opened — one line per opened PR,
`<repo> #<number> <url>`: only a remote product hosting repo (a declared
`target_repo`) gets one, a remote-less repo lands locally in the same close and is
never a PR; the single word `closed` when it recorded the spine with no PR open; or
`halted: <step> — <evidence>` when it stopped, naming the failing step and repo and,
on its own line, what it had already opened: `opened: <repo> #<n> <url> …` or
`opened: none`. A multi-repo close can halt after opening in one repo — hiding those
PRs strands them. Whenever the close review ran, carry its ledger verbatim too,
naming each finding, its `target_repo`, its decision and the reason: the record pass
cannot reconstruct it. Then: Changed / Evidence / Open / Files as ids, SHAs, counts and a report path.

NEVER: create a seat, merge, ask the operator anything
(questions go up to the top in your report file), or re-invoke `/ossify:close` — a halt
settles this dispatch; remediated, the top dispatches a fresh close session.
Report a refusal verbatim.
```

---

## Work-PR session (one fresh seat per returned PR)

Created by the top **in that PR's hosting-repo worktree**, so REPO_ROOT is the path this
seat already sits in, never a fixed canonical path. Launched from the `work-PR session`
seat the project file names, with the top's merge-executor assignment and PRIOR_REVIEW, it
owns both PR seats inside a `run.json` of its own. The top waits on it as a coordinator
seat (`herdr-mechanics.md`, Completion).

```text
ROLE: work-PR session for PR PR_NUMBER in PR_REPO, and coordinator of its two
seats. State the model you are running in your first reply, then continue.
A first reply whose model is not WORKPR_EXPECTED_MODEL is a failed launch to
report, not to work around.

PLACEMENT: REPO_ROOT — the worktree holding this PR's branch.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — never in pieces
RUN_JSON=<abs path of the run.json you write and own — never the top's>
MECHANICS=<the directory this session read the orchestrate skill's SKILL.md from>/references/herdr-mechanics.md
PR_REPO=<owner/repo>
PR_NUMBER=<number>
REPO_ROOT=<abs path of this seat's worktree>
WORKPR_COMMAND=<the command this seat was launched with, from its machine entry>
WORKPR_EXPECTED_MODEL=<the model the banner or screen must show>
WORKPR_EFFORT=<the effort this seat was launched at>
REVIEWER=<command> | model: <expected model> | effort: <effort> | model_shows: <banner|screen> | brief_delivery: <inject|file>
REVIEW_LEVEL=<the /code-review level the top decided>
PRFIX=<command> | model: <expected model> | effort: <effort> | model_shows: <banner|screen> | brief_delivery: <inject|file>
PRIOR_REVIEW=<the prior dispatch's durable review record — ran, reviewed head,
clean/findings state, summary, fix rounds run, ledger/comment refs — "none", or "covered">
MERGE_EXECUTOR=<session|operator — the top's explicit assignment>
STOPPING_RULE=<the rule agreed before the PR opened>
Everything you tell the top — a question, the round summary, the merge ask, your report —
goes in your report file at REPORT_PATH; then wait, or stop where this brief says so. Your
first herdr command is `herdr --skill`. MECHANICS addresses a run's orchestrator, which for
your own seats is you: every seat you launch, send to, wait on or release follows it,
except that where it says the operator, you mean the top, through your report file.

TASK: drive PR_NUMBER to a merge on the top's word.
  1. Create RUN_JSON for your two seats and stay its single writer, as dagr's
     producer contract (`dagr --skill`) says, linting every write with
     `dagr check --strict` before it replaces the file. Nothing of yours goes in
     the top's run.json.
  2. Decide your startup branches BEFORE any seat exists. MERGE_EXECUTOR must read
     exactly `session` or `operator` — a missing, invalid or unknown assignment is
     asked upward and nothing is created. Then branch on PRIOR_REVIEW. `none` means
     the top dispatched you onto a PR no earlier work-PR dispatch has covered — an
     initial run, and step 3 creates the reviewer. `covered` means a dispatch worked
     this PR and left durable evidence its delegated review ran but persisted no record:
     a resumed run, no reviewer created, the current head's signals as your baseline,
     and only where that review's findings survive it — proof of execution with none is
     not `covered`: halt and ask the top. Evidence absent the value is not spent; ask. A record whose reviewed head equals
     the current PR head is a resumed run: skip only step 3's reviewer creation —
     the review already ran — and enter step 4 with the record and its unresolved
     findings as your disposition baseline. A record on a moved head is a resumed
     run too: re-fetch the GitHub signals; the prior review and its unresolved
     findings still baseline the disposition. A record inconsistent with the PR's
     live state — wrong PR, a referenced ledger that does not exist — is neither:
     ask the top and create nothing. You did not open this PR.
  3. Initial runs only: create the reviewer FIRST from its REVIEWER row —
     confirm the model as its row's `model_shows` says and from the
     first reply, and brief it to run `/code-review PR_NUMBER REVIEW_LEVEL`.
     Read the findings from its report file — it posts nothing; that file is
     the only copy. Validate it against the reviewer brief's schema —
     `Findings: none` with `Reviewed head:` and `Summary:`, or finding lines
     plus both — before passing anything on; on a malformed body send
     ONE bounded correction request and re-validate, escalating a second
     malformed body to the top. A mismatched reviewed head makes the review
     historical — re-fetch the GitHub signals rather than commissioning
     another; absent or untriaged signals never satisfy the merge gate.
  4. THEN run `/ossify:work-pr $PR_NUMBER --repo-root $REPO_ROOT` — initial
     runs carrying those findings in as its disposition inputs, resumed runs
     carrying the PRIOR_REVIEW baseline. It owns the whole loop — started first
     it would reach its merge ask on pre-existing signals, your review never
     run. In this seat its "drive the fixes" dispatches to the PR-fix seat —
     you edit nothing yourself — and its merge ask is your question to the top
     in step 6.
  5. Disposition every finding — the reviewer's, the bot threads, and the
     review bodies and top-level PR comments that `reviewThreads` does not
     return — post the ledger, file deferrals as tracked issues in PR_REPO, and
     dispatch fix tasks to a PR-fix seat — briefed from `briefs.md`'s fix-round
     brief but **without the ossify replacement clause**, which would start a
     second merge loop inside this one; it works the fix list you give it,
     pushes, and returns `fixed in <sha>` per finding, never running work-pr or
     asking a merge — created from its PRFIX row —
     confirm its model as the row's `model_shows` says and by the worker's own check before the
     first fix task; a mismatch is a failed launch to ask about, never to work
     around. The delegated review ran once, on the head it was briefed with, and
     that seat is released after its report file validates. Each push moves the
     head under that verdict: before the next disposition round,
     re-fetch the GitHub review signals and the thread state on the new head —
     the bots review every push, so the current-head verdict is read there, not
     re-commissioned. A post-disposition finding returns
     through a blocking question to the top before any seat acts on it, never
     fixed by you or silently deferred. Relay ONE batched summary per round;
     STOPPING_RULE decides when fixing stops, counting the fix rounds
     PRIOR_REVIEW carries.
  6. When the gate is clean, ask the top for the merge word. MERGE_EXECUTOR
     is the top's explicit assignment, not something you infer — never parse
     permission settings, never probe by attempting a merge. On `session`: on
     the reply, re-fetch the whole gate set once more and
     merge bound to the named SHA, as a merge commit. On `operator`: your ask
     names the operator as executor, the approved SHA and the merge-commit
     convention; on the reply you re-fetch the gates, the operator's landing
     is a merge commit on that same SHA — never a squash or rebase — and you
     confirm and report the resulting merge SHA, surfacing any deviation
     rather than adopting it. Either way a later permission denial is
     surfaced verbatim, never bypassed. Then release both seats and close the
     workspaces you created for them, as MECHANICS's Teardown says, with
     `herdr workspace list` showing none of them — only what you can prove is
     yours; report any teardown you cannot complete rather than claiming it.
     You are exempt from any record-pass hold.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file, returning PR_REPO, PR_NUMBER and every ledger
comment id, plus one of two outcomes: the merge SHA; or
`open: <PR url> at <head sha>` when the word you were relayed was wait or leave
open, or at a fix-round boundary once the context-ceiling notice has fired — then stand
down your own armed waits before you return, as the top and a spine session do: one
report must wake one session (`lifecycle.md`, "Your own rotation"). On the open shape, persist its review record —
whether the delegated review ran, its reviewed head, its clean/findings state and
summary, the fix rounds run, and the durable ledger/comment references — the next
fresh work-PR dispatch receives it as PRIOR_REVIEW in a fresh brief, the review
state reused. Both settle this dispatch; release both seats and close their
workspaces as step 6 directs. On the open shape the top does not advance to
the record pass — a later merge is a new work-PR dispatch, not a resumption of this
one. Then: Changed / Evidence / Open / Files as ids, SHAs, counts and a report path.

NEVER: talk to the operator — every question goes up to the top; squash; merge
without the top's relayed word; delete a branch; or dispatch a second full review — one
delegated review per PR (`roles.md`, step 8); a fixed head takes one scoped delta re-review.
```
