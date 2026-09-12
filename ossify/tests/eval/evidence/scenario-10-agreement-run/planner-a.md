I read all three skills (SKILL.md + every reference) before judging. Findings below.

## Summary

1. **Ladder label — `MVP`** (rolling-wave §4: independent usability, evidence-gated, not counted).
2. **Spine class — `bone`**, overruling the declared `flesh` (class-declaration rung 2 / bone-touch judge: `src/storage/segment.rs` is inside a registered bone surface; the declared class is a claim, the surface is a fact).
3. **Risk gate — warranted.** Family **destructive**; touch surface `src/retention/**,src/storage/segment.rs`. Register it now (risk-gates §1, §5).
4. **Mandatory controls — paper/sandbox env + human confirm + audit trail** (risk-gates §2 rule of thumb for destructive), attached to this spine as required work; separately, the `open-core` posture makes the standing `[community-edition]` `auto:` ledger line a MUST the project owes (demo-authoring §1).

---

## 1. Ladder label: `MVP`

Rule: `plan-release/references/rolling-wave.md` §4 — the ladder is **Skeleton (Release 0) -> MVP -> v1 -> vN**, evidence-gated, not counted.

MVP is defined there as "the release at which the product can be used independently — cold start, real data lifecycle, a recovery path appropriate to solo scale." All three are met at this release and were not met before it:

- **cold start** — installs from a published artifact with no hand-holding (previously: operator-driven guided flows). Same shape as `start`'s clean-checkout test (`start/SKILL.md` §6).
- **real data lifecycle** — ingests a real series and queries it back.
- **recovery path at solo scale** — documented `pulsedb repair`, no operator intervention.

What does **not** decide it: "the third release." §4 states MVP "is not 'release 3', and it is not 'skeleton plus N spines' as an arithmetic rule."

Not `v2`: §4 requires a changed product promise, a new primary journey, or an intentionally breaking public contract. The scenario negates all three explicitly.

The absent date is correct, not a gap: §5 anti-pattern — "Dating releases. The ladder is evidence-gated; a date is a wish."

The sketch's "next: v1 once the retention policy engine lands" is admissible only as a hypothesis (§4). It binds nothing here, and is worth flagging at the next groom: its stated condition — the retention engine — is being satisfied *in this release*, so the sketch is already stale as an input.

## 2. Spine class: `bone` — rung 2, bone-touch

Rule: `plan-release/references/class-declaration.md` §1 + `references/bone-touch-judge.md`.

- **Rung 1 (journey gate) passes** — not an `internal-enabler`. The proposed `user:` line is an actor performing an action for value with an observable outcome. Nearly verbatim the ACCEPT row in `demo-authoring.md` §3.4; rejecting it for "see ... disappear" would be §3.3's false-reject failure mode.
- **Rung 2 fires — `bone`.** `src/storage/segment.rs` lies inside the touch surface registered to the on-disk-segment-format bone. §3's worked contrast row is exactly this case: "The declared class is a claim; the touch surface is a fact. Facts win."

Rungs 3 and 4 are not reached. Consequence: bone ceremony — grill gates at planning, full architect-critic audit with the external adversary at close, full retro, ADR required.

The system-shape admission bar does **not** engage: `codebase-design.md` §3 binds at rung 3 category 1 only for a separately-deployed service. No service extraction is proposed, so no `pressure:` clause is owed.

## 3. Risk gate: warranted — family `destructive`

Rule: `start/references/risk-gates.md` §1. The retention path removes segment files from disk permanently and a test failure cannot undo a deletion — the **destructive** family. Not the bounded-and-locally-reversible case.

**Touch surface:** `src/retention/**,src/storage/segment.rs`. Module granularity for the new retention module; `src/storage/segment.rs` named as a file because that is the deletion site. `src/cli/commands.rs` stays out — the CLI is the entry point, not the hazard.

**Register it now, not later.** §5: the skeleton reaches this surface in this release, so the surface exists and is knowable today.

Once registered, `touch_check` prints both `bone <adr>` and `risk_gate <name>`; bone-touch-judge §4.2 says both apply — one reclassification, the gate's controls on top.

**Close-time consequence:** risk-gates §4 — the first release where a gate's surface becomes reachable is a docs trigger requiring threat/failure notes plus an audit & recovery plan. That fires at *this* release's close.

## 4. Mandatory controls

**(a) The gate's control floor — three controls, required work in this spine.**

Rule: risk-gates §2 rule of thumb — "money or destructive -> at least paper env + human confirm + audit trail":

- **paper / sandbox env** — the retention sweep runs against a non-real target by default; real deletion is opt-in and explicit.
- **human confirm** — naming the concrete effect ("delete 14 segments older than 30 days from series X"), never a generic "are you sure?".
- **audit trail** — append-only who/what/when/inputs/outcome, retained independently of the operation's own state.

**Kill switch is not on the floor** — §2's menu scopes it to money and ordering. **Progressive exposure** is listed for destructive but is a scale-to-harm judgment, not part of the floor; applying all five is named ceremony inflation.

These belong in **this** spine's plan — §6's anti-pattern is exactly "'We'll add the kill switch later.'"

**(b) The posture-conditional MUST — the `[community-edition]` ledger line.**

Rule: `demo-authoring.md` §1. For an `open-core` posture the cumulative ledger must carry a standing `auto:` line that builds and smoke-runs the public repo standalone from a clean checkout. PulseDB's recorded posture is `open-core`, so if no active line begins with the exact prefix `[community-edition]`, this spine authors it. Match on the prefix, never on wording.

Nothing else in these three skills makes a control mandatory for this project.
