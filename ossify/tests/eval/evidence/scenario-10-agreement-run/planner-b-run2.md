# Planner B's verdict — run 2

**Everything below the `---` is the verdict, as returned.** This header is not
part of it. Run 2 of the scenario-10 agreement series: same `scenario.md`, same
`planner-prompt.md`, both byte-identical to run 1. See this directory's README.

---

## Summary

1. **Ladder label — MVP.** First release meeting rolling-wave §4's three evidence tests (cold start, real data lifecycle, recovery path); not v2 (promise unchanged, no new primary journey, no contract break), and not decided by being the third.
2. **Spine class — `bone`,** by rung 2 (bone-touch judge): `src/storage/segment.rs` is inside the on-disk-segment-format bone's registered surface. The declared `flesh` is a claim; the surface is a fact. Rung 3 still runs and adds a new-bone ADR obligation (category 5, destructive operations).
3. **Risk gate — warranted, register it now.** Family **destructive**; touch surface = the code that performs the irreversible removal — `src/retention/**` plus `src/storage/segment.rs` — not `src/cli/**`.
4. **Mandatory controls — four, and only four:** paper/sandbox env, human confirm naming the concrete effect, audit trail, progressive exposure. **No kill switch** (its column names money and ordering only).

---

## 1. Ladder label: MVP

Rule: `/Users/draco/projects/claude-agent-scaffolding/ossify/skills/plan-release/references/rolling-wave.md` §4 — the release ladder is **Skeleton (Release 0) → MVP → v1 → vN**, and it is *evidence-gated, not counted*. MVP is "the release at which the product can be used independently — cold start, real data lifecycle, a recovery path appropriate to solo scale."

All three land here, for the first time:

- **cold start** — installs from a published artifact with no hand-holding;
- **real data lifecycle** — ingests a real series and queries it back;
- **recovery path appropriate to solo scale** — a documented `pulsedb repair` that needs no operator intervention.

The previous release fails the same test on its own facts: an operator drove guided flows and hand-edited config files to recover. That is manual repair — the shape `start`'s clean-checkout bar (`skills/start/references/skeleton-cut.md` §4) excludes by name ("without editing storage, invoking hidden developer operations, or receiving manual repair"). Independent use is exactly what the operator was substituting for.

Not v2: §4's v2 bar is "a *changed product promise*, a new primary journey, or an intentionally breaking public contract." The scenario negates all three — the promise is unchanged, the primary journey is the first release's now fully real, no public contract breaks — and "accumulated features stay v1.x."

Two distractors the rules dispose of explicitly:

- **"Its third release" decides nothing.** §4: MVP "is not 'release 3', and it is not 'skeleton plus N spines' as an arithmetic rule (skeleton + 2-3 feature spines is the observed shape, not the criterion)." `plan-release/references/feature-map-grooming.md` §5 carries the same "≈" as a calibration point, not a test.
- **The sketch's "next: v1" is a hypothesis, not an assignment.** §4: "a sketch may name the next release's *label* as a hypothesis … but the label is confirmed by evidence at that release's planning, never assigned in advance as a milestone." It says nothing about *this* release's label.

The missing date is correct, not a gap — §5 anti-pattern: "Dating releases. The ladder is evidence-gated; a date is a wish."

## 2. Spine class: `bone` (rung 2)

Rule: `plan-release/SKILL.md` §7a + `references/class-declaration.md` §1.

- **Rung 1 (journey gate) does not fire.** The demo contribution is "set a 30-day retention on a series and see segments older than 30 days disappear from the segment list" — a named actor performing an action for value, with an observable outcome. It is not artifact existence. It is nearly verbatim `plan-spine/references/demo-authoring.md` §3.4's own repaired line ("change the retention window to 30 days from settings and see old records stop appearing"), and §3.3 forbids the false reject: "the ban is on the action, not on the outcome." So: not `internal-enabler`, and no admission/consumer question arises.
- **Rung 2 (bone-touch judge) fires and decides the class.** `src/storage/segment.rs` lies inside the touch surface registered to the on-disk-segment-format bone. `class-declaration.md` §3 carries this exact archetype: *"declared `flesh`; plan changes a file listed in the bone's touch surface → **bone**. The declared class is a claim; the touch surface is a fact. Facts win."* Mechanically: feed all three plan paths to `oss touch_check` and read the rc as **0 = matched, 1 = clean, 2 = could not check** (never fold rc 2 into clean). On the hit, both calls, plus a one-line notice to the user:

  `oss class_set "<spine>" bone "bone-touch: <ADR-ref> (<matched surface>)"` and `oss veto_add "<spine>" "bone-touch: <ADR-ref> (<matched surface>)" auto-bone "touch-surface overlap"`.
- **Rung 3 still runs, and carries its own obligation.** §1: "an earlier rung's verdict is never overridden by a later one … every rung still runs anyway, because … rung 3 is the only source of the new-bone obligation." The spine introduces permanent, irreversible removal of user data — bones category 5, *trust boundaries & destructive operations* (`start/references/bones-registry.md` §2). So the spine owes an **ADR** (authored `Proposed`, flipped once the release exercises it) **with a declared touch surface**; a new bone with no registered surface "is how the registry rots."
- **The system-shape admission bar does not bind.** Rung 3's measured-pressure requirement (`plan-spine/references/codebase-design.md` §3) applies to `system shape & deployment topology`. No separately-deployed service is proposed and none is planned — the work stays in the single deployable — so there is no split to justify and no `; pressure: …` clause owed. Do not import that bar here.
- **Nothing downstream can clear this.** `references/bone-touch-judge.md` §1: a clean critic does not clear a touch hit, and §7: "Overriding a bone-touch reclassification" is an anti-pattern — if the surface is wrong, fix the surface in the registry; a glob is not a finding. The critic veto (§7c) is still owed as an independent third judgment and can only push `flesh → bone`, never the reverse.

Downstream consequences of `bone`, for the record: the grill-me gate is offered at `plan-spine` §7 (bone only), the touch check is re-run on the decomposed path set (§4c), and close runs the full external-adversary audit.

## 3. Risk gate: warranted — family **destructive**

Rule: `start/references/risk-gates.md` §1 — "A risk gate is not 'code that might have bugs'. It is a surface where a defect produces harm that a test failure cannot undo." The scenario states that criterion verbatim ("a test failure cannot undo a deletion — the data is gone"), and the family table's **destructive** row is the match: "Deleting user data … overwriting files"; irreversible because "Data destroyed is gone." The §1 escape hatch — "if the harm is bounded and locally reversible, it is not a gate" — does not apply. Only one family fires; there is no ordering or money claim in the plan.

**Register it now.** §5: a gate is registered once you know its surface ("If you do not yet know the surface, put it in the feature map instead and register the gate when the surface exists"). The surface exists in this plan and the skeleton reaches it in this release, so `oss risk_gate_add` before the class declaration.

**Touch surface** — the code that performs the irreversible removal, at module granularity: **`src/retention/**` plus `src/storage/segment.rs`**.

- `bones-registry.md` §4 (same semantics for gates, per risk-gates §3): globs are bash `case`, `*` crosses `/`, so `src/retention/**` is a plain prefix wildcard. "Write surfaces that are neither too tight nor too loose … Aim at the directory or module that embodies the decision."
- `src/storage/segment.rs` belongs in the gate surface if the removal itself lands there — a gate whose surface misses the code doing the deleting cannot reclassify the next spine that touches it, and that file is already bone-registered anyway, so the only thing the gate adds there is the control checklist.
- **`src/cli/commands.rs` / `src/cli/**` stays out.** It is the invocation surface, not the hazard; registering it would attach deletion controls to every future CLI change — the "`src/**` makes everything a bone" inflation §4 warns against. The human-confirm control gets *implemented* in the CLI; that is not a reason to register the CLI as the gate's surface.

**Register the gate *and* the bone.** §6: "Treating a risk gate as a substitute for a bone. A gate about *safety* often accompanies a bone about *design*. Register both when both apply." That pairs with the rung-3 ADR obligation in judgment 2.

**One mechanical caveat.** Because no gate is registered yet, this release's `oss touch_check` prints `bone <adr>` only — never `risk_gate <name>`. The class escalation is coming from the *bone* surface; the gate's controls attach mechanically only once the gate exists (`bone-touch-judge.md` §4.2). Register first, then declare.

**Release-close consequence:** risk-gates §4 — "the first release where a gate's surface becomes reachable requires threat/failure notes plus an audit & recovery plan for that gate." That is this release.

## 4. Mandatory controls: paper/sandbox env · human confirm · audit trail · progressive exposure

Rule: `risk-gates.md` §2 — "**The 'Applies when' column is the rule, not a hint.** A control whose column names the gate's family is **required**. A control whose column does not name it is **not applied** … there is no harm-scaling judgment left to make, and no floor above which an attached control turns optional." Reading the destructive column:

| Control | Owed | What it means here |
|---|---|---|
| Paper / sandbox env | **yes** | The retention path runs against a non-real target by default; real deletion is opt-in and explicit |
| Human confirm | **yes** | Names the concrete effect ("delete 14 segments covering 2026-01-01 → 2026-02-04 in series X") — §6: a generic "are you sure?" trains the user to hit yes |
| Audit trail | **yes** | Append-only who/what/when/inputs/outcome, "retained independently of the operation's own state" — so not inside the segments being removed |
| Progressive exposure | **yes** | Narrow blast radius first (one series), widen on evidence |
| Kill switch | **no** | Its column names money and ordering. §6 names "a kill switch on a destructive one" as ceremony inflation, by example |

Also **not** owed: least privilege and no-secret-in-log assertions (§2 attaches those to *identity* gates only), and a determinism/property test (ordering only). §2 closes the set: those "are the **only** additions — anything else outside the column is ceremony inflation."

**Where they land.** `bone-touch-judge.md` §4.2: the listed controls are "**required work in the spine's plan**, not advice. They become work items when `plan-spine` decomposes the spine, and the close path checks them." Carry them in the class reason so they survive the handoff:

`oss class_set "<spine>" bone "risk-gate: <gate-name> (<surface>) - controls: paper env, human confirm, audit trail, progressive exposure"`

Deferring any of them is the named anti-pattern: *"'We'll add the kill switch later.' The control belongs in the plan of the spine that first reaches the surface … Do not pre-emptively defer it here."*

**The `open-core` posture owes nothing here.** Controls attach by defect family; posture governs the moat channel and the boundary artifacts (`start/references/posture-block.md` §4-§6). Deriving controls from the posture is the same class of error as posture-block §13's "Reading the channel off the posture."

**One derived consequence to carry into `plan-spine`:** with paper/sandbox as the default, the demo contribution's line observes an actual deletion only in explicitly opted-in real mode — so the `auto:` line must bind a command that opts in, or F5 (`plan-spine` §8a: every `auto:` line binds a runnable command plus a declared `exit:<n>`/`contains:<str>`) will be satisfied by a command that deletes nothing.
