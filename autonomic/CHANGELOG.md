# Changelog

All notable changes to the `autonomic` plugin.

## 0.1.1

**The pilot patch** (#677). Built on the live pilot of 0.1.0, run under bypass permissions.

- **molt's stage file** (F12; `floor.ts`, `records.ts`): the turn end is molt's when
  `~/.claude/state/molt/stage/<id>` says `command`, `block` or `fallback`; `yieldAtPercent` is
  only the fallback when no stage file exists, and a stage of `off` turns the fallback off. A
  live fill at or above the file's `command` yields too, whatever the hook order.
- **The bypass floor** (`register.tsx`): in autopilot, an `allow` for a command that matches an
  enabled never-approve rule becomes an `ask`, so the operator gets the dialog under bypass
  permissions too (probe P14). Manual mode never touches an allow; a deny is never changed.
  A failure inside the floor keeps the call with the operator. The reader now lists an
  interpreter, a git global it cannot skip, or an inline git alias as unreadable when the
  command names a danger, and reads an abbreviated long option as the option it abbreviates;
  an escaped, quote-split or brace word is unreadable, an `rm -r` path with a brace or a dot
  glob is outside, `--repo` names the remote, and `@` is `HEAD`; a wildcard destination may be
  the default branch, refspecs after `--` are checked, and `git -C` into another directory
  reads the branch as unknown, as does a `cd` below the root; wrappers such as `setsid` are
  runners, a short-flag cluster splits up to its value, and `send-pack`/`http-push` are
  unreadable. A session that leaves autopilot through a failure keeps the floor until
  `/autopilot off`. Credentials are redacted from the ledger and every pain signal.
- **`neverApprove`** (`config.ts`, `enforce.ts`): a `/config` setting naming the enforced rules,
  all six by default; empty means none; an unknown name is reported and ignored.
- **A deny beneath rings** (F7): a deny from a plugin beneath autonomic's `tool.call` hook rings
  "hard deny" once per session, tool and reason — except molt's own gate deny past its block
  stage.
- **Texts** (F2, F4, F5, F8, F9, F10, F13): `/autopilot status` drops the doubled prefix and lists
  policy `default`/`edited`, the settings, the enabled rules and molt's stage; one log line per
  fork; no doubled period before "Proceed."; the pain text leads with the line that matched; the
  `molt` ledger reason reads `molt owns this turn end`.
- **Docs** (F1, F3, F6, F11): no `/plugin configure` step is needed; the record's `source`
  values; a "Permission modes" section, bypass first.

## 0.1.0

**Autopilot as a mod** (#660). A session in autopilot keeps going without asks the planning already answered.

- **Mode** (`mode.ts`, `records.ts`): `AUTONOMIC_MODE=autopilot` per spawn or `/autopilot on [docs…]`; fails to manual; carried across a molt by molt's lineage file; a crew child takes its scope from its brief.
- **Policy** (`policy.ts`): `~/.claude/autonomic/policy.md`, written once, injected as a `session` system-prompt section.
- **Reflexes** (`register.tsx`): a cached fork at each turn end (covered, stalled, waiting, done, pain), at each `AskUserQuestion`, and at each permission ask; the never-approve list (`never.ts`) is code, before any fork; no deny is ever changed.
- **molt floor** (`floor.ts`): a `MOLT-HANDOFF:` line, a child's `handoff required`/`handed-off` status line, or a block beneath lets the turn end stand.
- **Ledger** (`ledger.ts`): one committed line per decision, with the fork's token usage; an unwritable ledger ends autopilot.
- **Pain**: band, toast, optional bell, optional `AUTONOMIC_PAIN_PATH` file.
- **Hard floors** (final review): `AskUserQuestion` and `ExitPlanMode` are never approved by the permission reflex; the never-approve list reads short-flag clusters, a lone `&`, block keywords, `-o` values, and lists any command it cannot follow when that command names a danger; it applies to every tool with a `command` input; a call too long to show the fork stays an ask; past `yieldAtPercent` (65) every turn end is molt's whatever the hook order; read-only Bash is no change for the loop guard; a free-text question and a failed ledger ring.
