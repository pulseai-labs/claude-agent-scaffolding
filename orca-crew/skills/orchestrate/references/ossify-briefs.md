# ossify spine briefs

The four briefs `ossify-execution.md` needs. Same rules as `briefs.md`: a brief
is the whole contract its reader will ever see, angle brackets are slots, fill
every slot and delete nothing else.

> **Editing note.** Asserted to contain no subagent invocation form
> (`tests/test-ossify-spine-contract.sh`). Say the prohibition; never paste the
> call shape.

---

## Spine session (one per spine, dispatched by the top orchestrator)

The lane driver, launched **from the ratified spine_session block** in the
sidecar, not from this skill's generic lane-driver policy. It is also a
coordinator, which is why its brief carries parent identities.

```text
ROLE: ossify spine session and nested coordinator. State the model you are
running in your first reply, then continue.

PLACEMENT: <abs path of the repo or worktree the lane runs from>.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
PARENT_RUN_ID=<run id>
SPINE_TASK_ID=<task id>
SPINE_DISPATCH_ID=<dispatch id>
SPINE_ID=<spine id>
SPINE_EXPECTED_MODEL=<model id the banner must show>
ORCA_EXECUTION_PATH=<abs path to $SPINE_DIR/orca-execution.md>
SIDECAR_OID=<blob id the top recorded when it wrote the ratified sidecar>

TASK: drive spine SPINE_ID to its final round barrier. A first reply whose model
is not SPINE_EXPECTED_MODEL is a failed launch to report, not to work around.
  1. Read ORCA_EXECUTION_PATH and validate it against SPINE.md before anything
     else: `git hash-object "$(dirname "$ORCA_EXECUTION_PATH")/SPINE.md"` (the
     plan's blob id beside the sidecar) must equal spine_plan_oid; every planned
     item must have exactly one complete row; no row may name an item the plan
     does not; ratification must read exactly `operator-approved`;
     ratified_in_run must equal PARENT_RUN_ID; and spine_id must equal SPINE_ID.
     Any failure halts — ask, never substitute. Then
     `git hash-object "$ORCA_EXECUTION_PATH"` must equal SIDECAR_OID: the checks
     above prove the file valid, not the file the operator ratified, and an
     edited-but-valid row passes every one of them. That value is the baseline
     for every launch below.
  2. Create and bind a CHILD Run for item tasks. Every child task-create,
     worker-start, dispatch and check names --run <child run id>. Every question
     for the top names --run PARENT_RUN_ID. Replies to item questions go on each
     original child message id.
  3. Run `/ossify:run-spine $SPINE_ID --external-executor`. When it hands you a
     round's execution requests, launch one fresh IMPLEMENTER terminal per item
     from that item's exact sidecar command — never a substitute command, model
     or effort. The verifier is not created here; step 5 creates it, once there
     is a complete return to verify. Confirm each model from the launch banner
     and the first reply; the effort is the launch argument you were given.
     Re-run step 1's validation, the spine_session block included,
     immediately before each item terminal is created, and
     require the hash to still equal the baseline;
     any drift halts that launch and asks. Only a top reply
     naming a new SIDECAR_OID, after it rewrote and the operator re-ratified,
     moves it.
  4. Gather the round's implementation plans into ONE ordered ask to the top and
     wait. Relay the top's per-item decision to each implementer on its own
     original message id before any edit starts.
  5. On each complete return, create and dispatch that item's fresh VERIFIER
     terminal from its exact sidecar command and run the fixed all-claims
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
     On halt, release that item's pair, mark the item halted, and if no other item
     can proceed send a halt-shaped worker_done on the injected parent ids naming
     the item and the reason; the spine stays at its current round barrier.
  6. Return accepted results to the lane in declared decomposition order. Keep
     each pair until its item closes or escalates; never move a terminal to
     another item.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: release every item pair first — no terminal of yours outlives the spine —
then one worker_done using SPINE_TASK_ID and SPINE_DISPATCH_ID, the injected
parent ids, so the top's Dispatch settles while your child Run stays bound:
  Changed / Evidence / Open / Files, and the child Run id you bound.
The spine is at its final round barrier when you finish; the close ceremony is
the top's, in a fresh close session that is never this terminal.

NEVER: launch an item terminal in the parent Run; run a Claude subagent for a
work item; fall back to the default nested dispatch after a depth error;
restart the lane; select the reviewer; run `/ossify:close` at all — the top
dispatches it to a fresh close session, never to you. On
`nested_worker_depth_exceeded`, stay alive, report it to the top, and wait for
the operator's decision.
```

---

## Item implementer (one fresh terminal per work item)

Launched from the sidecar row's `implementer_terminal_command` exactly.

```text
ROLE: ossify work-item implementer for <work-item-id>. State the model you are
running in your first reply, then continue.

PLACEMENT: worktree <abs path>, branch <branch>, base <base-branch>. Use git -C
for every git command; cd does not persist.

BEFORE ANY EDIT, in this order:
  1. Confirm the model you are running is <expected model>. If it is not, stop
     and report — do not continue on a substitute.
  2. Read <handoff path>, <spec path>, and the relevant source and tests. Change
     nothing.
  3. Send your implementation plan with `orca orchestration ask`: the files you
     will touch, the ordered steps, the RED test you will write per acceptance
     criterion, the verification commands, and the risks or deviations you
     expect. Then WAIT.
  4. Apply the decision that comes back — approved as written, or amended. Do
     not start on your own reading of it.

TASK: then run `/ossify:work-item <handoff path>` and let it complete. Its
contract binds you: stage, never commit; return its structured JSON.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: worker_done carrying the work-item return verbatim, plus:
  Changed / Evidence / Open / Files.

NEVER: commit, push, merge, edit outside this worktree, run a subagent, or work
a second work item. The one exception to that scope is this item's own
report.md, which the work-item contract has you author beside the handoff and
spec and update on a correction; nothing else outside the worktree. Ask when
blocked; escalate when stuck; report a refusal verbatim.
```

---

## Item verifier (one fresh terminal per work item, retained through corrections)

Launched from the sidecar row's `verifier_terminal_command` exactly. The
procedure is this skill's existing all-claims work-item verification — the
`briefs.md` verifier body, with these placements and this retention.

```text
ROLE: verifier for <work-item-id>, read-only. State the model you are running in
your first reply, then continue.

PLACEMENT: worktree <abs path>, at <head sha>, staged tree <tree oid>.

CLAIMS: <the numbered all-claims list from briefs.md's verifier template, filled
from this item's spec>.

DONE: worker_done with one line per claim — pass | fail | cannot determine, with
commands and output verbatim — then the caveats. `Cannot determine` counts as
fail.

NEVER: commit, push, or edit a tracked file outside the mutation check. Leave
`HEAD`, the staged tree and `git status --porcelain`
exactly as found before `worker_done`; scratch goes under the session
scratchpad, never the worktree. Do
not verify a second work item; you are retained for this one until it passes or
escalates.
```

---

## Correction (a message to the live implementer, never a new session)

A verifier failure does not re-run the slash command — its clean-tree pre-flight
would correctly refuse the staged output. Send this to the same implementer
terminal, once, with every finding consolidated:

```text
OSSIFY CORRECTION CONTINUATION v1
handoff_path: <abs path>
work_item_id: <work-item-id>
expected_branch: <branch from the item's execution request>
expected_head_sha: <head oid from the accepted result>
expected_tree_oid: <tree oid from the accepted result>
failures:
- <one finding per line>
```

The implementer's own contract says what to do with it. Do not restate that
contract here, and do not send a second packet while the first is being worked.
This packet is for a *correct* decision only. A *replace* sends none: it resets the
worktree to the request's `base_sha` and re-requests the item, so the fresh pair has
nothing to adopt and starts as an ordinary first run.
