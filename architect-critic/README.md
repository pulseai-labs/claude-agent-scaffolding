# architect-critic

Anti-sycophancy reviewer plugin for Claude Code and Codex (skill-first). Six gerund-named skills auto-invoke on natural-language triggers: `critiquing-spec` runs a host-agent self-audit followed by sequential adversarial rebuttal with T=4 concession scoring, `managing-async-critique` tracks background async audits (status / result / cancel / resume), `checking-adversary-readiness` verifies the external adversary before a deep critique, `reviewing-critique-history` surfaces recent run summaries, `listing-principles` renders the merged principle set, and `promoting-principle` adds a principle manually. Ships two shipped-default principles — ghost notes (Wald survivor-bias: look for what is *absent*) and CORE protocol (Curiosity / Objectivity / Reassurance / Empathy rebuttal tone) — read from `templates/principles.md` at audit time. Principle promotion is manual, via `/promote-principle`. At `--close` depth, the plugin dispatches the other agent as the adversarial fresh-frame reviewer: Codex when hosted in Claude Code, Claude Code when hosted in Codex. Standalone-invocable; consumer plugins (`scaffold-onboard v0.2+`, `scaffold-dev v0.1+`) invoke `critiquing-spec` in-conversation with no file IPC.

## Install

```
/plugin install architect-critic@claude-agent-scaffolding
```

## Quick start

Shallow audit (claude-self-audit only):

```
/critique
```

Close audit (claude-self-audit + Codex 0.125+ fresh-frame adversary):

```
/critique --close
```

When installed in Codex, close-depth audits invert the adversary: Codex runs the
host-agent audit and invokes Claude Code CLI for the fresh-frame pass when
`claude` is installed.

Audit a specific spec file:

```
/critique --spec docs/SPEC-payments.md
```

All six skills also auto-invoke on natural-language triggers — no slash command required:

```
"critique my spec"                   # → critiquing-spec
"critique jobs" / "resume critique"  # → managing-async-critique
"check adversary readiness"          # → checking-adversary-readiness
"show my recent critiques"           # → reviewing-critique-history
"what principles are in use?"        # → listing-principles
"add a principle about rollbacks"    # → promoting-principle
```

## Skills (6)

| Skill | Trigger phrases (examples) | What it does |
|---|---|---|
| `critiquing-spec` | "critique my spec", "audit this plan", "review this design", "run a critique" | Discovers spec file, runs claude-self-audit, optional Codex fresh-frame, sequential rebuttal per challenge, appends run to state.json |
| `managing-async-critique` | "critique jobs", "resume critique", "cancel critique audit", "check critique job" | Background async audits: status, result, cancel, resume (resume consolidates the finished Codex result with the persisted host self-audit and runs one unified rebuttal) |
| `checking-adversary-readiness` | "check adversary readiness", "is codex ready", "critique doctor" | Verifies the external adversary is installed, authenticated, and schema-capable; advisory, never blocks |
| `reviewing-critique-history` | "show recent critiques", "critique list", "what did the last audit find", "history of critiques" | Renders recent runs from state.json with challenge counts, concession tallies, skills invoked |
| `listing-principles` | "what principles are in use", "show my principles", "list my principles", "principles-list" | Renders shipped + user-global + project-scoped + memory-bank principles, merged last-wins |
| `promoting-principle` | "add a principle", "promote this principle", "record a principle about X", "add to principles.md" | Validates text, routes to user-global or project scope, appends a `<!-- source: user-promoted, promoted_at: …, principle_id: … -->`-annotated entry, records the promotion in state.json |

## Slash commands (6)

| Command | Args | Delegates to |
|---|---|---|
| `/critique` | `[--close] [--spec PATH]` | `critiquing-spec` skill |
| `/critique-jobs` | `<status\|result\|cancel\|resume> [run-id]` | `managing-async-critique` skill |
| `/critique-doctor` | _(none)_ | `checking-adversary-readiness` skill |
| `/critique-list` | `[--limit N]` | `reviewing-critique-history` skill |
| `/promote-principle` | `"<text>" [--scope user\|project]` | `promoting-principle` skill |
| `/principles-list` | `[--source all\|shipped\|user\|project]` | `listing-principles` skill |

All commands use `$ARGUMENTS` env-var bridge exclusively — no `$1`/`$2` bare positionals.

## Shipped principles

Two principles ship as defaults in `templates/principles.md`. Audits read them from the plugin's own template file — nothing is copied into your principles file at install or first run:

**Ghost notes** — drawn from Abraham Wald's WWII survivor-bias insight: when auditing a spec, look not just at what is present but for what is *absent*. The missing cases, the unspecified failure modes, the undocumented assumptions — these are the ghost notes. A design that only addresses the visible is incomplete.

**CORE protocol** — sets the rebuttal-cycle tone: Curiosity (ask before assuming), Objectivity (score the argument, not the author), Reassurance (challenge the design, not the person), Empathy (acknowledge when the concern was legitimate even if conceded). Applied by Claude during the sequential rebuttal phase.

## Principle promotion

Promotion is manual. When an audit surfaces a pattern worth keeping, add it yourself:

```
/promote-principle "Always specify cancellation propagation in retry policies"
```

`/promote-principle "<text>"` writes to `~/.claude/architect-critic/principles.md` (user-global) by default, or `.claude/architect-critic/principles.md` (project-scoped) with `--scope project`. Each promotion is recorded in `state.json` under `principle_promotions[]` for dedup.

## Standalone use

`architect-critic` works in any Claude Code session without `scaffold-onboard` or any other plugin installed.

**Spec file discovery order:**

1. Explicit `--spec PATH` argument.
2. Workspace-init manifest `well_known_paths.master_spec` (if workspace-init is installed).
3. Restricted glob: `SPEC*.md` or `PLAN*.md` in the project root (never a bare `*.md` sweep).
4. `AskUserQuestion` fallback — Claude asks you to identify the spec file.

**Storage locations:**

- `~/.claude/architect-critic/state.json` — run history, concession records, promotion records, async job records. (Under `$CLAUDE_PLUGIN_DATA` when that env var is set.)
- `~/.claude/architect-critic/principles.md` — user-global principles (your additions; shipped defaults stay in the plugin's `templates/principles.md`).
- `.claude/architect-critic/principles.md` — project-scoped principles (optional; created by `/promote-principle --scope project`).

**Invoking with an explicit path:**

```
/critique --spec /abs/path/to/SPEC-foo.md
```

or pass a relative path from the project root:

```
/critique --spec docs/SPEC-payments.md --close
```

## What `project_class=unknown` means

If a workspace-init manifest is present and reports `project_class: unknown`, the critic falls back to **generic principles only** — project-class-specific heuristics (e.g., API-design rules for `project_class: api-service`, or migration-safety rules for `project_class: data-pipeline`) are not applied.

This is expected when workspace-init could not determine the project type during bootstrapping. Two options to resolve:

1. **Add detection rules to workspace-init** — update its classifier so future bootstraps detect the class.
2. **Author project-scoped principles** — run `/promote-principle "<text>" --scope project` to add heuristics manually; these are always applied regardless of `project_class`.

The `project_class=unknown` state is logged in the skill output ("Project class: unknown — using generic principles only") so it is visible without inspecting the manifest.

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `ARCHITECT_CRITIC_CODEX_TIMEOUT_S` | `180` | Seconds before codex fresh-frame is killed and claude-only fallback is used |

Principles merge order (later sources win on a normalized duplicate):

1. `templates/principles.md` inside the plugin (shipped defaults — always present)
2. `~/.claude/architect-critic/principles.md` (user-global)
3. `.claude/architect-critic/principles.md` (project-scoped)
4. The file `$ARCHITECT_CRITIC_MEMORY_BANK_PATH` points at (memory-bank patterns, opt-in)

## Migrating from v0.1.x

See [CHANGELOG.md](./CHANGELOG.md) for the full breaking-changes list.

On first run after upgrading, `lib/migration.sh` runs automatically:

- Backs up `state.json` → `state.json.v0.1.3.bak` (timestamped on collision).
- Moves `inbox/` and `outbox/` directories to `legacy-v0.1.x/` (no data is deleted).
- Prepends ghost-notes + CORE shipped defaults to `principles.md`, preserving all existing user content below the defaults block.

No manual steps required. If anything looks wrong after migration, restore from the `.bak` file and open an issue.

## Composition

`scaffold-onboard v0.2+` and `scaffold-dev v0.1+` invoke `critiquing-spec` in-conversation — Claude calls the skill directly, no file IPC. This is the v0.2 contract: consumer plugins pass context through the conversation turn, not through inbox/outbox JSON files.

**v0.1.x `scaffold-onboard` is incompatible with `architect-critic v0.2`.** The v0.1.x onboard plugin writes to an inbox directory that no longer exists. Upgrade scaffold-onboard to v0.2+ before using architect-critic v0.2.

## Development

Run the suite (all unit + integration tests under `tests/`):

```bash
bash run-tests.sh
```

Run LLM-as-judge evals (requires an active Claude Code session):

```
See tests/eval/RUNBOOK.md
```

## See also

- Design spec: [`docs/SPEC-architect-critic.md`](../docs/SPEC-architect-critic.md)
- Implementation plan: [`docs/PLAN-architect-critic.md`](../docs/PLAN-architect-critic.md)
- Composition contract: [`docs/SPEC-scaffold-onboard.md`](../docs/SPEC-scaffold-onboard.md) §8.3

## Platforms

macOS and Linux. Windows deferred (matches sibling plugins).

## License

MIT
