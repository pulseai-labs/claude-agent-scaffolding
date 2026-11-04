The user wants to run a security audit on the current Claude Code project.

Invoke the `auditing-claude-configs` skill in audit mode.

Pass `$ARGUMENTS` (which may contain flags like `--focus <aspect>`, `--verbose`, `--show-suppressed`, `--suppress <id>`) to the skill so it can parse and dispatch correctly.

If `$ARGUMENTS` contains `--suppress <id>`, route to suppression mode (refuses Critical findings and findings discovered <60s ago per the race-window rule).

If `$ARGUMENTS` is empty, run a full audit across all 7 aspects.
