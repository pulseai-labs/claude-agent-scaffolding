---
scenario_id: 02-third-repo-bare-clone-worktree-probe-catches-it
expected_outcome: some-fail
expected_reason: "`.workspace/pairing.json` declares `ai_workspace`, `canonical` (root `/srv/repos/product-api`, healthy), and `data-pipeline` (root `/srv/repos/data-pipeline.git`) — an operator ran `git clone --bare` for `data-pipeline` months ago to mirror it for a backup job and the manifest was hand-edited to point at that bare clone instead of a real checkout. `oss repo_root data-pipeline` resolves cleanly (the path exists and is absolute) and `/srv/repos/data-pipeline.git` IS a real directory, so the root-resolution and directory checks both pass for it. Pre-#272/#310-Task-10, interop-check.md's canonical-and-ai_workspace section runs the git-work-tree probe ONLY against `canonical` — `data-pipeline` is never named in the checklist at all, so its bare-repo shape is invisible to the check. `git -C /srv/repos/data-pipeline.git rev-parse --is-inside-work-tree` on a bare repo answers `false` at rc 0 (it IS a git repo, just with no working tree) rather than failing outright — the exact #153 shape the probe exists to catch, now recurring on a repo the old checklist never reached. The discriminating fact is whether `data-pipeline` gets probed at all and whether a `false` (not merely a nonzero rc) is read as a fail. A judgment that reports interop health clean, or that checks `data-pipeline`'s root/directory but never runs the git-work-tree probe against it, misses the failure the same way pre-Task-10 code did. The correct read-out: `ok: data-pipeline` on the root/directory check, then `fail: data-pipeline - resolved root is not a git work tree: /srv/repos/data-pipeline.git` on the probe (rc 0 with output `false`, not rc-only), and the summary states plainly that the workspace failed interop."
---

`.workspace/pairing.json` at the AI workspace root declares:

```json
{"schema_version":"1.0","ai_workspace":{"root":"/srv/ws"},"canonical":{"root":"/srv/repos/product-api"},"data-pipeline":{"root":"/srv/repos/data-pipeline.git"},"well_known_paths":{}}
```

Exactly one JSON object. `/srv/ws` and `/srv/repos/product-api` both exist
and resolve; `git -C /srv/repos/product-api rev-parse --is-inside-work-tree`
prints `true`.

`/srv/repos/data-pipeline.git` exists and is a real directory — it is a
**bare** git repository (`git -C /srv/repos/data-pipeline.git rev-parse
--is-bare-repository` prints `true`), created months ago by `git clone --bare`
for a nightly mirror job. `git -C /srv/repos/data-pipeline.git rev-parse
--is-inside-work-tree` exits **0** and prints `false` — the probe runs
without error, it simply answers the wrong question for what this manifest
entry claims to be.

`$OSS_STATE_FILE` is unset and `oss state_path` resolves cleanly to an
existing file. `AGENTS.md` exists at `/srv/ws/AGENTS.md` and mentions
`ossify` in its opening paragraph.

Doctor's `/ossify:doctor interop` surface is invoked.
