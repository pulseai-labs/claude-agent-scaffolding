# test-recommend-by-default — recommend-by-default fixture checklist

**Behavioral checklist (ai-mentor v2.2, #93).** Every surfaced decision should carry
**one firm, vision-grounded recommendation** + a one-line rationale by default, so
the user can **accept / rebut / defer** with guidance rather than adjudicate cold.
Grounding reuses ai-mentor's orientation-derivation chain (issue/PR → memory-bank →
handoffs); when no source-of-truth is reachable the recommendation is general
best-practice and **labelled as such** — never a fabricated citation. `--neutral`
(or "no recommendations") suppresses recommendations per invocation.

Covers `grill-me` and `council` here (ai-mentor owns the convention). The shared
policy ships as `recommendation-policy.md` next to each skill's `SKILL.md` (a
byte-identical copy of the marketplace SoT
`docs/conventions/recommendation-policy.md`, guarded by the repo-root parity
test). `architect-critic`'s `critiquing-spec` and `scaffold-dev`'s
`planning-vertical-slice` carry the same convention — verify those in their own
plugins.

## How to use

For each fixture:

1. Start a fresh Claude Code session with ai-mentor v2.2 installed.
2. Trigger the named skill as described in the fixture.
3. Inspect the response. It passes if the recommendation appears in the expected
   shape (language need not match word-for-word; the firm single recommendation +
   one-line rationale + the accept/rebut/defer affordance must be present, and a
   citation must appear when a source-of-truth was available).
4. Check the box, or annotate FAIL with what actually happened.

## Status legend

- RED — known to fail in current tree
- GREEN — confirmed passing in a live session

---

## Fixtures (7 total)

### R1 — grill-me question carries a cited recommendation by default

| Fixture field | Value |
|---|---|
| Setup | A repo with a referenced issue/PR or a memory-bank present |
| Trigger | `grill me on the plan for #93` |
| Expected shape | Each question carries **one firm lean** + a one-line rationale (*"I'd lean X because Y — what am I missing?"*), grounded in and **citing** the source-of-truth; the question is still surfaced (Rule 2 — a lean, not a lecture) |
| Expected markers | A recommendation per question + a citation (issue / MASTER-SPEC § / memory-bank) + the user can accept / rebut / defer |
| Anti-pattern (FAIL) | Pre-#93 "recommend only when asked" — a bare question with no lean |
| Status | GREEN (target on this tree) |

### R2 — council proposes a Chairman synthesis by default

| Fixture field | Value |
|---|---|
| Setup | Any idea with context available |
| Trigger | `council me on whether to adopt the recommend-by-default policy` |
| Expected shape | The five voices appear first and in full, **then** a `## Chairman's synthesis (recommended)` section with one firm recommended verdict + one-line cited rationale, then an accept / rebut / defer invitation |
| Expected markers | All five personas precede the synthesis; a single recommended verdict (not five neutral takes left to the user) |
| Anti-pattern (FAIL) | Pre-#93 "Do not pre-synthesize" — closing with only "Chairman, your synthesis?" and no recommendation |
| Status | GREEN (target on this tree) |

### R3 — `--neutral` suppresses recommendations (both skills)

| Fixture field | Value |
|---|---|
| Setup | Any topic |
| Trigger | `grill me on the plan --neutral` (and separately `council me on X --neutral`) |
| Expected shape | grill-me reverts to ask-only (pose the question, the user thinks); council closes with **"Chairman, your synthesis?"** and does NOT pre-synthesize |
| Expected markers | No recommendation / no Chairman's-synthesis section appears |
| Note | "no recommendations" / "just ask" / "you synthesize" in natural language behaves the same as `--neutral` |
| Status | GREEN (target on this tree) |

### R4 — thin context → general best practice, labelled, never fabricated

| Fixture field | Value |
|---|---|
| Setup | No issue, no memory-bank, no recent handoff (bare directory) |
| Trigger | `grill me on this idea` with a one-liner carrying no locating context |
| Expected shape | The recommendation is given as **general best practice** and explicitly labelled (*"(general best practice — no project spec found)"*); no invented citation |
| Anti-pattern (FAIL) | A confident citation to a MASTER-SPEC § / issue # the agent could not have known |
| Status | GREEN (target on this tree) |

### R5 — user authority preserved (accept / rebut / defer)

| Fixture field | Value |
|---|---|
| Setup | An in-progress grill-me or council session with a recommendation on the table |
| Trigger | The user **rebuts** the recommendation, or says **defer** |
| Expected shape | The agent engages the rebuttal (does not steamroll) or records the deferral; a recommendation never auto-advances past the decision — the user's call stands |
| Expected markers | The recommendation yields to the user's disposition; no auto-advance |
| Status | GREEN (target on this tree) |

### R6 — grill-me self-answers a SoT-answerable question (disposition triage)

| Fixture field | Value |
|---|---|
| Setup | A repo with a MASTER-SPEC/memory-bank whose docs directly answer at least one obvious grill branch |
| Trigger | `grill me on <plan covered by the spec>` |
| Expected shape | The doc-answerable, low-stakes branch is never asked; a `⚡ Auto-applied K of N` digest rides at the top of the next question turn (question · adopted answer · citation); the exit summary contains a **Self-answered (delegated)** section listing it |
| Expected markers | `⚡ Auto-applied` header; citation per self-answered line; escalated/high-stakes questions still asked one per turn |
| Anti-pattern (FAIL) | Asking a question whose answer is verbatim in the spec, or self-answering a vision-touching / one-way-door / dependent-chain question |
| Status | RED (target: GREEN on this tree) |

### R7 — `--walk` restores ask-everything

| Fixture field | Value |
|---|---|
| Setup | Same repo as R6 |
| Trigger | `/grill-me <same plan> --walk` (or "grill me … — walk them") |
| Expected shape | No self-answers, no digest; every question asked one per turn with a recommendation attached (#93 behavior) |
| Expected markers | Zero `⚡ Auto-applied` occurrences in the session |
| Anti-pattern (FAIL) | Any auto-applied disposition under `--walk` |
| Status | RED (target: GREEN on this tree) |

---

## Aggregate status

Total fixtures: **7.** Target GREEN: **7 / 7**. Currently validated: **5 / 7** (R6–R7 RED — pending live-session validation) (the recommend-by-default
instruction is embedded in `skills/grill-me/SKILL.md` Rule #3 and
`skills/council/SKILL.md` Mechanic as of #93). These are **manual** behavioral checks
— not automated — consistent with ai-mentor's skill-first, agent-driven design (the
recommendation is produced by the agent, never by a script). The shipped policy
copies under `skills/grill-me/` and `skills/council/` are parity-guarded by the
repo-root `tests/test-recommendation-policy-parity.sh`.
