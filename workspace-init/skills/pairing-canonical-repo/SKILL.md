---
name: pairing-canonical-repo
description: Pair a new AI workspace with an existing canonical repository (Scenario A migration). Creates the sibling AI workspace and writes a manifest pointing at existing canonical. Does NOT modify the existing canonical except for installing the commit-msg hook. Use when user has existing repo without AI scaffolding and wants to add an AI workspace alongside.
---

# Skill — pairing-canonical-repo

## 1. Overview

This skill handles **Scenario A migration** (per **SPEC §9**): the user
already has a canonical repository (their production code, possibly with
years of history, remotes, branches) and wants to *pair* it with a brand-new
sibling AI workspace. Unlike `initializing-dual-repo-workspace` — which
creates BOTH repos from scratch — this skill creates ONLY the new AI
workspace; the existing canonical is left untouched except for one
intentional addition: a `commit-msg` git hook in `<canonical>/.git/hooks/`
that enforces the trace filter going forward. The canonical's working tree,
branches, remotes, `.gitignore`, and existing hooks (other than the one
`commit-msg`) are not modified. The skill auto-invokes on phrases like
"pair this repo with an AI workspace", "add AI workspace alongside",
"existing canonical needs scaffolding". It also runs via
`/pair-workspace <abs-path-to-canonical>`.

**Already have a populated AI workspace?** This skill creates a *fresh* AI
workspace. If your AI workspace already exists as a separate populated sibling
directory (memory-bank, specs, CLAUDE.md grown organically before you found the
plugins) and you only need a manifest to wire it up, use `pairing-existing-dual`
(`/pair-existing-dual <ai-workspace-abs> <canonical-abs>`, **Scenario C**)
instead — it preserves your existing content and never seeds or stubs.

## 2. Preconditions

Same as the fresh-init skill (`jq` on `$PATH`, `git` on `$PATH`, parent dir
exists + writable, project name regex `^[a-z0-9-]+$`), PLUS the
pair-with-specific checks below. If any fail, exit non-zero with a clear
error; do NOT start any tasks (per **SPEC §8.1**, **SPEC §13.3**).

- `command -v jq` and `command -v git` on PATH.
- `[[ -d "$parent" && -w "$parent" ]]` — parent dir for the NEW AI workspace.
- `[[ "$name" =~ ^[a-z0-9-]+$ ]]` — kebab-case project name.
- **Canonical path must be absolute.** Reject relative paths (`wi_realpath`
  can canonicalize, but require the user to pass absolute to avoid surprise).
- **Canonical path must exist.** `[[ -d "$canonical_root" ]]`.
- **Canonical must be a git repo.** `git -C "$canonical_root" rev-parse --git-dir >/dev/null 2>&1`.

## 3. Input collection

Inputs (prompt the user OR read from `$ARGUMENTS` for the slash command —
never positional `$1`/`$2` per the slash-command `$N` substitution bug):

- **project name** (kebab-case). Often the user wants it to match the
  existing canonical's basename, but it doesn't have to.
- **parent dir for the NEW AI workspace** (default: `$PWD`; absolute path).
  This is where `<name>-ai/` will be created.
- **existing canonical absolute path** (required; supplied via `$ARGUMENTS`
  for `/pair-workspace`). This is where the user's existing repo lives.
- **project_type** — `personal` or `work` (per **SPEC §7.1** prompt:
  *"Is this a personal project or a work/company project?"*). Both
  enforce the trace filter; the distinction is a forward hook for v0.2.

Resolve to shell variables:

- `name="$resolved_name"`
- `parent="$resolved_parent"`
- `canonical_root="$resolved_canonical_abs"`
- `project_type="$resolved_project_type"`
- `ai_root="${parent}/${name}-ai"`

## 4. Abort-on-AI-scaffolding-marker check

Per **SPEC §9.4**, BEFORE creating anything, scan the existing canonical
for AI scaffolding markers. If ANY are present, the canonical was already
onboarded as a single-repo (Scenario B territory) and pair-with would
produce a confusing dual-repo state. Abort cleanly — nothing has been
created yet, so no rollback is needed.

Markers to check:

- `[[ -d "${canonical_root}/.claude/memory-bank" ]]`
- `[[ -f "${canonical_root}/MASTER-SPEC.md" ]]`
- `[[ -f "${canonical_root}/docs/MASTER-SPEC.md" ]]`
- `[[ -f "${canonical_root}/.claude/.onboarding-state.json" ]]`

If any are present, print this abort message (substitute the found markers):

```
ERROR: existing canonical already contains AI scaffolding.
Found markers in /abs/path/{name}:
  - .claude/memory-bank/
  - docs/MASTER-SPEC.md
Refusing to pair: this repo was already onboarded as a single-repo project.
Pairing now would create an inconsistent dual-repo state.

This is Scenario B (split existing single-repo into dual-repo) and is
deferred to workspace-init v0.2. For now, the manual workaround is:
  1. Move .claude/memory-bank/, MASTER-SPEC.md (or docs/MASTER-SPEC.md),
     and any other scaffolding artifacts into a NEW sibling AI workspace
     directory of your choosing (e.g., <canonical>-ai/).
  2. Write the pairing manifest by hand at <ai-workspace>/.workspace/pairing.json
     using the v1.0 schema (see workspace-init SPEC §6.2).
  3. Re-run /pair-workspace once the canonical no longer has the markers.
```

Exit non-zero. Do NOT touch anything (no mkdirs, no manifest, no hook).

## 5. Detect canonical metadata

Detect default branch + remote from the existing repo via the `wi`
dispatcher (`workspace-init/bin/wi`; bash shebang forces a bash
runtime even when the calling shell is zsh). On Claude Code, `wi` is on
`$PATH` automatically; on Devin, invoke via `exec` with the full path
(`<plugin-source>/bin/wi`). Per
**SPEC §8.4** the fallback chain is robust to oddly-configured repos:

- `detected_branch="$(wi git_detect_default_branch "$canonical_root")"`
- `detected_remote="$(wi git_detect_remote "$canonical_root")"`

Never `source` lib files directly from skill body — under zsh
`${BASH_SOURCE[0]}` is unset and the libs crash. Always go through `wi`.

`wi_git_detect_default_branch` tries (in order):
`git symbolic-ref refs/remotes/origin/HEAD` → `git symbolic-ref HEAD` →
`git branch --show-current` → interactive user prompt → ultimate fallback
`"main"`.

`wi_git_detect_remote` returns `origin`'s URL if set, else empty (manifest
records `null`).

## 6. Execute the modified 8 tasks

Same skeleton as `initializing-dual-repo-workspace` but with three
pair-with-specific differences (8.2, 8.4, 8.8). After each task, append to
`${ai_root}/.workspace/init-log` via `wi log_op …`. On ANY task failure,
call `wi rollback "${ai_root}/.workspace/init-log" --pair-with "$canonical_root"`
(the `--pair-with` flag tells rollback to skip ops against the existing
canonical — see section 7).

### 6.1 — Task 8.1: Input

Already collected in section 3. Reference `name`, `parent`, `canonical_root`,
`project_type`, `ai_root`.

### 6.2 — Task 8.2: Create root dir (AI ONLY)

**Difference vs. fresh mode:** the canonical already exists, so skip
`mkdir <canonical>`. Only create the new AI workspace:

Resolve the `wi` dispatcher once and hold it in `wi_bin` — it is on `$PATH` on Claude Code and Codex, but **not** on Devin, where `bin/` is never added. Recipe per the plugin's `rules/dispatcher-path.md`: `command -v wi`, else the `source:` path (`--local` installs), else the plugin-cache manifest glob (remote installs). Every `wi` invocation below — and in this skill's references — is `"$wi_bin"`.

```
"$wi_bin" skeleton_create_root_ai_only "$parent" "$name"
```

Expected init-log entry: `mkdir <ai_root>`. NO entry for canonical mkdir.

### 6.3 — Task 8.3: Seed AI workspace subdirs + .gitignore

Same as fresh mode:

```
"$wi_bin" skeleton_seed_subdirs "$ai_root"
```

Expected init-log entries: subdir mkdirs + `.gitkeep` files + `.gitignore`.

### 6.4 — Task 8.4: Write the pairing manifest (with detected metadata)

**Difference vs. fresh mode:** pass the detected default branch and remote
through to `wi_manifest_write`:

```
"$wi_bin" manifest_write "$ai_root" "$canonical_root" "$project_type" \
  --git-remote "$detected_remote" \
  --default-branch "$detected_branch"
```

If `$detected_remote` is empty, the helper records `null`. If
`$detected_branch` is empty, the helper falls back to `"main"`.

**Optional — tooling repo (#48 Stage 2).** If the user keeps a separate *tooling/marketplace*
repo (so `/defer --tooling` can route tech-debt there instead of the project repo), append
`--tooling-repo "$tooling_root"` (and `--tooling-repo-remote "$tooling_remote"` if known).
Only ask when the user volunteers one — omit the flags otherwise and the `tooling_repo` key
is left out entirely (today's behavior, unchanged).

Expected init-log entry: `file <ai_root>/.workspace/pairing.json`.

### 6.5 — Task 8.5: Write CLAUDE.md stub

```
"$wi_bin" stub_claude_md "$ai_root" "$name"
```

Expected init-log entry: `file <ai_root>/CLAUDE.md`.

### 6.6 — Task 8.6: Write AGENTS.md stub

```
"$wi_bin" stub_agents_md "$ai_root"
```

Expected init-log entry: `file <ai_root>/AGENTS.md`.

### 6.7 — Task 8.7: Write README.md

```
"$wi_bin" stub_readme "$ai_root" "$name"
```

Expected init-log entry: `file <ai_root>/README.md`.

### 6.8 — Task 8.8: git init (AI ONLY) + hooks (BOTH) + stage (AI ONLY)

**Differences vs. fresh mode:**

1. **SKIP** `git init` in canonical — it's already a git repo. Initialize
   only the AI workspace:

   ```
   wi git_init_ai_only "$ai_root"
   ```

2. **DO** install the commit-msg hook in BOTH AI workspace and canonical
   (the trace filter must guard canonical commits going forward):

   ```
   wi trace_filter_install_pair "$ai_root" "$canonical_root"
   ```

3. **STAGE ONLY** in the AI workspace; do NOT run `git add` against the
   canonical (its working tree is the user's; we never touch it):

   ```
   wi git_stage_ai_workspace "$ai_root"
   ```

Expected init-log entries: `git-init <ai_root>` (no canonical git-init),
`hook <ai_root>/.git/hooks/commit-msg`, `hook <canonical_root>/.git/hooks/commit-msg`,
`git-stage <ai_root>`.

## 7. Rollback discipline

Per **SPEC §8.9 step 3**, rollback in pair-with mode **NEVER** undoes ops
on the existing canonical. Pass the `--pair-with "$canonical_root"` flag to
`wi rollback`; the helper then filters out ops whose target lies under
`$canonical_root` when walking the init-log in reverse.

**Pair-with-safe to reverse** (rollback DOES undo these):

- `mkdir <ai_root>` and all subdirs under it
- All file creations inside `<ai_root>` (manifest, stubs, .gitignore, .gitkeep)
- `git init` of `<ai_root>` (removes `<ai_root>/.git/`)
- `git-stage <ai_root>` (no inverse needed — discarding `<ai_root>` discards the index too)
- Hook install at `<ai_root>/.git/hooks/commit-msg` (removed with the dir)

**Pair-with-frozen** (rollback DOES NOT undo these):

- Hook install at `<canonical_root>/.git/hooks/commit-msg` — `wi_rollback`
  leaves this in place and prints a warning telling the user how to remove
  it manually (`rm <canonical_root>/.git/hooks/commit-msg`).

**Important nuance:** the canonical hook install IS technically reversible
in the immediate failure-mid-init sense (we just wrote the file; we know
its contents; we could `rm` it safely). But to be conservative — in case
the user or another tool relied on the file we overwrote, or in case the
hook was already running successfully and only a LATER task failed —
rollback adopts a leave-in-place policy. The warning surfaces the path so
the user can opt in to removal.

This conservatism is deliberate: a destructive rollback against the user's
existing canonical is a worse failure mode than a stale hook the user can
delete in one command.

## 8. Print next-steps

After all tasks succeed, print this message verbatim (substitute `{name}`
and `/abs/path` with resolved values; everything else stays as written —
this is the pair-with variant of **SPEC §8.8**):

```
Pair-with bootstrap complete.

  AI workspace (new):     /abs/path/{name}-ai
  Canonical (existing):   /abs/path/{name}     (untouched except .git/hooks/commit-msg)

AI workspace has skeleton + manifest + stubs staged.
Canonical's commit-msg hook installed (blocks AI-trace patterns).
Canonical's working tree NOT modified.

Next steps:
  1. cd /abs/path/{name}-ai && git status
  2. git commit -m "workspace-init: initial bootstrap (pair-with, workspace-init v0.1.0)"
  3. cd /abs/path/{name}-ai && claude
  4. /onboard

Manifest at: /abs/path/{name}-ai/.workspace/pairing.json
Trace filter active in: /abs/path/{name}-ai  AND  /abs/path/{name}
To override trace filter for a specific commit: git commit --no-verify
```

## 9. Discipline rules

- **DO NOT auto-commit** anywhere — not in the new AI workspace, and
  certainly not in the existing canonical (which we never stage anyway).
- **DO NOT touch canonical's working tree.** No file creates, no
  `.gitignore` edits, no README updates. The ONLY canonical-side change
  is `<canonical>/.git/hooks/commit-msg`.
- **DO NOT add a `Co-Authored-By:` trailer or AI marker** anywhere.
- **DO NOT push, pull, or fetch** against canonical. The user may have
  uncommitted work, dirty branches, or pending pushes — staying read-only
  on canonical's history is non-negotiable.
- Cite **SPEC §7.4** and **SPEC §9.3** — pair-with mode explicitly
  preserves canonical's existing state.

## 10. Failure handling

- **Parent dir not writable / project name invalid** → preflight aborts;
  nothing created; no rollback needed.
- **Canonical path doesn't exist or isn't absolute** → preflight aborts.
- **Canonical isn't a git repo** → preflight aborts (per **SPEC §13.3**:
  fail, or — future enhancement — offer to `git init` it; v0.1 just
  fails).
- **Canonical has AI scaffolding markers** → section 4 abort with
  Scenario B guidance. No rollback needed; nothing created.
- **`git symbolic-ref` returns nothing** → `wi_git_detect_default_branch`
  walks the fallback chain per **SPEC §8.4**: `refs/remotes/origin/HEAD`
  → `HEAD` → `branch --show-current` → interactive prompt → ultimate
  fallback `"main"`.
- **Manifest write fails mid-operation** → `wi_rollback ... --pair-with
  "$canonical_root"` cleans up the partial AI workspace; canonical
  untouched.
- **Hook install fails** (symlink loop, permissions, `chmod +x` failure)
  → `wi_rollback ... --pair-with "$canonical_root"`. The AI workspace
  side is removed; the canonical-side hook (if it was installed before
  the failure) is LEFT IN PLACE per section 7's conservatism, with a
  warning telling the user how to remove it.
- **`jq` produces malformed JSON** during manifest write → caught by
  `wi_guarded_jq_write` (tempfile + `jq empty` validation + rename); on
  failure, rollback.
- **Concurrent invocation** against the same canonical →
  `wi_lock_acquire` on `<ai_root>` (locks the new workspace dir). A
  separate lock on canonical isn't taken — workspace-init does not own
  canonical and shouldn't lock it; the user's other tools may need
  access concurrently.
