# Skill-first — prose by default, code where the input is closed

> **Single source of truth.** This file is authored once at the marketplace root
> (`docs/conventions/skill-first.md`) and imported by every `CLAUDE.md` that needs it,
> including the paired private AI workspace's. Edit here.
>
> **One copy is sanctioned: the headline sentence, inline above each import.** `@` expansion
> is a Claude Code feature, not a property of a file — Codex, `cat`, the GitHub web view, and
> any session whose external import was silently declined all receive a bare path and no rule.
> Those headlines exist for those readers. **Do not delete them, and do not extend them past
> the one sentence.** Where a headline and this file disagree, this file wins.
>
> Nothing else restates the rule. A restatement is the failure mode this file exists to
> prevent.

## What we are building, and why it constrains how

These plugins are built for our own daily workflow across many projects. The design lineage
is `superpowers` and mattpocock's skills: capability ships as **prose skills a model
follows**, with code only where code is the better tool. Poteto's "gradient" (Matt Pocock ×
Poteto, 2026) names where that line falls: judgment goes to the agent, mechanical work goes
into code so that agents do not "rebuild the world each time". This file makes the line
decidable for our stack.

## Scope: this governs code that runs on a user's path

Build, release and test tooling is **out of scope entirely**. Deterministic code for
maintaining the plugins themselves — version bumps, linting, test runners, parity checks —
is unconstrained by this rule, because it never executes on a consumer's machine and so
cannot produce a user-facing defect.

Verification code that **ships** in a plugin is not that tooling. A gate that decides whether
a user's tests passed, or whether a user's change meets its spec, runs on the user's path: it
is in scope, and as a safety rail it falls under question 3.

Everything below is about the other kind of code: what ships and runs for a user.

## The rule

**Prose is the default. Code is allowed when the work is mechanical and its inputs are closed, or when its only possible mistake is an extra stop.**

Ask in order; the first question that matches decides.

| # | Question | If yes |
|---|---|---|
| 1 | Does the work need judgment — choosing, weighing, reading meaning? | **Prose.** |
| 2 | Is it mechanical, **and** is its input closed — a small, known set of shapes that tests can cover fully (our own state files, IDs we mint, digests, git commands with fixed arguments, version strings)? | **Code.** |
| 3 | Is the input open-ended (free shell text, paths people type, prose, another tool's changing output), **and** can every mistake the code makes only add a stop — an extra question, a refusal — never let something through? | **Code, as a safety rail.** It states which way it fails. |
| 4 | None of the above. | **Prose**, or a model judgment called from code. |

**New work and existing work.** New work follows the test from the start. Existing work
moves only when evidence — a pulse360 finding, a review finding, a recorded incident — shows
the current form failing.

**"Rebuild the world."** When agents keep re-deriving the same mechanical step, make one
shared tool — only if question 2 or 3 allows it. Otherwise write the step once into the skill
as fixed wording.

**Two consequences worth naming.** Most state mutation — journals, locks, IDs, git side
effects — comes out as code, because its input is closed. "Run this; did it pass" may be code
when it reads only an exit status; explaining *why* it failed stays prose.

**The test is decidable on purpose.** Each question asks for a property you can check: does
the work judge, is the input set closed, which way can the code be wrong. A criterion like
"only where deterministic code is really crucial" is the sentence a session writes to justify
the code it already wanted.

## Measured, not asserted

On this repo, new library bash has been ~29% of changed volume and ~57% of review findings —
roughly 4x the defect density of prose. On PR #166 it was 100%: four review rounds, five
defects, every one in path-string handling, net product value a path normalizer. The defects
sit where question 2 says they will: code reading open input.

autonomic 0.5.0 (PR #735) is the worked example of question 3. Its never-approve check reads
free shell text — mechanical work on open input. It is allowed as code only because every
mistake it can make is an extra ask, never a missed one. It still took four review rounds and
ships with 16 recorded known limits: the cost of open input, paid in the safe direction.

## In practice

Default to a skill. Reach for code when the test says so, and say which question allowed it.
Prefer agent/LLM-judge review over brittle deterministic gates for anything semantic; keep
deterministic checks for mechanical facts on closed input.

Over-specifying mechanical precision in prose is its own failure — it drives review churn
without buying correctness.
