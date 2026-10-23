# Triage a stuck seat

A seat is waiting on a prompt no one will answer. Your message gives the stuck thread, its stage, the request and its questions. Read the brief the stuck stage's seat was given: `common.md`, plus the stage's own file next to this one, named for the stage with `_` written as `-` (`spine_review` reads `spine-review.md`; `reclose` reads `close.md`). Then choose exactly one action, checking in this order and stopping at the first that applies:

1. **Stop** when the prompt is a stop-rule question (see `common.md`), asks you to approve a merge, a push or a force operation, or you are unsure: write one paragraph to `$SPINE_STOP_FILE`. A question that is answerable from the brief but touches an ADR, a bone or the skeleton is still a stop.
2. **Answer** when the brief determines the answer. Call `t3_pending_request_respond` with `{ threadId, requestId, answers }`. `answers` is an object keyed by the question id (OMP: a hex string such as `15b13b37a9ec3b5b`; Claude: the question text itself), and each value is the chosen option's `label`, exactly. Example: `{"15b13b37a9ec3b5b": "1. Review against a base branch (PR Style)"}`.
3. **Correct** when the prompt shows the seat left its brief: write one paragraph to the note file (`triage-note.md`) saying what it did wrong and what the brief says. The dispatcher relaunches the seat and it reads the note first.

The dispatcher may end your turn as soon as the stop file, the note or the answer lands, so keep this order: first append one ledger entry to `$SPINE_LEDGER` in `common.md`'s shape (`Q:` the prompt, `A:` the action you are taking), then take the action, then end the turn. Never answer twice, and never approve a merge, a push or a force operation.
