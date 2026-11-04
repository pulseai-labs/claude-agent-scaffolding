# test-council-personas — Council multi-persona output fixtures

**Phase 1 RED-state checklist (sage v2.0).** When `council` is invoked
on an idea, the response must contain 5 distinguishable persona sections,
each in-character, ending with a Chairman-synthesis prompt. The Historian
persona has special codebase-grounding behavior that degrades gracefully on
greenfield repos.

## How to use

For each fixture:

1. Start a fresh Claude Code session with sage v2.0 installed.
2. Run the **trigger** column verbatim.
3. Inspect the response against the **assertion** column.
4. Check the box or annotate FAIL.

**Current state (Phase 1):** all rows are **RED**. The council skill does not
exist yet. Phase 4 creates it.

## Status legend

- RED — known to fail in current tree
- GREEN — confirmed passing

---

## Structural assertions (3 fixtures)

Run with this **sample idea** as the trigger:

```
council me on this idea: should I rewrite my Python API in Rust for performance
```

| # | Assertion | Status |
|---|---|---|
| S1 | Response contains **5 markdown-headed sections**, one per persona: `## The Contrarian`, `## The First Principles Thinker`, `## The Outsider`, `## The Executor`, `## The Historian` (exact headers or close variants — the persona name must appear as a section heading) | RED |
| S2 | After all 5 personas, the response ends with a prompt of the form `**Chairman, your synthesis?**` (or close — "Chairman" + "synthesis" must both appear in the closing prompt) | RED |
| S3 | No two persona sections produce semantically identical takes — each section has a distinguishable angle. Spot-check by reading: do all 5 sections sound interchangeable? If yes, FAIL. | RED |

---

## In-character language markers (5 fixtures, one per persona)

For the same sample idea, each persona's section should contain language
markers consistent with their assigned shape. These are heuristics, not
strict grep targets — use judgment.

| # | Persona | Expected language markers | Status |
|---|---|---|---|
| P1 | **The Contrarian** | Negation-heavy; phrases like "fatal flaw" / "this breaks when" / "have you considered" / "the assumption you're making is" / hunts for what kills the idea | RED |
| P2 | **The First Principles Thinker** | Strips surface framing; phrases like "what are we actually solving" / "the real question is" / "set aside the X vs Y framing" / rebuilds from ground up | RED |
| P3 | **The Outsider** | Names what's invisible to insiders; phrases like "to someone new" / "you keep saying X but" / "obvious to you but" / curse-of-knowledge naming | RED |
| P4 | **The Executor** | Action-language; phrases like "Monday morning" / "first concrete step" / "in week 1 you would" / demands a path; ignores theory | RED |
| P5 | **The Historian** | Codebase-grounded; references commits / files / git log; quotes specific patterns from the user's history; OR (in greenfield) explicitly says "no priors found" and pivots to "why this pattern vs alternatives" | RED |

---

## Historian codebase-grounding fixtures (2 fixtures)

The Historian persona is the only one that does actual codebase work. Two
fixtures test both modes — priors-rich and greenfield.

### H1 — priors-rich context (this repo)

| Fixture field | Value |
|---|---|
| Setup | Run from within this repo (`/path/to/pulsestack`) which has rich git history |
| Trigger | `council me on this idea: should I add a hook back to sage for ambient enforcement` |
| Expected | The Historian section must quote at least one specific commit hash, file path, or branch name from this repo (e.g., references the v1.3 PreToolUse hook removal in commit `1d3c9e0`, or the SPEC's "Hook re-introduction" deferred-scope note) |
| Status | RED |

### H2 — greenfield context (fresh temp repo)

| Fixture field | Value |
|---|---|
| Setup | `mkdir /tmp/council-greenfield && cd /tmp/council-greenfield && git init && echo hello > README.md && git add . && git commit -m initial` |
| Trigger | `council me on this idea: should I structure this as a monorepo` |
| Expected | The Historian section explicitly acknowledges no relevant priors (phrase like "no priors found in this codebase" / "this is a greenfield repo with no history of X yet") AND pivots to alternatives framing ("why reach for this pattern vs standard alternatives like Y, Z?") |
| Status | RED |

---

## Aggregate status

Total fixtures: **10** (3 structural + 5 in-character + 2 Historian
codebase-grounding). Currently expected RED: **10 / 10.** Phase 4 should turn
all GREEN by authoring `skills/council/SKILL.md` per SPEC §5.4.

If structural assertions S1–S2 fail but in-character markers P1–P5 mostly
match, the skill body has the personas but isn't enforcing the output
template — sharpen the "Output format" section. If P1–P5 fail (all personas
sound alike), the skill body needs sharper per-persona constraints (verbal
tics, hard rules per persona).
