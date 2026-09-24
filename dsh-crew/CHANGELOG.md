# Changelog

All notable changes to the `dsh-crew` plugin.

## 0.3.1

The verifier runs the driver's route, because 0.3.0's `crew-spine` could not run a spine.

- **Only `subagent_implementer` is model-selectable.** dsh 0.1.5-rc.3 registers at most one
  selectable child tool per composition, and 0.3.0 made both rows selectable, so its
  sessions had **no `subagent_verifier`**, silently. The verifier row drops
  `modelSelectionSettings` and runs the driver's own route and effort. `maxDepth: 1` and the
  `edit`/`write` deny stay. The headless profile's rows match.
- **`roles.md`'s verifier row is `| verifier | driver | (driver) |`, or it is absent.** Any
  other value stops the round at `dsh-executor` §2 step 0, naming the row. A file written for
  0.3.0 with a literal verifier route therefore stops until that row reads `driver`.
- **`dsh-executor`:**
  - §2 step 0 first checks both child tools exist, and the `crew-spine` persona runs its
    checks before run-spine's first mutation and before a continuation reconciles, so a
    stale preset or an unusable file stops with nothing changed;
  - §3a finds each child exactly, by `$DSH_SESSION_ID` (under `DSH_HOME`), the child's
    `parentSession` and the catalog label, and compares a verifier with the driver's own
    route;
  - §7 reports every child's route;
  - §9 resolves `roles.md` before close's first step. A defect that bears on the reviewer
    asks the operator whether close runs without the pass, and a no halts as
    `halted: roles`, never `close-review`.
- **`dsh-brief` §1 and §3:** the verifier call names no route.
- **`dsh-session` §3:** `workspace/archiveSession`, the only way to remove a session from the
  UI (the transcript stays on disk).
- **Suite:**
  - exactly one selectable child row per composition, and it is `subagent_implementer`; no
    other row in any block, the profile-level reviewer included, is selectable;
  - the example implementer effort is checked against the model's `reasoningEfforts`;
  - the example verifier row is `driver`.

**Upgrading.** Copy `presets/crew-spine/` into `~/.dsh/.agent-presets/` again, and re-apply
`references/presets.md` §5's rows to a headless `crew` profile. Coming from
0.2.0, also delete `crew-implementer/` and `crew-verifier/` from `~/.dsh/.agent-presets/`. A
stale preset fails like this:
- a 0.2.0 `crew-spine` has no `list_subagent_models`, so a `roles.md` stops at §2 step 0;
- a 0.3.0 `crew-spine` has no `subagent_verifier`, and 0.3.1's §2 step 0 now stops on that
  with a message.

## 0.3.0

A model per crew role, chosen per project; and a reviewer child at close.

- **The two child tool rows are model-selectable** (`modelSelectionSettings: true`), so each
  call may name a `provider`, `model` and `reasoning_effort` from the allow-list. Their
  recursion guard moves from `toolFilter` to `maxDepth: 1`, because a selectable tool is not a
  global tool and a filter naming it fails the child at start (spike 5). The headless
  profile's rows match.
- **The by-hand `crew-implementer` and `crew-verifier` presets are retired.** A spine's
  children never used them. Run one item by hand in `crew-spine` ("execute work item <id>"
  reaches the `work-item` skill), or in `standard` with the skills root. Delete them from
  `~/.dsh/.agent-presets/` by hand (see 0.3.1's upgrade note).
- **`.dsh-crew/roles.md`** (`references/presets.md` §9): one row each for `implementer`,
  `verifier` and `reviewer`; child routes from the `settings.yaml` allow-list; the reviewer
  `claude-code`, `codex` or `driver`. No file keeps 0.2.0's behaviour.
- **`dsh-executor` routes and checks them.** §2 step 0 resolves the file at each round start
  and stops before the first dispatch on a row the session cannot honour. Every child call
  copies its row's route, and §3a checks the route each child actually ran on from its own
  transcript; a difference is the stop rule. The records stay ossify's, with no route field.
- **The reviewer's second pass at close** (`dsh-executor` §9): one `subagent_reviewer` call per
  hosting repo over the spine diff, its findings added to close's and dispositioned under
  close's rules. ossify's own close review is unchanged and never delegated.
- **`dsh-brief` §6, the reviewer prompt**, returning a JSON array of `file`, `line`,
  `severity`, `claim` and a final `MODEL:` line; §1–§4 say route fields are copied, never
  chosen.
- **The reviewer is a profile-level tool** (`references/presets.md` §8): `subagent_reviewer`
  over `dsh-subagent-claude-code`, mounted in the web profile's patch, not the preset. Its
  model is pinned there and self-reported in the reply.
- Tests: selectable rows carry `maxDepth: 1` and no `toolFilter` names them; the headless
  child rows equal `crew-spine`'s; `crew-spine` is the only shipped preset; the example
  `roles.md` has one row per role and allow-listed routes.

## 0.2.0

What a four-item spine needed to run end to end from the web UI (two rounds, a hand-off and
a close), carried back into the plugin.

- **Presets ship as files.** `presets/crew-{spine,implementer,verifier}/` hold each preset's
  `agent.cordis.yml` and `preset.yml`, ready to copy into `~/.dsh/.agent-presets/`. The
  skills root is a `!!js` expression over `process.env.HOME`, so the files carry no user name.
  `references/presets.md` §2–§4 now point at them.
- **The `crew-spine` persona** gains the clauses that run's close depended on: continuing a
  halted spine from its recorded state, `/close <spine-id>`, handing off at a persisted round barrier
  through ossify's `handoff/compose.md`, and resuming through `resume.md`. It also keeps every
  `ask_user_question` short and posts the detail as a chat message first. A long card in the
  web UI hides its options and Submit button.
- **`dsh-executor` names `references/records.md` as its own.** A spine session resolved the
  bare path against ossify's `work-item/` and had to search for it.
- **New skill `dsh-session`**, for an orchestrator outside dsh. It covers login, spawning a
  session through the web `/api` where the UI shows it, `selectModel` on every spawn, steer
  (never queue) to a running driver, changing a queued message, and reading delivery, pending
  questions, turn end and context fill from the transcript. It also covers handing a spine to
  a successor session. Every call is one POST, so it is prose, not a client.
- **`references/presets.md` operations sections:** `~/.dsh/settings.yaml` as the one home for
  routes (Ollama, Z.AI, OpenCode Go; `reasoning: max`, the OpenCode session header,
  hand-declared models, the allow-list's `NO_ADAPTER` rule, `busyEnter: steer`). It also covers
  browser access over `tailscale serve` with `--trusted-host`, and an optional Claude Code
  review child (`dsh-subagent-claude-code`, measured in a test profile). The web and headless
  profile patches no longer carry routes.
- Tests: `test-presets-yaml.sh` covers the preset files, the HOME-relative skills root, the
  headless profile's persona against `crew-spine`'s, and every allow-listed route against the
  routes `settings.yaml` defines.

## 0.1.0

First release. Two prose skills for a DeepSeek Harness spine session running ossify's
`run-spine --external-executor` — `dsh-executor` (dispatch, collect, verify, one
correction, result record from git, hand back) and `dsh-brief` (child prompts and
personas) — plus `references/presets.md`, the copy source for the `crew-spine`,
`crew-implementer` and `crew-verifier` presets and the profile rows. Tests: frontmatter
lint, fidelity pins, ossify contract parity, presets YAML.
