The user wants to review the permission grants in their Claude Code settings.

Invoke the `auditing-claude-configs` skill in audit mode with `--focus permissions`.

Pass `$ARGUMENTS` for any additional flags. This runs PERM-001 through PERM-005 (including schema-validation that catches typo'd field names like `"allowed"` instead of `"allow"`).
