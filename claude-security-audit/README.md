# claude-security-audit

Static-analysis security audit for Claude Code and Codex project configurations and enabled plugins.

> **Inspired by AgentShield in [Everything Claude Code](https://github.com/affaan-m/everything-claude-code)** (Mustafa, 2026; MIT). This implementation is an independent, focused MIT-licensed audit tool tailored to composable plugin marketplaces.

## What it catches (v0.1)

- **Plaintext secrets** in `CLAUDE.md`, `AGENTS.md`, `.claude/`, and `.codex/` files (API keys, JWTs, GitHub PATs, AWS keys, env-var-shaped leaks)
- **Permission misconfigurations** including the high-impact **schema-validation** check that catches typo'd field names like `"allowed"` instead of `"allow"` (which Claude Code silently ignores → user has no enforcement)
- **Hook injection** patterns (curl|bash, rm -rf, unbounded eval, plaintext network exfiltration)
- **MCP server misconfiguration** (untrusted endpoints, missing auth, env-var leaks)
- **Prompt injection** in agent definitions and slash commands (common patterns)
- **Marketplace integrity** (non-HTTPS URLs, malformed marketplace.json, Claude `.claude-plugin/` manifests, Codex `.agents/plugins/` and `.codex-plugin/` manifests)
- **`settings.local.json` silent broadening** (gitignored file overrides committed settings)

## What it does NOT catch (v0.1)

v0.1 uses bash + jq + regex (no AST). A determined adversary who obfuscates payloads (base64, eval indirection, dynamic command construction) will evade most v0.1 rules. AST-based detection is on the v0.2 roadmap.

**Treat a clean audit as:** "doesn't trip our v0.1 common-pattern rules."
**NOT as:** "this plugin/config is safe to trust."

Realistic v0.1 value:
1. Catching accidental friendly-fire (secrets committed to CLAUDE.md)
2. Naive-malicious teammate PRs
3. Pre-publish hygiene before open-sourcing a Claude project
4. The common-pattern subset of compromised-plugin attacks

## Install

Via Claude Code marketplace:

```
/plugin install claude-security-audit
```

Via Codex marketplace:

```
codex plugin marketplace add github:draco28/claude-agent-scaffolding
```

## Usage

```
/security-audit                           # full audit
/security-audit --focus secrets           # one aspect
/security-audit --verbose                 # show Info findings
/security-audit --show-suppressed         # also show suppressed
/security-audit --suppress SA-2026-...    # dismiss a finding (refuses Critical)
/secrets-scan                             # alias for --focus secrets
/permissions-review                       # alias for --focus permissions
/apply-fix SA-2026-...                    # apply one safe-category fix
/apply-fix FUID-a3f9b21c                  # same, using durable ID
```

## Opt-in SessionStart reminder

The plugin ships `hooks/session-start-reminder.sh` but does NOT register it. To enable a "last audit N days ago" reminder on session start, add this to your **own** `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "command": "bash $HOME/.claude/plugins/cache/claude-security-audit/0.1.0/hooks/session-start-reminder.sh" }
    ]
  }
}
```

Why opt-in: the plugin's threat model flags plugin-installed SessionStart hooks as a Critical attack surface. Forcing the hook on every user would put the plugin's own shell into the very surface its rules treat as high-severity. Your install, your choice.

## What gets written to disk

The plugin writes audit state to `<project>/.claude/audits/` for compatibility
with the existing report/state format, even when scanning Codex surfaces:
- `state.json` — durable finding registry + audit history + tamper-detection mtimes
- `<date>-<NN>.md` — per-run report with stable finding IDs
- `suppressions.json` — your dismissed findings (gitignored per-developer)
- `.lock` — transient lock file during audit runs

The **first audit run** adds `.claude/audits/` to your `.gitignore` automatically (idempotent; handles nested git repos and missing `.gitignore`).

## Findings reference

| Severity | Meaning | Examples |
|---|---|---|
| Critical | Immediate action | hook running `curl ... \| bash`; plaintext production API key |
| High | Fix this session | MCP with no auth; settings.local.json broadens; schema typo silently disables |
| Medium | Fix within sessions | `Bash(*)` instead of `Bash(git:*)`; agent prompt with vague injection signals |
| Low | Hygiene | localhost dev URLs; permissions slightly too broad |
| Info | Observation | "N plugins in cache not enabled here"; "no audit baseline yet" |

Critical findings **cannot be suppressed**; they must be remediated.

## Composition

`claude-security-audit` is fully standalone. It runs in any Claude Code project, with or without other plugins. It has no integration with any other plugin in v0.1.

## License

MIT. See `LICENSE`.
