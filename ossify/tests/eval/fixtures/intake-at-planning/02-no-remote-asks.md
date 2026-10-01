---
scenario_id: 02-no-remote-asks
expected_outcome: say-unreadable-and-ask
expected_reason: The repo has no remote, so the intake queue cannot be read. The pre-flight says so in one line and asks the operator whether any other project has sent requests for this spine. It does not report an empty queue and invents no dispositions. Planning continues after the operator answers, and any request the operator names gets a disposition like a listed one.
---
pulse-trader is a local-only repository at `/home/dev/projects/pulse-trader`:
`git -C /home/dev/projects/pulse-trader remote` prints nothing. Its ossify topology
resolves. Release r1 is open, and spine r1.s3 ("order ticket") is planned with no
work items yet. The AI workspace has no `.claude/memory-bank/tech-debt.md`.

The operator says: "/ossify:plan-spine r1.s3".
