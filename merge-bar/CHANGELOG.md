# Changelog

All notable changes to the `merge-bar` plugin.

## 0.3.0

OMP marketplace surface.

- Wrappers name the skill by `skill://` path as well as `${CLAUDE_PLUGIN_ROOT}`; skill descriptions lead with the trigger ("Use when ...") so OMP's skill match fires; Claude Code tool names carry an OMP alias where a skill names one; the README gains an OMP note. No Claude Code-only parts.

## 0.2.1

- `opening-a-pr` — the template says a review stopping rule is not a bar and never goes in
  the Merge bar block: `working-a-pr` decides when rounds stop, and "after round 2, block only
  on X" is a lower bar. Seven PRs (#626, #653, #707, #712, #720, #722, #725) wrote a stopping
  rule in place of the four conditions, following a pre-merge-bar "2 rounds, then defer" rule.
- `working-a-pr` — a stopping rule in the bar's place is judged as a bar below the template.
- The repository `CLAUDE.md` drops its separate "agree a stopping rule" line and points at
  `working-a-pr`.

## 0.2.0

- `opening-a-pr` — the PR body has a seventh field, `## Merge danger`, between Known limits
  and Merge bar. It names the door (two-way when a revert of the merge undoes all of it,
  one-way when something outlives the revert) and the blast radius. It does not change which
  findings block.
- `working-a-pr` — the terminus report quotes the body's Merge danger, or says the body has
  none, before it asks for the merge ack.
- The `opening-a-pr` eval rubric's first criterion is renamed `body_fields` and checks seven
  headings. The committed eval results predate this change.

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
