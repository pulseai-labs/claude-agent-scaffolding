---
scenario_id: 05-both-files-disagree-hold
expected_outcome: hold-on-disagreement
expected_reason: "Both instruction files exist and disagree on the git policy. The root `/home/dev/ws/CLAUDE.md` (3,420 B) says \"Network ops are allowed for the orchestrator\"; `/home/dev/ws/AGENTS.md` (1,180 B) names `ossify` and says \"Network ops require explicit user instruction\". `claude_md` fails on the root path; `agents_md` is `ok:`. The operator says yes to the repair, so §5's merge builds the plan and shows both network-ops statements — and the operator has NOT answered the disagreement asked of them. §5.4 is a hold: nothing is written, moved, merged or deleted, and NO line is re-emitted — the read-out's `fail: claude_md` stands exactly as read, with `/home/dev/ws/CLAUDE.md` still present. Nothing is committed. A transcript that picks one network-ops rule silently, or that re-emits `ok: claude_md` while the file is still there, fails."
---

`.workspace/pairing.json` at the AI workspace root declares:

```json
{"schema_version":"1.0","ai_workspace":{"root":"/home/dev/ws"},"canonical":{"root":"/home/dev/repos/product-api"},"well_known_paths":{}}
```

Exactly one JSON object. `/home/dev/ws` and `/home/dev/repos/product-api` both
exist as real directories, and `git -C <root> rev-parse --is-inside-work-tree`
prints `true` for both. `/home/dev/ws` is a clean git repository.

`$OSS_STATE_FILE` is unset. `oss state_path` resolves to
`/home/dev/ws/.ossify/project-state.json`, which exists and parses.

`/home/dev/ws` holds no `.claude/CLAUDE.md` and no `.claude/` directory at all.
It holds two instruction files:

- `/home/dev/ws/CLAUDE.md`, 3,420 bytes: the router. Its heading is `# Operating
  rules`; it routes to the memory bank and to `docs/conventions/`, and it carries
  the sentence "Network ops are allowed for the orchestrator". It has no `@`
  import and no pointer line to another instruction file.
- `/home/dev/ws/AGENTS.md`, 1,180 bytes: a workspace-init stub that names
  `ossify`, states "Network ops require explicit user instruction", and has no
  `@` import and no pointer line to another instruction file.

The two files disagree on the network-ops rule: the router permits the
orchestrator's network ops, the stub requires explicit instruction for them. Every
other statement appears in one file only, with no counterpart in the other.

Doctor's `/ossify:doctor interop` surface is invoked. After the read-out, the
operator answers the repair offer with an unconditional yes: "yes, go ahead".

The merge then asks the operator which network-ops rule to keep, and the operator
gives no answer — no further message, nothing in the transcript, and the session
does not continue past the question.
