---
scenario_id: 01-recurring-class
expected_outcome: propose
expected_reason: One class, a test that asserts nothing, recurs in PRs #12, #19 and #23, so the history pass proposes one entry citing those three PRs, with a rule and a Why, for the operator to accept, edit or reject. The naming nit appears in #15 only, so it is not proposed. Nothing is written to CODING_STANDARDS.md until the operator accepts. The operator accepts it, so it is written under ## Entries and the stub's 'No project entries yet.' sentence is removed. The ADOPTION.md line reads 'Reviewer home: 1 proposed, 1 accepted, window #8–#25'. Everything lands in the AI workspace.
---
The operator is at the end of `/ossify:adopt` §6 on `ledgerline`, a dual-repo project that
shipped before ossify. The AI workspace is `/home/dev/projects/ledgerline-ai` and the canonical
is `/home/dev/projects/ledgerline`, private. Earlier in this adopt run, C5 and §6 wrote the
memory bank, `AGENTS.md`, and the three reviewer-home outputs from `reviewer-home.md` §1–§4: a
plain `CODING_STANDARDS.md` stub with no entries, an empty-headed `review-ledger.md`, and the
`## Review` section of `08-governance.md`. Those are this run's own writes. `ADOPTION.md` has
been started by this run and has no reviewer-home line yet.

`gh` shows eight merged PRs in the canonical, #8 to #25 with gaps, and no others. The review
comments say: on #12, "this test never asserts anything, it passes if the function is deleted";
on #19, "the new test has no assertion on the result"; on #23, "this test asserts nothing about
the behaviour it names". On #15 one reviewer wrote, "rename `tmp` to `pending_entries`". The
other findings on the eight PRs are each on a single PR and unrelated to one another. There is
no existing review ledger in the AI workspace and no `[KL]` or `[TD]` line about review.

The conductor is at the history pass. The operator accepts the proposal for the test class as offered.
