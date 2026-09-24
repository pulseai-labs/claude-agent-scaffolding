# Presets and profile rows for dsh-crew

The operator's dsh home, composed from this plugin. Nothing here is loaded by the plugin
itself; the operator installs it. Measured against **`@deepseek-ai/dsh` 0.1.5-rc.3**: the
profile patches with `dsh --profile <name> --dump-config` and a booted run, the presets through
the web app's own preset discovery, and the whole set through one four-item spine run end to end
from the web UI on 2026-09-23 and 2026-09-24 (two rounds, a hand-off and a close).

| What | Where it lives | Section |
|---|---|---|
| Provider routes, the default model, the child-model allow-list, the composer | `~/.dsh/settings.yaml` | §6 |
| Host settings for the web profile | `~/.dsh/profiles/web/cordis.patch.yml` | §1 |
| The spine preset | `presets/crew-spine/` in this plugin → `~/.dsh/.agent-presets/crew-spine/` | §2 |
| A headless spine session | `~/.dsh/profiles/crew/cordis.patch.yml` | §5 |
| Reaching the web UI from another machine | `tailscale serve` + the unit's flags | §7 |
| An optional Claude Code review child | a profile plugin + two rows | §8 |
| Which model fills each crew role, per project | `.dsh-crew/roles.md` in the AI workspace | §9 |

## 0. Before the rows

- **Pin 0.1.5-rc.3** (npm tag `next`): `npm install -g --prefix ~/.local
  @deepseek-ai/dsh@0.1.5-rc.3`. The `latest` tag (0.1.5-rc.2) does not boot on a fresh
  install: its launcher allows `@deepseek-ai/cordis@^4.0.2`, npm resolves 4.0.4, and
  `dsh-sandbox-local` (pinned to 4.0.2) fails with "cannot create effect on inactive context".
  0.1.5-rc.3 pins cordis 4.0.2 exactly.
- **Environment.** The service or shell that starts dsh needs `DSH_HOME`, every key named by an
  `apiKeyEnv` in §6 (`OLLAMA_API_KEY`, `ZAI_API_KEY`, `OPENCODE_API_KEY` for the routes shown),
  and `DSH_PERMISSION_MODE=danger-full-access`. The last one is not optional: dsh derives both
  the sandbox mode and the approval policy from it, and without it approval is `ask`, so a
  headless session stalls on its first tool call with nobody to answer. Keep these in a
  mode-600 environment file, never in a repo. `dsh web` reads it only at start, so a new key
  needs one restart.
- **The skills root** (`customSkillDirs` in the presets) must hold every skill directory of
  **both** ossify and dsh-crew, flat, as `<root>/<skill>/SKILL.md`. The spine persona and every
  implementer load ossify's `work-item`, and the executor loads `dsh-executor` and `dsh-brief`.
  dsh follows symlinks, so links into the installed plugins' versioned cache directories
  (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>`) are enough;
  re-link after a plugin update. The presets name the root as
  `~/.local/share/dsh-crew/skills`, through a `!!js` expression over `process.env.HOME`, so the
  files carry no user name.
- **ossify's references, linked.** The spine persona's hand-off and resume clauses read
  `handoff/compose.md` and `handoff/resume.md` from `~/.local/share/dsh-crew/ossify-references`,
  which must be a link to the installed ossify's `references/` directory (the highest installed
  version). ossify's handoff procedures are a command's references, not a skill, so the skills
  root does not carry them. Re-link after an ossify update, as with the skills.
- **How the rows compose.** The web profile disables the model-facing tools at host level and
  each preset turns them on for its own sessions; the subagent seam (`subagent`, the `spawn`
  provider) is already mounted. So the web profile patch carries only host settings (§1),
  routes live once in `settings.yaml` (§6), and everything a session sees (persona, tools,
  skills root, the two child tools) lives in the preset (§2). A child joins its parent's
  composition minus its `toolFilter`, takes its persona from its tool row, and runs its
  parent's route unless the call names one (both crew child tools are selectable; §6).

## 1. Web profile patch — `~/.dsh/profiles/web/cordis.patch.yml`

The default permission preset, and a bash timeout long enough for test suites and `oss` (the
shipped default is 60 s). No provider rows: routes and the default model are in §6.

```yaml
- id: permission
  config:
    defaultPreset: danger-full-access
- id: bash-sandbox
  config:
    timeoutMs: 600000
```

The permission row's id is `permission`.

## 2. The spine preset — `presets/crew-spine/` in this plugin

A directory with an `agent.cordis.yml` (the composition) and a `preset.yml` (the picker's name
and description). Install it by copying the directory to `~/.dsh/.agent-presets/crew-spine/`,
and copy it again after a plugin update. The file is complete as shipped: the skills root is
the only machine path in it, and it is resolved from `HOME`.

It is the shipped `standard` preset with its persona replaced, the skills root set, and its
delegation group reduced to the two configured child tools plus the subagent control tools
(no generic `subagent`, `subagent_fork`, `workflow` or `ralph`, so every child is one of the
two). Its persona:
- runs a spine;
- continues a halted spine from its recorded state (ossify cannot resume one itself);
- runs `/close`;
- hands off and resumes through ossify's handoff procedures;
- keeps every `ask_user_question` short, with the detail posted as a chat message first.

It commits only where ossify's lane and close tell it to; its children never commit.

**The two child rows are model-selectable** (`modelSelectionSettings: true`): each call may
name a `provider`, `model` and `reasoning_effort` from the allow-list in §6, and the driver
takes them from the project's `roles.md` (§9). Because a selectable tool is not a global tool,
no `toolFilter` may name it: a filter that does fails the child at start. Recursion is stopped
by `maxDepth: 1` on both rows instead, which dsh enforces on every start, whoever calls. The
verifier's `toolFilter` still removes `edit` and `write`.

## 3–4. Retired in 0.3.0

0.2.0 shipped `crew-implementer` and `crew-verifier` for a human running one item by hand. A
spine's children never used them. Run one item by hand in `crew-spine` ("execute work item
<id>" reaches the `work-item` skill), or in `standard` with the skills root.

## 5. The headless `crew` profile — a spine run with no browser

`dsh --profile crew --from-default-profile headless` creates a profile over dsh's headless
bundle, which has no preset roster. This patch (`~/.dsh/profiles/crew/cordis.patch.yml`) gives
it §1's rows and the `crew-spine` composition, so `dsh --profile crew "<task>"`, run from the
AI workspace with the environment above, is a one-shot spine session that prints its final
answer and exits 0 only on a completed turn. **It cannot ask.** The first well-formed gap ends
the run, so a spine with any chance of a gap belongs in the web UI.

```yaml
- id: permission
  config:
    defaultPreset: danger-full-access
- id: bash-sandbox
  config:
    timeoutMs: 600000
# ── the crew-spine composition, for a headless run (no preset roster in this profile) ──
- id: system-prompt
  config:
    personaSuffix: Your working directory is {{cwd}}.
    personaPrefix: >-
      You drive one ossify spine inside DeepSeek Harness, powered by {{model}}. When the
      operator asks you to run a spine, accept exactly `<spine-id> --external-executor` and
      refuse anything else before any mutation, as ossify's run-spine command does; then
      read the `work-item` skill's references/round-orchestration.md end to end and follow
      it with that spine id, executing each round through the `dsh-executor` skill. Never
      edit ossify state except through `oss`. Commit, merge and push only where ossify's
      lane and close tell you to; your children never commit. ossify state is the single
      authority. One exception exists because run-spine cannot resume a halted spine
      (ossify issue 133): when the operator asks you to continue `<spine-id>` from its
      recorded state, do not cut the spine branch and do not halt on it already existing;
      stay parked on it. Reconcile first from ossify state, each spawned item's handoff and
      the spine's round records files. Re-issue each item whose last record is a gaps
      record and whose handoff has since gained a `## Clarifications` dispatch as one
      single-item request, per the `work-item` skill's references/external-executor.md §5b,
      through `dsh-executor`; close what is accepted as round-orchestration.md says; then
      run the remaining rounds, spawning only items that have no worktree and taking each
      handoff's `base_branch` from that repo's existing handoffs' `base_branch:` lines, never
      from HEAD and never from SPINE.md's planned base; a hosting repo with no handoff yet
      has no recorded base, so ask the operator for the branch its spine branch was cut from
      before authoring that handoff. If the recorded state does not reconcile cleanly, stop
      and ask the operator before any mutation. When the lane has ended and the operator or orchestrator asks
      you to close a spine (`/close <spine-id>`), load the `close` skill and follow it
      for that spine id, including every walk it hands to the operator. When told to
      hand off, stop at the next persisted round barrier — after `dsh-executor` has written
      the round's records file and handed the round back, or before a round's first
      dispatch, never mid-round, where an accepted result may exist only in your context —
      then read compose.md in the `handoff/`
      directory of ~/.local/share/dsh-crew/ossify-references (expand ~ to your home
      directory) end to end and follow it; if it commits, commit only the handoff file,
      never the spine's other uncommitted records. Report the handoff's path, and stop.
      When told to resume from a handoff, read that directory's resume.md end to end and
      follow it, then continue under the continuation rule above. Keep every
      ask_user_question short: a one-line question and short option labels. Post any
      detail the operator needs as a chat message first, then ask, because a long
      question card hides its options and its Submit button.
      Child routes come from `.dsh-crew/roles.md`, as the `dsh-executor` skill's §2 step 0
      says; at close, its §9 adds the reviewer's pass.
- id: skill-filesystem
  config:
    customSkillDirs:
      - !!js "`${process.env.HOME}/.local/share/dsh-crew/skills`"
- id: tool-subagent
  disabled: true
- id: tool-subagent-fork
  disabled: true
- id: tool-workflow
  disabled: true
- id: tool-ralph
  disabled: true
- insert:
    - id: tool-subagent-implementer
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_implementer
        modelSelectionSettings: true
        maxDepth: 1
        persona: |
          You are ossify's work-item executor. Load the `work-item` skill with the skill tool as
          your first action; it is your binding system prompt. One handoff in, one JSON return out.
          You never commit.
    - id: tool-subagent-verifier
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_verifier
        modelSelectionSettings: true
        maxDepth: 1
        persona: |
          You are the crew's verifier for one ossify work item. Load the `dsh-brief` skill and
          follow its verifier prompt as sent to you: read the spec, the handoff, the report and the
          staged worktree; run the declared checks; return PASS or FAIL with the failing claims
          named. You change no file and you never commit.
        toolFilter:
          deny: [edit, write]
```

The persona is the `crew-spine` preset's, word for word; the suite checks it.

## 6. `~/.dsh/settings.yaml` — the one home for routes

Shared by every profile under `~/.dsh` (web, crew, headless, any test profile) and
live-reloaded: an edit takes effect on the next request, with no restart. Put **every** route
here and in no profile patch. A profile boots on this file alone: an empty patch gets these
routes and this default model.

```yaml
llm-pi-ai:
  providers:
    ollama-local:
      displayName: Ollama (local daemon)
      api: anthropic-messages
      baseURL: http://127.0.0.1:11434
      apiKeyEnv: OLLAMA_API_KEY
      reasoning: max
      models:
        - id: deepseek-v4.1-flash:cloud
          name: DeepSeek V4.1 Flash (Ollama Cloud)
          input: [text, image]
          contextWindow: 1048576
          maxTokens: 384000
          reasoningEfforts:
            off:
            low: low
            medium: medium
            high: high
            max: max
    zai:
      displayName: Z.AI Coding Plan
      apiKeyEnv: ZAI_API_KEY
      reasoning: max
      api: openai-completions
      baseURL: https://api.z.ai/api/coding/paas/v4
      models:
        - id: glm-5.3-flash
        - id: glm-5.3-flashx
          name: GLM-5.3-FlashX
          input: [text, image]
          contextWindow: 1000000
          maxTokens: 131072
          compat:
            supportsStore: false
            supportsDeveloperRole: false
            supportsReasoningEffort: true
            maxTokensField: max_tokens
            thinkingFormat: zai
          reasoningEfforts:
            low: low
            high: high
            max: max
        - id: glm-5.3
        - id: glm-5.3-highspeed
        - id: glm-5.2
        - id: glm-5.2-highspeed
        - id: glm-5-turbo
        - id: glm-4.7
    opencode-go:
      displayName: OpenCode Go
      apiKeyEnv: OPENCODE_API_KEY
      reasoning: max
      api: openai-completions
      baseURL: https://opencode.ai/zen/go/v1
      headers:
        x-opencode-session: dsh-<host>
      models:
        - id: deepseek-v4.1-flash
          name: DeepSeek V4.1 Flash (OpenCode Go)
          input: [text]
          contextWindow: 1000000
          maxTokens: 384000
          compat:
            supportsStore: false
            supportsDeveloperRole: false
            maxTokensField: max_tokens
            requiresReasoningContentOnAssistantMessages: true
            thinkingFormat: deepseek
            supportsReasoningEffort: true
          reasoningEfforts:
            off:
            low: low
            high: high
            max: max
        - id: deepseek-v4-flash
        - id: deepseek-v4-pro
        - id: glm-5.3-flash
        - id: glm-5.3
subagent-model-selection:
  enabled: true
  allowedModels:
    - { provider: ollama-local, model: "deepseek-v4.1-flash:cloud" }
    - { provider: opencode-go, model: deepseek-v4.1-flash }
    - { provider: zai, model: glm-5.3-flash }
    - { provider: zai, model: glm-5.3-flashx }
    - { provider: zai, model: glm-5.3 }
agent-default-model:
  provider: ollama-local
  model: deepseek-v4.1-flash:cloud
  reasoningEffort: max
ui-conversation:
  busyEnter: steer
```

What each part is for, and what breaks without it:

- **`reasoning: max` on every route.** It is the effort used when a session or child names
  none. Without it pi-ai sends `thinking: {type: disabled}` for Z.AI models, so the UI's
  "default" effort means no thinking at all.
- **A `models` list replaces the route's catalog.** Every entry that names a catalog model
  takes its unset fields from the catalog, so list the ones you want by id. A model newer than
  dsh's catalog (here `glm-5.3-flashx` and `deepseek-v4.1-flash`) is declared by hand with its
  wire settings, and **then the route needs `api` and `baseURL` of its own**, or dsh refuses
  the config (`INVALID_CONFIG`). Delete `models` to get the whole catalog back.
- **`opencode-go` needs `x-opencode-session`.** OpenCode Go answers 400 `MissingSessionID`
  without it, pi-ai never sends it, and dsh offers no session-affinity switch. So it is one
  static value per host, and every dsh session on that host shares one OpenCode routing
  session. DeepSeek there also needs `compat.supportsReasoningEffort: true`, or only
  thinking on/off travels, never the level.
- **`baseURL` for `anthropic-messages` has no `/v1`.** pi-ai's client appends `/v1/messages`
  itself, and `…/v1` answers 404. `contextWindow` and `maxTokens` are set because an
  undescribed model falls back to a 262,144-token window and compacts early.
- **The allow-list names routes every profile must know.** A profile whose tools can pick a
  child model has to resolve every allow-listed route, or it fails at boot with `NO_ADAPTER`.
  That is why routes live here and nowhere else. Never drop a route the allow-list still
  names. The allow-list does nothing for a tool row that does not set
  `modelSelectionSettings: true`. Both crew child tools set it, so a child call may name any
  allow-listed route; a call that names none runs its parent's route.
- **`busyEnter: steer`.** Plain Enter while the agent is busy steers (lands at the next step
  boundary) instead of queueing for the end of the turn, and Cmd/Ctrl+Enter does the opposite.
  dsh's default is queue, and a spine is one long turn, so a queued message can wait hours.
- **The UI writes this file only from a loopback page.** Settings > Models and > General edit
  it and keep its comments, but over any non-loopback address they report the settings as
  unavailable. Edit it by hand, or open the UI through `ssh -N -L 13080:127.0.0.1:3080
  <host>` at `http://localhost:13080/`.

## 7. Browser access — the web UI from another machine

The operator watches and answers every spine session in the web UI, so the UI has to be
reachable from wherever the operator is. On a tailnet:

- `tailscale serve --bg --https=8443 http://127.0.0.1:3080` publishes the loopback server to
  the tailnet only (any free port; 443 may already be taken).
- The unit's `dsh web` command line gets `--trusted-host <machine>.<tailnet>.ts.net:8443`, one
  per authority the browser uses. Without it the `/api` fence answers 403, which is checked
  before authentication (401 means unauthenticated). A new authority needs its own flag.
- `dsh web` logs `dsh web: http://127.0.0.1:3080/?token=…` at every start. The token is random
  per process and cannot be pinned. Opening `https://<authority>/?token=…` once mints a cookie
  that is signed with the persistent secret in `~/.dsh/.credentials.yaml`, bound to that
  authority, and valid for 30 days across restarts, so afterwards the bare URL is enough.
  **The token is a credential**: fetch it on the machine that opens it, and never paste it into
  a chat, a log or a commit. After a restart the server needs a few seconds before `/` stops
  answering 404.
- Sessions spawned through `/api` appear in the UI's workspace at once. A plain headless
  `dsh --profile crew` session does not: it is written to disk but never registered, so it is
  invisible there. Start spine sessions in the UI, or through `/api` (the `dsh-session` skill).

## 8. Optional — a Claude Code review child

`@deepseek-ai/dsh-subagent-claude-code` runs Claude Code, through its SDK and under the host
user's own Claude Code login, as a child tool of a dsh session. It is measured in a test
profile only, and **not yet run from `crew-spine`**. There, a Sonnet child reviewed a closed
spine's diff, and its top three findings matched ones the spine's PR review and close audit had
found independently. The child keeps no transcript (`persistSession: false`). Its model was
confirmed by calling the same SDK's `query()` and reading `result.modelUsage`
(`claude-sonnet-5`).

- **Install** into a profile: `dsh plugin --profile <name> add
  @deepseek-ai/dsh-subagent-claude-code@0.1.5-rc.3`. `dsh plugin` forwards to **pnpm**. Where
  pnpm is missing, a PATH shim works: a `pnpm` script containing `exec npx -y pnpm@10 "$@"`
  (corepack 0.24 cannot run pnpm 12). Check that the profile's `package.json` lists the package
  under `dsh.profile.bundles`.
- **Rows** in that profile's patch: the provider's settings, and one tool instance over it.

```yaml
- id: subagent-claude-code
  config:
    model: sonnet
    permissionMode: auto
- insert:
    - id: tool-subagent-claude
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: claude-code
        toolName: subagent_claude_code
        backgroundMode: one-shot
        maxDepth: provider-managed
```

The model is pinned on the provider row: Claude Code takes no per-call dsh route, so a review
child's model is fixed here, not chosen by the caller.

## 9. Roles — `.dsh-crew/roles.md`

The project's choice of model for each crew role. It lives at the root of the AI workspace.
The orchestrator writes it at spine planning, and the operator approves it. The driver's own
route is not here: whoever starts the driver chooses it (an orchestrator's agent entry, or the
operator in the UI).

```markdown
## Roles

| Role | Route | Effort |
|---|---|---|
| implementer | zai/glm-5.3-flashx | max |
| verifier | ollama-local/deepseek-v4.1-flash:cloud | max |
| reviewer | claude-code | (pinned) |
```

- **One row per role**: `implementer`, `verifier`, `reviewer`, and nothing else. There are no
  conditions and no second row.
- **Implementer and verifier** routes are `provider/model` exactly as §6 defines them, and each
  must be in §6's allow-list. Effort is one of that model's `reasoningEfforts`.
- **Reviewer** is `claude-code` or `codex` (the `subagent_reviewer` tool from §8, whose model
  is pinned in the profile), or `driver` for no second pass. The driver can check only that the
  tool exists. The operator checks, when approving the file, that the profile's pinned provider
  matches the row.
- **No file** means the 0.2.0 behaviour: children run the driver's route, and there is no
  reviewer pass. **No row** means the same for that role.
- A row the session cannot honour stops the round before its first dispatch (the
  `dsh-executor` skill, §2 step 0). A successor re-reads the file, so routes survive a
  hand-off.
