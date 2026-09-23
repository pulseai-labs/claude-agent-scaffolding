---
description: Bootstrap a fresh dual-repo workspace (AI workspace + canonical). Wraps the initializing-dual-repo-workspace skill.
allowed-tools: ["Read", "Write", "Bash"]
---

Invoke the `initializing-dual-repo-workspace` skill from the workspace-init plugin.

Arguments: $ARGUMENTS

Accepted forms:

```
/init-workspace <name>
/init-workspace <name> --wrapper <existing-dir>
```

Pass the raw `$ARGUMENTS` text to the skill for interpretation. The skill must
reject an unknown option, duplicate `--wrapper`, extra positional values, or a
missing/empty wrapper value with an error containing `--wrapper requires an
existing writable directory` plus the accepted forms above. If no project name
is supplied, prompt for it interactively. Never use shell positional parameters,
never infer wrapper mode, and never treat the entire non-empty argument string as
the name.

Follow the skill body exactly. Do not skip any of the 8 bootstrap tasks. Do not auto-commit (stage only). Print the next-steps message verbatim. If any task fails, invoke the rollback via `wi rollback "${ai_root}/.workspace/init-log"` (the `wi` dispatcher is on PATH; it sources lib modules under bash regardless of caller shell).
