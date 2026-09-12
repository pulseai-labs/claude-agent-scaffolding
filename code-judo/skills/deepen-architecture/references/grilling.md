# Grilling the picked candidate

Once the user picks a candidate, walk the decision tree with them. The **agenda** is fixed;
the **griller** is resolved at invocation time.

## The agenda

Whoever runs the grill, these are what the conversation has to settle before the candidate is
ready to build:

1. **Constraints** — what any new interface would have to satisfy.
2. **Dependencies** — what the module depends on, and which category each falls into
   (`code-judo:codebase-design` → `references/deepening.md`).
3. **The shape of the deepened module** — its interface: entry points, parameters,
   invariants, error modes.
4. **What sits behind the seam** — what the implementation absorbs, and what stays outside.
5. **What tests survive** — which existing tests are made redundant by tests at the new
   interface, and which have to be written.

Hand this agenda to the griller. Do not restate it as questions yourself if you are
delegating — that produces two interviews.

## Resolution order

Take the first of these that works:

1. **`ossify:challenge`** — the normal case, in interview mode.
2. **`ai-mentor:grill-me`**.
3. **The protocol below** — in-plugin, no dependency, always available.

**How to probe: just call it**, the way your host invokes a skill — the Skill tool in Claude
Code, an explicit `$skill` invocation on Codex. Do not try to detect
installation by looking for plugin directories on disk — the install path differs by host and
by install mode, so a wrong guess reports "not installed" for a plugin that is right there and
silently downgrades a user who has the better griller.

**Fall through only when the skill is genuinely absent.** "No such skill" is the answer that
means move on. A registry error, a plugin that failed to load, a permission refusal — none of
those mean the skill is not installed, and swallowing them as absence hides a real fault while
looking like a clean fallback. Surface anything that is not a plain not-found, say what
happened, and then continue with the in-plugin protocol so the user is not blocked.

These are **soft** dependencies. Nothing about the correctness of this skill changes when
neither plugin is installed; the third option is a complete griller, not a degraded one. Do
not tell the user to install anything.

**Cadence differs between resolvers, and that is fine.** `ossify:challenge` and
`ai-mentor:grill-me` ask one question at a time. The protocol below asks a whole round at a
time. What must not differ is the agenda: whichever resolver fires, all five items above get
settled before you stop.

## Recommendation policy

The lean this protocol attaches to every question is the marketplace's recommend-by-default
convention, not a local invention. The universal rule lives in
`references/recommendation-policy.md` — a byte-identical copy of the marketplace
source-of-truth, guarded by the repo-root parity test. Read it there. It is not restated here;
only how it renders on this surface is:

- **Rendering.** One firm lean plus a one-line rationale on each numbered question in the
  batch. *"Number the questions and answer each one yourself first"* below **is** this policy,
  and the user's three dispositions on each are accept / rebut / defer.
- **Grounding.** Ground in what the scan already **read**: the resolved vocabulary source, the
  ADRs covering the area, and the code itself. Cite the file. Where none of them reaches the
  question, say *"(general best practice — no project source found)"*. Never invent a citation.

  **The candidate card is not a source.** It is this scan's own recommendation — model-written,
  a few steps earlier in the same run. It may inform how a question is *phrased*, and it must
  never count as the evidence that answers one. Citing it grounds a lean in the agent's own
  output, which is the `UNGROUNDED` case the policy escalates, wearing a citation.
- **Triage.** A question whose answer is citable from an **independent project source you can
  reach** — the resolved vocabulary source, an ADR, the code — and which clears the policy's
  escalation predicate is not
  asked at all: adopt the lean and carry it in a `⚡ Auto-applied` digest at the top of your
  next batch. Nothing this run produced can clear that bar; a question the card alone answers
  is `UNGROUNDED` and gets asked. **TOP SEVERITY on this surface is anything that moves
  the seam** — what sits behind it, or what the deepened interface promises. Those are always
  asked, never auto-applied.
- **Opt-outs.** `--neutral` (or *"no recommendations"*) drops the leans and asks cold. `--walk`
  keeps the leans but asks every question, disabling triage.

When `ossify:challenge` or `ai-mentor:grill-me` runs instead, that skill brings its own
adoption of the same policy — which is the point of there being one policy.

## The in-plugin protocol

Compact by design. This is the fallback that ships with the plugin so the skill never depends
on another being installed — not a second general-purpose interviewer. Two of those already
exist in this marketplace, and a third written out at length would drift from both.

**Batch by dependency, not by topic.** Ask everything the agenda's current answers already
let you ask, in one go. Hold back anything whose sensible phrasing depends on an answer you
have not received — asking it now means guessing at that answer inside the question, and the
user ends up correcting your premise instead of deciding anything.

**Number the questions and answer each one yourself first.** A recommendation is what makes a
question cheap to answer: the user is confirming or overriding a position, not composing one
from nothing. Say which way you lean and why, in a sentence.

**Then stop and wait.** One batch, then silence until they reply. Answers reshape what is
askable, so recompute the next batch from the agenda rather than working down a list you
wrote earlier.

**Look things up yourself.** Anything the repository, the tests, or the tools can tell you is
yours to find — dispatch a sub-agent and keep going. Only decisions go to the user, and a
lookup in flight blocks only the questions downstream of it, not the whole batch.

**Done is when the agenda is settled**, not when you run out of questions. All five items —
constraints, dependencies, module shape, what sits behind the seam, surviving tests — have
answers that are either **given by the user** or **auto-applied under triage**, which is the
standing delegation the policy defines: those are settled, not outstanding, and waiting for a
user answer to a question triage decided not to ask would stall the grill forever. Then say
what you understood — including the auto-applied answers, so the delegation is visible and can
be reopened — and wait for them to confirm it before anything gets built.
