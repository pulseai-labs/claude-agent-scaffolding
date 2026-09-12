# Rubric: close-per-repo

Score each 1-5 (4 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`halt` | `proceed` | `reclassify`. `halt` = the ceremony stops before
completing the merge and/or before recording the close, naming the repo and
the reason. `proceed` = the ceremony lands every merge it needs to and
completes the step, without halting. `reclassify` = the ceremony does not
halt, but a touch-check hit reclassifies the spine mid-flight (`spine-close.md`
§6.1) and every remaining row runs at the deeper class's depth — a `proceed`
that silently skips the reclassification is a different, wrong outcome from
one that fires it.

**Every criterion is scored on every fixture.** A fixture that turns on one
mechanic is still scored on the other three — a criterion whose own condition
never arises in that fixture scores whether the skill correctly stayed silent
about it, the same convention `run-spine-declared-repo` and `adopt-multi-repo`
use. There is no N/A.

1. **A work item's merge lands in that item's OWN repo, not canonical by
   default.** `work-item-close.md` §4 reads the item's `target_repo` from
   state and commits, guards and merges entirely inside that repo. A work
   item whose `target_repo` is a declared repo other than canonical still
   closes — its commit lands there, not in canonical, and canonical is never
   touched by that item's close at all. Resolving `canonical` regardless of
   the item's own `target_repo`, or halting an otherwise-ready item only
   because its repo is not canonical, is a wrong answer here even when it
   happens to land on the right verdict for the fixture in front of it.
2. **Spine close merges into EVERY repo hosting one of the spine's items, not
   canonical alone, and the spine is not complete while any of them is
   unmerged.** `spine-close.md` §3 loops the switch-back-and-merge once per
   hosting repo. A hosting repo left on the spine branch, un-merged into its
   base, is a spine that has not actually closed there — reporting the close
   as done because canonical's share landed, while a second or third hosting
   repo's tip never reached its base branch, is a wrong answer even when
   canonical's own merge succeeded cleanly.
3. **The touch check reads ONE list built from every hosting repo's own
   first-parent diff, and a hit that lives only in a non-canonical repo's
   diff is still a hit.** `spine-close.md` §6 concatenates each hosting
   repo's `$merge_sha^1..$merge_sha` diff before the one `oss touch_check`
   call. A bone or risk-gate surface touched only in a repo other than
   canonical must still surface as a HIT and drive the same mid-flight
   reclassification a canonical-only hit would. Reporting the check clean
   because canonical's own diff carried no hit — while a non-canonical
   hosting repo's diff was never read at all — is the wrong answer this
   criterion exists to catch, independent of whether the overall verdict
   happens to be right.
4. **The patch lane's branch guard and its recorded repo key both name the
   repo the patch commit actually sits in, never canonical by default.**
   `patch-lane.md` §5 resolves `repo_key` — the repo the patch targets — and
   asserts THAT repo's branch before committing; §5b's `oss patch_add` records
   the same key. Checking canonical's branch (and finding it clean) while the
   patch's actual commit sits in a different, misparked repo is a false
   "proceed" — the guard validated a repo the patch never touched. A record
   whose repo key disagrees with the repo the branch was actually asserted
   against is a wrong answer even if the commit itself is fine.

## Output format
`{"scores":{"per_repo_merge_target":N,"spine_close_merges_every_hosting_repo":N,"touch_check_aggregated_across_repos":N,"patch_lane_keyed_to_own_repo":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
