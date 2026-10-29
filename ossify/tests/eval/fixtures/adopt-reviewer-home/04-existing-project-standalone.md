---
scenario_id: 04-existing-project-standalone
expected_outcome: standalone-seed
expected_reason: ossify started this project, so no adopt station runs and ADOPTION.md is not used. The skill follows reviewer-home.md section 1 to 5 as written. The free destinations are seeded in the AI workspace, the history pass proposes the recurring class for the operator, and the result line goes as a fifth line in the 08-governance.md Review section. Because that file has no Review section, the section is added, and no other part of the file is edited.
---
The project is `ledgerline`, a dual-repo project that `/ossify:start` set up some weeks ago and
that is now in Release 1, mid-spine. The AI workspace is `/home/dev/projects/ledgerline-ai`
and the canonical is `/home/dev/projects/ledgerline`, private. The project has no
`ADOPTION.md`: it was started, not adopted. Its memory bank holds `08-governance.md` with
governance rules and no `## Review` section, and the AI workspace holds no `CODING_STANDARDS.md`
and no `review-ledger.md`; `/start` ran before reviewer-home existed. Nothing has been written
in this session.

The operator says: "Follow reviewer-home.md on its own for this project."

`gh` shows eight merged PRs in the canonical, #8 to #25 with gaps, and no others. The review
comments say: on #12, "this test never asserts anything, it passes if the function is deleted";
on #19, "the new test has no assertion on the result"; on #23, "this test asserts nothing about
the behaviour it names". The other findings are each on a single PR. The operator accepts a
proposal for that class when it is offered.
