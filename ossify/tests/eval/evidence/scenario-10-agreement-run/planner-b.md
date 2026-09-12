## Summary

1. **Ladder label — `mvp`.** First release at which the product can be used independently (cold start + real data lifecycle + a solo-scale recovery path); v2 bar unmet, and "third release" is not a criterion. — `plan-release/references/rolling-wave.md` §4
2. **Spine class — `bone`**, not the declared `flesh`. Rung 2 (bone-touch judge) hits: `src/storage/segment.rs` is inside the on-disk-segment-format bone's registered touch surface. Rung 3 independently owes an ADR for the new deletion decision. — `plan-release/references/class-declaration.md` §1
3. **Risk gate — warranted. Family: destructive. Touch surface: `src/retention/**,src/storage/segment.rs`.** A defect there produces harm a test failure cannot undo. — `start/references/risk-gates.md` §1
4. **Mandatory controls — paper/sandbox env - human confirm naming the concrete effect - audit trail - progressive exposure.** Kill switch does not attach to destructive. Plus, posture-conditional and separate from the gate: the `[community-edition]` standing `auto:` line that `open-core` requires. — `risk-gates.md` §2; `plan-spine/references/demo-authoring.md` §1

---

## 1. Ladder label: `mvp`

Rule: `rolling-wave.md` §4 — the ladder is **Skeleton (Release 0) -> MVP -> v1 -> vN**, "evidence-gated, not counted".

- **MVP bar, met in full**: cold start, real data lifecycle, solo-scale recovery path. It is the **first** release at which this holds.
- **v2 bar, not met**: promise unchanged, primary journey is the first release's now fully real, no public contract breaks.
- **Not counted**: that this is the third release is not an input to the label.
- **No label pre-assigned** is correct; **no date** is correct (§5 anti-pattern).
- **The sketch's "next: v1 once the retention policy engine lands" is a hypothesis, not a commitment.** Its stated precondition is being satisfied by this release's spine; that promotes neither release.

## 2. Spine class: `bone` (declared `flesh` is overruled)

- **Rung 1 — journey gate: passes**, so not an `internal-enabler`. The `user:` line is the accept side of `demo-authoring.md` §3.4's own worked pair.
- **Rung 2 — bone-touch judge: HIT -> `bone`.** `src/storage/segment.rs` is inside the on-disk-segment-format bone's touch surface. "The declared class is a claim; the touch surface is a fact. Facts win." Record `class_set` + `veto_add` and say it out loud.
- **Rung 3 is not idle here, even though rung 2 already decided the class.** Rung 3 "catches what rung 2 cannot: a spine that creates a bone in files nobody has registered yet." `src/retention/policy.rs` is new and unregistered, and the decision it lands is bones category 5, **trust boundaries & destructive operations**. So the spine **owes an ADR** (authored `Proposed`, flipped at close) with a declared touch surface.
- **The system-shape admission bar does not bind** — category 1 requires measured pressure for a second deployable; none is proposed.
- **Still owed, and independent**: the §7c critic veto. A clean critic does not clear a touch hit.
- **Consequences of `bone`**: full ceremony — grill-me gate, full architect-critic audit at close, full retro, ADR required.

## 3. Risk gate: warranted — family `destructive`, surface `src/retention/**,src/storage/segment.rs`

- **Qualification.** The retention path removes segment files permanently and a test failure cannot undo it — the **destructive** family. Neither bounded nor locally reversible.
- **Register it now, and register it here.** The surface is known and the skeleton reaches it this release, so it goes in the registry, not the feature map: `oss risk_gate_add "segment-deletion" "src/retention/**,src/storage/segment.rs" "paper env,human confirm,audit trail,progressive exposure"`.
- **Touch surface sizing**: `src/retention/**` covers the new module and its future siblings; `src/storage/segment.rs` is the removal seam. `src/**` would make every spine a bone; the single file would miss the sibling. `src/cli/commands.rs` is the entry point, not the hazard.
- **Register the gate *and* the bone — not one instead of the other** (§6 anti-pattern). The gate is the safety half; rung 3's ADR is the design half.
- **Docs trigger at this release's close** (§4): threat/failure notes plus an audit & recovery plan.

## 4. Mandatory controls

Rule: risk-gates §2 — the five-entry menu "scaled to the harm", rule of thumb "money or destructive -> at least paper env + human confirm + audit trail."

| Control | Why it attaches |
|---|---|
| **Paper / sandbox env** | Menu row: money, destructive. Default dry-run; real deletion opt-in and explicit. |
| **Human confirm naming the concrete effect** | Menu row: money, destructive — must name the effect, never a generic "are you sure?". |
| **Audit trail** | Menu row: "All four families." Retained independently of the operation's own state — which matters precisely because that state is the segments being destroyed. |
| **Progressive exposure** | Menu row: money, **destructive**, ordering. Warranted above the rule-of-thumb floor because a retention policy's blast radius is every series at once: enable on one series first, widen on evidence. |

**Not owed:** the **kill switch**, whose menu row is "Money, ordering". Applying all five is ceremony inflation.

**Not deferrable.** All four are required work in *this* spine's plan.

**One further mandatory item, posture-conditional and not a risk-gate control.** `open-core` posture makes the `[community-edition]` standing `auto:` line a MUST; if no active line carries that prefix, this spine authors it.
