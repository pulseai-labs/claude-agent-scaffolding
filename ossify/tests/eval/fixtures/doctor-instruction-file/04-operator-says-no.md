---
scenario_id: 04-operator-says-no
expected_outcome: report-only
expected_reason: "Negative control. Root `/home/cy/ws/CLAUDE.md` (2,880 B, names `ossify`, one relative import `@docs/architecture.md`) and no `AGENTS.md`: `agents_md` fails (missing) and `claude_md` fails on the root path. The read-out must offer §5's repair with what it would change — the operator must see the move before answering — and the operator then says NO. Since §5 runs 'only on the operator's explicit yes', nothing is written, moved, merged or deleted; `/home/cy/ws/CLAUDE.md` is still there and `/home/cy/ws/AGENTS.md` still does not exist; nothing is committed; and the two failing lines are NOT re-emitted as `ok:` — they still say `fail:` and the closing statement still says the workspace failed interop."
---

`.workspace/pairing.json` at the AI workspace root declares:

```json
{"schema_version":"1.0","ai_workspace":{"root":"/home/cy/ws"},"canonical":{"root":"/home/cy/repos/product-api"},"well_known_paths":{}}
```

Exactly one JSON object. `/home/cy/ws` and `/home/cy/repos/product-api` both
exist as real directories, and `git -C <root> rev-parse --is-inside-work-tree`
prints `true` for both. `/home/cy/ws` is a clean git repository.

`$OSS_STATE_FILE` is unset. `oss state_path` resolves to
`/home/cy/ws/.ossify/project-state.json`, which exists and parses.

`/home/cy/ws` holds no `AGENTS.md` and no `.claude/CLAUDE.md`. It holds exactly
one instruction file, `/home/cy/ws/CLAUDE.md`: 2,880 bytes, naming `ossify`, with
exactly one import line, `@docs/architecture.md`, which resolves from the root to
an existing non-empty file. It has no other `@` import and no pointer line to
another instruction file.

Doctor's `/ossify:doctor interop` surface is invoked. After the read-out, the
operator is shown the repair offer and answers no: "no, leave it — I'll handle
it later". The operator gives no further instruction.
