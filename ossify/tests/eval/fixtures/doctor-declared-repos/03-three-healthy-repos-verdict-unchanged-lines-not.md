---
scenario_id: 03-three-healthy-repos-verdict-unchanged-lines-not
expected_outcome: all-ok
expected_reason: "`.workspace/pairing.json` declares `ai_workspace` plus THREE healthy product repos: `canonical`, `svc-billing`, and `svc-notify`, all resolving to real directories that are all clean git work trees. `state_path` resolves with no override, and `AGENTS.md` exists and names ossify. Every check genuinely passes, so pre-#272/#310-Task-10 code (which only ever named `canonical` and `ai_workspace`) and post-Task-10 code report the SAME top-level verdict — both say the workspace is interop-clean, because nothing anywhere is actually broken. This is deliberately the fixture where the verdict alone cannot distinguish old from new: the discriminating fact is which repos get a LINE at all. Old code's read-out has exactly two repo-shaped lines (`ok: canonical`, `ok: ai_workspace`) and never mentions `svc-billing` or `svc-notify` by name, even though they are declared, real, and were fully checked-if-you-had-checked-them. A judgment that reports only two repo lines, or that summarizes 'both roots are healthy' without individually naming `svc-billing` and `svc-notify`, silently reproduces the old two-repo checklist even though its all-ok verdict is correct. The correct read-out names all three product repos individually — `ok: canonical`, `ok: svc-billing`, `ok: svc-notify` (each with its own git-work-tree pass too) — plus `ok: ai_workspace`, `ok: manifest`, `ok: state_path`, `ok: agents_md`, and states plainly that nothing failed."
---

`.workspace/pairing.json` at the AI workspace root declares:

```json
{"schema_version":"1.0","ai_workspace":{"root":"/home/dev/ws"},"canonical":{"root":"/home/dev/repos/product-api"},"svc-billing":{"root":"/home/dev/repos/svc-billing"},"svc-notify":{"root":"/home/dev/repos/svc-notify"},"well_known_paths":{}}
```

Exactly one JSON object. `/home/dev/ws`, `/home/dev/repos/product-api`,
`/home/dev/repos/svc-billing`, and `/home/dev/repos/svc-notify` all exist as
real directories. `git -C <root> rev-parse --is-inside-work-tree` prints
`true` for `product-api`, `svc-billing`, and `svc-notify` — each is a clean,
ordinary git checkout with an `origin` remote and no stray `.git`-file
oddities.

`$OSS_STATE_FILE` is unset. `oss state_path` resolves to
`/home/dev/ws/.ossify/project-state.json`, which exists and parses. `AGENTS.md`
exists at `/home/dev/ws/AGENTS.md` with a `## Ossify` heading near the top.

Doctor's `/ossify:doctor interop` surface is invoked.
