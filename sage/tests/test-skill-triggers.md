# test-skill-triggers — natural-language auto-invocation fixtures

**Phase 1 RED-state checklist (sage v2.0).** Fixtures that capture which
natural-language phrases should auto-invoke which skill. Validate by running
each phrase in a fresh Claude Code session with sage v2.0 installed and
inspecting whether the expected Skill tool call appears.

## How to use

For each fixture row:

1. Open a fresh Claude Code session in any directory with the sage plugin
   installed and enabled (so the 4 skills are discoverable).
2. Send the **trigger phrase** verbatim as your first message.
3. Inspect the response (or the transcript / tool-call log) for whether the
   **expected skill** was invoked via the Skill tool.
4. Check the box, or annotate FAIL with what actually happened.

A fixture passes if the expected skill is invoked. Cross-skill fixtures pass
if either of the listed acceptable skills is invoked. Negative fixtures pass
if NO sage skill is invoked (Claude responds normally without dispatching
grill-me / eli10 / fool / council).

**Current state (Phase 1):** all rows below are **RED** — eli10, fool, and
council skills do not exist yet (Phases 3 + 4); grill-me still has v1.3
frontmatter (`when_to_use` + `version`) which subtly changes its trigger
surface (Phase 2 fixes).

## Status legend

- RED — known to fail in current tree
- GREEN — confirmed passing
- N/A — not yet runnable (waiting on a phase)

---

## grill-me (4 positive + 1 negative)

| # | Trigger phrase | Expected skill | Status |
|---|---|---|---|
| G1 | `grill me on this plan` | grill-me | RED |
| G2 | `pressure-test this` | grill-me | RED |
| G3 | `challenge my design` | grill-me | RED |
| G4 | `poke holes in this` | grill-me | RED |
| G5 | `let's grill some chicken` | NONE (negative — cooking context) | RED |

**Notes:** G5 is the cooking-context negative test. The v1.3 description's
explicit "Do NOT activate for cooking-related grill usage" must survive into
v2.0. If G5 wrongly invokes grill-me, the description is over-broad.

---

## eli10 (4 positive + 1 cross-check)

| # | Trigger phrase | Expected skill | Status |
|---|---|---|---|
| E1 | `explain in simpler terms` | eli10 | RED (skill doesn't exist) |
| E2 | `I don't get it` | eli10 | RED (skill doesn't exist) |
| E3 | `make it simpler` | eli10 | RED (skill doesn't exist) |
| E4 | `ELI10` | eli10 | RED (skill doesn't exist) |
| E5 | `consider me a beginner — explain this simpler` | eli10 OR fool (either acceptable) | RED (neither skill exists) |

**Notes:** E5 is a cross-check fixture. The phrase blends fool-shape
("consider me a beginner") with eli10-shape ("explain this simpler"). Either
skill being invoked is acceptable — both invoked is also acceptable. The
fixture FAILS only if neither is invoked.

---

## fool (4 positive)

| # | Trigger phrase | Expected skill | Status |
|---|---|---|---|
| F1 | `consider me a beginner` | fool | RED (skill doesn't exist) |
| F2 | `no jargon` | fool | RED (skill doesn't exist) |
| F3 | `beginner's mind` | fool | RED (skill doesn't exist) |
| F4 | `from scratch` | fool | RED (skill doesn't exist) |

**Notes:** F4 (`from scratch`) is the most ambiguous trigger — could be code
("rewrite from scratch") or pedagogy ("explain from scratch"). The skill body
must disambiguate via context. If F4 wrongly invokes on a rewrite intent, the
trigger is too broad and should be tightened.

---

## council (4 positive + 1 negative)

| # | Trigger phrase | Expected skill | Status |
|---|---|---|---|
| C1 | `council me on this idea` | council | RED (skill doesn't exist) |
| C2 | `is this a good idea?` | council | RED (skill doesn't exist) |
| C3 | `should I do X` (e.g. `should I rewrite my API in Rust`) | council | RED (skill doesn't exist) |
| C4 | `validate this from multiple angles` | council | RED (skill doesn't exist) |
| C5 | `city council meeting agenda` | NONE (negative — civic-government context) | RED (skill doesn't exist) |

**Notes:** C5 is the civic-government negative test. `council` the word is
heavily polysemous; the description must scope to advisor-personas / decision
validation only.

---

## Aggregate status

Total fixtures: **18** (4 positive + 1 negative grill-me, 4 positive + 1
cross-check eli10, 4 positive fool, 4 positive + 1 negative council).

Currently expected RED: **18 / 18.** Phase 2 should turn G1–G4 GREEN; Phase 3
should turn E1–E5 + F1–F4 GREEN; Phase 4 should turn C1–C4 GREEN. G5 and C5
should turn GREEN whenever their respective skill is authored with a
properly-scoped description.
