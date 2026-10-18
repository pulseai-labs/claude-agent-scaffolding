# One-way door — the merge holder's checklist

For a PR whose body says `Door: one-way`, or has no `Door:` line. `working-a-pr` never merges
it, not even on an ack; the merge holder (the orchestrator where one runs, otherwise the
operator) does, with the reviewed head OID and the §5 lines the hand-off carries.

## Before the merge

1. **Read the diff against the body's Merge danger.** The bar judged findings; this checks the
   one thing a revert will not undo, which no finding named.
2. **Check the version from a fresh clone of the head.** Not the working tree: a stale tree
   carries the old text and passes its own check.
3. **Re-fetch the findings and checks, then merge pinned:** `gh pr merge --match-head-commit
   <that OID>`. The pin refuses a head that moved; the re-fetch catches a finding that landed
   on the same head.

## After the merge

4. **Install from a clean plugin cache or a fresh clone.** What a consumer gets is what the
   install fetches, not what the branch holds.
5. **Tag only the merge result.** Use `git rev-parse` of the merge commit, and stop if the
   merge failed: after a failed merge `HEAD` is still the old commit, and tagging it ships the
   wrong release.
6. **Create the release with `gh release create --verify-tag`.** A release without the tag
   check can point at a tag that does not exist yet.
7. **Write the §5 `[KL]`/`[TD]` lines** per `working-a-pr` §5, or print them: they are written
   only once the merge has succeeded.
