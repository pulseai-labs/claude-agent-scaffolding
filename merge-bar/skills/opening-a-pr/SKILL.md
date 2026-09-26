---
name: opening-a-pr
description: Open a pull request whose body carries six fields — Claim, Scope, Known limits, Merge bar, Evidence, Closes — so every reviewer and the session that works the PR judge it against a finish line fixed before review starts. Use when opening, raising or creating a PR, writing or rewriting a PR description, or when another skill hands you a finished branch to open. Proposes a split instead of opening when the honest claim or scope is too wide.
---

# Opening a pull request

## 1. Why the body has a fixed shape

A review loop with no finish line agreed before it starts ends only when someone tires, and
every finding it cannot place becomes an issue. The body fixes the finish line before any
reviewer speaks: the **Merge bar** says which findings can block, and the **Claim**, **Scope**
and **Known limits** say what this PR promises and what it deliberately leaves alone.
`working-a-pr` judges every finding against this body, so write it as if nobody will read
anything else.

## 2. Four checks before you write

1. **Read the diff.** The base is the branch the caller names, else the repository default
   (`gh repo view --json defaultBranchRef`). Run `git fetch origin <base>` and
   `git diff --stat origin/<base>...HEAD`, then read the changes themselves.
2. **Size the Claim.** It must fit in three sentences, each checkable against the diff. If the
   honest claim needs more, or Scope spans more than one plugin, package or subsystem, stop and
   propose a split before opening: name each part, what it would claim, and the order they
   land in. This is a proposal, not a refusal — if the operator says to open it anyway, open
   it, and let the Claim say plainly that the PR is wide.
3. **Test every Known limit against condition 1.** If a would-be limit rejects valid input, or
   corrupts or loses state, on a path this PR touches, it is not a limit — it is a blocking defect
   and the PR is not ready to open. Say so, name the defect, and do not open the PR, whoever asked
   for it to be listed.
4. **Collect the Evidence.** Only commands run in this session, with what they showed. Never
   write a command you did not run or a result you did not see.

## 3. Write the body

Use the template in `references/pr-body.md` exactly — its six headings, in order, and its
Merge bar block word for word. Its "Filling each field" section says what goes in each one.

## 4. Follow the repository's own conventions

- **A PR template already exists** (`.github/pull_request_template.md`, a file under
  `.github/PULL_REQUEST_TEMPLATE/`, or the root or `docs/` equivalents): keep every one of its
  sections, fill them, and put the six fields after them. Never delete a template section.
- **Closing issues:** one `Closes #N` line per issue. GitHub closes only the first issue of `Closes #1, #2`.
- **The repository's rules for commit and PR text** apply to this body too. Read its
  `CLAUDE.md`, `AGENTS.md` and `CONTRIBUTING.md` — for example, a repo that forbids AI
  attribution trailers in commits forbids them here.
- **The title** follows the repository's recent merged PRs
  (`gh pr list --state merged --limit 10 --json title`).

## 5. Open it

Write the body to a file and run
`gh pr create --base <base> --head <branch> --title "<title>" --body-file <file>`.
Open it ready for review, not as a draft, unless the caller asks for a draft. Report the URL.

On a forge other than GitHub (for example Azure DevOps), the body is the same; print the
title and body for the operator, because this version does not drive that forge's CLI.

## 6. What this skill does not do

It does not lint the body with a script — whether a body is honest is judgment, not a
mechanical fact. It does not work the PR through review (`working-a-pr` does) and never merges.
