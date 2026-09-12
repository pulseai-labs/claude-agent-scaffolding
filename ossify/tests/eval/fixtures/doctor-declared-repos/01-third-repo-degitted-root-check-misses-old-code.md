---
scenario_id: 01-third-repo-degitted-root-check-misses-old-code
expected_outcome: some-fail
expected_reason: "`.workspace/pairing.json` declares THREE repository objects with a `root`: `ai_workspace`, `canonical` (root `/Users/ops/repos/product-api`), and `mobile-app` (root `/Users/ops/repos/mobile-app`). `canonical` and `ai_workspace` both resolve and are real directories; `canonical` is a healthy git work tree. `mobile-app` also resolves and is a real directory, but a botched migration deleted its `.git` directory last week — it is now a plain, non-git directory with the source files still sitting in it. Pre-#272/#310-Task-10 interop-check.md's `canonical`-and-`ai_workspace` section names exactly two check names and never reads `mobile-app` at all, so old code's checklist has no line for it — the read-out is `ok: canonical` / `ok: ai_workspace` and nothing else, and the summary says nothing failed, even though a Codex or Claude session pointed at `mobile-app` would find no git history, no index, and every git-backed ceremony (worktree_add, the boundary audit, spine close's checkout-and-merge) refusing outright. The discriminating fact is NOT the top-level some-fail-vs-all-ok verdict in isolation — it is whether `mobile-app` gets its OWN `ok:`/`fail:` line at all. A judgment that reports interop health as clean, or that reports on `canonical` and `ai_workspace` only without naming `mobile-app`, reproduces the pre-Task-10 blind spot even if it happens to mention that something elsewhere seems fine. The correct read-out names `mobile-app` on its own root-resolution line (`ok:` — the directory does resolve) and then fails it on the git-work-tree probe (`fail: mobile-app - resolved root is not a git work tree: /Users/ops/repos/mobile-app`), and states plainly at the end that the workspace is NOT interop-clean."
---

`.workspace/pairing.json` at the AI workspace root declares:

```json
{"schema_version":"1.0","ai_workspace":{"root":"/Users/ops/ws"},"canonical":{"root":"/Users/ops/repos/product-api"},"mobile-app":{"root":"/Users/ops/repos/mobile-app"},"well_known_paths":{}}
```

It is exactly one JSON object. `/Users/ops/ws` exists and is a real directory.
`/Users/ops/repos/product-api` exists, is a real directory, and `git -C
/Users/ops/repos/product-api rev-parse --is-inside-work-tree` prints `true`.

`/Users/ops/repos/mobile-app` exists and is a real directory — the source
tree is intact — but its `.git` directory was deleted three weeks ago during
a botched CI migration and never restored. `git -C /Users/ops/repos/mobile-app
rev-parse --is-inside-work-tree` fails at nonzero rc with `fatal: not a git
repository`.

`$OSS_STATE_FILE` is unset. `oss state_path` resolves to
`/Users/ops/ws/.ossify/project-state.json`, which exists. `AGENTS.md` exists
at `/Users/ops/ws/AGENTS.md` and its second heading reads `## Ossify
ceremonies`.

Doctor's `/ossify:doctor interop` surface is invoked.
