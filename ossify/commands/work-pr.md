---
description: Drive a pull request through the full review-fix-merge loop — fetch every reviewer finding, disposition each, drive the fixes, re-review on the new head, defer leftovers as tracked issues, merge only on explicit ack
argument-hint: "<PR number or URL> [--repo-root DIR]"
allowed-tools: Bash(bash:*), Bash(git:*), Bash(gh:*), Read, Write, Edit, Glob, Grep
---

The PR to work, and any flags: $ARGUMENTS

Read `${CLAUDE_PLUGIN_ROOT}/references/work-pr/loop.md` end to end and follow
it. It owns the whole lane: the preflight (resolve the target repo, refuse a
dirty tree, verify the checked-out head), fetching both finding signals, the
set-level pass that collapses those findings into classes before each edit
pass, the disposition contract, driving the fixes, re-review on the new head,
tracked deferral, and the merge ask.

Three rails survive any adaptation:

- **A P1 is never ack-to-merged.** Correctness, security, data loss, or a
  broken contract gets fixed before merge — or refuted with evidence — no
  round limit and no deferral applies to that class.
- **A deferral is a tracked issue, never a silent pass.** Every finding ends
  as `fixed in <sha>`, `deferred → #N`, or `invalid — <why>` (an
  evidence-shaped refutation) in the ledger you surface.
- **The merge is the operator's.** Surface the ledger, the reviewer state,
  and a mergeability verdict, then stop at the ask. Never auto-merge.

This is a generic utility: it needs no pairing manifest and works on any
repository `gh` can reach. Since #339 it is also the spine-close merge lane: a
spine's **remote-hosted** repos land on their base branches by PR, and the spine
close hands each opened PR to this command with the ceremony's requirements
stated in the invocation — the merge convention is a **merge commit**, and
deferrals land as tracked issues in the target repo. Repos with no remote never
reach this lane; the ceremony merges them locally. The ceremony owns the tier;
this lane owns the loop.
