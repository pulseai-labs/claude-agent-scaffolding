# Changelog

All notable changes to the `merge-bar` plugin.

## 0.1.0

Initial release. Three prose skills and three slash commands, no runtime library.

- `opening-a-pr` (`/merge-bar:open-pr`) — a six-field PR body whose Merge bar fixes, at open
  time, which findings can block; a split proposal when the claim or scope is too wide; a
  condition-1 "limit" stops the PR from opening.
- `working-a-pr` (`/merge-bar:work-pr`) — ossify's work-pr loop re-anchored on the PR's own
  merge bar: five dispositions, non-blocking findings answered in the thread by default, one
  issue per PR for out-of-scope defects, one push per round, a round-3 stop when the fixes are
  generating the findings, and the known-limits ledger written to the paired AI workspace after
  merge.
- `setting-up-reviewers` (`/merge-bar:setup-reviewers`) — an `AGENTS.md` `## Code Review Rules`
  section, and a `.coderabbit.yaml` on public repositories, landed as a PR.

Ships on Claude Code and Codex. Not on Devin or in the OpenCode bundle.
