---
scenario_id: 04-sole-repo-named-canonical-unaffected-negative-control
expected_outcome: all-ok
expected_reason: "Negative control. `.workspace/pairing.json` declares exactly ONE product repo, and it happens to be named `canonical` — the ordinary single-repo shape every ossify project used before #272/#310. Both `canonical` and `ai_workspace` resolve, are real directories, and `canonical` is a healthy git work tree; `state_path` and `agents_md` are both clean. Because there is only one declared repo and it is literally spelled `canonical`, the generalized per-declared-repo loop this task introduced visits exactly the same single repo the old two-name checklist always named — there is nothing here for the loop to add or drop. Pre- and post-#272/#310-Task-10 code produce the IDENTICAL read-out: `ok: manifest`, `ok: canonical`, `ok: ai_workspace`, `ok: state_path`, `ok: agents_md`, all-clean. This fixture exists to confirm the fix is a genuine generalization rather than a regression on the common case: a judgment that reports anything other than a clean, five-line, unremarkable interop check here — extra lines, a spurious fail, or a changed check name — is wrong regardless of how it reasoned about the other fixtures in this set."
---

`.workspace/pairing.json` at the AI workspace root declares:

```json
{"schema_version":"1.0","ai_workspace":{"root":"/Users/solo/ws"},"canonical":{"root":"/Users/solo/repos/product"},"well_known_paths":{}}
```

Exactly one JSON object, exactly one declared product repo. `/Users/solo/ws`
and `/Users/solo/repos/product` both exist as real directories. `git -C
/Users/solo/repos/product rev-parse --is-inside-work-tree` prints `true`.

`$OSS_STATE_FILE` is unset. `oss state_path` resolves cleanly to an existing,
well-formed state file. `AGENTS.md` exists at `/Users/solo/ws/AGENTS.md` and
its first section is titled `## Working with ossify`.

Doctor's `/ossify:doctor interop` surface is invoked.
