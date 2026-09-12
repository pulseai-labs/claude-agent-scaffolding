# Derived input set — `release-ladder-labels`

**What this is.** The inputs `rubrics/release-ladder-labels.md` reads, derived
from that rubric in one pass. A fixture body on this surface must declare
every class below, because **every criterion is scored on every fixture**. An
input a criterion reads but the body never states is scored against a guess.

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
| I1 | the release's content — accumulated features vs a changed product promise / a new primary journey / an intentionally breaking public contract | 1 |
| I2 | whether the product can be used independently at this release (cold start, real data lifecycle, a recovery path appropriate to solo scale), and whether this is the **first** release attaining that independence or a later release past it | 2 |
| I3 | whether a label is pre-assigned to a release number or milestone vs confirmed by evidence at the release's planning | 3 |
| I4 | whether the release record carries a date | 4 |
| I5 | the sketch's next-release label — a hypothesis ("next: mvp if the paper loop lands") vs a commitment or promise | 5 |

## The two ways a declaration still fails

**Declared as an outcome rather than a fact.** "This release is v1.x" is
criterion 1's conclusion wearing an input's clothes — state what the release
contains and whether the promise changed, not the label the criterion derives
from them.

**Omitting the promise.** A body that lists the release's features without
stating whether the product promise, primary journey, or public contract
changed hands criterion 1 a guess between `v1.x` and `v2`.
