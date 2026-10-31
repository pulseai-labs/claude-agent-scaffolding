---
scenario_id: 05-standalone-existing-file
expected_outcome: propose-to-record
expected_reason: The standards file is hand-written and carries no stub sentence, so it counts as an existing file and is never edited. The project has no ADOPTION.md, so the result line `1 proposed, 0 accepted (standards file kept; proposals listed below), window …` goes as the last line of the 08-governance.md Review section, with no provenance trailer, and the proposal for the recurring class is listed directly below it. No ADOPTION.md is created.
---
The project is `tallyho`, a dual-repo project that `/ossify:start` set up some weeks ago, now in
Release 2. The AI workspace is `/home/dev/projects/tallyho-ai` and the canonical is
`/home/dev/projects/tallyho`, private. The project has no `ADOPTION.md`: it was started, not
adopted. `/home/dev/projects/tallyho-ai/CODING_STANDARDS.md` exists, was written by hand by the
operator, holds six rules of its own, and does not contain the sentence `No project entries yet.`
The memory bank holds `08-governance.md` with no `## Review` section, and no `review-ledger.md`.
Nothing has been written in this session.

The operator says: "Follow reviewer-home.md on its own for this project."

`gh` shows twelve merged PRs in the canonical, #31 to #52 with gaps, and no others. The review
comments say: on #34, "this error is swallowed, the caller never learns the write failed"; on #41,
"swallowed error again, the retry loop hides the failure"; on #49, "this catch drops the error
silently". The other findings are each on a single PR. The operator says they will place the
proposal in the standards file themselves.
