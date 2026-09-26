---
name: setting-up-reviewers
description: One-time setup that teaches a repository's automated reviewers the merge bar — a Code Review Rules section in AGENTS.md for Codex and any agent reviewer, and a .coderabbit.yaml when the repository is public — landed as a pull request. Use when asked to set up, configure or tune code reviewers, Codex review rules, CodeRabbit, or AGENTS.md review guidance for a repository.
disable-model-invocation: true
---

# Setting up reviewers

Reviewers that do not know the merge bar review against their own defaults, and every finding
they raise costs a round. This skill writes the bar where each reviewer reads it, once per
repository, and lands it as a pull request.

## 1. Read the repository first

- `gh repo view --json nameWithOwner,visibility,defaultBranchRef`
- Whether a root `AGENTS.md` exists, and whether it already has a review-rules section.
- Whether a `.coderabbit.yaml` exists.
- The one domain invariant reviewers most often have to explain, if any: ask the operator, or
  propose one from the repository's `README.md`/`CLAUDE.md` and let the operator confirm. It
  is optional.

## 2. AGENTS.md

Take the block in `references/code-review-rules.md`. If the root `AGENTS.md` exists, append the
block at the end and change nothing else in the file; if it does not, create it holding only
the block. If a review-rules section already exists, show the diff you would make and ask.

In a dual-repo project the pairing manifest may route `AGENTS.md` to the AI workspace. The
reviewer reads only the reviewed repository, so this section goes there — and it holds review
rules only, never process notes.

## 3. .coderabbit.yaml

Only when `visibility` is `PUBLIC`. For a private repository, write none and say why: the free
tier does not review private repositories. When the repository is public, use
`references/coderabbit.md`. If the file already exists, never overwrite an existing `.coderabbit.yaml` — show the diff you would make and ask the operator.

## 4. Land it as a pull request

Create a branch (`chore/review-rules`), commit following the repository's commit rules, push
the branch, and open it with `opening-a-pr`. Never push to the default branch.

## 5. Azure DevOps and other forges

There is no bot to configure. Print the block from `references/code-review-rules.md` so the
operator can place it in the reviewer seat's brief, with the PR body alongside it — a seat,
unlike Codex, can be handed the body.
