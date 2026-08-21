---
name: initializing-dual-repo-workspace
description: Bootstrap a fresh dual-repo workspace — creates a new AI workspace repo (memory bank, specs, agent scaffolding) and a clean canonical repo (production code, zero AI traces) with a pairing manifest. Use when the user wants to start a new project with the dual-repo topology, mentions "create workspace", "bootstrap project", "new AI workspace", "set up dual repo", "init project workspace".
---

# Skill — initializing-dual-repo-workspace

## 1. Overview

This skill bootstraps a fresh **dual-repo workspace**: a brand-new pair of git
repositories where AI scaffolding lives in one repo and production code lives
in the other, joined by a pairing manifest. By default the repos are siblings
under a parent directory. Explicit `--wrapper <existing-dir>` mode places the
same pair inside an existing outer wrapper without touching other wrapper
contents. The skill auto-invokes when
the user signals intent to start a new project under workspace-init's topology
(triggers: "create workspace", "bootstrap project", "new AI workspace", "set up
dual repo", "init project workspace"). It also runs when the user explicitly
invokes the `/init-workspace` slash command. On success it produces:
`<parent>/<name>-ai/` (the AI workspace, with skeleton + manifest + stubs
staged) AND `<parent>/<name>/` (the canonical, freshly `git init`'d on `main`,
working tree empty). Trace-filter commit-msg hooks are installed in both. Cite
**SPEC §1** (TL;DR) and **SPEC §4.3** (the dual-repo topology). The user is
expected to commit the staged bootstrap manually — workspace-init never
auto-commits (SPEC §7.4).

This skill delegates bookkeeping to bash modules under
`workspace-init/lib/`. Those modules expose stable function names; this skill
calls them via the `wi` dispatcher (`workspace-init/bin/wi`). On Claude Code,
`wi` is on `$PATH` automatically (every plugin's `bin/` is added); on Devin,
locate it at the plugin's source directory + `/bin/wi` and invoke via the
`exec` tool with the full path. The dispatcher has a bash shebang so the libs
always run under bash even when the calling shell is zsh. Never `source`
the lib files directly from skill body — under zsh `${BASH_SOURCE[0]}` is
unset and the libs crash. Always go through `wi`.

## 2. Preconditions

Before doing any work, verify each item below. Run the dependency checks before
prompting; run the name/path checks immediately after §3 resolves the inputs and
before starting the 8 tasks. If any check fails, print a clear error to stderr
and EXIT (per **SPEC §8.1** and **SPEC §13.3**). No rollback is needed at this
point because nothing has been created yet.

Checks (run as bash one-liners):

- `command -v jq >/dev/null 2>&1` — `jq` must be on `$PATH` (manifest reads/writes use it).
- `command -v git >/dev/null 2>&1` — `git` must be on `$PATH`.
- `[[ -d "$parent" && -w "$parent" ]]` — the resolved parent must exist and be
  writable. In wrapper mode this is the wrapper itself.
- `[[ "$name" =~ ^[a-z0-9-]+$ ]]` — project name must be kebab-case (lowercase, digits, hyphens).

If a check fails, the error message must say WHICH check failed and what to
fix (e.g., "missing dependency: jq — install via your package manager and
re-run"). Exit non-zero. Do not proceed to input collection if any of these
preconditions failed during a non-interactive run; in interactive mode you may
prompt the user to fix and retry, but treat retries as a separate invocation.

## 3. Input collection

Slash-command grammar:

```
/init-workspace <name>
/init-workspace <name> --wrapper <existing-dir>
```

Read the raw slash-command text from the `$ARGUMENTS` env-var bridge — never
from `$1`/`$2`, per the slash-command `$N` substitution bug. Interpret exactly
one positional project name plus the optional `--wrapper <existing-dir>` pair.
Reject an unknown option, duplicate `--wrapper`, a missing/empty wrapper value,
or more than one positional name with a concise usage error. A wrapper path
containing spaces must be quoted in the slash command.

Inputs (prompt the user when not supplied):

- **project name** (kebab-case; must satisfy `^[a-z0-9-]+$`).
- **parent dir** (normal mode only; default: `$PWD`; must be an absolute path;
  `wi_realpath` if the user types a relative path).
- **wrapper dir** (wrapper mode only; the explicit `--wrapper` value; resolve
  it with `wi_realpath`; it must already exist and be writable). Treat the
  resolved wrapper as `parent`. Do not also prompt for a separate parent.
- **project_type** — one of `personal` or `work`. Per **SPEC §7.1** prompt
  the user with the exact wording: *"Is this a personal project or a
  work/company project?"* Both project types still enforce the trace filter;
  `project_type` is a forward hook for v0.2 policy differentiation.

Record the resolved values in shell variables for use below. In wrapper mode,
set `parent="$resolved_wrapper"`; otherwise use the resolved normal parent:

- `name="$resolved_name"`
- `parent="$resolved_wrapper"` in wrapper mode, otherwise
  `parent="$resolved_parent"`
- `project_type="$resolved_project_type"`
- `ai_root="${parent}/${name}-ai"`
- `canonical_root="${parent}/${name}"`

Wrapper mode is explicit only: never auto-detect it from the parent's basename,
existence, or non-empty state. Existing wrapper contents are orchestration
context, not owned bootstrap artifacts: preserve them byte-for-byte, do not
move/copy them into either repo, do not log the wrapper itself for rollback,
and do not add a `wrapper_root` field to the pairing manifest.

Do NOT prompt for `--git-remote` or `--default-branch` in fresh mode — fresh
repos have neither, and `wi_git_init` explicitly initializes them on `main` so
the repository state matches the manifest default on every machine.

## 4. Validate via lib/

Run preflight via the `wi` dispatcher:

```
wi skeleton_preflight "$parent" "$name"
```

The dispatcher (`workspace-init/bin/wi`) sources every `lib/*.sh` module
under a bash shebang and resolves the function-suffix argument
(`skeleton_preflight` → `wi_skeleton_preflight`). No env-var setup, no
`source`, no shell-portability footgun.

`wi_skeleton_preflight` checks the parent-writable + name-regex invariants
(same as section 2) AND verifies that the target dirs (`<parent>/<name>-ai`
and `<parent>/<name>`) do NOT already exist. A non-empty explicit wrapper is
valid: only those two inner targets are collision-sensitive. If any check fails, abort
cleanly — no rollback needed because nothing has been created. Print the
preflight error to stderr and exit non-zero.

## 5. The 8 pre-onboard tasks

Execute the tasks in the order below. After each task, append an entry to
`<ai-workspace>/.workspace/init-log` via `wi log_op …` so rollback can undo
the work in reverse order. **On ANY task failure**, immediately invoke
`wi rollback "${ai_root}/.workspace/init-log"` and exit non-zero. Per
**SPEC §8** and **SPEC §8.9**, rollback walks the log in reverse and
inverts each op (`mkdir` → `rmdir`, file create → `rm`, `git init` →
remove `.git/`, hook install → remove hook file).

Init-log path: `${ai_root}/.workspace/init-log`.
Manifest path: `${ai_root}/.workspace/pairing.json`.

### 5.1 — Task 8.1: Take user input

Already done in section 3 above. Nothing further to do here; reference the
resolved `name`, `parent`, `project_type`, `ai_root`, `canonical_root`.

### 5.2 — Task 8.2: Create root dir pair

Creates `<parent>/<name>-ai` AND `<parent>/<name>` (both empty). In wrapper
mode, `<parent>` is the existing wrapper; the operation creates/logs only the
two inner roots and `<name>-ai/.workspace`, never the wrapper itself.

```
wi skeleton_create_root_pair "$parent" "$name"
```

Expected init-log entries: `mkdir <ai_root>` and `mkdir <canonical_root>`.

### 5.3 — Task 8.3: Seed AI workspace subdirs + .gitignore

Creates `.workspace/`, `.claude/`, `docs/`, `docs/specs/`, `.superpowers/`,
`.archive/` (each with a `.gitkeep`) AND renders the `gitignore.tmpl`
template to `<ai_root>/.gitignore`.

```
wi skeleton_seed_subdirs "$ai_root"
```

Expected init-log entries: `mkdir <ai_root>/.workspace`, `mkdir <ai_root>/.claude`,
`mkdir <ai_root>/docs`, `mkdir <ai_root>/docs/specs`, `mkdir <ai_root>/.superpowers`,
`mkdir <ai_root>/.archive`, plus `file <ai_root>/.gitignore` and `.gitkeep` files.

### 5.4 — Task 8.4: Write the pairing manifest

Writes the v1.0 manifest to `<ai_root>/.workspace/pairing.json` per
**SPEC §6.2**. In fresh mode no `--git-remote` or `--default-branch` flag
is passed; `wi_manifest_write` defaults `default_branch` to `"main"` and
`git_remote` to `null`.

```
wi manifest_write "$ai_root" "$canonical_root" "$project_type"
```

**Optional — tooling repo (#48 Stage 2).** If the user volunteers a separate
*tooling/marketplace* repo (so `/defer --tooling` can route tech-debt there rather
than the project repo), append `--tooling-repo "$tooling_root"` (and
`--tooling-repo-remote "$tooling_remote"` if known). Don't prompt for one in fresh
mode; omit the flags and the `tooling_repo` key is left out entirely (unchanged).

Expected init-log entry: `file <ai_root>/.workspace/pairing.json`.

### 5.5 — Task 8.5: Write CLAUDE.md stub

Renders the CLAUDE.md router stub. scaffold-onboard's `/scaffold-project`
will overwrite this later.

```
wi stub_claude_md "$ai_root" "$name"
```

Expected init-log entry: `file <ai_root>/CLAUDE.md`.

### 5.6 — Task 8.6: Write AGENTS.md stub

Renders the cross-tool AGENTS.md stub.

```
wi stub_agents_md "$ai_root"
```

Expected init-log entry: `file <ai_root>/AGENTS.md`.

### 5.7 — Task 8.7: Write README.md

Renders the AI workspace README.

```
wi stub_readme "$ai_root" "$name"
```

Expected init-log entry: `file <ai_root>/README.md`.

### 5.8 — Task 8.8: git init + hooks + stage

Three sequential sub-steps; any failure triggers full rollback:

1. `wi git_init_pair "$ai_root" "$canonical_root"` — `git init` both repos
   with the unborn branch explicitly set to `main`, independent of the user's
   `init.defaultBranch` configuration.
2. `wi trace_filter_install_pair "$ai_root" "$canonical_root"` — render
   `hooks/commit-msg.tmpl` with the baked AI workspace path and install to
   `<ai_root>/.git/hooks/commit-msg` AND `<canonical_root>/.git/hooks/commit-msg`,
   `chmod +x` on both.
3. `wi git_stage_ai_workspace "$ai_root"` — `git -C "$ai_root" add .` (stages
   the skeleton; does NOT commit).

Expected init-log entries: `git-init <ai_root>`, `git-init <canonical_root>`,
`hook <ai_root>/.git/hooks/commit-msg`, `hook <canonical_root>/.git/hooks/commit-msg`,
`git-stage <ai_root>`.

## 6. Print next-steps

After all 8 tasks succeed, print the following message verbatim (substitute
`{name}` and `/abs/path` with the resolved values; everything else stays as
written, per **SPEC §8.8**):

```
Workspace bootstrap complete.

  AI workspace:  /abs/path/{name}-ai
  Canonical:     /abs/path/{name}

Both repos initialized + commit-msg trace filter hooks installed.
AI workspace has skeleton + manifest + stubs staged (not yet committed — review + commit yourself).

Next steps:
  1. cd /abs/path/{name}-ai && git status
  2. git commit -m "workspace-init: initial bootstrap (workspace-init v0.1.0)"
  3. cd /abs/path/{name}-ai && claude
  4. /onboard                              # begin scaffold-onboard's 10-phase conversation

Manifest at: /abs/path/{name}-ai/.workspace/pairing.json
Init log at: /abs/path/{name}-ai/.workspace/init-log (rollback record)

To override trace filter for a specific commit: git commit --no-verify
```

## 7. Discipline rules

These are non-negotiable invariants for this skill:

- **DO NOT auto-commit** the bootstrap. `wi_git_stage_ai_workspace` stages
  files; the user runs `git commit` themselves. Strict-honor rule per
  `[[feedback_strict_honor_no_unsolicited_commits]]` and the Wabash
  strict-honor convention.
- **DO stage-only** in the AI workspace (canonical stays empty in fresh mode).
- **DO NOT push.** workspace-init never pushes; remote setup is v0.2 work.
- **DO NOT infer wrapper mode.** It is enabled only by an explicit
  `--wrapper <existing-dir>` argument or an equivalent unambiguous natural-
  language request naming the wrapper.
- **DO NOT mutate wrapper-level source material.** Only the two inner target
  repos belong to the bootstrap and rollback log.
- **DO NOT pull or fetch.** Network ops are off (`allow_ai_pull=false`,
  `allow_ai_fetch=false`); this is a fresh project, there's nothing to pull.
- **DO NOT add a `Co-Authored-By:` trailer or any AI-marker** anywhere —
  not in commit messages (you're not committing anyway), not in the
  rendered stubs, not in the manifest's `created_by` field beyond
  `workspace-init@0.1.0`.
- **DO NOT modify any pre-existing `.git/hooks/`** — fresh mode just
  created the repos, so this isn't a real risk, but stay disciplined: the
  hook install always overwrites only `commit-msg` and only via the
  template, never by appending to an existing hook.
- Cite **SPEC §7.4** — workspace-init's own initial commit is explicitly
  left to the user.

## 8. Failure handling

Each failure mode below maps to a concrete response per **SPEC §13.3**. On
any of these, the skill exits non-zero with a clear message; rollback runs
where indicated.

- **Parent dir not writable** → `wi_skeleton_preflight` aborts; nothing
  created; no rollback needed. Error tells user to chmod the parent or
  pick a different one.
- **Wrapper missing/not writable** → reject before the 8 tasks with a
  `--wrapper requires an existing writable directory` error; do not create the
  wrapper implicitly and do not fall back to normal mode.
- **Unknown or malformed slash option** → reject with the two accepted command
  forms from §3; do not guess intent.
- **Project name invalid** (fails kebab-case regex) → preflight aborts;
  nothing created.
- **Pair-with path doesn't exist** → not relevant in fresh mode (this skill
  doesn't take a `--pair-with` arg). The sibling `pairing-canonical-repo`
  skill handles the pair-with case; if the user signaled pair-with intent
  by accident, point them at that skill.
- **Manifest write fails mid-operation** → `wi_manifest_write` returns
  non-zero; this skill catches it, calls `wi_rollback` on the init-log,
  and reports which task failed. Rollback removes the partially-created
  dirs and any prior files.
- **Hook install fails** (symlink loop, permission denied,
  `chmod +x` failure) → `wi_trace_filter_install_pair` returns non-zero;
  this skill calls `wi_rollback`. In fresh mode every op IS reversible —
  we just created both repos, so removing them is safe.
- **`git symbolic-ref` returns nothing** during default-branch detection →
  fresh mode does not use detection (`wi_git_init` pins `main`), but
  `wi_git_detect_default_branch` is the canonical fallback path used
  elsewhere. Per **SPEC §8.4** it walks the chain
  `symbolic-ref refs/remotes/origin/HEAD` → `symbolic-ref HEAD` →
  `branch --show-current` → user prompt → ultimate fallback `"main"`.
- **`jq` produces malformed JSON** during manifest write → covered by
  `wi_guarded_jq_write` (writes to a tempfile, validates with `jq empty`,
  then renames). On failure: rollback.
- **Concurrent invocation** (rare for fresh init, but possible) →
  `wi_lock_acquire` on the AI workspace root prevents two
  `initializing-dual-repo-workspace` runs from racing. Lock release in
  the `EXIT` trap; rollback runs before lock release.

For every failure: the rollback message must clearly tell the user WHAT
was rolled back (so they can verify the filesystem is clean) and what
(if anything) was left in place. In fresh mode, rollback always leaves
zero traces.
