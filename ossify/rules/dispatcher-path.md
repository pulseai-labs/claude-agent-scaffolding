---
trigger: model_decision
description: How to locate and invoke the oss dispatcher on Devin
globs: "**/*"
---

The `oss` dispatcher is at `<plugin-source>/bin/oss` where `<plugin-source>` is
the installed ossify plugin's source directory. On Devin, `bin/` directories are
NOT added to `$PATH`. Always invoke `oss` via the `exec` tool with its full path,
never as a bare `oss` command.

To discover the plugin source path, run `devin plugins info ossify` and read
the `source:` field.

Example:

```
exec: /path/to/ossify/bin/oss verify_acs "/abs/path/to/spec.md"
```

Never `source` the lib files directly — they require bash. Always go through
the `oss` dispatcher.
