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
the top copies its approved profile into the brief.
It is also a coordinator, which is why its brief carries scope identities.

```text
ROLE: ossify spine session and nested coordinator. State the model you are
running in your first reply, then continue.

PLACEMENT: <abs path of the repo or worktree the lane runs from>.

INJECTED IDENTITIES — use these verbatim; do not rediscover them:
PARENT_RUN_ID=<run id>
SPINE_ID=<spine id>
SPINE_COMMAND=<the command this seat was launched with, from its machine entry>
SPINE_EXPECTED_MODEL=<model id the banner must show>
SPINE_EFFORT=<the effort this seat was launched at>
SEATS — the operator-approved seats for this spine. Use them verbatim.
<item id> implementer: <command> | model: <expected model> | effort: <effort> | model_shows: <banner|screen> | brief_delivery: <inject|file>
<item id> verifier:    <command> | model: <expected model> | effort: <effort> | model_shows: <banner|screen> | brief_delivery: <inject|file>
A seat this block does not list halts the item and asks.
OPERATOR_ROLES=<each declared after-implementer role: <name> | agent: <resolved profile row> | blocks: <yes|no> | brief: <path> — or "none">
HANDOFF_PATH=<a prior spine session's handoff path, or "none">
TASK/DISPATCH: your task and dispatch identities come from the Orca preamble injected
into this terminal; spend those verbatim — never placeholders, never ids predicted
before it existed. Capture them, and PARENT_RUN_ID, before binding your child Run.

TASK: drive spine SPINE_ID to its final round barrier. With HANDOFF_PATH set, read that
handoff first; ossify's own state says which round runs next. A first reply whose model
is not SPINE_EXPECTED_MODEL is a failed launch to report, not to work around.
  1. Check the SEATS block against SPINE.md before anything else: every planned
     item has exactly one implementer row and one verifier row, and no row names
     an item the plan does not. A failure halts — ask, never substitute.
  2. Create and bind a CHILD Run for item tasks. Child task-create, worker-start,
     dispatch and check name --run <child run id>, questions for the top name
     --run PARENT_RUN_ID; item replies go on each original child message id.
  3. Run `/ossify:run-spine $SPINE_ID --external-executor`. On the round's
     execution requests, launch a fresh IMPLEMENTER terminal per item from its SEATS row, verbatim —
     never a substitute value. The
     verifier is created at step 5, once a complete return exists. Confirm each
     model as its row's `model_shows` says and from the first reply; the effort is the given launch
     argument. A row that is missing or ambiguous halts that launch and asks;
     only a top reply carrying replacement rows moves the block.
  4. Gather the round's implementation plans into ONE ordered ask to the top and
     wait. Relay the top's per-item decision to each implementer on its own
     original message id before any edit starts.
  5. On each complete return, spend every OPERATOR_ROLES role first — dispatch
     its seat from its row with its `brief:` file; `blocks: yes` holds the item:
     relay the summary to the top and wait for its reply — then create and dispatch that item's fresh VERIFIER
     terminal from its SEATS row's verifier command and run the fixed all-claims
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
     can proceed send a halt-shaped worker_done on the identities your injected
     Orca preamble names, with the item and reason; the spine stays at its barrier.
  6. Return accepted results in declared decomposition order, closing each item
     before the next feeds: the lane gates, commits and merges `work/<wi>` into
     the spine branch — the per-item close, not the spine-close ceremony the top
     dispatches to a fresh close session. An item still `active` at a proposed
     barrier is a halt naming it, never a completion. Keep each pair until its
     item closes or escalates; never move a terminal to another item.

RULES THAT DO NOT LOAD HERE: <paste verbatim, or "none">.

DONE: release every item pair, then close each item terminal — worker-release
does no cleanup on an alias-launched terminal, so run
`orca terminal close --terminal <handle>` on each terminal you created and
verify `orca terminal list` shows none of them, closing only terminals you can
prove are yours — never an active, reused, unrelated or unprovable identity — and
report teardown you cannot complete rather than claiming it. Then one
worker_done on the identities your injected Orca preamble names, settling the
top's Dispatch while your child Run stays bound:
  Changed / Evidence / Open / Files as ids, SHAs, counts and a report path, and the child Run id you bound.
ROTATE instead once the context-ceiling notice has fired: stop at the next round
barrier, do the same teardown, write `/ossify:handoff`, and send worker_done
`rotate: <handoff path>` with the child Run id. Never stop mid-round.
The spine is at its final round barrier when you finish; the close ceremony is
the top's, in a fresh close session that is never this terminal.

NEVER: launch an item terminal in the parent Run; run a Claude subagent for a
work item; fall back to the default nested dispatch after a depth error;
restart the lane; select the reviewer; run `/ossify:close` at all — the top
dispatches it to a fresh close session. On `nested_worker_depth_exceeded`, stay
alive, report it to the top, and wait for the operator's decision.
```

---

## Item implementer (one fresh terminal per work item)

Launched from its SEATS row's implementer command, verbatim.

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
  Changed / Evidence / Open / Files as ids, SHAs, counts and a report path.

NEVER: commit, push, merge, edit outside this worktree, run a subagent, or work
a second work item. The one exception to that scope is this item's own
report.md, which the work-item contract has you author beside the handoff and
spec and update on a correction; nothing else outside the worktree. Ask when
blocked; escalate when stuck; report a refusal verbatim.
```

---

## Item verifier (one fresh terminal per work item, retained through corrections)

Launched from its SEATS row's verifier command, verbatim. The
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

The implementer's own contract says what to do with it. Do not restate that contract
here, and do not send a second packet while the first is being worked. This packet is
for a *correct* decision only; a *replace* sends none — it resets the worktree to the
request's `base_sha` and re-requests the item, so the fresh pair starts from clean.
