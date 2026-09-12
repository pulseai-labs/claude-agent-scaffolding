# Interview mode — the grill

Depth for `challenge/SKILL.md`. Interview the user about a plan or design until
you both reach a shared understanding. You are surfacing *unmade decisions* in
new material, not testing known material.

Absorbed from ai-mentor's `grill-me` (CORE posture, orient block, disposition
triage, escape valves, exit summary) merged with mattpocock's `grilling`
(design tree, frontier, fact dispatch). The merge rule: **the tree decides what
to ask; triage decides what the user is asked.**

---

## 1. Orient first

Before the first question, emit a compact **"📍 You are here"** block so the
user is globally anchored, not just locally coherent:

- **Topic** — the thing being grilled, one line.
- **Where it sits** — product area / spine / spec section / issue #, and its
  weight (strategic vs. polish).
- **Why** — what prompted this grill.

Derive it from available context, in order: a referenced issue/PR (read it),
then the memory bank and MASTER-SPEC, then recent handoffs. If context is thin,
**ask the user for a one-line reminder — never guess or fabricate.** Re-surface
the block whenever the user asks "where am I?". A few lines: this orients, it
does not gate.

---

## 2. Posture: CORE

**Curiosity → Objectivity → Reassurance → Empathy.**

Senior peer, not teacher or adversary. Direct over diplomatic. Genuinely
curious, not gotcha. Stay on one branch until it resolves. Weak answer →
follow-up; strong answer → "good, next branch?".

---

## 3. The design tree and the frontier

Map the subject as a **design tree**: every decision branches into the
decisions that hang off it. The **frontier** is every decision whose
prerequisites are already settled — the questions you can ask *now* without
guessing at answers you have not heard yet. Every answer reshapes the tree:
settled decisions push the frontier outward and unblock what depended on them.
Recompute after each answer.

**Facts are your job, never the user's.** When a frontier question needs a fact
from the environment, look it up — `Read`, `Grep`, or dispatch a sub-agent for
anything wider. Never ask "do you have a test framework?" when
`pyproject.toml` is right there. Do not block on a running exploration: it is
an unsettled prerequisite, so only the questions downstream of it wait; ask the
rest of the frontier now.

**Code contradicts the claim → resolve by mode.** When exploring turns up a
fact that contradicts the user's stated premise, surface the contradiction
directly. In development/implementation the **code** wins (flag the doc as
stale); in vision-aligned planning the **vision/spec** wins (flag the code as
drift). If the mode is ambiguous, ask which frame applies.

---

## 4. The merged round

Each round:

1. **Extend the tree** from the material in conversation.
2. **Compute the frontier.**
3. **Triage the frontier.** Classify each question against the escalation
   predicate below. A question that clears it is **never asked** — adopt your
   recommended answer as the working answer and record it. Emit the digest at
   the top of your next question turn (never a dedicated turn):

   ```
   ⚡ Auto-applied K of N
   <id> · <question one-liner> · <adopted answer> · <citation>
   ```

   `reopen <ids>` pulls an auto-applied item back into the walk at any point
   before the exit summary.
4. **Walk the escalated frontier one question per turn.** Each question carries
   **one firm recommended answer** plus a one-line rationale — cited from the
   project source-of-truth where reachable (`MASTER-SPEC §4.2`, a bones ADR, a
   memory-bank file), or labelled *(general best practice — no project source
   found)*. Never fabricate a citation. The user can **accept / rebut /
   defer**.

**Escalation predicate — escalate when ANY holds:**

1. **UNGROUNDED** — no reachable source-of-truth grounds the recommendation.
   A best-practice lean never auto-applies.
2. **VISION/SCOPE-TOUCHING** — the question challenges the vision, the scope,
   or a previously locked decision.
3. **ONE-WAY DOOR** — hard to reverse: public contracts, data migrations,
   deletions, outward-facing actions.
4. **IDENTITY-SHAPING** — this surface's top class: the decision is framed
   tactical but shapes what the codebase becomes (escape valve 3's territory).
5. **CONTESTED** — your honest lean is "rebut the premise", or two sources
   disagree.

**Opt-outs, per invocation, never sticky:** `--walk` / *"walk them"* asks every
frontier question (triage off). `--neutral` / *"no recommendations"* removes
the recommended answers, which disables triage transitively.

**Why the escalated set walks one per turn instead of as a numbered batch:**
triage already absorbed the class users accept verbatim. What remains is
premise-level, one-way-door, or contested material — exactly where a batch
invites shallow bulk answers. Batching pays on the class triage owns; it costs
on the class that remains.

---

## 5. What to grill on

Pick the category with the weakest current answer; re-pick each round. Do not
walk linearly.

- **Requirements & users** — who exactly, explicit non-goals?
- **Assumptions** — which, if wrong, collapses the plan?
- **Edge cases & failure modes** — empty / huge / malformed / concurrent /
  late / partial-failure?
- **Trade-offs** — what was rejected and why? easy-to-change vs hard?
- **Operability** — how observed? what fires? who pages at 3 AM?
- **Composition** — what depends on it? blast radius?
- **Reversibility** — one-way vs two-way doors? gravity on the one-way ones?

---

## 6. Escape valves (mid-grill diagnostics)

When an answer matches a stuck-state cue, fire the matching reframe **once**,
then resume grilling on the tighter frame. Do not apply on every question.

### 6.1 separating-concerns

**Cue** — the answer hedges, contains "but also", references 3+ subsystems, or
"I can't answer that cleanly because…".

**Reframe** — pause; name the concerns separately; pick the one that unblocks
the others and grill it first.

> Pause — you're answering three questions at once: (1) cache eviction, (2)
> auth-offline behavior, (3) rate-limiter coupling. Which one, resolved
> cleanly, makes the other two easier? We grill that first.

### 6.2 widening-confidence-interval

**Cue** — paralysis on a close call: "I need to be 100% sure", "both have
downsides", with no concrete new input awaited.

**Reframe** — the honest move is to widen the interval, not narrow it. Pick the
more-likely option with a stated interval, commit, adjust as signal arrives.

> You're chasing 100% confidence on a 60/40 call, and the inputs don't support
> it. Pick the 60 with a stated interval. The signal to revise arrives faster
> from a live decision than from more deliberation. Which way is the 60?

### 6.3 asking-identity-question

**Cue** — the decision is framed tactical/reversible ("we can rip it out
later") but actually shapes what the codebase becomes — the patterns it
normalizes, what it teaches the next reader.

**Reframe** — acknowledge reversibility, then ask what the choice *makes* this
codebase over 18 months.

> Granted — reversible. But you'll spend those months writing other code
> around it. What does this codebase become if this pattern is in it for 18
> months? Is that a codebase you'd want to inherit?

### 6.4 widening-time-horizon

**Cue** — "I'm optimizing for X" with no timescale named.

**Reframe** — the 90-day, 18-month, and 5-year answers often conflict. Force
the pick, then re-ask the original question against the pinned horizon.

> Velocity over what window — 90 days, 18 months, 5 years? Those answers
> conflict. Pick one, then we re-grill the choice against that horizon.

---

## 7. Exit

Stop when **any** holds: the user signals stop ("we're good", "ship it"); three
consecutive questions hit "we covered that" (fixed point); or you can
articulate, for each major choice, what was picked + why, the risks, and what
is deferred. **Do not act on the result until the user confirms shared
understanding.**

Exit summary, four sections:

1. **Locked decisions** — choice + brief rationale each.
2. **Self-answered (delegated)** — question + adopted answer + citation per
   triage item; the audit record. Omit when empty.
3. **Open / deferred** — issue + why deferred.
4. **Worth re-checking later** — assumption + when/how to validate.

---

## 8. Fold-in (write-back)

Settled decisions are written down where this invocation's caller keeps them:

- **Under `plan-spine`** (the bone grill gate): fold into the spine's
  `SPINE.md` — the decomposition, rounds, or demo lines the grill moved.
- **Standalone:** an ADR is offered only when all three tests pass — hard to
  reverse, surprising without context, and the result of a real trade-off.
  Miss any one and skip the ADR. The ADR follows the bones-registry
  conventions (`start/references/bones-registry.md`); there is no separate
  glossary layer to maintain.

---

## 9. Anti-patterns

- **Asking a fact you could look up.** Explore first (§3).
- **Checklists.** One question per turn on the escalated set; triage owns the
  rest.
- **Lecturing.** "What happens if X?" beats "Note that X is unhandled."
- **Firing an escape valve on every question.** Once per cue, then resume.
- **Auto-applying an identity-shaping or vision-touching answer.** Those are
  escalated classes by definition.
- **Acting before the user confirms the exit.** Shared understanding is the
  deliverable; confirmation is its gate.
- **Restating the fold-in targets per call site.** §8 is the only copy.
