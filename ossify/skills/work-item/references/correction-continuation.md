# Correction continuation — fixing an item without re-running the command

Depth for SKILL.md §9 and for `references/external-executor.md` §7. This is the
provider-neutral packet that carries a rejected item back to the executor that
built it, and the contract for what the executor does with it.

> **Editing note.** Like its sibling, this file is asserted to contain no
> subagent *invocation* form. Say the prohibition; do not paste the call shape.

---

## 1. Why a re-dispatch is not the answer

Ordinary `/work-item <handoff-path>` opens with pre-flight Gate 3, which
requires a **clean** worktree (SKILL.md §3). After a run the worktree holds
staged output, so Gate 3 refuses — correctly, and for the right reason: it
cannot tell your staged work from a stranger's. Re-dispatching into that state
burns the 3-iteration cap on a condition no clarification can answer, which is
exactly the trap `round-orchestration.md` §6 names for a crashed worker.

So a correction is a **continuation of the same run**, not a new one. It goes to
the same executor, on the same item, and it is the only thing that may skip a
gate.

---

## 2. The packet

```text
OSSIFY CORRECTION CONTINUATION v1
handoff_path: /abs/docs/specs/r7/r7.s2-schema/work-r7.s2.w1/handoff.md
work_item_id: r7.s2.w1
expected_branch: work/r7.s2.w1-schema
expected_head_sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
expected_tree_oid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
failures:
- AC-2 fails when the persisted record is reloaded after restart
```

Six fields, all required. `expected_branch` is the `branch` the item's execution
request carried (`references/external-executor.md` §3); `expected_head_sha` and
`expected_tree_oid` are the `head_oid` and `tree_oid` its result declared (§4),
carried back unchanged. **All four identities the check in §3 compares are in the
packet** — that is the point of carrying them rather than re-deriving them.
`failures` is the **consolidated** list — every finding from the rejection in one
packet, not one packet per finding.

The packet names no tool, no session and no model. Who delivers it is the
caller's business; what it means is this file's.

---

## 3. What the executor does with it

In order. The first step is a gate and it fails closed.

1. **Re-read `handoff.md`, `spec.md` and `report.md`, end to end.** The
   continuation is not a substitute for them and does not restate them. If the
   rejection added clarifications, they are in the handoff, which is why the
   re-read is first and not optional.
2. **Confirm identity, and refuse on any mismatch.** Four comparisons, each
   against a value the packet carries: the work item id against `work_item_id`,
   the checked-out branch against `expected_branch`, `HEAD` against
   `expected_head_sha`, and the staged tree against `expected_tree_oid`. A
   mismatch means this is not the run that produced the rejected result
   — someone else's work, a different item, a moved branch, a re-staged tree —
   and continuing would edit a state nobody reviewed. Refuse, name which of the
   four disagreed, and stop. Do not re-derive the packet's values from what you
   find; the packet is the claim being checked.
3. **Skip exactly two things, and nothing else:** the initial clean-tree
   pre-flight (SKILL.md §3 gate 3) and the RED gate (§4). They are skipped
   because they already ran on this run and their preconditions are gone, not
   because they stopped mattering. Every other gate, rule and NEVER in SKILL.md
   §3–§10 still binds — including the whole of §10.
4. **Add or adjust the targeted regression FIRST**, before the fix. A
   correction whose test is written afterwards proves nothing about the failure
   it claims to close, which is the same RED→GREEN discipline §5 asks for and
   the reason the RED gate existed in the first place.
5. **Apply the consolidated corrections** — all of `failures`, not the first
   one.
6. **Re-run every verification command in the handoff**, all of them, without
   halting on the first failure (SKILL.md §6). A correction that reruns only the
   failing command reports a green it did not measure.
7. **Update the SAME `report.md`.** Edit it; do not author a second report and
   do not append a parallel section set. Its ten sections are a machine contract
   (`references/report-contract.md`) and the close reads them by name.
8. **Stage, and return the existing `complete` shape** (`references/returns.md`
   §2). There is no third return mode, no new field, and no correction-specific
   envelope. The close that rejected the item is the close that reads this one.

**No commit, no push, no state write, no spec mutation** — SKILL.md §10 in
full, unchanged. The commit boundary is still the orchestrator's.

---

## 4. What this does not change

- **The recovery menu.** `close/references/impl-check.md` §6 still owns it,
  still presents all three options, and is still never auto-selected. A
  continuation is what option 1 *becomes* when the lane is in external mode; it
  is not a fourth option and it is not chosen here.
- **The 3-iteration cap.** A continuation is a dispatch of that item and counts
  as one (`round-orchestration.md` §6).
- **The lane's own validation.** Under external mode the repaired item returns to
  the lane as a fresh `external_execution_result` and passes the whole of
  `references/external-executor.md` §5a again, identity table included. The
  `complete` shape this file returns is the executor's half of that record, never
  a substitute for it.
- **The second-failure escalation.** A correction that fails its recheck goes
  to the operator, exactly as before.
- **Merge-conflict and post-commit recovery.** Untouched
  (`close/references/work-item-close.md` §4, `merge-conflict-resolution.md`).
- **The default no-flag path.** It never produces a continuation, because its
  recovery is the re-dispatch the cap was written for.
