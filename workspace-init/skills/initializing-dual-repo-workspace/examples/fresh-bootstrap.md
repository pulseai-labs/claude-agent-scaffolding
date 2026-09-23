# Example: Fresh bootstrap (dual-repo initialization)

## Scenario

User runs `/init-workspace foo` from `/Users/example/projects/` (the parent directory).
They want to start a brand-new dual-repo workspace with no existing canonical or AI scaffolding.

## Prompts and user inputs

The skill prompts the user for three inputs:

```
What is your project name? (kebab-case, e.g., my-project)
foo

Parent directory? (default: /Users/example/projects)
(user presses Enter to confirm default)

Is this a personal project or a work/company project?
personal
```

The skill resolves:
- **name** = `foo`
- **parent** = `/Users/example/projects` (confirmed as writable)
- **project_type** = `personal`
- **ai_root** = `/Users/example/projects/foo-ai`
- **canonical_root** = `/Users/example/projects/foo`

## Pre-flight checks

The skill verifies (per SPEC §8.1):

```
✓ jq command available
✓ git command available
✓ Parent directory /Users/example/projects exists and is writable
✓ Project name 'foo' matches kebab-case regex ^[a-z0-9-]+$
✓ Neither /Users/example/projects/foo-ai nor /Users/example/projects/foo exist yet
```

## What workspace-init does (8 bootstrap tasks)

1. **Task 8.1: Input collection** — user provides project name, parent dir, and project type
2. **Task 8.2: Create root dir pair** — `wi_skeleton_create_root_pair` creates both `/Users/example/projects/foo-ai` and `/Users/example/projects/foo` (empty directories)
3. **Task 8.3: Seed AI workspace subdirs** — `wi_skeleton_seed_subdirs` creates `.workspace/`, `.claude/`, `docs/`, `docs/specs/`, `.superpowers/`, `.archive/` with `.gitkeep` files; renders `.gitignore`
4. **Task 8.4: Write pairing manifest** — `wi_manifest_write` writes the v1.0 schema to `.workspace/pairing.json` with fresh-mode defaults (git_remote: null, default_branch: "main")
5. **Task 8.5: Write CLAUDE.md stub** — `wi_stub_claude_md` renders the router stub at the AI workspace root
6. **Task 8.6: Write AGENTS.md stub** — `wi_stub_agents_md` renders the cross-tool agents reference
7. **Task 8.7: Write README.md** — `wi_stub_readme` renders the AI workspace README with project name and next-steps guidance
8. **Task 8.8: Git init + hooks + stage** — three sub-steps:
   - `wi_git_init_pair` initializes both repos with `git init`
   - `wi_trace_filter_install_pair` installs `commit-msg` hook in both `.git/hooks/` directories
   - `wi_git_stage_ai_workspace` stages all files in the AI workspace (canonical stays empty)

## Created paths

After bootstrap completes, the AI workspace at `/Users/example/projects/foo-ai` contains exactly:

- `.workspace/` — `.gitkeep`, `pairing.json` (the manifest, schema v1.0), `init-log` (transactional log of operations)
- `.claude/.gitkeep`
- `docs/.gitkeep`, `docs/specs/.gitkeep`
- `.superpowers/.gitkeep`
- `.archive/.gitkeep`
- `CLAUDE.md` — topology stub
- `AGENTS.md` — cross-tool agents reference
- `README.md` — AI workspace guide
- `.gitignore` — rendered from template
- `.git/hooks/commit-msg` — trace filter (executable; not tracked by git)
- (all files staged for commit, not yet committed)

The canonical at `/Users/example/projects/foo` has an empty working tree; its only
addition is `.git/hooks/commit-msg` (trace filter, executable; not tracked by git).

## Final manifest

The pairing manifest at `/Users/example/projects/foo-ai/.workspace/pairing.json`:

```json
{
  "schema_version": "1.0",
  "topology": "dual-repo",

  "ai_workspace": {
    "root": "/Users/example/projects/foo-ai",
    "name": "foo-ai",
    "git_tracked": true,
    "git_remote": null
  },
  "canonical": {
    "root": "/Users/example/projects/foo",
    "name": "foo",
    "git_tracked": true,
    "git_remote": null,
    "default_branch": "main"
  },

  "routing": {
    "master_spec":              "ai_workspace",
    "executive_summary":        "canonical",
    "memory_bank":              "ai_workspace",
    "claude_md":                "ai_workspace",
    "agents_md":                "ai_workspace",
    "scaffold_project_outputs": "ai_workspace",
    "backlog":                  "canonical",
    "project_plan":             "canonical",
    "roadmap":                  "canonical",
    "prd":                      "canonical",
    "srs":                      "canonical",
    "product_adrs":             "canonical",
    "process_adrs":             "ai_workspace",
    "sprint_specs":             "ai_workspace",
    "implementation_handoffs":  "ai_workspace",
    "brainstorm_artifacts":     "ai_workspace"
  },

  "during_dev": {
    "worktrees_dir":        "${canonical.root}/.worktrees",
    "branch_naming":        "slice/sprint-{N}-work-{NN}-{kebab-name}",
    "sprint_dir_template":  "${ai_workspace.root}/docs/specs/sprint-{N}",
    "slice_spec_format":    "wabash-format-b-v1"
  },

  "well_known_paths": {
    "master_spec":            "${ai_workspace.root}/docs/MASTER-SPEC.md",
    "memory_bank":            "${ai_workspace.root}/.claude/memory-bank",
    "superpowers_brainstorm": "${ai_workspace.root}/.superpowers/brainstorm"
  },

  "git_policy": {
    "project_type": "personal",
    "allow_ai_local_commits": true,
    "allow_ai_local_merge":   true,
    "allow_ai_local_rebase":  true,
    "allow_ai_fetch":         false,
    "allow_ai_push":          false,
    "allow_ai_pull":          false,
    "trace_filter": {
      "enforce": true,
      "blocked_patterns": [
        "^Co-Authored-By:",
        "^🤖 Generated with",
        "<noreply@anthropic\\.com>",
        "<noreply@openai\\.com>"
      ]
    }
  },

  "created_at":      "2026-05-25T14:30:00Z",
  "created_by":      "workspace-init@<running-plugin-version>"
}
```

The real writer stamps the installed plugin version at write time.

## Final next-steps message

After all 8 tasks complete successfully, the skill prints:

```
Workspace bootstrap complete.

  AI workspace:  /Users/example/projects/foo-ai
  Canonical:     /Users/example/projects/foo

Both repos initialized + commit-msg trace filter hooks installed.
AI workspace has skeleton + manifest + stubs staged (not yet committed — review + commit yourself).

Next steps:
  1. cd /Users/example/projects/foo-ai && git status
  2. git commit -m "workspace-init: initial bootstrap"
  3. cd /Users/example/projects/foo-ai && claude
  4. /ossify:start                         # bare canonical; routes to /ossify:adopt if source or history is present
                                           # on Codex, invoke the corresponding ossify skill — `start`, or `adopt`
                                           # on Devin, invoke the ossify skill `start`; the adopt paths are not published on that surface, so reopen the checkout in Claude Code or Codex
                                           # a recorded tooling repo that already carries history refuses it too, with no supported ossify continuation yet

Manifest at: /Users/example/projects/foo-ai/.workspace/pairing.json
Init log at: /Users/example/projects/foo-ai/.workspace/init-log (rollback record)

To override trace filter for a specific commit: git commit --no-verify
```

The user then commits the staged AI workspace skeleton manually, launches Claude Code in the AI workspace directory, and invokes `/ossify:start`.
