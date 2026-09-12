# Rubric: external-executor

Score each 1-5 (5 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`nested` | `external` | `halt` | `gap-loop`. `nested` = the lane dispatches its
own `ossify:implementer-agent` per work item. `external` = the lane hands the
round to the caller-supplied in-session procedure and processes the results it
returns. `halt` = the lane stops the round, naming the failing check, without
falling back to the nested path. `gap-loop` = the item re-enters
`round-orchestration.md` §6 (clarifications appended to the handoff, then one
new single-item request through the caller, under the 3-iteration cap) rather
than halting or reaching close.

**Every criterion is scored on every fixture.** A criterion whose own condition
never fires on a fixture is scored on whether the output stayed correctly silent
about it — and an unexercised criterion **caps at 4** (consistent with the
contract, not demonstrated by this scenario). **5 requires the scenario to have
actually exercised it.** There is no N/A.

**Score only what the scenario supplies.** If the fixture body does not state a
fact, an output that does not decide it is not penalised; an output that invents
that fact and decides on it is.

1. **The mode split is exact, and the default is untouched.** `/run-spine
   <spine-id>` with no flag keeps dispatching `ossify:implementer-agent`;
   `/run-spine <spine-id> --external-executor` hands execution to a
   caller-supplied procedure and calls no subagent. The flag is never inferred
   from context, an installed tool, or the presence of a caller; a malformed,
   reordered, duplicated or unknown argument is refused **before** the
   spine-branch cut, any worktree, and any state write. Treating external mode
   as a degraded variant of the nested path, or letting either mode silently
   become the other, is a wrong answer even when the fixture's verdict is
   otherwise right.
2. **Round sequencing and ordering survive the seam.** In external mode every
   same-round worktree is created and journaled and every handoff authored — in
   declared decomposition order — **before** any request is built; then one
   request per item, and the caller procedure is invoked once for the round.
   The caller may execute a round concurrently. Accepted results are processed
   into close in **declared decomposition order, never arrival order**; closes
   and merges stay serial; the round barrier is unchanged. An output that closes
   items in the order their results arrived is a wrong answer even if every item
   eventually closes.
3. **Validating a COMPLETE result is a real gate, and every one of its checks
   is terminal.** Item-set equality runs first and spans **both** envelope kinds
   — exactly one envelope per request across the complete records and the gaps
   records together — and only then does each go to its own list. For a §4
   record: every declared field and no other, with `implementer_return` carrying
   exactly the four complete-return keys; `coordinator_verdict` is `accepted`;
   `mode` is `complete`; and one **identity** check recomputed against the
   **request**, not merely against the record — the checked-out branch is the
   request's `branch`; `HEAD` equals both the request's `base_sha` and the
   declared `head_oid`; the staged tree equals `tree_oid`; the working tree
   carries nothing beyond the index, so `all_staged` is recomputed rather than
   trusted; the report is the one beside the request's `spec_path` and
   `handoff_path` rather than any file that hashes right; and those two files'
   blob ids equal `report_oid` and `spec_oid`. Branching this list on `mode` is a
   wrong answer: the two shapes are separate records (criterion 4). So is
   accepting a record because it "looks complete", reading a declared id back as
   if it were the recomputed one, or checking identity only against the record —
   an executor that commits and then stages again agrees with itself.
4. **A gaps-surfaced return is its own record, and it routes rather than
   halting.** An item stopped at pre-flight produced no report, no staged tree
   and no commit, so it comes back under a **separate marker** carrying only
   `work_item_id`, `coordinator_verdict` and an `implementer_return` in the gaps
   shape — **no `*_oid` of any kind**, and a record carrying one is describing
   work that did not happen. **It is validated before it routes** — exactly those
   three fields, `accepted`, `gaps-surfaced`, a non-empty schema-valid `gaps` —
   and the worktree is checked clean at `base_sha`, and on the request's `branch`,
   before the replacement request goes out, because this record carries no identity
   of its own. A valid one then
   enters `round-orchestration.md`
   §6's gap loop **with that loop's dispatch step replaced**: gaps surfaced,
   clarifications appended to **that item's handoff**, then **one new
   single-item request** issued through the caller-supplied procedure, counted
   against the 3-iteration cap — and it never reaches close as a result.
   Calling it a halt, a malformed result, or a reason to abandon the round is a
   wrong answer; so is routing it past the gap loop straight into close. **In
   this mode the lane dispatches nothing itself**, and it does not say which
   executor the caller reuses — an answer that has ossify re-dispatching "the
   same live implementer" is describing the default nested path, not this one.
5. **Correction is same-executor, and Layer 4 goes inline under this mode.** A
   rejected item is repaired by a continuation sent to the **same** executor
   that produced it, because the ordinary command's clean-tree pre-flight would
   correctly refuse the staged output; the continuation re-reads
   handoff/spec/report, refuses on any item/branch/HEAD/staged-tree mismatch,
   writes the targeted regression before the fix, reruns every verification
   command, updates the same report, stages, and returns the **existing**
   `complete` shape — no third return mode and no commit — and the repaired item
   comes back to the lane as a fresh §4 record that passes the whole of criterion
   3 again, identity included, rather than being accepted on the continuation's
   inner shape. Separately, external
   mode runs Layer 4 **inline** even where the delegated path's own conditions
   are otherwise satisfied, while the no-flag path's choice of the delegated
   path is unchanged. Inventing a new return mode, sending the correction to a
   fresh executor, or spending the delegated six-agent pass under external mode
   is a wrong answer.

## Output format
`{"scores":{"mode_split":N,"round_sequencing":N,"result_validation":N,"gaps_routing":N,"correction_and_layer4":N},"pass":true|false,"notes":"<one sentence; where any criterion scores below 5, name the cause>"}`. Pass = all ≥4. JSON only.
