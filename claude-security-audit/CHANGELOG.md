# claude-security-audit changelog

## 0.1.4 (2026-09-04)

### Fixed
- **Public dispatcher delivery.** Both manifests now publish the dispatcher environment setup required for `csa rule_engine_scan_all` to discover rules without ambient `CSA_*` variables.
- **Hook handler safety rails.** The scanner covers executable extensionless handlers under `.claude/hooks/`, including plaintext-secret detection, while non-executable hook documents are skipped safely.
- **Pipefail false negatives.** Hook network-exfiltration, MCP literal-secret matching, and paranoid-plugin membership avoid producer-to-`grep -q` pipelines.

## 0.1.3 (2026-06-21)

CI hardening (#71) — keep the wall-clock perf benchmark out of blocking PR CI.

### Changed
- **`tests/test-perf.sh` honors `CSA_SKIP_PERF` (#71).** When the env var is set, the benchmark prints `skipped (CSA_SKIP_PERF set)` and exits 0 (a no-op pass — `run-tests.sh`'s glob still counts the file). The repo CI sets `CSA_SKIP_PERF=1` on the security-audit step because the 30s wall-clock hard-fail threshold is calibrated for the homelab reference machine and flakes on slower shared runners. Local / homelab runs are unaffected — the benchmark still runs there with no env var. No rule or audit-behavior changes; 182 tests otherwise unchanged.

## 0.1.2 (2026-05-26)

Shell-portability patch (v0.x.1 bundle). See `docs/HANDOFF-shell-portability-v0x1.md` in the marketplace repo.

### Fixed
- **Shell portability (zsh compatibility):** Claude Code's Bash tool runs zsh by default on macOS; skill bodies referenced libs as prose ("call `lib/state.sh::csa_state_bootstrap_gitignore`") which Claude would otherwise source under zsh, where `${BASH_SOURCE[0]}` is unset and lib self-location crashed. Added `bin/csa` dispatcher with `#!/usr/bin/env bash` shebang — kernel forces bash on direct execution regardless of caller shell. `auditing-claude-configs/SKILL.md` prose references rewritten to explicit `csa <fn-suffix>` dispatcher invocations across the audit/focus/apply-fix/suppress paths. `csa --list` enumerates dispatchable functions. The dispatcher is auto-discoverable via `$PATH` (Claude Code adds each plugin's `bin/` to PATH automatically). claude-security-audit had the highest BASH_SOURCE volume in the plugin lineup (50 sites across 11 lib files) but the simplest skill-body refactor (zero literal `source` statements; pure prose-reference rewrites) and zero BASH_REMATCH risk (1 site, non-critical).

## 0.1.1 (2026-05-25)

Manifest schema fix — v0.1.0 failed installation due to plugin.json shape mismatch against Claude Code's marketplace schema. Three fixes:
- `author` changed from string `"Praveen Kumar Singh"` to object `{"name": "Pras"}` (schema requires object form, matching sibling plugins ai-mentor/architect-critic)
- Removed explicit `skills` array — auto-discovered from `skills/*/SKILL.md` by convention
- Removed explicit `commands` array — auto-discovered from `commands/*.md` by convention
- Added top-level `category: "security"` for marketplace categorization

No code or rule changes. All 182 tests still pass.

## 0.1.0 (2026-05-25)

First public release. Static-analysis security audit for Claude Code project configs and enabled plugins, inspired by AgentShield in Everything Claude Code (Mustafa, 2026; MIT). 28 rules across 7 aspects, 182 tests, ≤30s perf budget for ~200-file workloads. Zero ambient surface by default — SessionStart reminder ships opt-in only (T1-C). Two-flag auto-fix gated by 5-layer defense-in-depth (T2-H). Durable `finding_uid` survives whitespace edits (T2-I). Self-tamper detection on state files (T1-F). 5 clean-fixture release gate (D17) verified at zero findings.

### Phase 0 — Eval fixtures
- Plugin manifest (no hooks declared per T1-C opt-in pattern)
- Bash test harness skeleton (`_helpers.sh`, `run-tests.sh`) with accumulator-style exit propagation
- `.gitignore` override re-including `.claude/` fixtures vs contributor global gitignore
- 5 clean-set fixture projects (release-gate metric per SPEC D17)
- 8 issue-set fixture projects covering all 7 v0.1 aspects + dedicated PERM-005 schema-typo
- 15 fixture existence tests (full detection assertions deferred to Phase 7 e2e)

### Phase 1 — Skill body + references
- SKILL.md for auditing-claude-configs with rich description for natural-language matching
- references/threat-model.md (distilled from SPEC §4 + §6.3 enumerate algorithm)
- references/severity-rubric.md (5-tier + chat posture + GC)
- references/auto-fix-policy.md (two-flag system + safe-write allowlist + tamper detection + gitignore bootstrap)

### Phase 2 — Foundation libs
- `lib/helpers.sh`: csa_sha256 (cross-platform), csa_realpath (with macOS fallback), csa_sed_inplace (GNU/BSD), csa_mkdir_lock (atomic)
- `lib/redact.sh`: pattern-aware redaction for Anthropic/OpenAI keys, JWT, GitHub PAT family, AWS keys, base64 blobs; configurable length cap
- `lib/fingerprint.sh`: two-layer per T2-I — `csa_finding_uid` (durable, no line number) + `csa_dedup_fingerprint` (per-run); plugin-version-stripping
- `lib/severity.sh`: 5-tier rank + compare + validate
- 35 unit tests added (cumulative 50)

### Phase 3 — Orchestration libs
- `lib/enumerate-targets.sh` per §6.3 pinned algorithm (T2-J); local-dev fallback for marketplace operator dogfood
- `lib/rule-engine.sh` with SCANNER-001/002 High-severity emit (T2-G); banner aggregation for 3+ SCANNER-002
- `lib/state.sh` schema_version=2; findings registry keyed on finding_uid (T2-I); GC after 10-run absence (T2-K); self_integrity tamper detection (T1-F); first-audit gitignore bootstrap (T1-D)
- `lib/baseline.sh` NEW/PERSISTED tagging via finding_uid
- `lib/suppress.sh` with race-window refusal + Critical-cannot-suppress
- `lib/report-render.sh` chat+markdown per §8.4 with stable display_id
- `lib/apply-fix.sh` two-flag system (T2-H) + 5-layer defense-in-depth (rule re-validation, target re-resolution, symlink refusal, path-traversal refusal, atomic state log)
- 54 unit tests added (cumulative ~104)

### Phase 4 — Rule files (7 aspects, 28 rules)
- secrets/ (4): SECRETS-001 to 004
- permissions/ (5): PERM-001 to 005 including dedicated schema validation per T1-E
- hooks/ (4): HOOK-001 to 004 (common-pattern only; AST is v0.2)
- mcp/ (3): MCP-001 to 003
- claude-md/ (2): CLAUDE-MD-001 to 002
- prompt-injection/ (2): PROMPT-INJ-001 to 002 (common-pattern only; semantic-intent is v0.2)
- marketplace/ (2): MARKETPLACE-001 to 002
- _known-keys.txt allowlist for PERM-005
- 51 rule tests added (cumulative ~151)
- All 5 clean fixtures produce zero findings (D17 release gate verified)

### Phase 5 — Slash command wrappers
- /security-audit, /secrets-scan, /permissions-review, /apply-fix — all use $ARGUMENTS (per feedback_slash_command_dollar_n_bug)
- Wrappers route to skill modes; no dedicated unit tests (covered by Phase 7 e2e)

### Phase 6 — Opt-in hook + README + LICENSE
- hooks/session-start-reminder.sh shipped as file (NOT declared in plugin.json — T1-C invariant)
- README.md with ECC attribution + scope-honesty caveats + opt-in registration snippet
- LICENSE (MIT)
- 2 hook smoke tests (153 cumulative)

### Phase 7 — E2E integration tests + perf benchmark
- 4 core e2e test files (audit, apply-fix, suppress, baseline) against all 13 fixtures
- 4 adversarial e2e test files covering T1-F (tamper), T2-G (rule-load), T2-H (malicious-rule), T2-I (uid-stability) per SPEC §14.4
- Perf benchmark validates ≤10s ideal / ≤30s fail-threshold for ~200-file workload (17s on Mac Mini M-series — passes threshold, WARN on ideal)
- Release-gate metric: ZERO findings on all 5 clean fixtures asserted in test-e2e-audit.sh
- Integration bugs found and fixed: (1) enumerate-targets.sh scanned .claude/audits/ — excluded via -not -path filter; (2) rule-engine ran N×M subshell cross-product — restructured to batch targets per rule (csa_rule_run_many) with aspect-based pre-filtering; (3) _next_scratch pattern using $() subshell lost counter increments — fixed to use global _CSA_SCRATCH without $()
- 29 e2e/perf tests added (cumulative 182)
