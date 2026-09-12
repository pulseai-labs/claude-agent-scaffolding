# Rubric: spike-contract-integrity

Score each 1-5 (5 criteria). Pass = all ≥4. `expected_offer` vocabulary: `yes` |
`no` — whether the skill offers a feasibility spike; `expected_contract`:
`sound` | `unsound` — whether the written contract meets §9a's six-field bar.

This surface scores `start` SKILL.md §9a's spike judgment
(`references/spike-contract.md`) — when a feasibility spike is the right tool
for a spec-core architectural uncertainty, and whether the contract written
before any code is enforceable.

**Every criterion is scored on every fixture.** Criteria 2-5 name fields the
contract carries when a spike is offered; on a scenario where the spike is
correctly declined (no genuine uncertainty, or a cheaper sibling owns the
question), each scores whether the skill correctly declined to require or
accept the field — the same convention `close-gate-integrity` uses. There is
no N/A.

1. **Offer bar correct** — a spike is offered only on genuine architectural
   uncertainty (the bone cannot be responsibly written without knowing the
   shape works at all); a question a cheaper sibling owns is routed there — a
   crate/version/API/platform fact → smoke test, a read-shaped comparison →
   research, an experiential "which shape" with no falsifier → prototype; and
   "just not sure it'll be fast enough" with no bone depending on it, or "try a
   library I find interesting", is declined outright. On a scenario with real
   uncertainty the offer is made; on one without it, the offer is correctly
   withheld.
2. **One hypothesis, falsifier first** — exactly one falsifiable hypothesis;
   the falsifier — the concrete observation that would say *no* — is written
   **before** the run. A spike with no falsifier, one written after the fact,
   or multiple hypotheses in one spike, is unsound.
3. **`code_fate: discard` held** — the spike runs on a scratch branch or
   throwaway worktree, **never merged**; learned behavior is **reimplemented**
   inside the product under normal spine ceremony, not copy-pasted; "it's
   already written, let's tidy and merge" (prototype laundering) is refused.
4. **Timebox + evidence + enabling decision** — a wall-clock timebox decided
   upfront (at expiry, stop and answer with what you have — an expired spike is
   a *no* by default, not an extension request); the evidence retained after
   deletion named upfront; and the bone decision the spike enables named (if
   you cannot name the bone, you are not spiking, you are exploring).
5. **Risk-gate inheritance** — a spike inherits applicable risk-gate controls
   and never touches live money, live customer data, or a destructive surface;
   if the hypothesis requires that, the hypothesis is wrong for a spike. On a
   spike touching no gate surface, none is manufactured.

## Output format
`{"scores":{"offer_bar":N,"hypothesis_falsifier":N,"code_fate_discard":N,"timebox_evidence_decision":N,"risk_gate_inheritance":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
