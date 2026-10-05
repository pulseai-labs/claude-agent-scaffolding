# Changelog

All notable changes to the `autonomic` plugin.

## 0.1.0

**Autopilot as a mod** (#660). A session in autopilot keeps going without asks the planning already answered.

- **Mode** (`mode.ts`, `records.ts`): `AUTONOMIC_MODE=autopilot` per spawn or `/autopilot on [docs…]`; fails to manual; carried across a molt by molt's lineage file; a crew child takes its scope from its brief.
- **Policy** (`policy.ts`): `~/.claude/autonomic/policy.md`, written once, injected as a `session` system-prompt section.
- **Reflexes** (`register.tsx`): a cached fork at each turn end (covered, stalled, waiting, done, pain), at each `AskUserQuestion`, and at each permission ask; the never-approve list (`never.ts`) is code, before any fork; no deny is ever changed.
- **molt floor** (`floor.ts`): a `MOLT-HANDOFF:` line, a child's `handoff required`/`handed-off` status line, or a block beneath lets the turn end stand.
- **Ledger** (`ledger.ts`): one committed line per decision, with the fork's token usage; an unwritable ledger ends autopilot.
- **Pain**: band, toast, optional bell, optional `AUTONOMIC_PAIN_PATH` file.
