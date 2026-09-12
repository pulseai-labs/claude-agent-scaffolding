---
scenario_id: 05-patch-lane-keyed-to-its-own-repo
expected_outcome: halt
expected_reason: The patch commit sits in svc-billing, not canonical — a one-line log-level fix, mechanically clean on touch_check (no bone, no risk gate). But svc-billing is currently parked on spine/r1.s9-notification-batching (an unrelated, in-progress spine), not its base branch, because an engineer used an already-checked-out worktree to make the fix without noticing. Patch-lane close must resolve `repo_key: svc-billing` — the repo the commit actually targets — and assert THAT repo's branch: svc-billing is on a spine branch, so it halts, naming svc-billing and the branch, before recording anything. A ceremony still resolving `canonical="$(oss repo_root canonical)"` unconditionally and asserting only canonical's branch (pre-#272/#310-Task-5-and-9) never looks at svc-billing at all: canonical happens to be parked cleanly on its own base branch (`main`) for entirely unrelated reasons, so the old guard's case statement matches its `"$base_branch") echo "ok: patching on the base branch '$br'"` arm and reports success — a FALSE "proceed". The old two-argument `oss patch_add "<sha>" "<text>"` then records the patch with no repo key at all (readers treat that as canonical), while the actual commit sits on a live spine branch in svc-billing, invisible to the guard that was supposed to catch exactly this. The wrong answer this fixture falsifies is reporting the branch check clean because canonical looked fine, without ever asserting the repo the commit is actually in.
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). No open spine currently has a work item
targeting `canonical`; `canonical` is checked out on `main`, its base branch,
clean.

`svc-billing` is mid-spine: `r1.s9` ("notification batching") is active, and
`svc-billing` is checked out on `spine/r1.s9-notification-batching` for it,
with one completed work item's commit already on that branch.

An engineer, working from the already-checked-out `svc-billing` worktree,
notices a mis-set log level in `worker/logging.go` and commits a one-line fix
directly — `git -C /Users/ops/repos/svc-billing log -1 --format=%s` reads
`fix: log level was Debug, should be Info`. `git -C
/Users/ops/repos/svc-billing diff --name-only HEAD~1 HEAD` shows only that
one line changed, in a file `oss touch_check` reports clean on (no bone, no
risk gate registered over `worker/logging.go`). The engineer has not yet run
`oss patch_add`.
