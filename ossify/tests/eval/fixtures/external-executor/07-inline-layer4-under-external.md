---
scenario_id: 07-inline-layer4-under-external
expected_outcome: external
expected_reason: 'Every condition the delegated Layer 4 path has ever required is
  satisfied here - OSSIFY_NO_WORKFLOWS unset, a Workflow tool available, a nonempty
  staged index, handoff.md present and readable - and the close still takes the INLINE
  path, because external mode is now one of the conditions and it is not met. The
  reason is cost, not capability: the caller already reviewed this item, so a six-agent
  delegated pass buys a second review nobody asked for. The lenses, the finding schema
  and the verdict rule are unchanged whichever path runs, and the inline path is not
  a degraded mode. The second half is the control: the same project''s OTHER spine,
  run with no flag, still takes the delegated path under those same conditions. The
  wrong answers this fixture falsifies are: taking the delegated path because its
  named conditions are all true; and generalising the inline choice into "this project
  now always runs Layer 4 inline"'
---

A project has two spines in flight.

Spine `r8.s1` ("policy cache") is running under `--external-executor`. Its work
item `r8.s1.w1` came back accepted and complete, the recomputed fingerprint
matched, and the item is now at work-item close. The gate passed Layers 1, 2 and
3. At the point Layer 4 is chosen: `OSSIFY_NO_WORKFLOWS` is unset, a tool named
`Workflow` is available in this harness, `git diff --cached --name-only` in the
worktree lists four files, and `handoff.md` exists beside `spec.md` and is
readable.

Spine `r8.s2` ("policy cache metrics") is being run separately in another
session with `/ossify:run-spine r8.s2` — no flag. Its work item `r8.s2.w1` has
reached work-item close under exactly the same four conditions.

For each of the two closes, state which Layer 4 path runs and why, and what the
close prints about it. Say whether the lenses or the verdict rule differ between
the two.
