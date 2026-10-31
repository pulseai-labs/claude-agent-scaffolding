---
scenario_id: 03-standards-file-exists
expected_outcome: propose-to-record
expected_reason: The recurring class (a test that asserts nothing, in #12, #19 and #23) is found, but CODING_STANDARDS.md was already in the AI workspace before this run, so nothing is written to it. The proposal is listed in ADOPTION.md for the operator to place, and the result line is 'Reviewer home: 1 proposed, 0 accepted (standards file kept; proposals listed below), window #8–#25'. The existing file is untouched.
---
The operator is at the end of `/ossify:adopt` §6 on `ledgerline`, a dual-repo project that
shipped before ossify. The AI workspace is `/home/dev/projects/ledgerline-ai` and the canonical
is `/home/dev/projects/ledgerline`, private. Before this adopt run started, the AI workspace
already held a hand-written `CODING_STANDARDS.md` with three entries of its own; the occupied
check named it at the start of this run and the operator chose to keep it. Earlier in this run,
the free reviewer-home destinations were written from `reviewer-home.md` §1–§4: an empty-headed
`review-ledger.md` and the `## Review` section of `08-governance.md`. `ADOPTION.md` has been
started by this run and has no reviewer-home line yet.

`gh` shows eight merged PRs in the canonical, #8 to #25 with gaps, and no others. The review
comments say: on #12, "this test never asserts anything, it passes if the function is deleted";
on #19, "the new test has no assertion on the result"; on #23, "this test asserts nothing about
the behaviour it names". On #15 one reviewer wrote, "rename `tmp` to `pending_entries`". The
other findings are each on a single PR. None of the three existing entries covers tests that
assert nothing.

The conductor is at the history pass, and the operator says they will place the proposal for the test class themselves; nothing is written to the file.

The memory bank resolves to `/home/dev/projects/ledgerline-ai/.claude/memory-bank`.
