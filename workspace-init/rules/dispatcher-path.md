---
trigger: model_decision
description: How to locate and invoke the wi dispatcher on Devin
globs: "**/*"
---

The `wi` dispatcher is at `<plugin-source>/bin/wi` where `<plugin-source>` is
the installed plugin's source directory. On Devin, `bin/` directories are NOT
added to `$PATH`. Always invoke `wi` via the `exec` tool with its full path,
never as a bare `wi` command.

To discover the plugin source path, run `devin plugins info workspace-init`
and read the `source:` field, or use the skill's own base directory and
append `../../bin/wi`.

Example:

```
exec: /path/to/workspace-init/bin/wi skeleton_preflight "$parent" "$name"
```

Never `source` the lib files directly — they require bash and will crash
under zsh. Always go through the `wi` dispatcher.
