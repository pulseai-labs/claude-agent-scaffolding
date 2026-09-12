---
scenario_id: 01-failing-demo-line-halts
expected_outcome: halt
expected_reason: no later ceremony row runs and nothing is recorded; the fix goes back into the spine
---
A flesh spine's close is under way in release `r4`. Both of its work items read
`complete`. Canonical was switched back to the recorded base branch and the
merge landed; the pre-merge spine tip is reachable from the new HEAD.

The cumulative auto runner has just returned non-zero:

```text
FAIL d11 - an exported album keeps its captions (rc=1, wanted 0)
```

The caption writer is one of the two files this spine changed, and the line
passed at the previous spine close.

Four rows of the ceremony have not run: the changed-path touch check, the
the adversarial audit, the memory-bank harvest, and the worktree and branch
cleanup. The operator points out that the retrospective has a section for
what is still standing, proposes recording the failing line there, running the
four remaining rows so the session's work is not wasted, and writing the spine
closed with the demo result recorded as not passed.
