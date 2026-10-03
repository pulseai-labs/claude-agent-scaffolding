# The run

One run per objective. The orchestrator drives these thirteen steps and nothing else.
Every command's syntax comes from Paseo's own `paseo` skill.

1. **Orient.** Your first commands are Paseo's own `paseo` skill and `list_profiles`;
   every command's syntax comes from that guide. Single-command probes only: branch,
   `git status`, open PRs, the run's `run.json` (and its `dagr check --strict`
   lint), `paseo status`, `paseo inspect <id> --json`. **The daemon must be at least
   0.10.2**: the `paseo status` above reads `daemonVersion`, and a lower one stops the run
   — say so and stop — because 0.9.2 crash-loops resuming an agent whose cwd was deleted.
   Then bind or create the run's
   `run.json` for the objective — **binding** an existing one is naming its path, with no
   CLI call,
   and you continue from the one the operator names when resuming. **Creating**
   one is dagr's producer contract, never a bare write: resolve the `dagr`
   validator first (`dagr --skill`) and, with none available, do not start
   writing run files at all. That contract is the rule for every write of the
   file, not only its first: the complete document goes to a temp file beside
   the target, `dagr check --strict` it, and the rename over `run.json` — `mv`,
   which this command allows — lands only once that check is clean.
1b. **Ossify spine planned here?** If this session just completed `/ossify:plan-spine`
   against a concrete spine directory with a run bound, step 2 is replaced by
   `references/ossify-execution.md`: agree one implementer/verifier seat per work
   item and the three coordinator seats with the operator into the project file,
   inject them as the spine session's SEATS block, ask the
   operator to confirm nested worker depth is 2, and
   start **one** spine session that creates a nested `run.json` of its own and launches every
   item pair. You approve relayed worker plans and wait on that one completion; you
   launch no item seat. **That completion is the final round barrier, not a PR.** When
   it lands you **dispatch** `/ossify:close <spine-id>` to a **fresh** close session —
   launched from the project file's close-session seat — never
   the spine driver's seat, and wait on its report file, which returns **every** PR
   it opened, one per remote product hosting repo — a remote-less repo lands
   locally and is never a PR; an AI-workspace record arm is not one —
   or `closed`; `close` is a dispatched command (§6),
   not one you run here. Then **dispatch a work-PR session** per returned PR, in that
   PR's own hosting-repo worktree, launched from the project file's work-PR
   seat, carrying the reviewer **and** PR-fix profiles you
   decide now, the merge-executor assignment, `PRIOR_REVIEW` (`none` for a PR no
   earlier work-PR dispatch has covered, `covered` when one has and left durable
   evidence its review ran but no record,
   otherwise the record its last `open:` result
   persisted), and the child templates it will construct, verbatim as `briefs.md`'s
   dispatch matrix lists them for a work-PR session: steps 8-12 are that session's loop,
   and you relay the merge word to it rather than merging yourself. Once every returned
   PR has merged, dispatch the record pass — a second close — and only then tear down:
   **step 12's worker release and branch deletion wait for that pass** — the work-PR
   session's own reviewer and PR-fix seats are exempt: it releases them when their work
   finishes, and the hold covers the top's spine-level teardown, not seats in a work-PR
   session's `run.json`; post-merge product fixes take a new PR and fresh seats.
   **But a closed return skips the record pass**
   and goes straight to teardown: the pass exists to record PRs, and that return named
   none. Absent any of those four facts, continue at step 2.
   **A `kind: dsh-spine-driver` spine seat** keeps this step's order, but
   `references/dsh-driver.md` replaces its SEATS block, depth ask, spine and close
   launches and completion signals: read it before agreeing any seat.
2. **Decompose.** One task per brief in the run's `run.json`, its `deps` the task ids it
   waits on (the run is a DAG), each carrying the complexity class the orchestrator
   derives from the work item's spec and its spine's bone/flesh class: `contract` if it
   touches an interface, schema, or contract, or belongs to a bone spine; `bounded` only
   when the item is one-file, mechanical, or read-only; everything else — including an
   item that classifies nowhere — is `contract`. One implementer per worktree. Items
   within a round may run in parallel; their merges are serial.
3. **Launch.** The seat launch is `roles.md`'s "The launch." The "state your model"
   line is the worker's own second check: a model that is not `SEAT_EXPECTED_MODEL` is a
   failed launch it writes to its report file and stops on. A wrong model at the
   launch's own model check is `paseo-mechanics.md`'s The seat launch, step 3, which owns the
   cancel, its release going to the operator; this step reports the failure.
4. **Plan gate, planned work only.** The planned implementer's brief says: write your
   plan to your report file, then wait for a reply before implementing. The
   orchestrator reads the plan from that file when its bounded wait wakes, the same
   `report` exit as completion (`paseo-mechanics.md`), and approves or amends it by sending
   the seat its next message. The final report later overwrites the plan in the same
   file. Fast briefs skip this.
5. **Wait.** One background wait per dispatch, as `paseo-mechanics.md`'s Completion
   states it — the report file, or one of its four attention exits. A round's N
   parallel items are N such waits, one per seat, each waking the session when it
   exits — not a loop, since each targets a different seat rather than re-entering
   the one that just exited. What persists is the report file, not the seat's own
   state since moved on, so a seat that finishes while another item still works
   loses nothing; the round's barrier closes when every item's report file is in
   hand. A seat at its `budget` exit gets `paseo-mechanics.md`'s one grace; if that
   expires with no report, the seat is cancelled and escalated, and the barrier
   waits on the operator's word — which may re-dispatch the item, arming a fresh
   wait, but never resurrects the cancelled one — not on the orchestrator's own
   re-entry. At each task
   boundary for a retained implementer, send `/context` and read the one reply
   before attaching the next task; the threshold, and the seat this probe does not
   reach, are in `roles.md`.
6. **Implementer finishes.** Its report file carries the completion body its
   brief defined — the commit SHAs and file count, each test command's pass and
   fail counts with the full output, the PR it opened with
   its head SHA, and any open ids. Check the PR with one
   `gh pr view <number> --repo <owner/repo>` and read CI from
   `commits/<sha>/check-runs` plus the commit statuses when the repo's CI reports
   through the Status API instead of Checks, never the status rollup, both fetched
   against `--repo <owner/repo>`. These reads are the floor's PR-gate probes — identity
   and state from the first, CI for the named SHA from the rest — and anything beyond
   reading them becomes a verifier dispatch. A read-only item — one whose brief released
   it from the commit, push and PR line — has no PR to check: its report's evidence is the
   completion, the verifier still checks it (step 7), the review, the disposition and
   the merge (steps 8-12) do not apply to it, and its seat and any workspace it used are
   released there, as Teardown says, since no later step releases them for it.
7. **Verify, once per work item.** One verifier session per work item, one brief
   listing every claim: each acceptance criterion of the work item's spec, the
   mutation of any new test, and the diff against the requirement. The suite result
   on the head is not a claim — the orchestrator reads that SHA's check-runs before
   dispatching the verifier. The verifier seat runs at the effort its profile
   names — the claims include judgment, and `cannot determine` counts as fail.
   On a fail, attach a fix task to the retained implementer by sending it the
   fast-implementer brief with the verifier's claims for a TASK (`briefs.md`;
   `paseo-mechanics.md` says how), wait for its report file
   naming the new head SHA, read that SHA's check-runs, then re-check on the retained
   verifier; a second fail on the same item goes to the operator. The verifier is
   released only at pass or escalation.
8. **Review.** A review runs exactly once per PR: the reviewer seat in a fresh worktree
   at the PR head, brief `/code-review <PR>`, every finding returned in the report file.
   **Every pushed head gets a reviewed delta before the merge ask**: a fixed head is
   revalidated over the fix range alone, never re-reviewed whole, and its findings enter the
   disposition baseline like any other, so a repository whose bot does not review a push still
   reaches a complete signal on the head it asks about. Every finding returned in the report file
   as file, line, severity, claim. The reviewer posts nothing to GitHub and edits
   nothing, so that file is the sole copy of the review. Its report file must validate
   before release — findings lines present in the stated schema, or
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
    whole-PR `/code-review` — a fixed head gets the scoped delta pass step 8 requires.
    Bot comments after each push stay in this stream, and review
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
    threads, `autoMergeRequest` null (nothing already scheduled to land this head),
    and the non-thread signals of review bodies and PR conversation comments,
    which are clean when every finding in them has a terminal state recorded in the
    disposition comment (step 10).
    Ask only when every one is clean: a non-mergeable state is surfaced to the operator
    as the blocker instead of asking, and a new actionable finding returns to step 10.
    Ask the operator for the merge word naming that SHA.
    Merge only on that word, as a merge commit, never a squash, bound to the approved
    SHA: re-fetch the same full gate set for that SHA once more, then
    `gh pr merge <number> --repo <owner/repo> --merge --match-head-commit <sha>` —
    the orchestrator often sits outside the PR's repository, so every
    read and the merge name the repo. On a branch governed by a merge queue the command
    never merges: with required checks pending it enables auto-merge, and with them
    passing it enqueues the PR — either way a later landing bypasses this step's own
    revalidation. So confirm `MERGED` at the named SHA: when the command left one of
    those states instead, undo it (`dequeuePullRequest` on GitHub; `gh pr merge --disable-auto`
    for the auto-merge arm) and surface the repo's queue to the operator
    as the blocker — this step never leaves a merge scheduled. The read and merge are two
    operations — a signal can still land between them: the ruleset
    requires conversation resolution, GitHub refuses the merge while any thread
    is open, and a refusal returns to step 10, never a retry. Then release the workers
    whose retention ends here (`roles.md`), as Teardown directs — its settled-status gate,
    and the operator's tab confirmation before a run-created workspace is archived — and
    delete the branch only after confirming a merged PR exists whose head OID equals the
    branch tip — on an activated ossify spine (1b) the merge lands on the word you relay
    under that dispatch's `MERGE_EXECUTOR` assignment — always a merge commit on the named
    SHA, session or operator — and that wait covers the top's spine-level teardown alone —
    work-PR seats released when their work finished. **A closed spine has no PR to confirm**,
    so its teardown validates the close's own result instead — the local landing it
    recorded in each hosting repo — and waits for no record pass.
13. **Handoff.** If the run outlives the session, write a handoff naming the run's
    `run.json` path, task ids, head SHA, and the next step — every seat's agent id, and,
    per live dispatch, its `REPORT_PATH`, the hash last noted, the file's identity, its
    `DISPATCHED_AT`, `TIME_BUDGET` and `SETTLE_WINDOW`; on an activated
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
handoff says which step was the operator's. A replacement for a **retained** role keeps
that role's lifetime: an `implementer` or `verifier` replacement is retained across
items and the fail-and-fix cycle, and a `reviewer` replacement through the PR's fix
rounds, each released when the built-in would be, never at its dispatch's end —
step 7's correction, step 8's reviewed delta and step 10's fixes need the seat to
exist. Every point above is the top's own — a
declared role is not yet carried into a delegated spine or work-PR session, so a
`before-merge-ask` role does not fire on an activated spine (issue #500 holds it).

## Rotation past the context ceiling

paseo-crew's hook tells a session its own context figure once it reaches the ceiling (the
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
operator question in flight. Live child dispatches keep running, but nothing
inherits their waits: they are this session's background calls, and rebinding a
`run.json` re-arms nothing. Write the handoff, recording every seat's agent id, and, per live dispatch, its `REPORT_PATH`, the hash last noted, the file's identity, its `DISPATCHED_AT`, `TIME_BUDGET` and `SETTLE_WINDOW` — your own resolved profile
travels with it too — `/ossify:handoff` with ossify installed, the same file by hand
without it.

Then follow `paseo-mechanics.md`'s Handoff (D3), in the order it fixes so that no
seat ever has two waiters and one report wakes one orchestrator: **materialise your
successor's profile first** — its two gaps resolved — so a halt there leaves this
session the orchestrator with its waits still armed. Then **stand down** — kill this
session's armed background waits and `delete_heartbeat`, and take no further
dispatch action — and **launch the successor as `paseo-mechanics.md`'s Handoff
states: detached, in this session's workspace, its resume as the launch prompt,
verified settled and parentless.** A failed launch is cancelled with `cancel_agent`
and never archived; this session re-arms its own waits and a fresh heartbeat from
the handoff it just wrote, reports the failed successor's agent id to the operator, and
remains the orchestrator. The run file's `run.orchestrator` block still names
this session's seat after the handover — the field dagr routes the operator's messages
to — and the successor does not rebind it: issue #556 holds that gap.
One report must wake one top — a live dispatch a successor is also
waiting on otherwise advances twice, and a close, a PR or a merge runs twice with it.
After stand-down every wake this session gets — a child seat's finish notice, a
heartbeat turn, a wait that fires anyway — is read and handed to the successor, never
acted on, unless a failed launch made it the orchestrator again. On success, tell the
operator which agent is now the orchestrator, and that this session stays unarchived
until the run's inherited seats are gone.
The new top resumes by naming the parent's `run.json` path — there is no CLI call —
and then, before the step the handoff named, re-arms with one fresh background wait
per live dispatch the handoff listed, and a fresh heartbeat: a new session's first
wait, not a re-entry, which re-arms what the `run.json` cannot — and it can re-arm
them because the predecessor stood down, so each dispatch has exactly one waiter.
