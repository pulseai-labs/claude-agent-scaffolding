# Example: Failure and rollback mid-init

## Scenario

User runs `/init-workspace foo` from `/Users/example/projects/`. The parent directory is writable,
but mid-stream, Task 8.7 (write README.md) fails with a file-exists error — a stale partial run left
a README.md from a previous failed invocation.

## Inputs and pre-flight

Same as fresh-bootstrap:
- **name** = `foo`
- **parent** = `/Users/example/projects` (writable)
- **project_type** = `personal`
- **ai_root** = `/Users/example/projects/foo-ai`
- **canonical_root** = `/Users/example/projects/foo`

All pre-flight checks pass; no existing AI/canonical dirs are found.

## Init-log state before failure

After Tasks 8.2 through part of 8.7, the init-log at `/Users/example/projects/foo-ai/.workspace/init-log` contains:

```
MKDIR	/Users/example/projects/foo-ai
MKDIR	/Users/example/projects/foo
MKDIR	/Users/example/projects/foo-ai/.workspace
MKDIR	/Users/example/projects/foo-ai/.claude
MKDIR	/Users/example/projects/foo-ai/docs
MKDIR	/Users/example/projects/foo-ai/docs/specs
MKDIR	/Users/example/projects/foo-ai/.superpowers
MKDIR	/Users/example/projects/foo-ai/.archive
FILE	/Users/example/projects/foo-ai/.gitignore
FILE	/Users/example/projects/foo-ai/.workspace/.gitkeep
FILE	/Users/example/projects/foo-ai/.claude/.gitkeep
FILE	/Users/example/projects/foo-ai/docs/.gitkeep
FILE	/Users/example/projects/foo-ai/docs/specs/.gitkeep
FILE	/Users/example/projects/foo-ai/.superpowers/.gitkeep
FILE	/Users/example/projects/foo-ai/.archive/.gitkeep
FILE	/Users/example/projects/foo-ai/.workspace/pairing.json
FILE	/Users/example/projects/foo-ai/CLAUDE.md
FILE	/Users/example/projects/foo-ai/AGENTS.md
```

## The failure

During Task 8.7, `wi_stub_readme` attempts to write `/Users/example/projects/foo-ai/README.md`:

_Dispatcher invocations below are `"$wi_bin" …` — the calling skill resolves `wi_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

```bash
"$wi_bin" stub_readme "$ai_root" "$name"
```

But the file already exists (from the stale partial run). The function detects the error:

```
ERROR: /Users/example/projects/foo-ai/README.md already exists (not overwriting)
```

`wi_stub_readme` returns exit code 1. The skill catches this and immediately invokes rollback:

```bash
"$wi_bin" rollback "${ai_root}/.workspace/init-log"
```

## Rollback execution log

`wi_rollback` walks the init-log in reverse order and inverts each operation:

```
REVERSING: FILE /Users/example/projects/foo-ai/AGENTS.md → rm
REVERSING: FILE /Users/example/projects/foo-ai/CLAUDE.md → rm
REVERSING: FILE /Users/example/projects/foo-ai/.workspace/pairing.json → rm
REVERSING: FILE /Users/example/projects/foo-ai/.archive/.gitkeep → rm
REVERSING: FILE /Users/example/projects/foo-ai/.superpowers/.gitkeep → rm
REVERSING: FILE /Users/example/projects/foo-ai/docs/specs/.gitkeep → rm
REVERSING: FILE /Users/example/projects/foo-ai/docs/.gitkeep → rm
REVERSING: FILE /Users/example/projects/foo-ai/.claude/.gitkeep → rm
REVERSING: FILE /Users/example/projects/foo-ai/.workspace/.gitkeep → rm
REVERSING: FILE /Users/example/projects/foo-ai/.gitignore → rm
REVERSING: MKDIR /Users/example/projects/foo-ai/.archive → rmdir
REVERSING: MKDIR /Users/example/projects/foo-ai/.superpowers → rmdir
REVERSING: MKDIR /Users/example/projects/foo-ai/docs/specs → rmdir
REVERSING: MKDIR /Users/example/projects/foo-ai/docs → rmdir
REVERSING: MKDIR /Users/example/projects/foo-ai/.claude → rmdir
REVERSING: MKDIR /Users/example/projects/foo-ai/.workspace → rmdir
REVERSING: MKDIR /Users/example/projects/foo → rmdir
REVERSING: MKDIR /Users/example/projects/foo-ai → rmdir
```

All operations complete successfully. Filesystem is now clean.

## Final clean state

After rollback:

```bash
$ ls /Users/example/projects/
(only pre-existing projects shown; neither foo-ai/ nor foo/ are present)
```

The user is back to where they started before running `/init-workspace foo`.

The stale README.md that caused the failure has been removed as part of the rollback
(it was not in the init-log, so rollback didn't try to remove it; the directory structure
it lived in was demolished by rmdir, leaving the filesystem clean).

## Error message to user

After rollback completes, the skill prints to stderr:

```
ERROR: Task 8.7 (write README.md) failed: /Users/example/projects/foo-ai/README.md already exists

Init rolled back: all created directories and files have been removed.
Workspace is back to clean state as if init never ran.

To retry: clean up any stale files at /Users/example/projects/foo-ai and
/Users/example/projects/foo manually (if they still exist), then re-run /init-workspace foo
```

The skill exits with code 1. The user can now investigate the stale state, clean it up manually if needed,
and re-run `/init-workspace foo`. Per SPEC §8.9, rollback always returns the workspace to clean state.
