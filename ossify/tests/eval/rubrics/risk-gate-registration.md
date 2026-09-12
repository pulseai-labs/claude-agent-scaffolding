# Rubric: risk-gate-registration

Score each 1-5 (6 criteria). Pass = all ≥4. `expected_register` vocabulary:
`yes` | `no` — whether a risk gate is registered for the scenario's surface;
`expected_controls` is the control set the scenario warrants (a CSV per risk-gates.md §3's grammar
the judge reads as the key, not an exact string match).

This surface scores `start` SKILL.md §8's risk-gate judgment
(`references/risk-gates.md`) — which surfaces qualify as risk gates, whether
every control the menu attaches to the family is present, and what a gate
converts into downstream.

**Every criterion is scored on every fixture.** Criteria that name a thing the
registration may carry score, on a scenario that warrants no gate, whether the
skill correctly declined to register one. There is no N/A.

1. **Gate qualification correct** — a surface whose defect produces harm a
   test failure cannot undo (money moved, data destroyed, identity/trust
   disclosure, silent ordering corruption) is identified as a risk gate; a
   bounded, locally reversible defect is **not** inflated to a gate. On a
   scenario with no irreversible-harm surface, no gate is manufactured.
2. **Controls attached to the family** — controls taken from the menu by what
   its "Applies when" column names. The menu attaches: money → paper/sandbox env + human confirm
   naming the **concrete effect** (never a generic "are you sure?") + kill
   switch + audit trail + progressive exposure (all five); destructive →
   paper/sandbox env + human confirm (concrete effect) + audit trail +
   progressive exposure (kill switch does not attach); identity → audit trail
   + least privilege + no-secret-in-log assertions; ordering → audit trail +
   kill switch + progressive exposure (+ a cheap determinism/property test).
   The identity and ordering additions are named in §2's prose rather than the
   column, and they are the only ones. Attachment is the whole rule:
   every control the menu attaches to the family is required, and there is no
   floor above which an attached control becomes optional. Ceremony inflation
   is applying a control the menu does not
   attach to the family (e.g. paper env or progressive exposure on identity,
   or kill switch on destructive), and no gate with no controls.
3. **Touch surface recorded** — the gate carries a touch-glob-csv naming the
   surface that reaches it, so the auto-reclassification is mechanical; a gate
   with no touch surface cannot convert.
4. **Release-0 minimum + known-coming** — gates the skeleton can actually
   reach are registered now; a gate known to be coming with a known surface is
   registered too (the surface is what makes later reclassification automatic);
   a gate Release 0 cannot reach with no known surface goes to the feature map,
   not the registry. On a scenario where nothing reachable qualifies, the
   registry staying empty is correct.
5. **Downstream consequence understood** — a spine touching the gate's surface
   auto-reclassifies to `bone` **and** inherits the gate's controls as required
   work; the gate's first reachable release is a docs trigger (threat/failure
   notes + an audit & recovery plan). A gate treated as advisory scores low.
6. **Not a substitute for a bone** — a gate about *safety* often accompanies a
   bone about *design*; both are registered when both apply. A gate used in
   place of a bone (or a bone in place of a gate) scores low. On a scenario
   where only one applies, registering only that one is correct.

## Output format
`{"scores":{"qualification":N,"controls_scaled":N,"touch_surface":N,"release0_minimum":N,"downstream_consequence":N,"not_substitute_for_bone":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
