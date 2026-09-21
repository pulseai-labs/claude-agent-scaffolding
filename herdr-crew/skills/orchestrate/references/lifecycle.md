# The run

One run per objective. The orchestrator drives these thirteen steps and nothing else.
Every command's syntax comes from `herdr --skill`.

1. **Orient.** Your first herdr command is `herdr --skill`; every
   command's syntax comes from that guide. Single-command probes only: branch,
   `git status`, open PRs, the run's `run.json` (and its `dagr check --strict`
   lint), `herdr status`. Then bind or create the run's `run.json` for the
   objective — naming its path is the whole operation, with no CLI call — or
   continue from the one the operator names when resuming.
1b. **Ossify spine planned here?** If this session just completed `/ossify:plan-spine`
   against a concrete spine directory with a run bound, step 2 is replaced by
   `references/ossify-execution.md`: agree one implementer/verifier seat per work
   item and the three coordinator seats with the operator into the project file,
   inject them as the spine session's SEATS block, ask the
   operator to confirm nested worker depth is 2, and
   start **one** spine session that creates its own child `run.json` and launches every
   item pair. You approve relayed worker plans and wait on that one completion; you
   launch no item pane. **That completion is the final round barrier, not a PR.** When
   it lands you **dispatch** `/ossify:close <spine-id>` to a **fresh** close session —
   launched from the project file's close-session seat — never
   the spine driver's pane, and wait on its report file, which returns **every** PR
   it opened, one per remote product hosting repo — a remote-less repo lands
   locally and is never a PR; an AI-workspace record arm is not one —
   or `closed`; `close` is a dispatched command (§6),
   not one you run here. Then **dispatch a work-PR session** per returned PR, in that
   PR's own hosting-repo worktree, launched from the project file's work-PR
   seat, carrying the reviewer **and** PR-fix profiles you
   decide now, the merge-executor assignment, and `PRIOR_REVIEW` (`none` for a PR no
   earlier work-PR dispatch has covered, `covered` when one has and left durable
   evidence its review ran but no record,
   otherwise the record its last `open:` result
   persisted): steps 8-12 are that session's loop, and you relay the merge word to it
   rather than merging yourself. Once every returned PR has merged, dispatch the record
   pass — a second close — and only then tear down: **step 12's worker release and
   branch deletion wait for that pass** — the work-PR session's own reviewer and PR-fix
   seats are exempt: it releases them when their work finishes, and the hold covers the
   top's spine-level teardown, not seats inside a work-PR child run; post-merge product
   fixes take a new PR and fresh seats. **But a closed return skips the record pass**
   and goes straight to teardown: the pass exists to record PRs, and that return named
   none. Absent any of those four facts, continue at step 2.
2. **Decompose.** One `task-create` per brief, `--deps` for the DAG, each carrying
   the complexity class the orchestrator derives from the work item's spec and its
   spine's bone/flesh class: `contract` if it touches an interface, schema, or
   contract, or belongs to a bone spine; `bounded` only when the item is one-file,
   mechanical, or read-only; everything else — including an item that classifies
   nowhere — is `contract`. One implementer per worktree. Items within a round may
   run in parallel; their merges are serial.
3. **Launch.** The seat launch — pane creation, the idle wait, the banner read that
   confirms the model, then the brief delivered as `brief_delivery` says (inject or
   file) — is `roles.md`'s "The launch," with the undetected-seat path in
   `herdr-mechanics.md`. The "state your model" line in the worker's first reply is
   the second check. Wrong model: release the pane and report it.
4. **Plan gate, planned work only.** The planned implementer's brief says: post your
   plan, then wait for a reply before implementing. The orchestrator waits on that
   pane, reads the plan, and approves or amends it by prompting the pane again. Fast
   briefs skip this.
5. **Wait.** One `herdr agent wait <pane> --until done --until idle --timeout <ms>`
   per dispatch: one shell call that returns once, over a typed state
   (`idle｜working｜blocked｜done｜unknown`), never a rolling poll. On a `done` wake,
   read the report file it names — the wake is only the doorbell, the file is the
   contract. A `blocked` wake means a question: `herdr pane read <pane>` for it,
   answer with `herdr agent prompt <pane>`, then one fresh bounded wait on the answer.
   A timeout is a checkpoint, not a failure: a loop of waits, and restarting a wait
   after an empty timeout, both stay forbidden. `herdr pane read` only on a `blocked`
   wake or a missing or malformed report, never to watch progress. A round's N
   parallel items are N sequential bounded waits, one per pane in dispatch order —
   not the forbidden loop, since each targets a different pane rather than
   re-entering the one that just timed out. What persists is the report file, not
   the state a finished pane has since moved to, so parking on one pane while
   another keeps working loses nothing; the round's barrier closes when every
   item's report file is in hand. On an empty timeout, the orchestrator does not
   re-wait that pane: it moves on to the round's remaining panes, then returns
   idle. That item's report file is not yet in hand, so the barrier closes on a
   later turn, once it is on disk. At each task boundary for a retained implementer,
   send `/context` and read the one reply before attaching the next task (the
   threshold is in `roles.md`).
6. **Implementer finishes.** Its report file carries the completion body its
   brief defined — the commit SHAs and file count, each test command's pass and
   fail counts with the full output, the PR it opened with
   its head SHA, and any open ids. Check the PR with one
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
   dispatching the verifier. The verifier seat carries the effort its project-file
   entry names — the claims include judgment, and `cannot determine` counts as fail.
   On a fail, attach a fix task to the retained implementer by prompting its pane
   again, `herdr agent prompt <pane> "<fix task's brief>"`, wait for its report file
   naming the new head SHA, read that SHA's check-runs, then re-check on the retained
   verifier; a second fail on the same item goes to the operator. The verifier is
   released only at pass or escalation.
8. **Review.** A review runs exactly once per PR: the reviewer seat in a fresh worktree
   at the PR head, brief `/code-review <PR>`, every finding returned in the report file
   as file, line, severity, claim. The reviewer posts nothing to GitHub and edits
   nothing, so that file is the sole copy of the review. Release the reviewer only
   after its report file validates — findings lines present in the stated schema, or
   `Findings: none` on a clean review, with the reviewed head equal to the PR head; on
   a malformed report, send one bounded correction request
   before release.
9. **Disposition.** Each finding becomes **fix**, **defer** as a tracked issue, or
   **reject** with a reason. Post that list as one PR comment — the disposition
   ledger — so it survives the session.
10. **Fix rounds.** The retained implementer — on an activated ossify spine (1b) this
    whole step runs inside that PR's work-PR session, which creates the PR-fix seat from
    the profile the top decided at step 8's transition and dispatches its fix task here
    once step 9's ledger exists; no implementer is retained into a spine PR — gets
    the fix list plus the GitHub thread stream (Codex, CodeRabbit, humans) and works
    to zero unresolved threads by GraphQL `reviewThreads` count, pushing as it goes.
    The unit that reaches a terminal state
    is each finding, including each finding inside a review body or PR comment: every
    finding ends **fixed**, resolved only after the fix is on the head the reviewer
    can see; **deferred**, resolved with a comment linking the tracked issue; or
    **rejected**, resolved with the evidence. After each fix round's report file,
    and after each later-finding disposition, edit the disposition comment so every
    finding's terminal state is recorded there — fixed in <sha>, deferred →
    #<issue>, rejected with the reason. A signal is clean when every finding in it
    has a terminal state so recorded. P0 and P1 findings are never deferred. A new
    bot or human finding that arrives after the disposition returns to the
    orchestrator, and the implementer waits — it
    resolves the finding only after the orchestrator's decision (#410). No second
    `/code-review`. Bot comments after each push stay in this stream, and review
    bodies and top-level PR conversation comments are part of it too —
    `reviewThreads` does not return them — refreshed after each push alongside the
    thread count. With ossify installed, this
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
    the orchestrator often sits outside the PR's repository, so every
    read and the merge name the repo. The read and merge are two
    operations — a signal can still land between them: the ruleset
    requires conversation resolution, GitHub refuses the merge while any thread
    is open, and a refusal returns to step 10, never a retry. Then
    release every worker and delete the branch only after confirming a merged PR
    exists whose head OID equals the branch tip — on an activated ossify spine (1b) the
    merge lands on the word you relay under that dispatch's `MERGE_EXECUTOR`
    assignment — always a merge commit on the named SHA, session or operator —
    and that wait covers the top's spine-level teardown alone — work-PR seats
    released when their work finished. **A closed spine has no PR to confirm**,
    so its teardown validates the close's own result instead — the local landing it
    recorded in each hosting repo — and waits for no record pass.
13. **Handoff.** If the run outlives the session, write a handoff naming the run's
    `run.json` path, task ids, pane ids, head SHA, and the next step — on an activated
    ossify spine, also the spine's approved `SEATS` block, the resolved coordinator
    profiles and the accumulated close-review ledger (oldest first). With ossify
    installed, that is `/ossify:handoff`.

## Roles of the operator's own

A role the operator defines in the project file (`config.md`) runs at a named point of
the run above: `after-implementer` (after step 6), `before-review` (before step 8),
`after-disposition` (after step 9), `before-merge-ask` (before step 12's ask),
`at-teardown` (step 12's teardown — release and branch deletion, not step 13's
handoff). `at: on-demand` has no fixed point, dispatched when wanted — its seat
counts against the allowance the project file declares, one by default. A declared
role's seat lives for its dispatch — launched at its point or on demand, released on
return — never a standing seat. A role with `blocks: yes` holds the run at its point
until it passes or the operator overrules it — the orchestrator relays its summary,
the operator's word settles it, anything else is advice in the disposition. A role
with `replaces:` takes a plugin step — `implementer`, `verifier`, `reviewer`:
the named seat is not launched, the role runs at its point in its place, and the
handoff says which step was the operator's. Every point above is the top's own — a
declared role is not yet carried into a delegated spine or work-PR session, so a
`before-merge-ask` role does not fire on an activated spine (issue #500 holds it).

## Rotation past the context ceiling

herdr-crew's hook tells a session its own context figure once it reaches the ceiling (the
plugin setting `context_ceiling`, default 500000 tokens). The top, the spine session and the
work-PR session act on it; a close session and every leaf seat simply finish their unit.
Past the ceiling a seat finishes the unit in hand and starts no new one, never stopping
mid-item. At its next boundary it settles its dispatch with a return that carries its state
forward, and its parent launches a fresh seat to resume: the spine session writes
`/ossify:handoff`, returns `rotate: <handoff path>`, and resumes from the same
project-file seat with that path as `HANDOFF_PATH`; a work-PR session returns `open: <PR url> at
<head sha>` with its review record, and its successor resumes from `PRIOR_REVIEW` — it
takes no `HANDOFF_PATH`. A figure the hook reports as unavailable is relayed upward once,
never guessed. Both sessions' boundaries and returns are in their briefs
(`ossify-briefs.md`, `ossify-pr-briefs.md`); a spine `rotate:` is
`ossify-nested-run.md` §4.

**Your own rotation.** Your boundary is a fully acknowledged delivery with no
operator question in flight — live child dispatches keep running throughout and
your successor inherits them by rebinding to the parent run's `run.json`. Write the
handoff, recording your own resolved profile — `/ossify:handoff`
with ossify installed, the same file by hand without it. Open a new tab and pane
with the launch command the handoff recorded — ask the operator once when none
did; an alias carries provider settings `ps` does not show. Send the new top its
resume — `/ossify:handoff-resume <path>` with ossify, or the path as its first
instruction without — confirm its turn started, then tell the operator
which tab to use and that this one can close.
The new top resumes by naming the parent's `run.json` path — there is no CLI call —
then continues at the step the handoff named.
