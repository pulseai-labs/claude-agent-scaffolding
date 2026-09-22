# ossify spine briefs

The four briefs `ossify-execution.md` needs. Same rules as `briefs.md`: a brief
is the whole contract its reader will ever see, angle brackets are slots, fill
every slot and delete nothing else.

> **Editing note.** Asserted to contain no subagent invocation form
> (`tests/test-ossify-spine-contract.sh`). Say the prohibition; never paste the
> call shape.

---

## Spine session (one per spine, dispatched by the top orchestrator)

The lane driver, launched **from the `spine session` seat the project file names** —
the top copies its approved profile in. A coordinator too, so it carries scope identities.

```text
ROLE: ossify spine session and nested coordinator. State the model you are
running in your first reply, then continue.

PLACEMENT: <abs path of the repo or worktree the lane runs from>.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
RUN_JSON=<abs path of the run.json you write and own — never the top's>
MECHANICS=<the directory this session read the orchestrate skill's SKILL.md from>/references/herdr-mechanics.md
SPINE_ID=<spine id>
SPINE_COMMAND=<the command this seat was launched with, from its machine entry>
SPINE_EXPECTED_MODEL=<the model the banner or screen must show>
SPINE_EFFORT=<the effort this seat was launched at>
SEATS — the operator-approved seats for this spine. Use them verbatim.
<item id> implementer: <command> | model: <expected model> | effort: <effort> | model_shows: <banner|screen> | brief_delivery: <inject|file>
<item id> verifier:    <command> | model: <expected model> | effort: <effort> | model_shows: <banner|screen> | brief_delivery: <inject|file>
A seat this block does not list halts the item and asks.
HANDOFF_PATH=<a prior spine session's handoff path, or "none">
Everything you tell the top — plan relay, question, halt, rotation, report — goes in your
report file at REPORT_PATH; then wait, or stop where this brief says so. Your first herdr
command is `herdr --skill`. MECHANICS addresses a run's orchestrator, which for your own
seats is you: every seat you launch, send to, wait on or release follows it, except that
where it says the operator, you mean the top, through your report file.

TASK: drive spine SPINE_ID to its final round barrier. With HANDOFF_PATH set, read that
handoff first; ossify's own state says which round runs next. A first reply whose model
is not SPINE_EXPECTED_MODEL is a failed launch to report, not to work around.
  1. Check the SEATS block against SPINE.md before anything else: every planned
     item has exactly one implementer row and one verifier row, and no row names
     an item the plan does not. A failure halts — ask, never substitute.
  2. Create RUN_JSON for your item tasks, or continue it if it exists, as its single
     writer per dagr's producer contract (`dagr --skill`): one task per item, and each
     round's barrier a gate node whose fan-in is that round's items. Lint every write
     with `dagr check --strict` before it replaces the file.
  3. Invoke `/ossify:run-spine $SPINE_ID --external-executor`. On the round's
     execution requests, launch a fresh IMPLEMENTER seat per item from its SEATS row, verbatim —
     never a substitute value — as a tab of the workspace you create for your run (created
     again first if `herdr workspace list` no longer shows it: closing its last pane may take
     it), its `--cwd` the worktree ossify prepared. The verifier is created at step 5, once
     a complete return exists. Confirm each model as its row's `model_shows` says and by
     the worker's own check; the effort is the given launch argument. A row that is missing or
     ambiguous halts that launch and asks; only a top reply carrying replacement rows moves the block.
  4. Gather the round's implementation plans, each read from its implementer's
     report file, into ONE ordered relay to the top, and wait. Send each
     implementer the top's decision for its item before any edit starts.
  5. On each complete return, create and dispatch that item's fresh VERIFIER
     seat from its SEATS row's verifier command and run the fixed all-claims
     procedure; `cannot determine` counts as fail. On the FIRST failure ask the
     top, with the verifier's summary and the three options — correct, replace,
     halt — and block: the pair idles until the reply. Correct sends one
     consolidated correction to the SAME implementer and the full recheck to the
     SAME verifier; replace releases the old pair, resets that item's worktree to
     the request's base_sha with a clean porcelain (the rejected staged work is
     discarded), and re-requests the item so the fresh pair runs the ordinary
     work-item entry from clean; a second failure asks again. Every execution of
     an item — the initial run, each correction, each replacement — counts against
     ossify's three-iteration cap, and once it is spent the ask offers halt only.
     On halt, release that item's pair, mark it halted in your own state, and if no
     other item can proceed write a halt-shaped report to your report file, with the
     item and reason; the spine stays at its barrier.
  6. Return accepted results in declared decomposition order, closing each item
     before the next feeds: the lane gates, commits and merges `work/<wi>` into
     the spine branch — the per-item close, not the spine-close ceremony the top
     dispatches to a fresh close session. An item still `active` at a proposed
     barrier is a halt naming it, never a completion. Keep each pair until its
     item closes or escalates; never move a seat to another item.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: release every item pair and close the workspace you created for them,
as MECHANICS's Teardown says, with `herdr workspace list` showing none of them; report
teardown you cannot complete, never claim it. Then write your report file:
  Changed / Evidence / Open / Files as ids, SHAs, counts and a report path, and the path of RUN_JSON.
ROTATE instead once the context-ceiling notice has fired: stop at the next round barrier,
do the same teardown, write `/ossify:handoff`, and write `rotate: <handoff path>` to your
report file with the path of RUN_JSON, then stand down your own armed waits before you
return — one report must wake one session. Never stop mid-round.
The spine is at its final round barrier when you finish; the close ceremony is
the top's, in a fresh close session that is never this session.

NEVER: record an item task in the top's run.json; run a Claude subagent for a work item;
fall back to the default lane when an item launch fails; restart the lane; select the
reviewer; run `/ossify:close` at all — the top dispatches it to a fresh close session.
If no item session will launch, stay alive, report that, and wait for the operator's decision.
```

---

## Item implementer (one fresh seat per work item)

Launched from its SEATS row's implementer command, verbatim.

```text
ROLE: ossify work-item implementer for <work-item-id>. State the model you are
running in your first reply, then continue.

PLACEMENT: worktree <abs path>, branch <branch>, base <base-branch>. Use git -C
for every git command; cd does not persist.
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
Everything you say upward (plan, question, escalation, report) goes in that file.

BEFORE ANY EDIT, in this order:
  1. Confirm the model you are running is <expected model>. If it is not, stop
     and report — do not continue on a substitute.
  2. Read <handoff path>, <spec path>, and the relevant source and tests. Change
     nothing.
  3. Write your implementation plan to your report file: the files you will
     touch, the ordered steps, the RED test you will write per acceptance
     criterion, the verification commands, and the risks or deviations you
     expect. Then WAIT.
  4. Apply the decision that comes back — approved as written, or amended. Do
     not start on your own reading of it.

TASK: then run `/ossify:work-item <handoff path>` and let it complete. Its
contract binds you: stage, never commit; return its structured JSON.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file, carrying the work-item return verbatim, plus:
  Changed / Evidence / Open / Files as ids, SHAs, counts and a report path.

NEVER: commit, push, merge, edit outside this worktree, run a subagent, or work
a second work item. The two exceptions to that scope are this item's own
report.md, which the work-item contract has you author beside the handoff and
spec and update on a correction, and your report file at REPORT_PATH; nothing
else outside the worktree. When blocked, write the question to your report file
and wait; when stuck, write an escalation there and stop; report a refusal
verbatim.
```

---

## Item verifier (one fresh seat per work item, retained through corrections)

Launched from its SEATS row's verifier command, verbatim. Its procedure is the
fixed `all-claims-work-item-verify/v1`; its CLAIMS is `briefs.md`'s verifier CLAIMS
body, supplied verbatim with the dispatch; its placements and retention are its own.

```text
ROLE: verifier for <work-item-id>, read-only, in worktree <abs path>, at the accepted result's
`head_oid`, staged tree `tree_oid`. State the model you are running; EXPECTED_MODEL below is the
value to match — a mismatch is a failed launch to report and stop.
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
EXPECTED_MODEL=<this item's SEATS row names it — fill this line; a coordinator never sends it blank>

CLAIMS: <the numbered list the coordinator fills from this item's spec, from the verifier body
it supplied — every claim, so the verifier reads no other file for them>.

DONE: write your report file with one line per claim — pass | fail | cannot
determine, with commands and output verbatim — then the caveats. `Cannot
determine` counts as fail.

NEVER: commit, push, or edit a tracked file outside the mutation check. Leave `HEAD`, the
staged tree and `git status --porcelain` exactly as found before you write your report file;
scratch goes under the session scratchpad, never the worktree. Do not verify a second
work item; you are retained for this one until it passes or escalates.
```

---

## Correction (a message to the live implementer, never a new session)

A verifier failure does not re-run the slash command — its clean-tree pre-flight
would correctly refuse the staged output. Send this to the same implementer
seat, once, with every finding consolidated:

```text
OSSIFY CORRECTION CONTINUATION v1
handoff_path: <abs path>
work_item_id: <work-item-id>
expected_branch: <the `branch` of the item's execution request>
expected_head_sha: <the `head_oid` of the accepted result>
expected_tree_oid: <the `tree_oid` of the accepted result>
failures:
- <one finding per line>
```

The implementer's own contract says what to do with it. Do not restate that contract
here, and do not send a second packet while the first is being worked. This packet is
for a *correct* decision only; a *replace* sends none — it resets the worktree to the
request's `base_sha` and re-requests the item, so the fresh pair starts from clean.
