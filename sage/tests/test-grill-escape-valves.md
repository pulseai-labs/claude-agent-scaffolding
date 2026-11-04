# test-grill-escape-valves — stuck-state fixture checklist

**Phase 1 RED-state checklist (sage v2.0).** During a grill-me session,
when the user produces a stuck-state answer (tangled / paralyzed / tactical /
no-timescale), the grill-me skill should detect the cue and fire the
corresponding **escape valve reframe** (SPEC §5.1, body item #4).

## How to use

For each fixture:

1. Start a fresh Claude Code session with sage v2.0 installed.
2. Open a grill-me session — e.g., paste a short fictional design and say
   `grill me on this design`. Let grill-me ask its first question.
3. Reply with the **stuck-state message** verbatim (or close — the cue should
   trigger regardless of exact wording).
4. Inspect the next response. It passes if the **expected reframe** appears
   (the language doesn't need to match word-for-word, but the shape must:
   naming the trap, then pivoting the user to a tighter frame).
5. Check the box, or annotate FAIL with what actually happened.

**Current state (Phase 1):** all rows are **RED**. v1.3 grill-me has no
escape-valve content; only the 7-category interview structure. Phase 2 folds
the 4 escape valves into the refined grill-me body.

## Status legend

- RED — known to fail in current tree
- GREEN — confirmed passing

---

## Stuck-state fixtures (4 total)

### V1 — tangled answer → separating-concerns reframe

| Fixture field | Value |
|---|---|
| Stuck-state cue | Answer hedges, contains "but also", references 3+ subsystems |
| Stuck-state message | `Well, the cache depends on auth which depends on whether the user is offline, but also we have to think about the rate limiter, and the rate limiter is shared with the queue subsystem so any cache eviction policy has to account for queue pressure too…` |
| Expected reframe shape | Name the trap ("you're answering 3 questions at once"); ask user to enumerate the concerns; pick one to grill at a time |
| Expected language markers | "separate concerns" / "one at a time" / "name them" / "split this" |
| Status | RED |

### V2 — paralyzed answer → widening-confidence-interval reframe

| Fixture field | Value |
|---|---|
| Stuck-state cue | User seeks 100% confidence on a close call; both options have downsides |
| Stuck-state message | `I just can't decide — both options have real downsides and I need to be 100% sure before I commit. Let me think about it more.` |
| Expected reframe shape | Name the trap (chasing 100% on a 60/40 call); pick the more-likely option with a stated confidence interval; commit + adjust as signal arrives |
| Expected language markers | "100%" / "confidence interval" / "60/40" or "55/45" / "commit and adjust" / "you don't need certainty" |
| Status | RED |

### V3 — tactical framing → identity-question follow-up

| Fixture field | Value |
|---|---|
| Stuck-state cue | User frames a decision as reversible/tactical when it actually shapes what the codebase becomes |
| Stuck-state message | `Yeah we can rip it out later if it doesn't work — it's reversible, low-risk to try.` |
| Expected reframe shape | Acknowledge the tactical framing; ask the identity question — what does picking this make the codebase in 3 years? what behaviors does it normalize across the team? |
| Expected language markers | "even if reversible" / "what does this make the codebase" / "in 3 years" / "behaviors this normalizes" / "what kind of codebase" |
| Status | RED |

### V4 — no timescale → time-horizon clarification

| Fixture field | Value |
|---|---|
| Stuck-state cue | User says "I'm optimizing for X" without naming the timescale |
| Stuck-state message | `I'm optimizing for developer velocity here.` |
| Expected reframe shape | Ask for the timescale explicitly — 90 days vs 18 months vs 5 years — because the answers conflict and the user has to pick one |
| Expected language markers | "what timescale" / "90 days" / "18 months" / "5 years" / "those answers conflict" / "pick one" |
| Status | RED |

---

## Aggregate status

Total fixtures: **4.** Currently expected RED: **4 / 4.** Phase 2 should turn
all four GREEN by folding the 4 escape valves into `skills/grill-me/SKILL.md`
as diagnosis-cue + reframe pairs per SPEC §5.1 body item #4.
