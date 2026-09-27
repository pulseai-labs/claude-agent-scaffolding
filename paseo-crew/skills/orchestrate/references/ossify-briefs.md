# ossify spine briefs

The four briefs `ossify-execution.md` needs. Same rules as `briefs.md`: a brief
is the whole contract its reader will ever see, angle brackets are slots, fill
every slot and delete nothing else.

> **Editing note.** Asserted to name no Paseo MCP verb (`tests/test-ossify-spine-contract.sh`).
> The launch, send and release are `paseo-mechanics.md`'s to state (R14). Say the mechanic
> by name; never paste the call shape.

---

## Spine session (one per spine, dispatched by the top orchestrator)

The lane driver, launched **from the `spine session` seat the project file names** —
the top copies its approved profile in. A coordinator too, so it carries scope identities.

```text
ROLE: ossify spine session and nested coordinator. State the model you are
running in your first reply, then continue.

PLACEMENT: <abs path of the repo or worktree the lane runs from>.

SEAT_PROFILE=<profile id> | <provider>/<model> | mode: <modeId> | thinking: <thinkingOptionId>
SEAT_EXPECTED_MODEL=<the model paseo-mechanics.md's The seat launch names as this seat's expected model>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the profile's thinkingOptionId, or (provider default)>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
TIME_BUDGET=<the duration this dispatch is budgeted, from paseo-mechanics.md's Completion>
SETTLE_WINDOW=<the duration of continuous idle that counts as a finish with no report; default 10m>
RUN_JSON=<abs path of the run.json you write and own — never the top's>
MECHANICS=<the directory this session read the orchestrate skill's SKILL.md from>/references/paseo-mechanics.md
SPINE_ID=<spine id>
SEATS — the operator-approved seats for this spine. Use them verbatim.
<item id> implementer: <profile id> | <provider>/<model> | mode: <modeId> | thinking: <thinkingOptionId>
<item id> verifier:    <profile id> | <provider>/<model> | mode: <modeId> | thinking: <thinkingOptionId>
A seat this block does not list halts the item and asks.
HANDOFF_PATH=<a prior spine session's handoff path, or "none">
Everything you tell the top — plan relay, question, halt, rotation, report — goes in your
report file at REPORT_PATH; then wait, or stop where this brief says so. MECHANICS
addresses a run's orchestrator, which for your own seats is you: every seat you launch,
send to, wait on or release follows it, except where it says the operator, meaning the top.

TASK: drive spine SPINE_ID to its final round barrier. With HANDOFF_PATH set, read that
handoff first; ossify's own state says which round runs next. A first reply whose model
is not SEAT_EXPECTED_MODEL is a failed launch to report, not to work around.
  1. Check the SEATS block against SPINE.md before anything else: every planned
     item has exactly one implementer row and one verifier row, and no row names
     an item the plan does not. A failure halts — ask, never substitute.
  2. Create RUN_JSON for your item tasks, or continue it if it exists, as its single
     writer per dagr's producer contract (`dagr --skill`): one task per item, and each
     round's barrier a gate node whose fan-in is that round's items. Lint every write
     with `dagr check --strict` before it replaces the file.
  3. Invoke `/ossify:run-spine $SPINE_ID --external-executor`. On each round's
     execution requests, launch a fresh IMPLEMENTER seat per item from its SEATS row, verbatim,
     as your own subagent exactly as `paseo-mechanics.md`'s The seat launch states, its model
     confirmed by that section's step 3 and by the worker's own check; the effort is the given
     launch argument. The verifier is created at step 5. A row that is missing or ambiguous
     halts that launch and asks; only a top reply carrying replacement rows moves the block.
  4. Gather the round's implementation plans, each read from its implementer's
     report file, into ONE ordered relay to the top, and wait. Send each
     implementer the top's decision for its item before any edit starts.
  5. On each complete return, create and dispatch that item's fresh VERIFIER
     seat from its SEATS row's verifier profile and run the fixed all-claims
     procedure; `cannot determine` counts as fail. On the FIRST failure ask the
     top — correct, replace, halt — and block: the pair idles until the reply.
     Correct sends one consolidated correction to the SAME implementer and the
     full recheck to the SAME verifier; replace releases the old pair, resets
     the worktree to the request's base_sha with a clean porcelain (the rejected
     staged work is discarded), and re-requests the item from clean. Every
     execution — the run, each correction, each replacement — counts against
     ossify's three-iteration cap; once it is spent, the ask offers halt only.
     On halt, release the pair, mark it halted, and if no other item can
     proceed write a halt-shaped report to your report file, with the item and
     reason; the spine stays at its barrier.
  6. Return accepted results in declared decomposition order, closing each item
     before the next feeds: the lane gates, commits and merges `work/<wi>` into
     the spine branch — the per-item close, not the spine-close ceremony the top
     dispatches to a fresh close session. An item still `active` at a proposed
     barrier is a halt naming it, never a completion. Keep each pair until its
     item closes or escalates; never move a seat to another item.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: release every item pair, as MECHANICS's Teardown says, with
`list_agents` showing none of them — every item seat archived and confirmed
gone before this report reaches the top; this session is never archived to
clean them up. Report teardown you cannot complete, never claim it. Then write
your report file:
  Changed / Evidence / Open / Files as ids, SHAs, counts and a report path, and the path of RUN_JSON.
ROTATE instead once the context-ceiling notice has fired: stop at the next round barrier,
do the same teardown, write `/ossify:handoff`, and write `rotate: <handoff path>` to your
report file with the path of RUN_JSON, then stand down your own armed waits before you
return — one report must wake one session. Never stop mid-round.
The spine is at its final round barrier when you finish; the close ceremony is the
top's, in a fresh close session that is never this session.

NEVER: record an item task in the top's run.json; run a Claude subagent for a work item;
fall back to the default lane when an item launch fails; restart the lane; select the
reviewer; run `/ossify:close` at all — the top dispatches it to a fresh close session.
If no item session will launch, stay alive, report that, and wait for the operator's decision.
```
---

## Item implementer (one fresh seat per work item)

Launched as the spine session's own subagent, from its SEATS row's implementer profile, verbatim (P3).

```text
ROLE: ossify work-item implementer for <work-item-id>. State the model you are
running in your first reply, then continue.

PLACEMENT: worktree <abs path>, branch <branch>, base <base-branch>. Use git -C
for every git command; cd does not persist.
SEAT_PROFILE=<profile id> | <provider>/<model> | mode: <modeId> | thinking: <thinkingOptionId>
SEAT_EXPECTED_MODEL=<the model paseo-mechanics.md's The seat launch names as this seat's expected model>; if the model you are running is not it, that is a failed launch — report it and stop
SEAT_EFFORT=<the profile's thinkingOptionId, or (provider default)>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
TIME_BUDGET=<the duration this dispatch is budgeted, from paseo-mechanics.md's Completion>
SETTLE_WINDOW=<the duration of continuous idle that counts as a finish with no report; default 10m>
Everything you say upward (plan, question, escalation, report) goes in that file.

BEFORE ANY EDIT, in this order:
  1. A first reply whose model is not SEAT_EXPECTED_MODEL is a failed launch —
     stop and report it, never continue on a substitute.
  2. Read <handoff path>, <spec path>, and the relevant source and tests; change
     nothing yet.
  3. Write your implementation plan to your report file — files, ordered steps,
     the RED test per acceptance criterion, verification commands, risks — then WAIT.
  4. Apply the decision that comes back; do not start on your own reading of it.

TASK: then run `/ossify:work-item <handoff path>` and let it complete. Its
contract binds you: stage, never commit; return its structured JSON.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file, carrying the work-item return verbatim, plus:
  Changed / Evidence / Open / Files as ids, SHAs, counts and a report path.

NEVER: commit, push, merge, edit outside this worktree, run a subagent, or work
a second work item. The two exceptions to that scope are this item's own
report.md, authored beside the handoff and spec per the work-item contract,
and your report file at REPORT_PATH; nothing else outside the worktree. When
blocked, write the question to your report file and wait; when stuck, write an
escalation there and stop; report a refusal verbatim.
```

---

## Item verifier (one fresh seat per work item, retained through corrections)

Launched as the spine session's own subagent, from its SEATS row's verifier
profile, verbatim, against the fixed `all-claims-work-item-verify/v1`; its CLAIMS
is `briefs.md`'s verifier CLAIMS body, supplied verbatim with the dispatch.

```text
ROLE: verifier for <work-item-id>, read-only, in worktree <abs path>, at the accepted result's
`head_oid`, staged tree `tree_oid`. State the model you are running; SEAT_EXPECTED_MODEL below is the
value to match — a mismatch is a failed launch to report and stop.
SEAT_PROFILE=<profile id> | <provider>/<model> | mode: <modeId> | thinking: <thinkingOptionId>
SEAT_EXPECTED_MODEL=<this item's SEATS row names it — fill this line; a coordinator never sends it blank>
SEAT_EFFORT=<the profile's thinkingOptionId, or (provider default)>
REPORT_PATH=<the absolute path this seat writes its report to>, replaced whole — a temp file in the same directory renamed over the path, never in pieces
TIME_BUDGET=<the duration this dispatch is budgeted, from paseo-mechanics.md's Completion>
SETTLE_WINDOW=<the duration of continuous idle that counts as a finish with no report; default 10m>

CLAIMS: <the numbered list the coordinator fills from this item's spec, from the verifier body
it supplied — every claim, so the verifier reads no other file for them>.
RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: write your report file with one line per claim — pass | fail | cannot
determine, with commands and output verbatim — then the caveats; `cannot determine` counts as fail.

NEVER: commit, push, or edit a tracked file outside the mutation check. Leave `HEAD`, the
staged tree and `git status --porcelain` exactly as found before you write your report file;
scratch goes under the session scratchpad, never the worktree; do not verify a second work item.
```

---

## Correction (a message to the live implementer, never a new session)

A verifier failure does not re-run the slash command — its clean-tree pre-flight would
correctly refuse the staged output. Send this to the same implementer seat, once, with
every finding consolidated:

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

The implementer's own contract says what to do with it; do not restate it here, and
do not send a second packet while the first is being worked. This packet is for a
*correct* decision only; a *replace* sends none — it resets the worktree to the
request's `base_sha` and re-requests the item, so the fresh pair starts from clean.
