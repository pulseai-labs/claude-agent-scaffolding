---
name: council
description: Convene a 5-persona advisory council (Karpathy LLM Council pattern, codebase-aware Historian variant) when the user wants multi-angle validation of an idea, decision, design choice, or strategy. Distinct from `grill-me` (one-voice / one-question / interactive) — council is one-shot / five-voices / parallel. Activate on "council", "/council", "council me on this", "convene the council", "validate this idea", "stress-test from multiple angles", "different perspectives on this", "is this idea good", "is this a good idea", "should I do X" (decision-flavored, not factual), "what would the council say". Do NOT activate for civic-government "council" usage (city council, town council meeting), simple yes/no factual questions, code review of existing implementation (use a code-review skill), or "drill MY plan" interview-shape requests (use `grill-me`).
---

# The Council

Five advisor personas attack the user's idea from different angles in a **single response**, then the user (as Chairman) synthesizes the verdict. Adapted from Andrej Karpathy's LLM Council pattern; the canonical "Expansionist" is replaced with **The Historian** — a codebase-aware seat that quotes the user's own git history.

## 📍 Orient first

Before convening the personas, emit a compact **"📍 You are here"** block so the user is globally anchored, not just locally coherent (they may be resuming after a break or juggling several projects):

- **Topic** — the idea under council, one line.
- **Where it sits** — product area / plugin / sub-spec / issue # · **weight** (strategic vs. polish).
- **Why** — the motivating need / what prompted convening the council.

Derive it from available context, in order: a referenced issue/PR (read it), then the memory-bank (`00-project-brief`, MASTER-SPEC §, SPEC ledger), then recent handoffs. If context is thin, **ask the user for a one-line reminder — never guess or fabricate.** Re-surface this block whenever the user asks "where am I?" (or similar). Keep it to a few lines: this orients, it does not gate.

## Mechanic

Produce **one response** containing five markdown-headed sections in this exact order: `## The Contrarian`, `## The First Principles Thinker`, `## The Outsider`, `## The Executor`, `## The Historian`. Each section is 2–3 paragraphs of in-character take on the user's idea.

After the five voices, **propose a Chairman synthesis by default (#93)** under a `## Chairman's synthesis (recommended)` heading: one firm recommended verdict + a one-line rationale, grounded in the source-of-truth you derived for the 📍 block and *cited* where available (general best practice otherwise — never fabricate a citation), then invite the user to **accept / rebut / defer**. The five voices still come first and in full; the synthesis rides after them — it does not replace them or pre-empt the debate.

**Opt-out.** Under `--neutral` (or "no recommendations" / "I'll synthesize"), do **not** pre-synthesize — close instead with **"Chairman, your synthesis?"** and let the user write the verdict (the pre-#93 behavior). Note: a request for *you* to synthesize ("you synthesize", "propose a verdict") is the **opposite** of neutral — it wants the recommended synthesis, so honor it (do not treat it as an opt-out).

Do not run a peer-review round between personas (deferred to a future version). Full recommendation policy: `recommendation-policy.md` (next to this `SKILL.md`).

Full persona briefs — voice, what they hunt, opening moves, verbal tics — live in `personas.md`. **Read it before authoring the five sections** so each voice stays sharp and distinguishable. One-line summaries here for orientation only:

- **The Contrarian** — hunts the fatal flaw. Leads with what kills the idea, not caveats.
- **The First Principles Thinker** — ignores the surface question; rebuilds from the actual problem.
- **The Outsider** — fresh eyes. Names what the user thinks is obvious but isn't.
- **The Executor** — "what do you do Monday morning?" Concrete path or it's vapor.
- **The Historian** — codebase-aware. Quotes the user's prior commits / files / patterns. The only persona that does tool work: the required git/Glob survey, the priors-rich quoting rule, and the greenfield fallback are specified in `personas.md` — run them before authoring its section.

## Composition

- **`grill-me`** — different shape (one question per turn, interactive). **Do not run in the same session as council** — they fight each other for the interaction shape. Pick one.
- **`eli10`** / **`fool`** — fine to invoke on any single persona's section that reads too dense. Council yields gracefully.
