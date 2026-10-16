---
scenario_id: 01-only-claude-md-yes
expected_outcome: repair-rename
expected_reason: "Root `CLAUDE.md` only — 3,010 B, names `ossify`, one relative import `@docs/rules.md` — and no `AGENTS.md` anywhere in the AI workspace. `agents_md` fails (no `AGENTS.md` at the root) and `claude_md` fails on `/home/ada/ws/CLAUDE.md`. The operator says yes, so §5 branch 1 is the branch that runs: show the operator the move, then `git mv /home/ada/ws/CLAUDE.md /home/ada/ws/AGENTS.md`; `@docs/rules.md` is listed and still resolves from the root; nothing is committed; the re-emitted lines are `ok: agents_md` and `ok: claude_md`."
---

`.workspace/pairing.json` at the AI workspace root declares:

```json
{"schema_version":"1.0","ai_workspace":{"root":"/home/ada/ws"},"canonical":{"root":"/home/ada/repos/product-api"},"well_known_paths":{}}
```

Exactly one JSON object. `/home/ada/ws` and `/home/ada/repos/product-api` both
exist as real directories, and `git -C <root> rev-parse --is-inside-work-tree`
prints `true` for both. `/home/ada/ws` is itself a git repository with a clean
work tree, so a move inside it is a `git mv`.

`$OSS_STATE_FILE` is unset. `oss state_path` resolves to
`/home/ada/ws/.ossify/project-state.json`, which exists and parses.

`/home/ada/ws` holds no `AGENTS.md` and no `.claude/CLAUDE.md`. It holds exactly
one instruction file, `/home/ada/ws/CLAUDE.md`: 3,010 bytes, naming `ossify` in a
`## Ossify` section, and carrying exactly one import line, `@docs/rules.md`.
`/home/ada/ws/docs/rules.md` exists and is not empty. The file has no other `@`
import and no pointer line to another instruction file.

Doctor's `/ossify:doctor interop` surface is invoked. After the read-out, the
operator answers the repair offer with an unconditional yes: "yes, move it".
