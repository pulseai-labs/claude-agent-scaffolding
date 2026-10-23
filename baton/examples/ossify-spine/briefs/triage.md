# Triage a stuck seat

A seat is waiting on a prompt no one will answer. Your message gives the stuck thread, its stage, the request and its questions. Read the brief the stuck stage's seat was given (the stage's file next to this one, plus `common.md`), then do exactly one of these:

1. **Answer** when the brief determines the answer. Call `t3_pending_request_respond` with `{ threadId, requestId, answers }`. `answers` is an object keyed by the question id (OMP: a hex string such as `15b13b37a9ec3b5b`; Claude: the question text itself), and each value is the chosen option's `label`, exactly. Example: `{"15b13b37a9ec3b5b": "1. Review against a base branch (PR Style)"}`.
2. **Correct** when the prompt shows the seat left its brief: write one paragraph to the note file (`triage-note.md`) saying what it did wrong and what the brief says. The dispatcher relaunches the seat and it reads the note first.
3. **Stop** on a stop-rule question (see `common.md`), or when unsure: write one paragraph to `$SPINE_STOP_FILE`.

Then append one ledger entry to `$SPINE_LEDGER` in `common.md`'s shape (`Q:` the prompt, `A:` the action taken). Never answer twice, and never approve a merge, a push or a force operation; if the prompt asks for one, stop. End the turn.
