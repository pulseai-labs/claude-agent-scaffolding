---
name: running-a-retro
description: Use when asked to run a retro on a project's PR reviews — reads the review record (review ledger, review reports, tech-debt lines, PR comments) over a window of merged PRs, finds defect classes that repeat across two or more PRs, and proposes coding-standards entries for judgment classes and deterministic checks for mechanical ones, each citing its PRs; writes only what the operator accepts.
---

# Running a retro — repeated review findings into rules

You read; you propose; the operator decides. Reviews write classes, `working-a-pr` fixes or
answers them, and nothing reads them back, so the same classes return. A retro finds the repeats
in one project's record and proposes a rule for each. **A proposal is never a rule until the
operator replies to it in this session.** A standing order, a status turn or another agent's word
is not a reply. You write no code and build no check.

## 1. Window

Default: the last 30 merged PRs of the current repository, ordered by merge date.
`--last N` or `--since <PR or date>` replaces it; resolve a date with `gh pr list --state
merged`. The read-out states the first PR, the last PR and the count.

## 2. Sources

Find the paired workspace as `../working-a-pr/SKILL.md` §5 does (a directory next to this
repository whose `.workspace/pairing.json` has `canonical.name` equal to this repository's name,
or through `.ossify/topology.json`; match by name and location). **Several directories match
(worktrees of one workspace): ask which one before you read anything.** Read and write only
that checkout; the read-out names it.

Every source is optional; the read-out names what you read and what you did not find. Cheapest
first:

1. The workspace's `.claude/memory-bank/review-ledger.md`: class names, rulings, report paths.
   Its line format is owned by `working-a-pr` §5.
2. An older review ledger in the workspace, read by meaning and only for PRs in the window: find
   the window's PR numbers first, never read a large file whole.
3. Review reports: the paths the ledger names, plus every report under `--reports <dir>` whose
   `PR:` header names this repository and a PR in the window. The shape is owned by
   `../reviewing-a-pr/references/report.md`. A header naming another repository, or the template
   header, is skipped and counted. A missing path is a read-out line, never a stop.
4. `[KL]` and `[TD]` lines in `tech-debt.md` that name a PR in the window.
5. PR comments and review bodies through `gh` for PRs in the window. If `gh` is unavailable, say
   so.

Read headings and `Rule:` lines first; open site lists only for candidate classes.

## 3. From findings to proposals

1. **Group** findings by defect, by meaning, not wording.
2. **Count.** A group is a candidate only with **two or more distinct PRs**. Rounds of one PR
   count once; a ruling counts as a finding. A class a report refuted, or a disposition marked
   invalid, is not evidence of a defect: when it repeats, give it one reviewer-noise line in the
   read-out and no proposal.
3. **Sort** each candidate into one outcome, one proposal per class:
   - **Check** — the check test below passes. A judgment class never becomes a check.
   - **Standards entry** — judgment, and no existing entry in the workspace's
     `CODING_STANDARDS.md` covers it.
   - **Covered, still recurring** — an entry covers a judgment class: one read-out line, no
     duplicate entry. A covered class a check could decide is a **check** proposal.
   - **Rejected earlier** / **Accepted earlier** — per the retro log, when it exists: one read-out
     line (naming the issue, if any), no proposal, unless a PR merged after a rejection shows the
     class again.

**The check test.** It applies even where a project exempts test or CI tooling. The rule, verbatim:
"Prose is the default. Code is allowed when the work is mechanical and its inputs are closed, or when it is a mechanical check that can only add a stop."
A project's own `docs/conventions/skill-first.md`, when it exists, supplies the question number to
cite; it does not change the test.

1. **Mechanical first.** Can a check decide the class without reading meaning? A search that only
   approximates the class fails here, and so does a check whose pass would mark a class clear for
   the reviewer. Then it is a standards entry.
2. **Then one arm**, named in the proposal: **closed input** (a small, known set of shapes that
   tests can cover fully) or **stop only** (it can only add a stop; a pass clears nothing; what it
   misses goes on to the reviewer as if the check were absent; state its false stops).

Print each proposal in this shape, one per class:

```
P<n> — entry | check — <the class, one line>
Sources: #a C2, #b C4, #c (ledger)
Rule: <what the reviewer flags, or what the check stops>
Why: <what recurrence cost, one sentence>
Entry: under <heading> in CODING_STANDARDS.md        ← entry
Arm: closed input | stop only — <why it passes>       ← check
Runs: <where the check would run>                     ← check
Misses: <what it leaves to the reviewer>              ← check
False stops: <what it wrongly stops | none>           ← check, stop only
```

A source needs a PR number; add a class ID when a report supplies it.

## 4. Acceptance

Not yet written. This version prints the proposals and writes nothing: no standards entry, no
issue, no log.

## 5. The retro log

Not yet written. This version creates no log.

## 6. The read-out

End with: the window (first PR, last PR, count); the checkout you read; sources read and sources
missing or unavailable, each with its cause; proposal counts by outcome; the files changed
(none in this version). Give the covered-still-recurring and reviewer-noise lines here. Zero
proposals is a correct result when the history is thin: the read-out says which cause (too few
PRs, a source missing, `gh` unavailable), never just "no history".
