---
scenario_id: 05-c2-zero-shipped-halts
expected_outcome: halt-c2-zero
expected_reason: Class P. A6 passed on the operator's word, but C2 ran each shipped step's clean-checkout test and all three failed, so each was re-marked next. No step is left shipped, so C4 does not call release_add. Adoption halts with the record written to that point, and the hand-off names the state to remove (the file oss state_path prints, and ADOPTION.md moved aside) to retry.
---
Class P adoption of `/home/dev/projects/orbit` (Rust CLI, 18 commits) from
`/home/dev/projects/orbit-ai`. `oss init` has run. C1 marked three steps
`shipped`: "run `orbit sync`", "run `orbit list`", "run `orbit export`". C2 ran
each from a clean checkout at the baseline SHA: `orbit sync` panics on an empty
config, `orbit list` prints nothing for a populated store, and `orbit export`
is not wired to a command. The operator watched all three. Each step is now
re-marked `next` and recorded as a C2 gap; no step is `shipped`.

The ceremony is at C4.
