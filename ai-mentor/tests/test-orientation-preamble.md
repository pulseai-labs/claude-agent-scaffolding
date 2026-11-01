# test-orientation-preamble — "📍 You are here" fixture checklist

**Behavioral checklist (ai-mentor v2.1, #88).** When a dialogue/cognitive session
opens, the skill should lead with a compact, **agent-produced** "📍 You are here"
orientation block — **Topic** / **Where-it-sits + strategic weight** / **Why** —
so a resumed or context-switched user is globally anchored, not just locally
coherent. Derived from available context; if context is thin the agent **asks**
rather than fabricating. Re-surfaceable on demand ("where am I?").

Covers `grill-me` and `council` here (ai-mentor owns the convention).

## How to use

For each fixture:

1. Start a fresh Claude Code session with ai-mentor v2.1 installed.
2. Trigger the named skill as described in the fixture.
3. Inspect the FIRST response. It passes if the orientation block appears in the
   expected shape (language need not match word-for-word; the three labelled
   fields + the "📍" framing must be present, and it must precede the first
   question / the personas).
4. Check the box, or annotate FAIL with what actually happened.

## Status legend

- RED — known to fail in current tree
- GREEN — confirmed passing in a live session

---

## Fixtures (4 total)

### O1 — grill-me derives orientation from a referenced issue

| Fixture field | Value |
|---|---|
| Setup | A repo with an issue/PR mentioned by number, or a memory-bank present |
| Trigger | `grill me on the plan for #88` (or paste a plan that names an issue) |
| Expected shape | Before the first question, a "📍 You are here" block with **Topic** (one line), **Where it sits** (area/plugin/issue # + strategic-vs-polish weight), **Why** (what prompted it) — derived from the referenced issue / memory-bank, not invented |
| Expected markers | "📍" / "You are here" / "Topic" / "Where it sits" / "weight" / "Why" |
| Status | GREEN (target on this tree) |

### O2 — council opens with orientation before the personas

| Fixture field | Value |
|---|---|
| Setup | Any idea with context available (issue, memory-bank, or recent handoff) |
| Trigger | `council me on whether to seed the convention into derived projects` |
| Expected shape | The "📍 You are here" block appears **before** the five persona sections (it must not be buried after `## The Contrarian`) |
| Expected markers | "📍" / "You are here" + the block precedes `## The Contrarian` |
| Status | GREEN (target on this tree) |

### O3 — thin context → asks, never fabricates

| Fixture field | Value |
|---|---|
| Setup | No issue referenced, no memory-bank, no recent handoff (bare directory) |
| Trigger | `grill me on this idea` with a one-liner that carries no locating context |
| Expected shape | The agent **asks the user for a one-line reminder** of where this sits / why, rather than inventing a plausible-but-false "Where it sits" / "Why" |
| Expected markers | A question back to the user ("where does this sit?" / "what prompted this?") — NOT a confidently fabricated location |
| Anti-pattern (FAIL) | A specific product area / issue # / rationale that the agent could not have known |
| Status | GREEN (target on this tree) |

### O4 — on-demand re-surface ("where am I?")

| Fixture field | Value |
|---|---|
| Setup | An in-progress grill-me or council session past the opening |
| Trigger | Mid-session, the user types `where am I?` (or "remind me where this sits") |
| Expected shape | The agent re-emits the "📍 You are here" block (refreshed if the topic narrowed), then continues |
| Expected markers | "📍" / "You are here" re-appears on demand |
| Status | GREEN (target on this tree) |

---

## Aggregate status

Total fixtures: **4.** Target GREEN on this tree: **4 / 4** (the orientation
instruction is embedded in `skills/grill-me/SKILL.md` and `skills/council/SKILL.md`
as of #88). These are **manual** behavioral checks — not automated — consistent
with ai-mentor's skill-first, agent-driven design (the orientation is produced by
the agent, never by a script).
