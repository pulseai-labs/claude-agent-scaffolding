# Derived input set — `spike-contract-integrity`

**What this is.** The inputs `rubrics/spike-contract-integrity.md` reads,
derived from that rubric in one pass. A fixture body on this surface must
declare every class below, because **every criterion is scored on every
fixture**. An input a criterion reads but the body never states is scored
against a guess.

**What this is not.** It is not a second copy of the rubric and states no
rule. Each row points at the criteria that read it; **the rubric is the
authority on what those criteria say**, and where the two disagree the rubric
wins. Kept out of `fixtures/<surface>/` because `lib/aggregate-scores.sh`
globs `*.md` inside each surface directory and treats every one it finds as a
fixture owing a result JSON.

**Re-derive it when the rubric changes.** A criterion edited to read something
new adds a row here; this list is downstream of the rubric and goes stale
silently.

| # | Input class | Read by criteria |
|---|---|---|
| I1 | the uncertainty signal — genuine architectural uncertainty (the bone cannot be written without knowing the shape works at all) vs a question a cheaper sibling owns (a crate/version/API/platform fact → smoke test; a read-shaped comparison → research; an experiential "which shape" with no falsifier → prototype) vs "just not sure it'll be fast enough" / "try a library I find interesting" with no bone depending on it | 1 |
| I2 | the candidate architectures, and whether a cheap fact distinguishes them (picking wrong means a rewrite, and no cheap distinguisher exists) | 1 |
| I3 | the bone decision the spike would enable — named, or not (cannot name it → not spiking, exploring) | 1, 4 |
| I4 | the draft contract's hypothesis — exactly one, or multiple | 2 |
| I5 | the falsifier — present or absent, and written before the run or after the fact | 2 |
| I6 | the timebox — present and wall-clock, or absent | 4 |
| I7 | `code_fate` — `discard` (scratch branch or throwaway worktree, never merged) vs a merge / "tidy and merge" intent | 3 |
| I8 | whether learned behavior is to be reimplemented under normal spine ceremony or copy-pasted | 3 |
| I9 | the evidence retained after deletion — named upfront, or not | 4 |
| I10 | any risk gate / live-money / live-customer-data / destructive surface the hypothesis would touch, or none | 5 |

## The two ways a declaration still fails

**Declared as an outcome rather than a fact.** "The contract is sound" is
criterion 2-4's conclusion wearing an input's clothes — state the six fields,
not the verdict on them, or the criterion cannot fail.

**Declaring the offer without the uncertainty.** A body that says "a spike is
offered" without stating what the uncertainty is and why no cheaper sibling
owns it hands criterion 1 a guess between the defensible readings.
