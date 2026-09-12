# Planner prompt — identical for both planners

**Everything below the `---` is the prompt.** This header is not part of it.

Two substitutions the original run made, both of which a re-run must repeat:
`<repo-root>` was the absolute path of the checkout the planners read, and
`<scenario.md, verbatim>` was the body of `scenario.md` below its own `---`.
Nothing else differed between planner A's and planner B's prompts.

---

Repository root: <repo-root>

Read the ossify skills that own release, spine, and risk-gate planning end-to-end before answering — `ossify/skills/plan-release/` (SKILL.md + references/), `ossify/skills/plan-spine/` (SKILL.md + references/), and `ossify/skills/start/` (SKILL.md + references/). Apply ONLY those skills' documented decision procedures to the scenario below. Do not improvise beyond the skill bodies, and use only vocabulary the shipped prose defines.

Derive and state four judgments, each with the rule it rests on:
1. **Ladder label** for this release.
2. **Spine class** for the proposed spine.
3. **Risk gate** — whether one is warranted for the behaviour shipped, and if so its defect family and touch surface.
4. **Mandatory controls** — the controls this project owes, if any.

Your final message IS the return value. Lead with a compact four-line summary of the judgments, then the reasoning per judgment.

SCENARIO:
<scenario.md, verbatim>
