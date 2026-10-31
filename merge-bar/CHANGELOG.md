# Changelog

All notable changes to the `merge-bar` plugin.

## 0.7.0

Review ledger: every merged PR leaves one line in the paired workspace's review ledger.

- `working-a-pr` §5 — after a merge, appends one review-ledger line (PR, date, rounds, blocking and
  answered classes, bar rulings, report path) to the paired AI workspace's
  `.claude/memory-bank/review-ledger.md`, creating it with its heading when absent. The write is
  uncommitted and the operator is told which file changed. A PR that is not merged, or a PR with no
  paired workspace, gets the line printed instead. The ledger is never written into the reviewed
  repository. (#984)
- Evals: rubric criterion 6 (the ledger line) added to `working-a-pr`; fixture W16 (review-ledger
  line) is new and W8 (no paired workspace) is updated. Known limit: the other 14 `working-a-pr`
  result files were scored on the five-criterion rubric and were not re-judged.
- Agent-loaded bytes, `skills/**` against 0.6.0 (`wc -c`):
  - `skills/working-a-pr/SKILL.md` — 20371 → 21174 (+803)

## 0.6.0

Our own reviewer: `reviewing-a-pr` reviews against the PR's merge bar, and `working-a-pr` reads its report.

- New skill `reviewing-a-pr` and command `/merge-bar:review-pr` — every finding is a defect
  class with every site in the repo, sorted against the body's merge bar (never a reviewer's
  label); the standards axis and the Claim/spec axis run as parallel fresh-context subagents;
  coverage is stated per file; round 2+ reviews only the fix diff plus each prior class's
  closure. It reports and never posts, commits, edits or checks out. Standards come from
  `CODING_STANDARDS.md` at the paired AI workspace root, else `references/baseline-standards.md`.
- `working-a-pr` — reads the `reviewing-a-pr` report as a review signal (a crew reviewer seat
  returns it; without crew, a fresh-context subagent); the re-review of a pushed round is a
  fresh reviewer on the fix diff; every signal is counted and ledger lines carry their source;
  CodeRabbit and other bots are extra eyes that never gate a round.
- `working-a-pr` — a one-way door, or a body with no `Door:` line, is never merged by the
  skill, under a standing order or on an ack: it goes to the merge holder with
  `references/one-way-door.md`. A two-way door merges as before.
- Evals: `reviewing-a-pr` fixtures R1–R12 with a rubric; `working-a-pr` fixtures W13 (one-way
  door), W14 (extra eyes) and W15 (reviewer report and round 2, numbered W12 on its branch).

## 0.5.0

Standing orders come from the project's memory bank or `AGENTS.md`, and bind only the role they name; the autopilot policy is gone.

- `working-a-pr` — one **Standing orders** paragraph defines where an order is read (the memory
  bank's `08-governance.md` `## Standing orders`, then `AGENTS.md`; a canonical checkout reads
  its paired AI workspace), that the files are read as the base branch has them — an order a
  PR's own diff adds binds nothing in that PR — and that it binds only the role it names. Every other site points
  to it. With no order in effect, every ask stays exactly as it is.
- Eval fixture `W11` now keeps its three orders in the workspace `AGENTS.md`, naming the
  orchestrator; new fixture `W12` has an order naming the orchestrator read by a worker seat,
  which must still ask.

## 0.4.0

Standing orders in the autopilot policy for the merge, the round stop and the reviewers.

- `working-a-pr` — under a **Merge authority** standing order, a clean terminus is the ack
  (the reviewed-OID pin and the pre-merge re-fetch still hold); under a **Round stop** order,
  the round-3 stop narrows the Claim and continues instead of asking, and a condition-1
  finding is never narrowed; under a **Reviewers** order, a reviewer that cannot run on this
  head is replaced by the fallback reviewer the project's roles file names, and the ledger
  says so. With no standing order in effect, every ask stays exactly as it is.
- New eval fixture `W11` covers the three orders in one run: narrow, replace, merge.

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
