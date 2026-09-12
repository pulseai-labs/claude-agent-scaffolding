# claude-agent-scaffolding

Personal Claude Code and Codex plugin marketplace, plus an OpenCode adapter
bundle.

## Plugins

| Plugin | Version | Scope | Purpose |
|---|---|---|---|
| [`workspace-init`](./workspace-init/) | v0.5.0 | Project-level (run-once) | Bootstrap a dual-repo workspace (AI workspace + canonical) with pairing manifest, routed `well_known_paths`, and AI-trace commit-msg filter. Run-once plugin; first in the scaffolding chain. 3 skills (`initializing-dual-repo-workspace`, `pairing-canonical-repo`, `pairing-existing-dual`), 3 slash commands (`/init-workspace`, `/pair-workspace`, `/pair-existing-dual` via `$ARGUMENTS` bridge). Fresh repos explicitly initialize on `main`; `/init-workspace <name> --wrapper <dir>` supports an existing outer wrapper without touching its source material (#103). Pairing manifest schema v1.0 at `<ai-workspace>/.workspace/pairing.json`; `well_known_paths.roadmap_state` routes scaffold-onboard's structured roadmap for scaffold-dev field reads. Optional `tooling_repo` field routes `/defer --tooling` to a separate tooling repo (#48 Stage 2). Manifest `created_by` records the writing tool's version; `--ai-git-tracked` records a non-git AI workspace honestly; preflight rejects a linked-worktree canonical (#71). Scenario A migration (`--pair-with`). |
| [`ai-mentor`](./ai-mentor/) | v2.4.0 | User-level | Decision-making mentor. Four auto-invocable skills: `grill-me` (one-question-at-a-time plan interrogation with CORE posture + 4 cognitive-discipline escape valves), `council` (5-persona multi-angle idea validation, Karpathy LLM Council pattern with codebase-aware Historian), `eli10` (repeatable simplification), `fool` (sticky beginner's-mind mode). Skill-first; no hooks, no state machinery. `grill-me` and `council` open with an agent-driven "📍 You are here" orientation preamble (#88). |
| [`scaffold-onboard`](./scaffold-onboard/) | v0.13.0 | Project-level (run-once) | Onboarding plugin (skill-first). 9 skills + 5 slash commands. 10-phase guided conversation authors `MASTER-SPEC.md` with source-grounded audit traces, rejected alternatives, cross-cutting constraints, deep entity semantics, and a post-MVP horizon appendix (#104); derivation produces a 14-file memory-bank (ownership-classified: spec-derived · dev-authored · mixed, with a single-point update-cadence policy in `WORKFLOW.md`), tiered `CLAUDE.md`, managed Codex section in `AGENTS.md`, and governance docs. LLM-synthesis dispatch is verified-executable (behavioral harness); `EXECUTIVE-SUMMARY.md` is synthesized from MASTER-SPEC by a single authoritative producer (consumed, not refreshed, by `/scaffold-*`); an advisory read-only `derivation-reviewer` runs after the synthesis waves. Publishes a structured `project-roadmap.json` with 3-part `VS-N.M.K` ids and explicit `sprint_id` via workspace-init's routed `well_known_paths.roadmap_state`. Slice demos are agent-judged acceptance checks (#44). Seeds a lean tech-debt.md index for scaffold-dev's /defer loop (#33). Memory-bank templates document lean pointer conventions (DOC §anchor / ADR-NNNN / claude-mem) in `WORKFLOW.md` (#48 C/D/E). `WORKFLOW.md` also seeds a dialogue-session orientation convention so derived projects inherit oriented cognitive skills (#88). `/amend-spec` (`amending-spec`) folds a single change (new capability / hardening NFR) into an existing `MASTER-SPEC.md` for the post-MVP lifecycle — agent-driven classify → impact-analysis → targeted phase-section edit + `## Revision History` + SSoT `phase_record` fold, deferring whole-bundle re-derive to `/scaffold-docs` (#86 / SS-8). |
| [`scaffold-dev`](./scaffold-dev/) | v0.17.2 | Project-level (continuous) | Sprint-driven orchestrator-implementer workflow for dual-repo workspaces. 13 skills, 7 slash commands, Claude custom `implementer-agent` via Task, Codex worker-prompt dispatch guidance, handoff escape valve (`.workspace/handoffs/`), and cross-agent live-state lock/provenance helpers. Slice-close harvest routes only to dev-authored memory-bank files (never spec-derived ones) per the single cadence policy (#45). Field-reads scaffold-onboard's structured roadmap (`id` + `sprint_id`) and uses 3-part `VS-N.M.K` slice ids with sprint-namespaced worktrees. Opt-in pr_hierarchical merge mode (work-item → slice → sprint → main) with agent-driven PR gates. Adds /defer + blocker-recall (#33); `/defer --tooling` routes tech-debt to a tooling repo and offers `tech-debt` label auto-create (#48 Stage 2). Lean-index pointer resolution legs (doc-anchor + ADR) extend `verifying-spec-citations` (#48 C/D). Records a slice-start baseline so direct-mode review bundles get a real diff (#76); the vertical-slice SKILL bodies stay under a CI-guarded 500-line cap with reference-grade detail in `references/` (#77). The agent-driven pre-merge gate codifies a finding-disposition loop (P1 fixed pre-merge, P2 fix-or-defer via `/defer`) and reviewer-completeness detection so a silently-skipped reviewer (e.g. CodeRabbit on a non-default base) is never mistaken for approval (#82). Standalone `/work-pr <PR>` (`working-pull-request`) exposes that same gate as a slice-decoupled, **manifest-free** review-fix-merge loop runnable on any gh repo by whichever agent invokes it (Claude or Codex) — reusing the single `git-workflow.md` §7 contract, with `--repo-root` targeting added to the PR helpers (#92). Session handoffs carry 12 sections + a `Next-session focus` field with a References index and a Suggested-skills list, run a hybrid redaction pass (secret/PII candidate-surfacer + agent warn-and-confirm) before writing, and support an opt-in `--ephemeral` stdout mode for non-dual-repo / compaction handoffs (#38). |
| [`scaffold`](./scaffold/) | v1.0.0 | Project-level (continuous) | Implementation plugin. Slice-driven 5-phase workflow, living governance (ADRs, CHANGELOG, runbooks), per-repo memory bank with semantic search. 18 slash commands + 10 MCP tools. — DEPRECATED, replaced by scaffold-dev v0.1.0 |
| [`architect-critic`](./architect-critic/) | v0.6.0 | User-level | Anti-sycophancy reviewer (skill-first). 6 auto-invocable skills: `critiquing-spec` (audit + sequential rebuttal with T=4 concession scoring), `managing-async-critique` (background Codex audits: status/result/cancel/resume), `checking-adversary-readiness` (doctor), `reviewing-critique-history`, `listing-principles`, `promoting-principle`. Ships ghost-notes (Wald survivor-bias) + CORE protocol as default principles. Full auto-promotion (vote-recurrence T=4, instinct N=3, 30/90-day suppression). Codex 0.125+ adversarial fresh-frame at close-depth — synchronous OR async (defer-to-resume unified rebuttal, durable state.json v3 job memory). Standalone-invocable; consumer plugins invoke skills in-conversation (no file IPC). `critiquing-spec` opens with a "📍 You are here" orientation preamble (#88). |
| [`ossify`](./ossify/) | v1.8.0 | Project-level (continuous) | Skeleton-first replacement lifecycle for `scaffold-onboard` + `scaffold-dev` — install one lifecycle or the other, not both. Self-sufficient since 1.1.0: the grill and the adversarial critic ship in-tree as `challenge` (interview + audit modes, configurable external adversary via `OSSIFY_ADVERSARY`), so the bone grill gate, the spec-core audit, the release veto, and the spine close audits run with no ai-mentor or architect-critic install. 9 native skills (wayfinder, added at 1.2.0, charts a question into decision tickets on the issue tracker and works an existing map's frontier one ticket per session), an implementer subagent, and the standalone commands that run in any repository — `/ossify:handoff`, `/ossify:handoff-resume`, `/ossify:work-pr`, `/ossify:wayfinder`. The first three have no skill directory, so they are a Claude Code command surface only and the OpenCode bundle does not carry them (#131); `/ossify:wayfinder` is an entry skill as well as an any-repo one, so the bundle does expose it. Since 1.5.0 (#339) `/ossify:work-pr` is also the spine-close merge lane: a spine's hosting repos land on their base branches by PR where a remote exists, merged locally only where none does, and a release is a tag on the merged line. Since 1.6.0 (#139) impl-check gains Layer 4, a delegated three-lens semantic review at work-item close. Since 1.7.0 (#368), every bare doctor sweep reports the answering binary, loaded doctor body and expected version separately, then limits mismatch impact to ossify activity already evidenced in the session; unsupported Codex/OpenCode installed-reference resolution reports partial (#396, #399). Since 1.8.0, `/ossify:run-spine <id> --external-executor` is an optional provider-neutral execution seam — one `external_execution_request` per work item out, one `external_execution_result` back, the caller supplying the procedure — with a correction continuation that reuses the existing `complete` return and inline Layer 4 under that mode; the no-flag command is unchanged and still dispatches the nested implementer subagent. In the Claude and Codex marketplaces as of v1.0.0. The boundary audit is complete across 5 dimensions, and the consolidated eval covers all 10 acceptance scenarios — scenario 10 is a run rather than a standing fixture, and its second run agreed **5 of 5 with no divergence**, after the prose fixes its first run prompted (#250, #251). That is two runs on one scenario, not a measured property of the prose; #254 remains open over both. The two pilots are operator-owned and post-v1. OpenCode bundle installability begins only after an immutable bundle tag is published. |
| [`claude-security-audit`](./claude-security-audit/) | v0.1.4 | Project-level | Static-analysis security audit for Claude Code project configs and enabled plugins. 28 rules across 7 aspects (secrets, permissions incl. PERM-005 schema-typo, hooks, MCP, CLAUDE.md, prompt-injection, marketplace). Two-flag auto-fix + 5-layer defense-in-depth (T2-H). Durable `finding_uid` survives whitespace edits (T2-I). Self-tamper detection on state + suppressions (T1-F). Critical-cannot-suppress; 60s race-window refusal. Zero ambient surface — SessionStart reminder is opt-in (T1-C). 28 rules / 182 tests / 5 clean-fixture release gate. Inspired by ECC's AgentShield (MIT). |
| [`code-judo`](./code-judo/) | v0.1.0 | Project-level (on demand) | Strict quality review and architecture deepening. 4 prose skills, 4 slash commands, no runtime library. `deep-review` is a human-invoked maintainability audit of a diff or branch — the code-judo ambition standard (restructurings that *delete* complexity rather than rearrange it), the 1000-line rule with its waiver path, spaghetti-growth suspicion, wrapper/cast/boundary rules, a 7-tier prioritized output order, and a categorical approval bar with 6 presumptive blockers. It produces **one report and one disposition pass and never re-reviews its own fixes**, and its verdict is advisory rather than a merge gate. `deepen-architecture` scans a codebase for shallow modules using the deletion test, writes a single HTML report to the OS temp dir with before/after diagrams and `Strong` / `Worth exploring` / `Speculative` badges, opens it in the browser, and grills through the candidate you pick. `codebase-design` ships the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality), the four dependency categories, seam discipline, and design-it-twice. `domain-modeling` keeps the `CONTEXT.md` glossary where nothing else owns the project's vocabulary, and composes ADRs without filing them. No hard cross-plugin dependencies — the grilling step resolves softly to `ossify:challenge`, then `ai-mentor:grill-me`, then an in-plugin protocol. Not a correctness or security review of product code — `claude-security-audit` covers vulnerabilities in Claude and Codex *configuration*, which is a different target. Adapted from Cursor's thermo-nuclear code-quality review and Matt Pocock's improve-codebase-architecture (#382). |
| [`orca-crew`](./orca-crew/) | v0.4.0 | User-level | The orchestrator/worker session model over Orca orchestration. 1 prose skill, 1 slash command, no runtime library. One orchestrator session (`claude` on Fable, or `claude-sol`) keeps its context for decisions and dispatches everything else to GLM sessions launched by alias: `claude-glm` for planned work, `claude-glm-flash` for bounded work, one `claude-glm-flash` session running `/code-review` once per PR with findings returned through `worker_done`, the retained implementer working GitHub threads to zero, merge only on the operator's word. Since 0.2.0 a session budget of one implementer seat and one verifier seat per work item, work items carry a plan-time complexity class (`contract` → `claude-glm`, `bounded` → flash), verification is one all-claims brief per work item, new findings route through the orchestrator's disposition (#410), and corrections travel by message. Since 0.3.0 a spine this session just planned runs in three layers: the top ratifies one implementer/verifier profile per work item into an `orca-execution/v1` sidecar and starts **one** spine session, that session creates a child Run and owns both item terminals per item, and each item gets a fresh pair at its exact command, model and effort — no inherited-runtime subagent anywhere in that path, nested worker depth 2 required with no fallback, and the reviewer chosen only at the PR transition. Since 0.4.0 the spine session's own seat is a ratified sidecar block revalidated before every item launch, the first verifier failure sends one blocking ask with three options rather than being corrected silently, the close and every PR loop run in fresh sessions the top dispatches — only the top talks to the operator — and the record pass is single and conditional. Ships the role table, the thirteen-step run, and five brief templates plus a correction-request message, with six further briefs for the spine phase; defers every other Orca command to `orca skills get orchestration`. Composes with `ossify`: ceremonies stay in the orchestrator session, execution lanes are dispatched. |

Most of the marketplace is designed to **compose without overlap** — every plugin below except `ossify`, which is an alternate lifecycle rather than a stage in this one. Ordered by where they fire in the project lifecycle: `workspace-init` (chain head) bootstraps the dual-repo topology (AI workspace + canonical) and writes the pairing manifest every downstream plugin reads; `scaffold-onboard` runs once per project to author the source-of-truth spec, derive its scaffolding, and emit the R1/R2/R3 contract (roadmap hierarchy, machine-checkable rules, demo criteria) that `scaffold-dev` consumes; `scaffold-dev` owns the continuous sprint-by-sprint orchestrator-implementer workflow with a custom subagent type and handoff escape valve (superseding the deprecated `scaffold` v1.0.0); `architect-critic` provides anti-sycophancy reviews on demand or when invoked in-conversation by `scaffold-onboard v0.2+` / `scaffold-dev v0.1+` (no file IPC); `ai-mentor` provides decision-making mentor surfaces (interrogation, multi-angle validation, simplification, beginner's mind) at any point; `claude-security-audit` provides on-demand static-analysis review of project configs and enabled plugins; `code-judo` provides on-demand strict quality review and architecture deepening of product code, a distinct axis from `claude-security-audit`'s configuration scan and from `architect-critic`'s spec audit. Disjoint slash command namespaces and distinct state paths. `code-judo` reads `CONTEXT.md` and `docs/adr/`; the only file its flow writes is `CONTEXT.md`, and only where nothing else owns the project's vocabulary. It composes ADRs and hands filing to whichever plugin owns that directory, so it never writes into a sequence or a glossary another lifecycle already owns. `orca-crew` is not a lifecycle stage at all but a session layer: it says which session runs which command, composes with `ossify` by the seam in its SKILL §6, and does not address `scaffold-dev`, which is deprecated.

Ossify is an alternate replacement lifecycle for `scaffold-onboard` and
`scaffold-dev`, not another disjoint stage in that composition — the one
exception to the paragraph above. It is in the Claude and Codex
marketplaces as of v1.0.0: install ossify or the `scaffold-onboard` +
`scaffold-dev` pair, not both.

## Install

### Claude Code

```
/plugin marketplace add github:draco28/claude-agent-scaffolding
/plugin install workspace-init@claude-agent-scaffolding
/plugin install ai-mentor@claude-agent-scaffolding
/plugin install scaffold-onboard@claude-agent-scaffolding
/plugin install scaffold-dev@claude-agent-scaffolding
/plugin install scaffold@claude-agent-scaffolding
/plugin install architect-critic@claude-agent-scaffolding
/plugin install claude-security-audit@claude-agent-scaffolding
/plugin install code-judo@claude-agent-scaffolding
/plugin install orca-crew@claude-agent-scaffolding
```

`ossify` is an **alternative** to `scaffold-onboard` + `scaffold-dev`, not an
addition — install it instead of those two. `workspace-init` is **optional** for
ossify: `/ossify:start` and `/ossify:adopt` author `.ossify/topology.json`
themselves. Install it when you also want the dual-repo bootstrap and the
AI-trace commit-msg filter; ossify reads its `pairing.json` as a fallback.

```
/plugin install workspace-init@claude-agent-scaffolding
/plugin install ossify@claude-agent-scaffolding
```

### Codex v0

Codex support is dual-published from the same repo through
`.agents/plugins/marketplace.json`. The Codex marketplace exposes:

- `workspace-init`
- `ai-mentor`
- `scaffold-onboard`
- `scaffold-dev`
- `architect-critic`
- `claude-security-audit`
- `code-judo`
- `orca-crew`
- `ossify` (replaces `scaffold-onboard` + `scaffold-dev`; rounds are driven from
  Claude Code or OpenCode, which register the implementer subagent — Codex does
  not)

Deprecated and not ported: `scaffold`.

```
codex plugin marketplace add github:draco28/claude-agent-scaffolding
```

### OpenCode

OpenCode >=1.18.13 will load a pinned git-backed bundle containing
`workspace-init`, `ai-mentor`, and `architect-critic` by default after the first
release. Ossify is in the Claude and Codex marketplaces as of v1.0.0, but in
the OpenCode bundle it remains an explicit opt-in: bundle installability begins
only after an immutable bundle tag is published. `code-judo` and `orca-crew` are not in
the bundle at all — and because an unrecognised name in the plugin allowlist makes the
whole adapter config fail to load rather than skipping that one plugin, do not add them
to the tuple. `.opencode/INSTALL.md` carries the inventory that governs.

Task 7 validates the native export and options shapes with a direct `file://`
package spec. GitHub transport begins only after the first gated immutable
`bundle-v<semver>` tag is published. See [the OpenCode installation, trust,
update, and troubleshooting guide](./.opencode/INSTALL.md).

### Local Claude Code Development

```
/plugin marketplace add /home/pras/personal/claude-agent-scaffolding
/plugin install workspace-init@claude-agent-scaffolding
/plugin install ai-mentor@claude-agent-scaffolding
/plugin install scaffold-onboard@claude-agent-scaffolding
/plugin install scaffold-dev@claude-agent-scaffolding
/plugin install scaffold@claude-agent-scaffolding
/plugin install architect-critic@claude-agent-scaffolding
/plugin install claude-security-audit@claude-agent-scaffolding
/plugin install code-judo@claude-agent-scaffolding
/plugin install orca-crew@claude-agent-scaffolding
```

Ossify, instead of `scaffold-onboard` + `scaffold-dev`:

```
/plugin install ossify@claude-agent-scaffolding
```

### Local Codex Development

```
codex plugin marketplace add /home/pras/personal/claude-agent-scaffolding
```

## Quick start with `scaffold`

```
cd <your-project>
/scaffold-init                 # bootstrap LICENSE, .gitignore, README, CLAUDE.md, docs/
/slice-new my-first-slice      # start a slice
# ... edit the spec file's acceptance criteria ...
/slice-contract                # gate-checks ACs, advance to contract phase
/slice-scaffold                # advance to scaffold phase (write skeletons)
/slice-implement               # advance to implement phase
/slice-verify                  # run tests; mark complete on green
/adr-new "decide caching strategy"
/changelog Added "user authentication"
/changelog bump 0.1.0
/scaffold-worktree-fork alt-approach    # parallel branch with forked state
```

The MCP memory bank exposes `record_decision`, `record_pattern`, `record_note`, `record_retrospective`, `recall`, `list_recent`, `get_by_id`, `update`, `delete`, `reindex` as MCP tools — usable via natural language ("record a decision about caching strategy"), or directly in tool-calling contexts.

## Quick start with `ai-mentor`

All four skills auto-invoke on natural-language triggers — no slash command required. Examples:

```
"grill me on this plan"            # → grill-me (one question at a time, walks the tree)
"council me on this idea"          # → council (5 personas attack from different angles)
"explain in simpler terms"         # → eli10 (re-explain at 10-year-old level; repeatable)
"consider me a beginner here"      # → fool (sticky beginner's-mind mode for the conversation)
```

Slash commands are also available as explicit handles when you want to be unambiguous:

```
/grill-me <plan or design>
/council <idea or decision>
/eli10 [topic]
/fool
```

Don't run `/grill-me` and `/council` in the same session — different interaction shapes (1-question interactive vs 5-voices one-shot); pick one.

## Layout

```
.
├── .claude-plugin/marketplace.json    # Claude Code marketplace manifest
├── .agents/plugins/marketplace.json   # Codex v0 marketplace manifest
├── .opencode/                          # OpenCode adapter, runtime, and install guide
├── package.json                        # OpenCode bundle package contract
├── workspace-init/                    # workspace-init plugin (v0.5.0)
├── ai-mentor/                         # ai-mentor plugin (v2.4.0)
├── scaffold-onboard/                  # scaffold-onboard plugin (v0.13.0)
├── scaffold-dev/                      # scaffold-dev plugin (v0.17.2)
├── scaffold/                          # scaffold plugin (v1.0.0)
├── architect-critic/                  # architect-critic plugin (v0.6.0)
├── claude-security-audit/             # security-audit plugin (v0.1.4)
├── ossify/                            # skeleton-first replacement lifecycle (v1.8.0)
├── code-judo/                         # code-judo plugin (v0.1.0)
├── orca-crew/                         # orca-crew plugin (v0.4.0)
├── docs/
│   ├── SPEC-ai-mentor.md              # ai-mentor spec (v1.1 amendments)
│   ├── SPEC-scaffold.md               # scaffold spec (v1.0 amendments)
│   ├── SPEC-scaffold-onboard.md       # scaffold-onboard spec (v0.1)
│   ├── PLAN-scaffold-onboard.md       # scaffold-onboard implementation plan (v0.1)
│   └── archive/SPEC-v1.md             # historical 5-plugin design (pre-pivot)
├── README.md
└── LICENSE
```

## Platforms

Linux and macOS. Windows is deferred for all plugins (would require porting bash to PowerShell and the MCP launcher script).

`scaffold`'s MCP memory bank requires Python 3.11+ at install time and (optionally) Ollama running for semantic search. Falls back to FTS5 keyword search when Ollama is unavailable.

## License

MIT — see [`LICENSE`](./LICENSE).
