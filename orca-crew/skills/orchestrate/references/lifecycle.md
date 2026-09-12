# The run

One Run per objective. The orchestrator drives these thirteen steps and nothing else.
Every command's syntax comes from `orca skills get orchestration`.

1. **Orient.** Your first Orca command is `orca skills get orchestration`; every
   command's syntax comes from that guide. Single-command probes only: branch,
   `git status`, open PRs, `orca status --json`, `orca orchestration task-list --brief
   --json`. Then `run-create --objective "<objective>"`, or `run-use` when resuming a
   Run the operator names.
1b. **Ossify spine planned here?** If this session just completed `/ossify:plan-spine`
   against a concrete spine directory with a Run bound, step 2 is replaced by
   `references/ossify-execution.md`: ratify one implementer/verifier profile per work
   item with the operator, write the sidecar, confirm nested worker depth is 2, and
   start **one** spine session that creates its own child Run and launches every item
   pair. You approve relayed worker plans and wait on that one completion; you launch
   no item terminal. **That completion is the final round barrier, not a PR.** When it
   lands you **dispatch** `/ossify:close <spine-id>` to a **fresh** close session, never
   the spine driver's terminal, and wait on its `worker_done`, which returns **every** PR
   it opened, one per hosting repo, or `closed`; `close` is a dispatched command (§6),
   not one you run here. Then **dispatch a work-PR session** per returned PR, in that
   PR's own hosting-repo worktree, carrying the reviewer **and** PR-fix profiles you
   decide now: steps 8-12 are that session's loop, and you relay the merge word to it
   rather than merging yourself. Once every returned PR has merged, dispatch the record
   pass — a second close — and only then tear down: **step 12's worker release and
   branch deletion wait for that pass**. **But a closed return skips the record pass**
   and goes straight to teardown: the pass exists to record PRs, and that return named
   none. Absent any of those four facts, continue at step 2.
2. **Decompose.** One `task-create` per brief, `--deps` for the DAG, each carrying
   the complexity class the orchestrator derives from the work item's spec and its
   spine's bone/flesh class: `contract` if it touches an interface, schema, or
   contract, or belongs to a bone spine; `bounded` only when the item is one-file,
   mechanical, or read-only; everything else — including an item that classifies
   nowhere — is `contract`. One implementer per worktree. Items within a round may
   run in parallel; their merges are serial.
3. **Launch.** `terminal create --command "<alias>"` in the target worktree, then
   `terminal wait --for tui-idle`, then one `terminal read` of the banner to confirm
   the model, then `dispatch --inject` (the mechanic in `roles.md`). The "state your
   model" line in the worker's first reply is the second check. Wrong model: release
   and report.
4. **Plan gate, planned work only.** The `claude-glm` brief says: post your plan with
   `orca orchestration ask`, wait for the reply, then implement. Approve or amend via
   `reply`. Flash briefs skip this.
5. **Wait.** Rolling `check --wait --types worker_done,escalation,question`. Process the
   whole Delivery, answer every `question`, ack, wait again. A timeout is a checkpoint.
   `worker-read` only on `escalation` or a failed `worker_done`. At each task boundary
   for a retained implementer, send `/context` and read the one reply before attaching
   the next task (the threshold is in `roles.md`).
6. **Implementer finishes.** Its `worker_done` names the branch, head SHA, the test
   command with its result, and the PR it opened. Check the PR with one
   `gh pr view <number> --repo <owner/repo>` and read CI from
   `commits/<sha>/check-runs` plus the commit statuses when the repo's CI reports
   through the Status API instead of Checks, never the status rollup, both fetched
   against `--repo <owner/repo>`. These reads are the floor's PR-gate probes — identity
   and state from the first, CI for the named SHA from the rest — and anything beyond
   reading them becomes a verifier dispatch.
7. **Verify, once per work item.** One verifier session per work item, one brief
   listing every claim: each acceptance criterion of the work item's spec, the
   mutation of any new test, and the diff against the requirement. The suite result
   on the head is not a claim — the orchestrator reads that SHA's check-runs before
   dispatching the verifier. `claude-glm` at high — the claims include judgment, and
   `cannot determine` counts as fail. On a fail, attach a fix task to the retained
   implementer with `worker-start --task <fix-task> --terminal <handle>`, wait for its
   `worker_done` naming the new head SHA, read that SHA's check-runs, then re-check on
   the retained verifier; a second fail on the same item goes to the operator. The
   verifier is released only at pass or escalation.
8. **Review.** A review runs exactly once per PR: `claude-glm-flash` in a fresh worktree
   at the PR head, brief `/code-review <PR>`, every finding returned in the `worker_done`
   body as file, line, severity, claim. The reviewer posts nothing to GitHub and edits
   nothing, so that body is the sole copy of the review. Release the reviewer only after
   its `worker_done` validates — findings lines present in the stated schema, or
   `Findings: none` on a clean review, with the reviewed head equal to the PR head; on
   a malformed body, send one bounded correction request
   before release.
9. **Disposition.** Each finding becomes **fix**, **defer** as a tracked issue, or
   **reject** with a reason. Post that list as one PR comment — the disposition
   ledger — so it survives the session.
10. **Fix rounds.** The retained implementer — on an activated ossify spine (1b) this
    whole step runs inside that PR's work-PR session, which creates the PR-fix seat from
    the profile the top decided at step 8's transition and dispatches its fix task here
    once step 9's ledger exists; no implementer is retained into a spine PR — gets the
    fix list plus the
    GitHub thread
    stream (Codex, CodeRabbit, humans) and works to zero unresolved threads by GraphQL
    `reviewThreads` count, pushing as it goes. The unit that reaches a terminal state
    is each finding, including each finding inside a review body or PR comment: every
    finding ends **fixed**, resolved only after the fix is on the head the reviewer
    can see; **deferred**, resolved with a comment linking the tracked issue; or
    **rejected**, resolved with the evidence. After each fix round's `worker_done`,
    and after each later-finding disposition, edit the disposition comment so every
    finding's terminal state is recorded there — fixed in <sha>, deferred →
    #<issue>, rejected with the reason. A signal is clean when every finding in it
    has a terminal state so recorded. P0 and P1 findings are never deferred. A new
    bot or human finding that arrives after the disposition returns to the
    orchestrator through the blocking `ask`, and the implementer waits — it
    resolves the finding only after the orchestrator's decision (#410). No second
    `/code-review`. Bot comments
    after each push stay in this stream, and review bodies and top-level PR
    conversation comments are part of it too — `reviewThreads` does not return them —
    refreshed after each push alongside the thread count. With ossify installed, this
    dispatch is `/ossify:work-pr <PR> --repo-root <worktree holding the PR branch>`
    with the disposition embedded as a third signal.
11. **Stopping rule, agreed before the PR opens.** Default: when a round does not shrink
    or fixes generate new findings, stop fixing and defer the remaining P2s and P3s as
    tracked issues. P0 and P1 are never deferred. A PR that reaches round five halts
    the deferrable work and examines process, not code; P0 and P1 remediation
    continues past round five until each is fixed or rejected with evidence.
12. **Merge gate.** Fetch the full gate set against `--repo <owner/repo>` for the head
    SHA immediately before asking: `isDraft`, `mergeable`, `mergeStateStatus`, every
    relevant check-run and status context — all must be successful — the unresolved
    threads, and the non-thread signals of review bodies and PR conversation comments,
    which are clean when every finding in them has a terminal state recorded in the
    disposition comment (step 10).
    Ask only when every one is clean: a non-mergeable state is surfaced to the operator
    as the blocker instead of asking, and a new actionable finding returns to step 10.
    Ask the operator for the merge word naming that SHA.
    Merge only on that word, as a merge commit, never a squash, bound to the approved
    SHA: re-fetch the same full gate set for that SHA once more, then
    `gh pr merge <number> --repo <owner/repo> --merge --match-head-commit <sha>` —
    the orchestrator often sits in a checkout other than the PR's repository, so every
    read and the merge itself always name the repo. The read and the merge are two
    operations, so a signal can still land between them: the operator's ruleset
    requires conversation resolution, GitHub itself refuses the merge while any thread
    is open, and a merge refused that way returns to step 10, never a retry. Then
    release every worker and delete the branch only after confirming a merged PR
    exists whose head OID equals the branch tip — on an activated ossify spine (1b) the
    work-PR session merges on the word you relay, and both of these wait until the
    second close's record pass has returned. **A closed spine has no PR to confirm**,
    so its teardown validates the close's own result instead — the local landing it
    recorded in each hosting repo — and waits for no record pass.
13. **Handoff.** If the Run outlives the session, write a handoff naming the Run id,
    task ids, terminal handles, head SHA, and the next step. With ossify installed, that
    is `/ossify:handoff`.
