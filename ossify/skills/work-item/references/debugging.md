# Debugging

Depth for SKILL.md §5. This is what you read when the TDD loop stops being a
loop — a RED that will not clear, a test that fails for a reason the AC never
mentioned, a close ceremony that keeps halting on something you have already
"fixed" twice.

**The loop in §5 assumes the failure is the one you meant to cause.** Write a
test, watch it fail, implement, watch it pass. That works right up until a
failure arrives that you did not author and do not understand — and at that
point the loop's rhythm becomes actively harmful, because "implement the minimum
that makes it pass" turns into guessing at a symptom.

---

## 1. When this file applies, and when it does not

**Read this when:**

- an AC's test fails and the failure message does not match what the AC is about;
- a fix makes the test pass and something else goes red;
- the same failure returns after you fixed it;
- `close`'s gate halts on an AC that passed for you locally;
- the cumulative demo surfaces a regression in a line this work item never
  touched.

**Do not read this when** the RED is simply *"the thing is not built yet"*. That
is the ordinary case and §5 already handles it: write the minimum implementation
and move on. Reaching for a diagnosis loop on an unimplemented feature is how a
15-minute work item becomes an afternoon.

### Its neighbours, because three things here look similar

| | Answers | When |
|---|---|---|
| **TDD** (`tdd-loop.md`) | *"does the behaviour exist?"* | Before the code — prevents bugs by writing the test first |
| **impl-check** (`close/references/impl-check.md`) | *"did every AC pass?"* | At the gate — verifies mechanically, halts on first fail |
| **This file** | *"why does this fail?"* | When an AC fails and the cause is not obvious |

The RED gate already stops on a failing test; **debugging is what you read when
the RED is not a simple "implement the missing thing."** impl-check tells you an
AC failed and never tells you why — the why is here.

**Gaps-mode is not available to you here.** It is a gate-phase exit (§3 + §4) and
the loop is past it. A cause you genuinely cannot resolve goes in
`## 8. Blockers and advisories` and the run continues or halts under §5's
structural-surprise rule — never into a late gaps return that strands the ACs you
already implemented.

---

## 2. The loop

**Make it red reliably → minimize → hypothesize → instrument → fix →
regression-test.** In that order, and the first step is the one people skip.

### 2.1 Make it red reliably

**Before anything else, get a command that fails every time you run it.** Not
"usually", not "when I run the whole suite" — every time, on demand, in under a
few seconds if you can manage it.

```bash
# the AC's own command, run three times — same rc every time or it is not reliable
cd "<worktree-abs>" && rc=0; pytest tests/test_orders.py::test_submit || rc=$?; echo "rc=$rc"
```

This is the step that pays for the rest. Without it:

- you cannot tell a fix from a coincidence — the thing that "fixed it" may have
  been the second run;
- you cannot minimize, because you have no oracle to test each reduction against;
- you will report a fix that the close gate then rejects, which is the expensive
  way to find out.

**If it does not reproduce reliably, that is the finding, and it changes what you
are debugging.** An intermittent failure is usually order-dependence, a shared
fixture, a clock, or a real concurrency bug — and chasing the symptom before
establishing which is a waste. Run the single test alone; run the suite; compare.
A test that passes alone and fails in the suite is not a bug in the test, it is
state leaking between tests.

### 2.2 Minimize

**Cut the reproduction down until every remaining part is load-bearing.** Remove
a fixture, an argument, a config line, an unrelated assertion — re-run after each
cut, and keep the cut only if it still fails.

Minimization is not tidying. It *is* the diagnosis: each part you remove without
the failure disappearing is a part you have proven innocent, and the thing you
cannot remove is usually the bug. A ten-line reproduction that still fails has
told you more than an hour of reading.

### 2.3 Hypothesize

**State what you think is wrong, out loud, as a claim that could be false.**
Concretely: *"the adapter is passing the raw id where the port expects a
namespaced one"* — not *"something is wrong with the id handling."*

A vague hypothesis cannot be tested, so it cannot be wrong, so it survives
forever and you keep half-believing it while trying other things. **One
hypothesis at a time.** If you have three, rank them by how cheap they are to
disprove and take the cheapest first.

### 2.4 Instrument

**Make the hypothesis observable — do not reason about whether it is true.**
Print the value, assert the invariant, log both sides of the boundary you suspect.

```bash
# same command, with the probe in place — read what it prints, not what you expect
cd "<worktree-abs>" && pytest tests/test_orders.py::test_submit 2>&1 | tail -20
```

The whole point is to be *told* you are wrong rather than to conclude you are
right. Reading the code and deciding your hypothesis holds is the failure mode
this step exists to prevent — code you are reading is code you already believe.

**Remove every probe before you stage.** A `print` left in the diff is a finding
at the close gate, and a probe that survives into `report.md`'s evidence is
worse: it reads as intentional.

### 2.5 Fix

**Fix the cause the instrument proved, not the symptom the test showed.** If the
instrument disproved the hypothesis, go back to 2.3 — that is the loop working,
not a setback.

The test for whether you have the cause: **you can say why the failure looked the
way it did.** If the fix works but the original symptom is still surprising, you
have probably moved the bug rather than removed it.

### 2.6 Regression-test

**Add a test that fails without the fix and passes with it** — and prove the
first half by reverting the fix and watching it go red.

```bash
# with the fix reverted, the NEW test must be red — this is the assertion
cd "<worktree-abs>" && rc=0; pytest tests/test_orders.py::test_submit_rejects_stale_id || rc=$?; echo "rc=$rc"
```

This suite has been bitten five separate ways by tests that could not fail
(`tdd-loop.md` §2's sanity check is the same discipline). A regression test you
never watched fail is a comment.

Where the test goes: **with the code it protects**, not in a scratch file. It is
part of the work item's diff and it is what stops the next spine reintroducing
the bug.

### 2.7 When to stop

You have no iteration counter — the cap is the orchestrator's
(`round-orchestration.md` §6). Your bound is progress: **if two consecutive
passes through 2.3→2.5 end with the same failure and no disproved hypothesis,
stop debugging this AC.** Record the reproduction, the hypotheses you disproved,
and the last failure verbatim in `## 8. Blockers and advisories`, mark the AC
`fail` in the report's AC table, and move to the next AC in declared order. The
run still ends `complete` — an honest fail the orchestrator can route beats a
session spent on one AC.

---

## 3. The structural-surprise boundary — stub, work around, or halt

SKILL.md §5 says to stop for a structural surprise, gather information, "proceed
as best you can", and report it. That is the right instinct and it does not say
what *proceeding* means. Three worked cases:

**A helper the spec references does not exist.**
Search first — specs name things by intent and the real one is often called
something else (`grep -rn "<the behaviour, not the name>" src/`). If it genuinely
does not exist: **write the smallest real implementation that satisfies your AC**,
in the place the spec implies it belongs, and say so in `## 8`. Do **not** stub it
to return a constant — a stub makes your AC pass while leaving the next work item
a landmine, and nothing in the gate can see the difference. A stub is only correct
when the spec explicitly says the real thing is another item's job.

**An API has a different signature than the spec assumed.**
Adapt at the call site and report the difference. The spec was written before
someone read the library, and this is ordinary. It becomes a halt only if the
real signature makes the AC's *outcome* impossible — that is a spec problem, not
a code problem, and no amount of proceeding fixes it.

**The AC contradicts something the code already guarantees.**
Halt. You have found a genuine conflict between two things the project believes,
and picking one silently is the worst available outcome — whichever you pick, the
other's tests are now wrong and someone will "fix" them later. Report both sides
with the evidence and stop.

**The rule underneath all three:** proceed when you can do the AC's real work with
a documented deviation; halt when proceeding would require *deciding something the
spec should have decided*. You have no mandate for the second, and a decision made
quietly inside a work item is one nobody reviews.

---

## 4. Anti-patterns

- **Fixing before reproducing.** The most expensive habit in this file. You cannot
  know a fix worked without a failure that reliably preceded it.
- **Changing more than one thing between runs.** Now you do not know which one
  mattered, and neither will the report.
- **Reading code instead of instrumenting.** Reading confirms what you already
  believe; a probe can contradict you.
- **"It passes now"** as a stopping condition, with no account of why it failed.
  A failure you cannot explain is a failure that will return, usually in another
  spine, where it will look like a new bug.
- **Debugging past the timebox in silence.** If the diagnosis has eaten the work
  item, that is information the orchestrator needs now — put it in `## 8` and
  surface it, rather than arriving late with a story.
- **Leaving probes in the diff.** They read as intentional to every later reader.
- **Widening scope while you are in here.** A bug you find that is not yours is a
  note in `## 8`, not a second work item you quietly take on.
