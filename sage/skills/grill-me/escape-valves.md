# Escape valves — diagnostic cues + reframes

Four mid-grill diagnostics. Each fires **only** when its cue appears in a user answer, not on every question. Name the trap, deliver the reframe, then resume grilling on the tighter frame.

Source: internal cognitive-discipline notes (ghost-notes principles #3/#4/#5; manifest-transcript traps #1/#3).

---

## 1. separating-concerns

**Trigger** — the user's answer hedges, contains "but also" / "we also have to think about", references 3+ subsystems, or says "I can't answer that cleanly because…".

**Diagnosis** — they're trying to resolve multiple tangled concerns in one go. Working memory is overloaded; clarity drops the longer they push.

**Reframe** — pause. Name the concerns separately. Pick the one that unblocks the others and grill it first.

**Example response** —
> Pause — you're answering three questions at once: (1) cache eviction policy, (2) auth-offline behavior, (3) queue-rate-limiter coupling. Let's split them. Which one, if you resolved it cleanly, would make the other two easier? We'll grill that first.

---

## 2. widening-confidence-interval

**Trigger** — the user is paralyzed on a close call. Says "I need to be 100% sure" / "both have downsides" / "let me think about it more" without a concrete new input they're waiting on.

**Diagnosis** — they're chasing 100% confidence on a decision that doesn't admit it. The honest stance is to widen the interval, not narrow it.

**Reframe** — pick the more-likely option with a stated interval. Commit. Adjust as signal arrives. Acknowledging uncertainty is the move, not refusing to decide.

**Example response** —
> You're chasing 100% confidence on a 60/40 call. That confidence isn't reachable here — the inputs don't support it. Pick the 60 with an interval of [40%, 80%] confidence. Commit. The signal you need to revise will arrive faster from a live decision than from more deliberation. Which way is the 60?

---

## 3. asking-identity-question

**Trigger** — the user frames a decision as tactical / reversible / low-risk ("we can rip it out later", "it's just a try", "easy to swap"), but the decision actually shapes what the codebase becomes — patterns it normalizes, expectations it sets for future code.

**Diagnosis** — reversibility is real but downstream. Every "reversible" call still answers: *what does this codebase become if we keep this for 18 months?* That's the identity question.

**Reframe** — acknowledge reversibility, then ask what the choice *makes* this codebase. What behaviors does it normalize? What gets harder to do because this exists?

**Example response** —
> Granted — reversible. But even if you rip it out in 6 months, you've spent those months writing other code *around* it. So: what does this codebase become if this pattern is in it for 18 months? What does it teach the next person reading the repo? Is that codebase one you'd want to inherit?

---

## 4. widening-time-horizon

**Trigger** — the user says "I'm optimizing for X" (velocity, simplicity, correctness, cost, whatever) without naming the timescale.

**Diagnosis** — the same word ("velocity") describes different optimizations at different time horizons. The 90-day answer, the 18-month answer, and the 5-year answer often conflict. Without a named horizon, the optimization is incoherent.

**Reframe** — ask which timescale. Force the pick. Then re-ask the original question with the horizon pinned.

**Example response** —
> Velocity over what window — the next 90 days, the next 18 months, or the next 5 years? Those answers conflict. 90-day velocity rewards copy-paste; 18-month velocity rewards abstractions you'll re-use; 5-year velocity rewards documentation and migration paths. Pick one, then we'll re-grill the choice against that horizon.
