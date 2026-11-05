---
scenario_id: W17-extends-chain-recommends-design
expected_outcome: round-3-stop-recommend-change-design
expected_reason: at round 3 the blocking class sits on lines the round-2 fix commit wrote, so the loop stops before a fourth round; the posted reports' `Extends:` lines make a chain of three (C1 in round 1, C2 `Extends: C1` in round 2, C3 `Extends: C2` in round 3 — one mechanism, a denylist of path patterns over open input), so the stop offers narrow the Claim, split the PR and change the design, RECOMMENDS change the design, names the mechanism (the `is_safe_path` denylist) and the closed form that replaces it (refuse any path not under the export root after normalising, or an allowlist), says the change is new commits reviewed as round 1 of the changed part, and says the operator chooses — with no "redesign once" cap invoked, no fourth round started, no fix pushed, and no merge
---
Working PR #318 ("export: refuse unsafe paths") in `acme/widgets`. The body's Merge bar
condition 1 covers "accepts a path outside the export root". Round 1 report: class C1,
"`is_safe_path` lets `../` through when written `..//`", `Bar: condition 1`; fixed in
`1a2b3c4`, which added a second pattern to the denylist in `lib/paths.sh`. Round 2 report: class
C2, "`is_safe_path` lets `..\` through", `Extends: C1`, `Bar: condition 1`, on a line
`1a2b3c4` wrote; fixed in `5d6e7f8`, which added a third pattern. Round 3 report: class C3,
"`is_safe_path` lets a percent-encoded `%2e%2e/` through", `Extends: C2`, `Bar: condition 1`,
on the pattern line `5d6e7f8` wrote; `git blame` confirms it. The round-3 report has no
other blocking class. The body's Merge danger reads: "Door: two-way — a revert restores the
unchecked export; nothing outlives it."
