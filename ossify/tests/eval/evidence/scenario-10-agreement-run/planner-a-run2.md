# Planner A's verdict — run 2

**Everything below the `---` is the verdict, as returned.** This header is not
part of it. Run 2 of the scenario-10 agreement series: same `scenario.md`, same
`planner-prompt.md`, both byte-identical to run 1. See this directory's README.

---

I read all three SKILL.md bodies plus `rolling-wave.md`, `class-declaration.md`, `bone-touch-judge.md`, `risk-gates.md`, `bones-registry.md` §2/§4, `codebase-design.md` §3, and `demo-authoring.md` §3. Judgments below rest only on those.

---

## Summary

1. **Ladder label — `mvp`.** First release at which the product is usable independently (cold start, real data lifecycle, solo-scale recovery path); the v2 bar is unmet. — `plan-release/references/rolling-wave.md` §4
2. **Spine class — `bone`,** overruling the declared `flesh`. Rung 2 (bone-touch) fires: `src/storage/segment.rs` is inside the on-disk-segment-format bone's registered surface. — `class-declaration.md` §1 rung 2 / `bone-touch-judge.md`
3. **Risk gate — warranted.** Family **destructive**; touch surface `src/retention/**,src/storage/segment.rs`. — `start/references/risk-gates.md` §1, §5
4. **Mandatory controls — four:** paper/sandbox env, human confirm naming the concrete effect, audit trail, progressive exposure. **Kill switch is not owed** (ceremony inflation). Plus the release-close docs trigger. — `risk-gates.md` §2, §4, §6

---

## 1. Ladder label: `mvp`

**Rule.** `rolling-wave.md` §4: the ladder is **Skeleton (Release 0) → MVP → v1 → vN**, and it is *evidence-gated, not counted*. MVP is "the release at which the product can be used independently — cold start, real data lifecycle, a recovery path appropriate to solo scale. It is not 'release 3', and it is not 'skeleton plus N spines' as an arithmetic rule." v2 "requires a *changed product promise*, a new primary journey, or an intentionally breaking public contract. Accumulated features stay v1.x."

**Evidence, matched to the three MVP conditions.**

- *Cold start* — a user installs from a published artifact with no hand-holding. Before this release the operator drove guided flows.
- *Real data lifecycle* — ingests a real series and queries it back.
- *Recovery path appropriate to solo scale* — a documented `pulsedb repair` path needing no operator intervention, replacing hand-edited config files.

**Why not v2.** All three v2 triggers are explicitly absent: the product promise is unchanged from the first release's, the primary journey is the first release's journey now fully real (not a new one), and no public contract breaks.

**Why "third release" is not an input.** Evidence-gated, not counted. The release ordinal is not a criterion at any rung.

**Two things the scenario gets right, and they are scored, not incidental.** No date is recorded — §5 anti-pattern: "Dating releases. The ladder is evidence-gated; a date is a wish." No label is pre-assigned — §4: "the label is confirmed by evidence at that release's planning, never assigned in advance as a milestone."

**The sketch's "next: v1 once the retention policy engine lands" is a hypothesis, not a rule, and it does not touch this label.** §4: a sketch "may name the next release's *label* as a hypothesis," and §5 anti-pattern: "Treating the sketch as a commitment — or as a promise to a stakeholder." Note it is also already stale — the retention policy engine is the spine landing in *this* release — which changes nothing: the next release's label gets confirmed from evidence at its own planning pass (`rolling-wave.md` §3, nothing survives the sketch as binding).

## 2. Spine class: `bone`

Run the ladder in order (`class-declaration.md` §1). "An earlier rung's verdict is never overridden by a later one... Every rung still runs anyway, because the later rungs carry obligations of their own."

**Rung 1 — journey gate: passes.** The spine is not an `internal-enabler`. The gate "fires on *positive evidence of a missing journey* — an artifact-existence demo, or a plan that names no actor at all." The demo contribution is the opposite: a named actor performs an action for value ("set a 30-day retention on a series") and reaches an observable outcome ("segments older than 30 days disappear from the segment list"). This is near-verbatim the shipped corrected form in `demo-authoring.md` §3.4 — "change the retention window to 30 days from settings and see old records stop appearing" — and §3.3 is explicit that the visible outcome is the floor being *met*, not violated: the ban is on the action, not the outcome. Rejecting it because "see ... disappear" occurs would be the documented false-reject failure mode. The ladder does not stop.

**Rung 2 — bone-touch judge: HIT. This is the rung that decides the class.** `src/storage/segment.rs` lies inside the touch surface registered to the on-disk-segment-format bone, so `oss touch_check src/retention/policy.rs src/storage/segment.rs src/cli/commands.rs` returns **rc 0** and prints `bone <ADR-ref>`. Per rung 2: "A hit → `bone`, regardless of the declared class, regardless of the critic." This is `class-declaration.md` §3's second archetype exactly — a spine declared `flesh` whose plan changes a file in a registered surface: "The declared class is a claim; the touch surface is a fact. Facts win."

Record both calls (`bone-touch-judge.md` §4.1), and say it out loud — "A silent reclassification is a surprise at close":

```
oss class_set "<spine>" bone "bone-touch: <ADR-ref> (<matched surface>)"
oss veto_add  "<spine>" "bone-touch: <ADR-ref> (<matched surface>)" auto-bone "touch-surface overlap"
```

Once the §3 gate is registered, the same run prints `risk_gate` as well. `bone-touch-judge.md` §4.2: "A single path can hit **both** a bone and a risk gate. Then both apply: one reclassification, and the gate's controls on top."

**Rung 3 — still runs, and it carries its own obligation.** Rung 2 fixed the class; rung 3 is "the only source of the new-bone obligation, and skipping it is how the registry rots." The spine creates a new load-bearing, hard-to-reverse decision in bones category 5, **trust boundaries & destructive operations** (`bones-registry.md` §2: "Which operations are irreversible (spend money, delete data...)"), living in `src/retention/policy.rs` — a **new** file no surface covers. That is precisely what rung 3 catches: "a spine that creates a bone in files nobody has registered yet, because the bone does not exist until this spine lands." So the spine **owes an ADR** (authored `Proposed`, flipped to `Accepted` once this release exercises it) with a declared touch surface covering `src/retention/**` — "A new bone with no registered surface is how the registry rots," and without it the next spine's rung-2 check is blind there.

**Rung 3's system-shape admission bar does not bind.** The one category carrying an admission bar rather than just a label is `system shape & deployment topology`, requiring measured pressure for a service extraction. The scenario forecloses it: no separately-deployed service is proposed, no extraction is planned, the work stays in the single deployable. `codebase-design.md` §3 — "A module boundary is not a deployment boundary" — so no measured-pressure evidence is owed and no `; pressure: <evidence>` suffix belongs in the rationale.

**Rung 4 is not reached.**

**The critic is a third, independent judge and changes nothing here.** The scenario reports no findings, so the disposition is **none**: "Write nothing. No `veto_add` call, no class change" (`plan-release` SKILL §7c). And a clean critic could not have cleared the hit anyway — `bone-touch-judge.md` §1: "A **clean critic** does not clear a touch hit... The only legitimate way to undo a bone-touch reclassification is to **fix the touch surface** in the bones registry because it was written wrong — never a user override of the consequence."

Downstream consequence of the class, for completeness: the grill-me gate is now offered after decomposition settles (`plan-spine` §7, bone spines only), and the bone-touch check is re-run on the decomposed path set (§4c).

## 3. Risk gate: warranted — family **destructive**, surface `src/retention/**,src/storage/segment.rs`

**Rule.** `risk-gates.md` §1: "A risk gate is not 'code that might have bugs'. It is a surface where a defect produces harm that a test failure cannot undo." The scenario states the qualifying condition in the gate's own terms — the retention path removes segment files from disk permanently; a test failure cannot undo a deletion. The **Destructive** family row names it directly: "Deleting user data, dropping/altering tables, overwriting files" — "Data destroyed is gone."

**Exactly one family, deliberately.** Not *money* (no funds or paid API spend), not *identity/trust* (no auth, session, secret or acting-on-behalf), not *ordering/correctness-critical* (the hazard is the removal itself, not sequencing or silent arithmetic corruption). §1 closes with "If the harm is bounded and locally reversible, it is not a gate — do not inflate the registry"; the same restraint applies to inflating the *family* count, because family is what decides the control set in §4.

**Register it now.** §5: "Register only the gates the skeleton can actually reach" — and this surface is reached in this release. §5 further notes that a gate is worth registering as soon as "you already know its surface... the surface is what makes the later reclassification automatic." The absence of any registered deletion gate today is the finding, not an exemption: an unregistered gate is invisible to `oss touch_check`, so it cannot reclassify this spine and cannot reclassify any future spine that goes near deletion (`bones-registry.md` §4, the downstream consequence). Registration is `start` §8's verb (`oss risk_gate_add "<name>" "<touch-glob-csv>" "<controls-csv>"`) and must land before the class declaration is final, since `plan-release` only *reads* `.risk_gates`.

**Touch surface.** `src/retention/**,src/storage/segment.rs` — the deletion path itself. Under `case`-glob semantics (`bones-registry.md` §4, `*` matches `/`, so `**` is a prefix wildcard) `src/retention/**` covers `policy.rs` and everything the module grows.

Two judgment calls inside that surface, both from §4's "neither too tight nor too loose":

- **`src/cli/commands.rs` is excluded.** It is the invocation surface, not the removal primitive; registering the whole command file makes every unrelated CLI change inherit the destructive checklist, which is the ceremony inflation `risk-gates.md` §6 names ("what trains people to skip the checklist wholesale").
- **`src/storage/segment.rs` is registered as a single file, and that is the tighter of two defensible choices.** §4 warns that "`src/domain/order.rs` alone misses the sibling file the next change lands in." If the file-removal primitive is not confined to that one file, widen to `src/storage/**` rather than leave a sibling deletion helper outside the gate.

**The existing bone does not substitute for the gate.** `src/storage/segment.rs` is already inside the on-disk-segment-format bone's surface, but a bone surface escalates class only — it attaches no controls. `risk-gates.md` §6: "Treating a risk gate as a substitute for a bone. A gate about *safety* often accompanies a bone about *design*. Register both when both apply." Here both apply, in that order.

## 4. Mandatory controls: four, and one deliberate omission

**Rule.** `risk-gates.md` §2: "**The 'Applies when' column is the rule, not a hint.** A control whose column names the gate's family is **required**. A control whose column does not name it is **not applied**... there is no harm-scaling judgment left to make, and no floor above which an attached control turns optional."

Reading the column for **destructive**:

| Control | Applies when | Owed? |
|---|---|---|
| Paper / sandbox env | Money, **destructive** | **Required** — retention runs against a non-real target by default; real deletion is opt-in and explicit |
| Human confirm | Money, **destructive** | **Required** — must name the concrete effect ("delete 412 segments older than 30 days on series X"), never a generic "are you sure?" |
| Kill switch | Money, ordering | **Not applied** |
| Audit trail | **All four families** | **Required** — append-only who/what/when/inputs/outcome, "retained independently of the operation's own state" (load-bearing here: the record must outlive the segments it describes) |
| Progressive exposure | Money, **destructive**, ordering | **Required** — narrow blast radius first (one series), widen on evidence |

**The omission is the discriminating call.** A kill switch on a destructive gate is named as an anti-pattern verbatim in §6: "A control the family's column does not name. Paper env or progressive exposure on an identity gate, **a kill switch on a destructive one**. That is ceremony inflation." Likewise the two off-table controls do not attach: least privilege and no-secret-in-log are identity additions, and a determinism/property test is an ordering addition — §2 states these "are the **only** additions — anything else outside the column is ceremony inflation."

**Human confirm is required even though retention is a policy that runs on its own.** Attachment decides; harm is not re-litigated gate by gate (§2, §6: "Attachment decides; harm is not re-litigated"). The open question is *where* the confirmation sits — at policy application, naming the concrete effect — not whether it is owed.

**These are required work in this spine's plan, now.** §4: a gate hit means the spine "inherits that gate's control checklist as required work in the spine's plan." §6: "'We'll add the kill switch later.' The control belongs in the plan of the spine that first reaches the surface — that is precisely what the touch surface guarantees. Do not pre-emptively defer it here." They become work items when `plan-spine` decomposes the spine, and the close path checks them. Record them on the reclassification so they are not lost between planning and decomposition (`bone-touch-judge.md` §4.2):

```
oss class_set "<spine>" bone "risk-gate: <gate> (src/retention/**) - controls: paper env, human confirm, audit trail, progressive exposure"
oss veto_add  "<spine>" "risk-gate: <gate> (src/retention/**)" auto-bone "risk-surface overlap; gate controls attached"
```

**One further obligation the release owes, not the spine.** `risk-gates.md` §4: "The gate's exposure is a **docs trigger** at release close: the first release where a gate's surface becomes reachable requires threat/failure notes plus an audit & recovery plan for that gate." The scenario states this surface is reached in this release, so the trigger fires in this release, not a later one.
