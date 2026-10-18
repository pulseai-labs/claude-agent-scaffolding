# One-way door — the merge holder's checklist

For a PR whose body says `Door: one-way`, or has no `Door:` line. `working-a-pr` never merges
it; the merge holder (the orchestrator where one runs, otherwise the operator) does, after
every item below.

1. **Read the diff against the body's Merge danger.** The bar judged findings; this checks the
   one thing a revert will not undo, which no finding named.
2. **Check the version from outside the artifact.** Read it from an installed cache or a fresh
   clone, not the working tree: a stale tree carries the old text and passes its own check.
3. **Install from a clean plugin cache.** What a consumer gets is what the install fetches, not
   what the branch holds.
4. **Tag only the merge result.** Use `git rev-parse` of the merge commit, and stop if the
   merge failed: after a failed merge `HEAD` is still the old commit, and tagging it ships the
   wrong release.
5. **Create the release with `gh release create --verify-tag`.** A release without the tag
   check can point at a tag that does not exist yet.
