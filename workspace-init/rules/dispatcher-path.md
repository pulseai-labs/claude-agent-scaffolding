---
trigger: model_decision
description: How to locate and invoke the wi dispatcher on Devin
globs: "**/*"
---

The `wi` dispatcher is at `<plugin-source>/bin/wi` where `<plugin-source>` is
the installed plugin's source directory. On Devin, `bin/` directories are NOT
added to `$PATH`. Always invoke `wi` via the `exec` tool with its full path,
never as a bare `wi` command. And never resolve `wi` via `command -v wi`
on Devin — since this plugin's `bin/` is never on `$PATH` there, a PATH hit
can only be a foreign binary (an unrelated `wi` binary); verify a candidate answers our
dispatcher (e.g. `wi --list`/`help` emitting our verbs) before trusting it.

To discover the plugin source path, run `devin plugins info workspace-init`
and read the `source:` field, or use the skill's own base directory and
append `../../bin/wi`. A `--local` install reports the linked filesystem
path directly; a remote install reports a git URL (`https://…#workspace-init`
or `file://…`) — not a path. The remote tree lives under the plugin cache:
glob `${XDG_DATA_HOME:-$HOME/.local/share}/devin/cli/plugins/cache/*/*/
.devin-plugin/plugin.json` for the manifest whose `name` is `workspace-init`;
its parent's parent is the plugin root (measured layout on 3000.10.21).

Example:

```
exec: /path/to/workspace-init/bin/wi skeleton_preflight "$parent" "$name"
```

Never `source` the lib files directly — they require bash and will crash
under zsh. Always go through the `wi` dispatcher.
