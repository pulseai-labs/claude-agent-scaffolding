# Example: Pair-with abort — existing canonical has AI scaffolding

## Scenario

The user has an existing canonical repository at `/Users/example/projects/foo` that was previously
onboarded as a single-repo project. It contains AI scaffolding markers:

- `.claude/memory-bank/` (directory with memory state)
- `docs/MASTER-SPEC.md` (project spec)
- Possibly `CLAUDE.md` and other single-repo artifacts

The user tries to pair this canonical with a new AI workspace by running:

```bash
/pair-workspace /Users/example/projects/foo
```

They expect workspace-init to create a sibling AI workspace and write a manifest, but the skill
detects the AI scaffolding markers and aborts before creating anything.

## Pre-flight: abort-on-AI-scaffolding-marker check

Per SPEC §9.4, the skill scans the existing canonical for four markers BEFORE starting any tasks:

```bash
[[ -d "${canonical_root}/.claude/memory-bank" ]]         # FOUND
[[ -f "${canonical_root}/MASTER-SPEC.md" ]]             # NOT FOUND
[[ -f "${canonical_root}/docs/MASTER-SPEC.md" ]]        # FOUND
[[ -f "${canonical_root}/.claude/.onboarding-state.json" ]]  # FOUND
```

Three markers are detected (`.claude/memory-bank/`, `docs/MASTER-SPEC.md`, `.claude/.onboarding-state.json`).

The skill immediately aborts — no directories are created, no manifest is written, no hooks are installed.

## Abort message to user

The skill prints to stderr:

```
ERROR: existing canonical already contains AI scaffolding.
Found markers in /Users/example/projects/foo:
  - .claude/memory-bank/
  - docs/MASTER-SPEC.md
  - .claude/.onboarding-state.json

Refusing to pair: this repo was already onboarded as a single-repo project.
Pairing now would create an inconsistent dual-repo state.

This is Scenario B (split existing single-repo into dual-repo), which
workspace-init does not yet automate. For now, the manual workaround is:

  1. Move .claude/memory-bank/, MASTER-SPEC.md (or docs/MASTER-SPEC.md),
     and any other scaffolding artifacts into a NEW sibling AI workspace
     directory of your choosing (e.g., /Users/example/projects/foo-ai/).

  2. Write the pairing manifest by hand at
     /Users/example/projects/foo-ai/.workspace/pairing.json
     using the v1.0 schema (see workspace-init SPEC §6.2).

  3. Re-run /pair-workspace once the canonical no longer has the markers.

For support or to discuss Scenario B requirements, contact the workspace-init maintainer.
```

The skill exits with code 1.

## Filesystem state after abort

After abort, the filesystem is completely clean:

```bash
$ ls /Users/example/projects/
foo/                    # unchanged
(no foo-ai/ created)

$ git -C /Users/example/projects/foo status
On branch main
nothing to commit, working tree clean
(no AI-workspace hook installed in canonical; nothing was touched)
```

No partial directories, no partial manifest, no hooks — nothing has been created or modified.

## Why this abort is necessary

Creating an AI workspace alongside a single-repo that already contains AI scaffolding would produce
an ambiguous state:

- Which MASTER-SPEC.md is authoritative — the one in the old single-repo (canonical), or a new one in the AI workspace?
- Which memory-bank is current — the one in canonical/.claude/memory-bank/, or a new one in the AI workspace?
- The trace filter hook in canonical would point to the new AI workspace, orphaning the old scaffolding.

This is Scenario B (split existing single-repo) — deliberately deferred until workspace-init
includes migration tooling to safely move AI artifacts and repoint references.

## Manual workaround

For now, if the user needs to convert a single-repo to a dual-repo, the steps are:

1. **Move AI artifacts into a new AI workspace directory manually:**

   ```bash
   mkdir /Users/example/projects/foo-ai
   mv /Users/example/projects/foo/.claude /Users/example/projects/foo-ai/
   mv /Users/example/projects/foo/docs/MASTER-SPEC.md /Users/example/projects/foo-ai/docs/
   # (move any other scaffolding files)
   ```

2. **Create the AI workspace skeleton manually (copy from fresh bootstrap or another project's foo-ai/.workspace/).**

3. **Write the pairing manifest by hand** at `/Users/example/projects/foo-ai/.workspace/pairing.json`,
   following the v1.0 schema from SPEC §6.2.

4. **Commit the AI workspace** and initialize its git repo.

5. **Once the canonical is clean of AI markers**, re-run `/pair-workspace /Users/example/projects/foo`
   to have workspace-init install the commit-msg hook and validate the setup.

This workaround is tedious but safe — it avoids the risk of ambiguous dual-repo state.
A future workspace-init release is expected to automate this entire flow via a dedicated
migration command; today the path is re-running the pairing recipe after the canonical is clean.
