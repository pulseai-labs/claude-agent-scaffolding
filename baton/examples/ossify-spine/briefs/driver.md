# Drive a parked unit

A unit has parked. Your message gives the unit, the stage it parked in and the reason. Read the state file first. Then read the brief the parked stage's seat was given: `common.md`, plus the stage's own file next to this one, named for the stage with `_` written as `-` (`spine_review` reads `spine-review.md`; `reclose` reads `close.md`); a merge or wait park (`land`, a `*_wait` stage, `spine_ack`) has none, so read `common.md` and the state file. Then read the stop file or the failing checks the state file names.

Choose exactly one result, checking in this order and stopping at the first that applies:

1. **Escalate** for a `user:` demo line or walk; anything that needs a change on `main`, in code, a spec, an ADR, a bone or the skeleton; a merge; a decision outside the spine's or the item's scope; a park this list does not cover; or any doubt. The `action` is one line, starting with a verb, saying what the operator must do.
2. **Resume with `rerun-check`** only for a `land` park that is red when every failing check fails in a test outside the item's changed files (`gh pr diff <pr> --name-only`, `pr` from the state file's "This park"). Re-run it once: `gh run rerun <run-id> --failed`, the run id from `gh pr checks <pr>` or `gh run list` for the PR's head. Then resume in place (no `to`).
3. **Resume with `remove-file`** only for a `correct` park with reason `before failed` (the dispatch cap) where `correction.txt` is used up: `corrected` exists, or the event list shows a reclose after it. Remove `correction.txt` from the unit's out directory, then resume with `"to": "reclose"`.
4. **Stop** only when going on would harm the repo or the run, for example a unit acting on the wrong branch. Give the `reason`.

Write exactly one JSON object to the result file, then end the turn. Every shape carries `ledger`, with all four fields non-empty: `q` the park, `a` what you chose, `why`, `rejected` the other results you ruled out.

- `{"result":"resume","cleared":"rerun-check","ledger":{...}}`
- `{"result":"resume","cleared":"remove-file","to":"reclose","ledger":{...}}`
- `{"result":"escalate","action":"Merge PR 123 by hand.","ledger":{...}}`
- `{"result":"stop","reason":"...","ledger":{...}}`

A result the engine refuses (a missing field, a `cleared` or `to` it does not allow) becomes an escalate.

Never merge, push, force-push, delete a branch, edit code, specs or briefs, walk a `user:` line, or run a clearing step twice. Do not wait on CI or other sessions: `common.md` says why.
