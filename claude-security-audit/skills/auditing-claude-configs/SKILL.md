---
name: auditing-claude-configs
description: Static-analysis security audit for Claude Code and Codex project configurations and enabled plugins. Detects secrets, permission issues, hook injection, MCP misconfiguration, settings-schema typos, prompt-injection in agents/commands, marketplace integrity issues. Activate on "audit my claude config", "audit my codex config", "security scan my .claude", "security scan my .codex", "scan for leaked credentials", "review my permissions", "audit settings.json", "apply fix SA-...", "/security-audit", "/secrets-scan", "/permissions-review", "/apply-fix". Inspired by AgentShield in Everything Claude Code (Mustafa, 2026; MIT) — independent MIT implementation tailored to composable plugin marketplaces.
---

# auditing-claude-configs

Orchestrates the static-analysis security audit for Claude Code and Codex projects. Detection lives in `lib/rules/<aspect>/*.sh`; this skill body handles flow control, presentation, and the `/apply-fix` path.

**Lib invocation contract:** call every lib function via the `csa` dispatcher (`claude-security-audit/bin/csa`, on `$PATH` because Claude Code adds each plugin's `bin/` automatically). The dispatcher's bash shebang forces a bash runtime for the libs even when the Bash tool subprocess is zsh (the macOS default). Form: `csa <fn-suffix> [args...]` resolves to `csa_<fn-suffix>`. Never `source` lib files directly from skill body — under zsh `${BASH_SOURCE[0]}` is unset and `${BASH_REMATCH[…]}` returns empty silently; the libs crash or silently corrupt state. Always go through `csa`. Use `csa --list` for discovery.

## Scope honesty (read this before invoking)

v0.1 catches **common, unobfuscated patterns**. A determined adversary who obfuscates payloads (base64, eval indirection, dynamic command construction) will evade most v0.1 rules. AST-based detection is v0.2. Realistic v0.1 value: catching accidental friendly-fire (committed secrets), naive-malicious teammate PRs, pre-publish hygiene, and the common-pattern subset of compromised-plugin attacks. Treat a clean audit as "doesn't trip our v0.1 common-pattern rules" — NOT as "this is safe to trust."

## Audit mode (default — `/security-audit`)

1. Parse `$ARGUMENTS` for flags: `--focus <aspect>`, `--verbose`, `--show-suppressed`. Set `focus` to the selected aspect, or `all` when absent; `/secrets-scan` and `/permissions-review` set their respective focus.
2. **First-run gitignore bootstrap** (only if `.claude/audits/state.json` does not yet exist): `csa state_bootstrap_gitignore` to add `.claude/audits/` to `.gitignore` (idempotent; covers nested git repos, missing gitignore, unwritable files — see references/auto-fix-policy.md).
3. Resolve scan targets: `csa enum_targets_all "$PWD"` (project `.claude/`, `CLAUDE.md`, `.claude-plugin/marketplace.json`, Codex surfaces such as `.codex/`, `AGENTS.md`, `.agents/plugins/marketplace.json`, `.codex-plugin/plugin.json`, readable `~/.codex/config.toml`, plus enabled Claude plugins per the algorithm in references/threat-model.md §enumerate).
4. Run the deterministic rule engine: `csa rule_engine_scan_all "$PWD" "$focus"` iterates concrete targets × applicable rules.
5. Compute durable `finding_uid` (no line number) + per-run `dedup_fingerprint`: `csa finding_uid <...>` / `csa dedup_fingerprint <...>` (per scanner finding).
6. Tag scanner findings NEW vs PERSISTED via `csa baseline_tag <findings>` against state.json's `findings` registry.
7. Filter suppressed scanner findings via `csa suppress_filter <findings>` (unless `--show-suppressed`).
8. Write the scanner report file `.claude/audits/<date>-<NN>.md` and return chat summary via `csa report_render_markdown` + `csa report_render_chat`.
9. Update `state.json` (last-audit-date, scanner findings registry with GC per references/severity-rubric.md §GC, `self_integrity.state_mtime_at_last_audit` per references/auto-fix-policy.md §tamper).
10. If any rules failed to load, emit prominent chat banner: `"⚠ N rule(s) failed to load; results incomplete. See report for SCANNER-001 findings."`
11. Emit chat summary inline (per references/severity-rubric.md §chat-summary-format).

## Focused-scan mode (`/secrets-scan`, `/permissions-review`)

Identical to audit mode but with `--focus <aspect>` baked in. Skill body parses the slash command name from `$ARGUMENTS` (when wrapper passes it) or from focus flag.

## Apply-fix mode (`/apply-fix <finding-id>`)

1. Parse `$ARGUMENTS` to extract finding ID. Accept either `display_id` (e.g., `SA-2026-05-24-013`) or `finding_uid` (e.g., `FUID-a3f9b21c`).
2. Resolve via `csa apply_resolve_id "<id>"`: display_id → look up in latest report → finding_uid.
3. Load finding record from `state.json`.
4. Run defense-in-depth checks per references/auto-fix-policy.md:
   - Rule has `RULE_AUTO_FIXABLE=true` AND `RULE_MECHANICALLY_FIXABLE=true`
   - Re-resolve fix recipe target path; verify still in safe-write allowlist
   - Refuse symlinks at target; refuse paths outside project root
5. Execute the rule's `fix` function with `(target_file, finding_json_context)`.
6. Update `state.json.applied_fixes` audit-trail entry (BEFORE write; updated to `failed` if write fails).
7. Emit chat confirmation: `"Applied <display_id> (<finding_uid>): <fix_summary>"`.

If any check fails, refuse with the specific message from references/auto-fix-policy.md.

## Suppression mode (`/security-audit --suppress <finding-id>`)

Calls `csa suppress_add "<finding-id>"`. Refuses Critical-severity findings. Refuses if finding_uid was first_seen < 60s ago (race-window protection per references/auto-fix-policy.md §tamper).

## When the user asks naturally (no slash command)

Match phrasings like "scan my .claude for security issues", "scan my .codex for security issues", "audit my Codex config", "check for leaked credentials", "review my settings.json" — invoke this skill in the appropriate mode based on intent.

## References

- `references/threat-model.md` — what v0.1 catches and what it doesn't; enumerate algorithm
- `references/severity-rubric.md` — 5-tier rubric + chat-summary format + GC policy
- `references/auto-fix-policy.md` — safe/never categories + two-flag system + tamper detection
