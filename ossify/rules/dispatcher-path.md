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
the `source:` field. A `--local` install reports the linked filesystem path
directly. A remote install reports a git URL (`https://…#ossify` or
`file://…`) — not a path; the plugin tree then lives under the plugin cache:
glob `${XDG_DATA_HOME:-~/.local/share}/devin/cli/plugins/cache/*/*/
.devin-plugin/plugin.json` for the manifest whose `name` is `ossify`; its
parent's parent is the plugin root (measured layout on 3000.10.21).

Example:

```
exec: /path/to/ossify/bin/oss verify_acs "/abs/path/to/spec.md"
```

Never `source` the lib files directly — they require bash. Always go through
the `oss` dispatcher.
