# workspace-init

**Bootstrap a dual-repo workspace (AI workspace + canonical repo) with pairing manifest and AI-trace commit-msg filter.** Run-once plugin; first in the scaffolding chain (`workspace-init` → `scaffold-onboard` → `scaffold-dev`).

## What it does

Most "AI-with-codebase" workflows mix AI-only artifacts (memory banks, sprint specs, brainstorm outputs, process ADRs) directly into the project repo. That's noisy on review and leaks AI-trace into the canonical history. `workspace-init` creates a **paired second repo** — the *AI workspace* — and wires it to the *canonical* project repo via a pairing manifest. Both stay git-tracked; routing of every well-known artifact (master spec, memory bank, backlog, ADRs, etc.) is declared in `pairing.json`. A `commit-msg` git hook is installed into the canonical repo's `.git/hooks/` to refuse commits whose messages contain AI-trace patterns (`Co-Authored-By:`, robot emoji generation lines, `noreply@anthropic.com`, etc.).

Scenario A (`/pair-workspace`) lets you adopt an **existing** canonical repo — `workspace-init` will not touch its working tree, only install the hook and stage the new AI workspace alongside.

## Install

```
/plugin install workspace-init@claude-agent-scaffolding
```

## Quickstart

### Fresh project (both repos new)

```
/init-workspace foo
```

This bootstraps two sibling directories:

```
foo/                  # canonical repo (skeleton: README, .gitignore, LICENSE stub)
foo-ai/               # AI workspace (.workspace/pairing.json, .claude/, docs/, AGENTS.md, CLAUDE.md stub)
```

Both are explicitly `git init`'d on `main`, regardless of the machine's
`init.defaultBranch` setting. The `commit-msg` AI-trace hook is installed into
`foo/.git/hooks/`. Nothing is auto-committed — files are staged, you commit when
ready.

### Fresh project inside an existing wrapper

Use explicit wrapper mode when an outer project directory already contains
source material and should contain both repositories:

```
/init-workspace pulsebase --wrapper /Users/example/projects/pulsebase
```

This creates only the inner pair:

```
/Users/example/projects/pulsebase/
├── PULSEBASE_SPEC.md     # existing wrapper content; preserved
├── pulsebase/            # canonical repo
└── pulsebase-ai/         # AI workspace
```

The wrapper must already exist and be writable. Only `pulsebase/` and
`pulsebase-ai/` are collision-checked and rollback-owned; other wrapper contents
are never moved, copied, deleted, or added to the pairing manifest. Wrapper mode
is never inferred from directory names or non-empty parents.

### Pair with an existing canonical (Scenario A)

```
/pair-workspace /abs/path/to/existing-project
```

This creates `existing-project-ai/` as a sibling, writes the pairing manifest pointing at the existing canonical, and installs the `commit-msg` hook into the canonical's `.git/hooks/`. **The canonical's working tree is not modified.** Refuses to proceed if the canonical already has AI scaffolding (`.claude/memory-bank/`, `MASTER-SPEC.md`, `docs/MASTER-SPEC.md`, or `.claude/.onboarding-state.json`) — that's a Scenario B migration, deferred to v0.2.

### Skill auto-invocation

The two skills (`initializing-dual-repo-workspace`, `pairing-canonical-repo`) auto-invoke on natural-language triggers too:

```
"set up a fresh AI workspace for foo"          # → initializing-dual-repo-workspace
"pair an AI workspace with my existing repo"   # → pairing-canonical-repo
```

## The pairing manifest

Lives at `<ai-workspace>/.workspace/pairing.json`. Schema version **1.0**. Single source of truth for downstream plugins (`scaffold-onboard`, `scaffold-dev`) to discover which repo owns which artifact.

Top-level shape:

- `schema_version`, `topology: "dual-repo"`
- `ai_workspace` — `{ root, name, git_tracked, git_remote }`
- `canonical` — `{ root, name, git_tracked, git_remote, default_branch }`
- `routing` — per-artifact map of well-known paths to `"ai_workspace"` or `"canonical"` (master_spec → ai_workspace; backlog/PRD/SRS/roadmap → canonical; etc.)
- `during_dev` — slice/sprint conventions (worktrees dir, branch naming, slice spec format)
- `well_known_paths` — absolute path templates with `${ai_workspace.root}` / `${canonical.root}` / `${PLUGIN_DATA:<name>}` / `${HOME}` / `${USER}` placeholders, resolved lazily by `wi_manifest_resolve` (per SPEC §6.3) so the manifest survives directory moves.
- `git_policy` — `project_type`, `allow_ai_*` flags (local commit/merge/rebase allowed; fetch/push/pull blocked by default), and the trace filter (`enforce` + `blocked_patterns`).
- `created_at`, `created_by`

Downstream plugins read the manifest via `wi_manifest_resolve` to find any artifact regardless of where the user invoked them from.

## The trace filter

A `commit-msg` hook is installed into `<canonical>/.git/hooks/commit-msg` with the AI workspace path **baked in at install time** (so the hook keeps working even if your shell's cwd is elsewhere). On every commit to the canonical:

1. Reads `<ai-workspace>/.workspace/pairing.json`. If the manifest is missing, malformed, or its trace-filter policy is unreadable, the hook **blocks the commit** and names the repair — the filter fails closed, because a permanent trace leak into public history costs more than a blocked commit.
2. If `git_policy.trace_filter.enforce: false`, exits clean.
3. Otherwise, scans the commit message against `git_policy.trace_filter.blocked_patterns` (extended regex). Default patterns:
   - `^Co-Authored-By:`
   - `^🤖 Generated with`
   - `<noreply@anthropic\.com>`
   - `<noreply@openai\.com>`
4. If any pattern matches, refuses the commit with a pointer error.

The install only replaces hooks it wrote — recognised by a `# workspace-init:managed-hook` marker line (or the pre-0.5.1 `auto-installed` header). Any other existing `commit-msg` hook is preserved and the install refuses, so a user hook is never silently displaced.

**Repair after a workspace move or a broken manifest:** re-run the pairing recipe (`/workspace-init:pair-existing-dual` or `/workspace-init:pair-canonical-repo`) so the hook is re-baked against the workspace's new location, or run the deterministic form directly:

```
<workspace-init plugin dir>/bin/wi trace_filter_install_pair <ai-workspace> <canonical-repo>
```

The plugin dir is wherever your plugin host installed workspace-init, e.g. `~/.claude/plugins/cache/<marketplace>/workspace-init/<version>` or `~/.codex/plugins/cache/<marketplace>/workspace-init/<version>`. If the AI workspace is not a git repo, use `wi trace_filter_install <ai-workspace> <repo>` per target — the pair form installs the AI-side hook first and stops there.

### Bypass

```
git commit --no-verify -m "..."
```

Use sparingly — the whole point of the filter is to keep AI traces out of the canonical history. If you find yourself bypassing routinely, edit `blocked_patterns` in the manifest to relax the rule rather than disabling per-commit.

The hook itself lives in `.git/hooks/commit-msg`, which is **not tracked by git** — clones won't carry it. A `core.hooksPath`-based tracked variant is deferred to v0.2.

## Pointers

- Spec: [`docs/SPEC-workspace-init.md`](../docs/SPEC-workspace-init.md) — manifest schema (§6.2), resolver semantics (§6.3), bootstrap procedure (§8.1), Scenario A migration (§9.4), trace filter contract (§7.3).
- Plan: [`docs/PLAN-workspace-init.md`](../docs/PLAN-workspace-init.md) — 9-phase implementation plan.
- Changelog: [`CHANGELOG.md`](./CHANGELOG.md).
- Sibling plugins in the chain: [`scaffold-onboard`](../scaffold-onboard/) (run-once project onboarding), [`scaffold-dev`](../scaffold-dev/) (slice-driven implementation; future).

## License

MIT — see [`LICENSE`](./LICENSE).
