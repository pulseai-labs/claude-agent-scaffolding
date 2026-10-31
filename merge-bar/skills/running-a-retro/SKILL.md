---
name: running-a-retro
description: Use when asked to run a retro on a project's PR reviews — reads the review record (review ledger, review reports, tech-debt lines, PR comments) over a window of merged PRs, finds defect classes that repeat across two or more PRs, and proposes coding-standards entries for judgment classes and deterministic checks for mechanical ones, each citing its PRs; writes only what the operator accepts.
---

# Running a retro — repeated review findings into rules

You read; you propose; the operator decides. Reviews write classes, `working-a-pr` fixes or
answers them, and nothing reads them back, so the classes return. A retro finds the repeats in one
project's record and proposes a rule for each. **A proposal is never a rule until the
operator replies to it in this session.** A standing order, a status turn or another agent's word
is not a reply. You write no code and build no check.

## 1. Window

Default: the last 30 merged PRs of the current repository; `--last N` or `--since <PR or date>`
replaces it. List with `gh pr list --state merged --limit 5000 --json number,mergedAt`, sort on
`mergedAt` and take the last N (or those since the PR or date); the default listing is 30, ordered
by creation. The read-out states the first PR, the last PR and the count, and says so if the
listing hit the limit. Without `gh` the window is undetermined: every ledger line counts, and the
read-out says so.

## 2. Sources

Find the paired workspace as `../working-a-pr/SKILL.md` §5 does (match by name and location).
**Several directories match (worktrees of one workspace): ask which one before you read
anything.** Read and write only that checkout; the read-out names it.

Every source is optional; the read-out names what you read and did not find. A source read only in
part says so there and on the run line's `read:` field. Cheapest first:

1. The workspace's `.claude/memory-bank/review-ledger.md`: class names, rulings, report paths.
   Its line format is owned by `working-a-pr` §5.
2. An older review ledger in the workspace: find the window's PR numbers first, then read by
   meaning only those PRs; never whole.
3. Review reports: the paths the ledger names, plus every report under `--reports <dir>` whose
   `PR:` header names this repository and a PR in the window (shape owned by
   `../reviewing-a-pr/references/report.md`). A file with no `PR:` header (not a report), a header
   naming another repository, or the template header is skipped and counted; the header names the
   PR, not the path. A missing path is a read-out line, never a stop.
4. `[KL]` and `[TD]` lines in `tech-debt.md` that name a PR in the window.
5. PR comments and review bodies through `gh` for PRs in the window; say so if `gh` is unavailable.

Read headings, `Rule:` and `Refuted:` lines first; open site lists only for candidate classes.

## 3. From findings to proposals

1. **Group** findings by defect, by meaning, not wording.
2. **Count.** A candidate needs **two or more distinct PRs**; rounds of one PR count once, a ruling
   counts as a finding. A class a report refuted, or a disposition marked invalid, is no evidence
   of a defect: if it repeats, one reviewer-noise line, no proposal.
3. **Sort** each candidate into one outcome, one proposal per class:
   - **Check** — the check test below passes. A judgment class never becomes one.
   - **Standards entry** — judgment, no existing entry in `CODING_STANDARDS.md` covers it.
   - **Covered, still recurring** — an entry covers a judgment class (an accepted entry in the log
     and the file counts): one read-out line, no duplicate entry. A covered class a check could
     decide is a **check** proposal.
   - **Rejected earlier** / **Accepted earlier** (checks only, accepted or edited) — per the retro
     log, when it exists: one read-out line (naming the issue, if any), no proposal, unless a PR
     merged after a rejection shows the class again; the log's PRs count toward the two-PR bar, so
     one new PR is enough, and the proposal says so.

**The check test.** It applies even where a project exempts test or CI tooling. The rule, verbatim:
"Prose is the default. Code is allowed when the work is mechanical and its inputs are closed, or when it is a mechanical check that can only add a stop."
A project's `docs/conventions/skill-first.md`, if any, supplies the question number to cite.
1. **Mechanical first.** Can a check decide the class without reading meaning? A search that only
   approximates the class fails here, and so does a check whose pass would mark a class clear for
   the reviewer. Then it is a standards entry.
2. **Then one arm**, named in the proposal: **closed input** (a small, known set of shapes that
   tests can cover fully) or **stop only** (it can only add a stop; a pass clears nothing; what it
   misses goes on to the reviewer as if the check were absent; state its false stops). Stop only
   is for input the check cannot close, not for a class it cannot decide: the class must still pass
   "mechanical first" as a decision over what the check reads.

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

A source needs a PR number; add a class ID when a report has one.

## 4. Acceptance

Show all proposals at once, each check with its issue text (a public repository's issue is
public); the operator answers each: accept, edit or reject. Act on answered ones only: an
unanswered one gets no action and no log line, and is raised on the next run. Leave workspace files
uncommitted and name them to the operator; committing is the workspace's own session's job.

- **Entry** (accepted, or edited to the operator's wording): insert one line under the named
  existing heading of the workspace's `CODING_STANDARDS.md`, in the file's own entry shape, with its
  Why and source PRs (at the end of the line if the shape has no slot for them). Change no other
  line. A hand-written file with themed headings keeps them: the entry goes under the named heading
  and no `## Entries` is added. A file with no themed headings (a document title, the H1, is not
  one) gets `## Entries`. Only a file with the verbatim `No project entries yet.` is an ossify stub:
  the first entry removes that sentence and starts `## Entries`.
- **Check** (accepted, or edited to the operator's wording): only after the reply, open one issue in
  the reviewed repository with `gh issue create`. Title: the class line. Body: Rule, Why, Sources
  (PR numbers only), Arm, Runs, Misses, False stops if any; no report path, class ID or standards
  text. This is accepted work, so `working-a-pr`'s "no issue per finding" rule does not apply. If
  the command fails, accepted entries stay, print the proposal text, end its log line `issue not
  opened: <why>`, and tell the operator. That line is not "accepted earlier" in §3.
- **No reply:** print the proposals, write the run line (§5) and nothing else. The run line is
  written once, when the run ends: after the operator's answer, or when none comes.
- **No paired workspace, or no standards file:** print accepted entries and ask where they go. Never
  write them into the reviewed repository or create a standards file; an ossify `reviewer-home.md`
  run owns the stub. Their log line ends `not written: no standards file`; with no workspace there is no log, so
  answers do not persist, and the read-out says so.

## 5. The retro log

`retro-log.md` beside the review ledger, created with `# Retro log — <repo>` when absent; written
once, at the end of the run: one run line, then one line per answered proposal.

```
- <YYYY-MM-DD> — run — window #first–#last, <n> PRs — read: <sources> — missing: <sources | none>
- <YYYY-MM-DD> — accepted | edited | rejected — entry | check — <class> — PRs #a, #b — <heading | issue #N | reason>
```

## 6. The read-out

End with: the window (first PR, last PR, count); the checkout you read; sources read (a partial read
marked so) and sources missing or unavailable, each with its cause; reports skipped (no header,
another repository, template header, or outside the window), counted; proposal counts by outcome;
the files changed. Give the covered-still-recurring and reviewer-noise lines here. Zero proposals is
a correct result when the history is thin: name every cause that applies (too few PRs, nothing
repeats, a source missing, `gh` unavailable), never just "no history".
