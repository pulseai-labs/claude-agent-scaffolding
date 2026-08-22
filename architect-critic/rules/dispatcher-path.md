---
trigger: model_decision
description: How to locate and invoke the arc dispatcher on Devin
globs: "**/*"
---

The `arc` dispatcher is at `<plugin-source>/bin/arc` where `<plugin-source>` is
the installed plugin's source directory. On Devin, `bin/` directories are NOT
added to `$PATH`. Always invoke `arc` via the `exec` tool with its full path,
never as a bare `arc` command.

To discover the plugin source path, run `devin plugins info architect-critic`
and read the `source:` field, or use the skill's own base directory and
append `../../bin/arc`.

Example:

```
exec: /path/to/architect-critic/bin/arc state_append_run --request-id R --depth premise --adversaries '["devin"]' --challenge-count 0 --concessions 0 --skill-invoked critiquing-spec --elapsed-ms 0
```

Never `source` the lib files directly — they require bash and will crash
under zsh. Always go through the `arc` dispatcher.

On Devin, architect-critic runs host-only audits with `adversaries_used=["devin"]`.
No external adversary (Codex/Claude) is dispatched. `--async` is refused.
