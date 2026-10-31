---
scenario_id: 06-standalone-own-stub
expected_outcome: standalone-seed
expected_reason: The standards file is an ossify stub, because it still carries the verbatim `No project entries yet.` sentence, so it takes the accepted entry like a stub a run wrote itself. The entry goes under `## Entries`, the sentence is removed, and the result line in the 08-governance.md Review section reads `1 proposed, 1 accepted`. The class recurs in exactly two PRs, which is the floor.
---
The project is `quillpad`, a dual-repo project that `/ossify:start` set up on this version of
ossify two weeks ago. The AI workspace is `/home/dev/projects/quillpad-ai` and the canonical is
`/home/dev/projects/quillpad`, private. The project has no `ADOPTION.md`. Its
`CODING_STANDARDS.md` is the stub `/start` seeded: the header, the `## Read these where they live`
list and the sentence `No project entries yet. Entries come from review findings that recur,
accepted by the operator.` The memory bank holds `08-governance.md` with a `## Review` section of
four lines and no result line, and a `review-ledger.md` with no lines. Nothing has been written in
this session.

The operator says: "Follow reviewer-home.md on its own for this project."

`gh` shows six merged PRs in the canonical, #3 to #11 with gaps, and no others. The review
comments say: on #5, "this fixture shares state with the previous test, so order changes the
result"; on #9, "the two tests share one global fixture, so they pass only in this order". The
other findings are each on a single PR. The operator accepts the proposal when it is offered.
