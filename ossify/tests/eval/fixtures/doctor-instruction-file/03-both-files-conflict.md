---
scenario_id: 03-both-files-conflict
expected_outcome: repair-merge-asks
expected_reason: "Both instruction files exist. The root `/home/cy/ws/CLAUDE.md` (4,180 B) is the router and says \"Network ops are allowed for the orchestrator\"; `/home/cy/ws/AGENTS.md` (1,020 B) is a September workspace-init stub that names `ossify`, carries the pointer line \"Read `CLAUDE.md` for richer guidance\", and says \"Network ops require explicit user instruction\". The two disagree on the git policy. `agents_md` is `ok:` (the stub exists and names ossify); `claude_md` fails on the root `CLAUDE.md`. The operator says yes, so §5 branch 2 runs: the merge keeps every rule and fact from both files, drops the pointer line, does NOT pick between the two network-ops statements — it shows both and asks the operator — and shows the whole merged file before writing it. Then it writes the merged `AGENTS.md` and removes `CLAUDE.md`. Nothing is committed; the re-emitted lines are both `ok:`."
---

`.workspace/pairing.json` at the AI workspace root declares:

```json
{"schema_version":"1.0","ai_workspace":{"root":"/home/cy/ws"},"canonical":{"root":"/home/cy/repos/product-api"},"well_known_paths":{}}
```

Exactly one JSON object. `/home/cy/ws` and `/home/cy/repos/product-api` both
exist as real directories, and `git -C <root> rev-parse --is-inside-work-tree`
prints `true` for both. `/home/cy/ws` is a clean git repository, so the write and
the removal are not entangled with staged work.

`$OSS_STATE_FILE` is unset. `oss state_path` resolves to
`/home/cy/ws/.ossify/project-state.json`, which exists and parses.

`/home/cy/ws` holds no `.claude/CLAUDE.md` and no other `CLAUDE.md` beyond the
root one. It holds two instruction files:

- `/home/cy/ws/CLAUDE.md`, 4,180 bytes: the router. Its heading is `# Operating
  rules`; it routes to the memory bank and to `docs/conventions/`, and it carries
  the sentence "Network ops are allowed for the orchestrator". It has no `@`
  import.
- `/home/cy/ws/AGENTS.md`, 1,020 bytes: a September workspace-init stub. It names
  `ossify`, states "Network ops require explicit user instruction", carries the
  pointer line "Read `CLAUDE.md` for richer guidance", and has no `@` import.

The two files disagree only on the network-ops rule: the router permits the
orchestrator's network ops, the stub requires explicit instruction for them.
Every other statement appears in one file only, with no counterpart in the
other.

Doctor's `/ossify:doctor interop` surface is invoked. After the read-out, the
operator answers the repair offer with an unconditional yes.
