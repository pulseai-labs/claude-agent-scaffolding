# merge-bar

The pull-request lifecycle against a merge bar fixed when the PR opens.

A review loop with no finish line agreed in advance ends only when someone tires, and every
finding it cannot place becomes an issue. merge-bar writes the finish line into the PR body
before any reviewer speaks, and judges every finding against it.

## The merge bar

```
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite.
Everything else is non-blocking.
```

## Skills

| Skill | Command | What it does |
|---|---|---|
| `opening-a-pr` | `/merge-bar:open-pr` | Writes the six-field body (Claim, Scope, Known limits, Merge bar, Evidence, Closes) and opens the PR |
| `working-a-pr` | `/merge-bar:work-pr <PR>` | Works the PR to mergeable against its own bar; merges only on your ack |
| `setting-up-reviewers` | `/merge-bar:setup-reviewers` | Once per repository: `AGENTS.md` review rules, and `.coderabbit.yaml` if public |

On Codex, invoke the skills by name.

## Install

```
/plugin install merge-bar@claude-agent-scaffolding
```

## Known-limits ledger

After a merge, `working-a-pr` writes the PR's known limits as `[KL]` lines, and its one
out-of-scope issue as a `[TD]` line, to the paired AI workspace's
`.claude/memory-bank/tech-debt.md`. With no paired workspace it prints them and asks. It never
writes them into the reviewed repository.

## Tests

`bash merge-bar/run-tests.sh` runs the frontmatter lint and ten fidelity pins; CI runs it.
The behaviour evals in `tests/eval/` are session-driven and **not** run by CI — follow
`tests/eval/RUNBOOK.md` before any version bump.
