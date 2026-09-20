# workspace-init changelog

## 0.5.1 (2026-09-19)

Trace-filter hardening: the hook installs safely, renders any path, and fails closed instead of silently going dark (#457, #458, #481), plus a Scenario A manifest-write flag fix (#173).

### Fixed
- **#457 — installing the `commit-msg` hook can no longer destroy a foreign hook.** `wi_trace_filter_install` renders to a temp file and moves it into place only after a successful render, so a render failure leaves the existing hook byte-identical. It now refuses to overwrite any existing hook it did not write, recognising its own by a `# workspace-init:managed-hook` marker line (or the pre-0.5.1 `auto-installed` header) so a previously installed filter stays re-bakeable. `wi_rollback`'s HOOK_INSTALL inverse now removes only a hook carrying that ownership evidence — a foreign `commit-msg` is left in place with a warning instead of being deleted.
- **#458 — the baked AI-workspace path survives any character.** `wi_trace_filter_render` replaces `sed` substitution with a left-to-right splice of the shell-quoted path (`printf %q`), so paths containing `&`, `|`, `\`, `"`, `$`, backticks, spaces, or `'` render literally — `&` no longer expands to the matched text, `"` no longer produces an unparseable hook, and a path containing the literal placeholder text terminates cleanly.
- **#481 — the hook fails closed and names a real repair.** A missing manifest, malformed JSON, a missing or non-boolean `git_policy.trace_filter.enforce`, or unreadable `blocked_patterns` now blocks the commit with the specific reason and a pointer to the README's **Repair** section — replacing the previous fail-open warning that pointed at the non-existent `/init-workspace --repair`. (The repair wording itself was narrowed in the round-2 entry below.)
- **#173 — Scenario A records the canonical remote under the right flag.** `pairing-canonical-repo` §6.4 and the `pair-with-existing-clean` example now pass the detected remote via `--canonical-git-remote` instead of `--git-remote`, so it lands on `canonical.git_remote` rather than `ai_workspace.git_remote`.
- **Review round 1 — the manifest must be exactly one JSON object.** `jq empty` accepts a stream, so a 0-byte, whitespace-only, or multi-document `pairing.json` slipped through to the enforce check and read as "not true" — an allow. The hook now asserts a single top-level JSON object; empty, whitespace-only, concatenated-document, and non-object manifests all block.
- **Review round 1 — regex evaluation errors fail closed.** `grep -qE` exit status 2 (invalid ERE) was read as "no match"; an invalid `blocked_patterns` entry now blocks the commit naming the pattern. Non-string pattern entries (numbers, nested arrays) fail the extraction check instead of rendering as literal text. A missing `jq` is detected explicitly and reported as missing rather than as a JSON error.
- **Review round 1 — every block names a repair that fixes that exact condition.** Superseded by the round-2 narrowing below.
- **Review round 2 — the hook reports; the README repairs.** Per skill-first, the repair hint was computation in a read-and-report path: the hook no longer derives repair commands or paths at all (no `git rev-parse` worktree resolution, no baked `wi` path, no quoting). Each fail-closed branch states that the filter fails closed, gives the specific reason, and points at the README's new **Repair** section, which documents per-reason repairs in prose — including how to rewrite a corrupt manifest without losing `project_type`, `canonical.git_remote`, `canonical.default_branch`, or a customised `git_policy`. `wi_trace_filter_install` still canonicalises both roots to absolute physical paths (a relative hand-typed repair works), and `wi_trace_filter_install_pair` still repairs the load-bearing canonical hook first — but now validates the AI root (directory exists; `.workspace/pairing.json` present and a single JSON object) before touching either hook, so a mistyped or moved path can't leave canonical guarded by a dead path.
- **Review round 1 — a dangling symlink hook is never destroyed.** `-e`/`[[ -f ]]` follow links and miss a dangling `commit-msg` symlink; both the install guard and `wi_rollback`'s HOOK_INSTALL inverse now test `-e || -L`, so a foreign symlink survives byte-for-byte whether or not its target exists. `pairing-existing-dual` now documents the foreign-hook refusal (mirroring Scenario A), and the README names the real `/workspace-init:pair-workspace` command.

### Removed
- **`wi_guarded_jq_write` deleted.** The helper had no production callers — `wi_manifest_write` has always written via its own `jq -n` tempfile path — and the skill prose claiming it guarded manifest writes now describes the actual mechanism.

## 0.5.0 (2026-07-10)

### Added
- **#103 — explicit nested-wrapper bootstrap mode.** `/init-workspace <name> --wrapper <existing-dir>` now treats an existing writable outer directory as the resolved parent, creates only `<name>/` and `<name>-ai/` inside it, collision-checks only those inner targets, and preserves all wrapper-level source material. Wrapper mode is never auto-detected and does not add a redundant manifest field; canonical and AI root paths remain the topology source of truth.

### Fixed
- **#103 — fresh repositories now always initialize on `main`.** `wi_git_init` passes an explicit initial branch to Git 2.28+ and uses a plain-init plus symbolic-HEAD fallback on older Git, so a machine-level `init.defaultBranch=master` can no longer leave the real repository branch inconsistent with `canonical.default_branch: "main"` in the pairing manifest. Idempotent calls still skip existing repositories without renaming their current branch.
- **#103 — preflight rejects every inner target collision before writing.** Fresh and wrapper modes now reject files and symlinks as well as directories at `<parent>/<name>` or `<parent>/<name>-ai`, preventing a half-created sibling when one target is a non-directory entry.

## 0.4.1 (2026-07-02)

Trace-filter hook install now works for a `--separate-git-dir` / submodule canonical (#85).

### Fixed
- **`wi_trace_filter_install` accepts a canonical whose `.git` is a file (#85).** The install gated on `[[ -d "$target_repo/.git" ]]` and hardcoded the hooks dir as `$target_repo/.git/hooks`, so a `--separate-git-dir` checkout or a submodule (where `.git` is a *file* pointing at a separate git dir) passed preflight but then failed hook install with "not a git repo." It now requires an installable own git worktree root, resolves the repo-local hooks dir from `git rev-parse --git-dir`, and deliberately ignores `core.hooksPath`. The shared predicate rejects non-repos, nested subdirs, bare repos, and linked worktrees, while Scenario C AI-workspace git detection now uses the same predicate so separate-git-dir AI workspaces record `git_tracked: true` and receive a hook. Adds `test-trace-filter.sh` coverage for separate-git-dir, standard-repo, custom-hooksPath, subdir, bare, linked-worktree, and non-repo targets (the suite previously never exercised install at all).

## 0.4.0 (2026-06-21)

PR #70 review follow-ups (#71) — manifest-writer provenance + a non-git AI workspace flag + a linked-worktree preflight guard.

### Added
- **`--ai-git-tracked <true|false>` flag on `wi_manifest_write` (#71).** Sets `ai_workspace.git_tracked` (defaults `true`; canonical stays a validated git repo so its `git_tracked` is unchanged). The `pairing-existing-dual` skill (Scenario C — the only path where the existing AI workspace may not be a git repo) detects the AI workspace's git status once and threads it both into the manifest and the hook decision, so the manifest no longer cosmetically records `true` for a non-git AI workspace. Removed the corresponding "known v0.2 limitation" note from the skill.

### Changed
- **`created_by` is now provenance, not a frozen literal (#71).** `wi_manifest_write` stamps `workspace-init@<running version>`, resolved at write time from the sibling `.claude-plugin/plugin.json` (single source of truth, already guarded by the dual-publish parity test) via the new `wi_plugin_version` helper. Previously hardcoded `workspace-init@0.1.0`. `test-manifest.sh` now asserts the `workspace-init@<semver>` shape **and** parity with the manifest version, so it never needs touching on a version bump.

### Fixed
- **Reject a linked git worktree as the canonical (#71).** A `git worktree add` checkout passes the bare "is a git repo" preflight check (`git rev-parse --git-dir` succeeds) but has no own `.git/hooks` dir, so the trace-filter `commit-msg` hook would silently fail to install. Both canonical preflights — `wi_skeleton_preflight_existing_dual` (Scenario C) and `wi_skeleton_preflight --pair-with` (Scenario A) — now detect a linked worktree (new `wi_git_is_linked_worktree` helper) and fail early with a clear "pair against its main working tree" message, before any writes. The helper discriminates precisely via `--git-dir` vs `--git-common-dir`, so a standalone `--separate-git-dir` repo or a submodule (whose `.git` is also a file but which keeps its own hooks dir) is **not** over-matched (#84). (The AI-workspace-as-worktree case is out of scope — AI workspaces are created as standard repos.)
- **Scenario-C AI-workspace git detection requires its OWN repo root (#84).** The `pairing-existing-dual` skill detected the AI workspace's git status with `git rev-parse --git-dir`, which also succeeds for a plain subdirectory nested inside a parent repo — recording `git_tracked: true` and then failing hook install (`$ai_root/.git` absent). Switched to `[[ -d "$ai_root/.git" ]]`, the exact gate `wi_trace_filter_install` uses, so detection and install never disagree (a nested workspace now records `false` and cleanly skips its hook).
- **`wi_manifest_read` returns a present boolean `false` instead of treating it as missing (#84).** The reader's `jq -e -r "<field> // empty"` violated its own documented contract ("false is present-with-value"): jq's `//` and `-e` both treat `false`/`0` as falsy, so reading a `false` field returned exit 1. Rewritten with `try (<field>) catch null` + an explicit null check. Latent before this release (no consumer read a boolean field by path); the new `git_tracked: false` value makes it reachable, and the existing `allow_ai_*: false` fields are fixed too.

### Notes
- All items are PR #70 deferred non-blocking review findings tracked in #71. Co-shipped with `claude-security-audit` 0.1.3 (CI perf-benchmark gate) and the repo CI SHA-pin.

## 0.3.0 (2026-06-20)

### Added
- **Optional `tooling_repo` manifest field (#48 Stage 2).** `wi_manifest_write` gains `--tooling-repo <root>` and `--tooling-repo-remote <url>` flags; when given, it emits a `tooling_repo` object (`{ root, name, git_remote }`, `name` = basename of root) right after `canonical`, mirroring canonical's sub-schema. Absent by default → the key is omitted **entirely** (not `null`), so existing manifests and behavior are unchanged (additive; schema stays `1.0`). `wi_manifest_validate` validates `tooling_repo.root` + `tooling_repo.name` only when the key is present. The three init/pair skills (`initializing-dual-repo-workspace`, `pairing-canonical-repo`, `pairing-existing-dual`) document the optional flags so they record a tooling repo when the user volunteers one. This is the workspace-init half of marketplace routing — scaffold-dev's `/defer --tooling` resolves `.tooling_repo.root` to file tech-debt there instead of the project repo. 5 new tests (`tests/test-manifest.sh`).

### Notes
- Design-of-record: `docs/SPEC-lean-index-CDEF.md` §3.5. Pairs with scaffold-dev v0.10.0 (the routing consumer). Part of closing #48.

## 0.2.0 (2026-06-15)

### Added
- **`pairing-existing-dual` skill + `/pair-existing-dual` command (Scenario C, #9).** Pairs an already-populated AI workspace with an already-populated canonical — the case where a project grew its memory-bank/specs organically (in a sibling AI-workspace directory) before the plugins were discovered, and just needs a manifest to wire it up. Writes ONLY `.workspace/pairing.json` into the existing AI workspace and installs the trace-filter `commit-msg` hook (always in canonical; also in the AI workspace when it is itself a git repo). **Never creates, seeds, stubs, or overwrites** existing AI-workspace content — distinct from Scenario A (`pairing-canonical-repo`), which creates a *fresh* AI workspace and aborts on canonical AI-scaffolding markers. New lib preflight `wi_skeleton_preflight_existing_dual` (AI exists + non-empty; canonical exists + is a git repo; paths differ); conservative failure handling (no destructive rollback against populated content). 13 integration tests (`tests/test-pairing-existing-dual.sh`). SPEC §9.5. `pairing-canonical-repo` now cross-references this skill for the already-populated case.

## 0.1.2 (2026-05-30)

### Added
- **`well_known_paths.roadmap_state` (#28 Phase 2).** The pairing manifest now routes the structured roadmap state — `${ai_workspace.root}/.workspace/project-roadmap.json` — alongside the existing `master_spec` / `memory_bank` paths. scaffold-onboard publishes the structured roadmap there; scaffold-dev's orchestrator will field-read `id` + `sprint_id` from it (the #28 cross-plugin slice-ID contract fix) instead of grepping rendered `#### VS-…:` headings. Older manifests without the key are handled by consumer-side fallback (forward-compat, per the `routing.roadmap` §10.4 precedent).

## 0.1.1 (2026-05-26)

### Fixed
- **Shell portability (zsh compatibility):** Claude Code's Bash tool runs zsh by default on macOS; skill bodies that `source lib/*.sh` then inherited zsh, where `${BASH_SOURCE[0]}` is unset and lib self-location crashed. Added `bin/wi` dispatcher with `#!/usr/bin/env bash` shebang — the kernel forces bash on direct execution regardless of caller shell. Skill bodies (`initializing-dual-repo-workspace`, `pairing-canonical-repo`) and `/init-workspace` command now invoke `wi <fn-suffix> [args...]` instead of `source && fn`. `wi --list` enumerates dispatchable functions. The dispatcher is auto-discoverable via `$PATH` (Claude Code adds each plugin's `bin/` to PATH automatically), so callers don't need to know the plugin root.

## 0.1.0 (2026-05-25)

Initial release. Bootstrap a dual-repo workspace (AI workspace + canonical) with pairing manifest and AI-trace commit-msg filter. Run-once plugin; first in the scaffolding chain (workspace-init → scaffold-onboard → scaffold-dev). 145 tests across 10 suites.

### Added
- Skills: `initializing-dual-repo-workspace`, `pairing-canonical-repo` (skill-first per Pass D).
- Slash commands: `/init-workspace`, `/pair-workspace` (thin `$ARGUMENTS` wrappers per feedback_slash_command_dollar_n_bug).
- `lib/` bookkeeping: manifest read/write/resolve (`mi_manifest_resolve` alias per SPEC §6.3), skeleton, stubs, git-init with default-branch fallback chain, trace-filter hook install, transactional rollback.
- `commit-msg` git hook template with baked AI workspace path per SPEC §7.3.
- Pairing manifest schema v1.0 at `<ai-workspace>/.workspace/pairing.json`.
- Scenario A migration (`--pair-with <existing-canonical>`).
- 145 tests across 10 suites; `run-tests.sh` runner.

### Deferred to v0.2
- Git remotes auto-setup (per project_workspace_init_v02_deferrals).
- User-global workspace registry (per project_workspace_init_v02_deferrals).
- Scenario B migration (split existing scaffold-onboard'd single-repo).
- `/repair-workspace` command.
- `core.hooksPath`-based tracked hook (survives clones).

### Schema versions
- Pairing manifest: 1.0
