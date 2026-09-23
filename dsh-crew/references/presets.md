# Presets and profile rows for dsh-crew

Copy source for the operator's dsh home. Nothing here is loaded by this plugin; the operator
installs it. Every block below was composed and run against **`@deepseek-ai/dsh` 0.1.5-rc.3**
on 2026-09-23: the profile patches with `dsh --profile <name> --dump-config`, the presets
through the web app's own preset discovery, and the `crew` profile through a full round of one
(request record → implementer child → verifier child → accepted result record).

## 0. Before the rows

- **Pin 0.1.5-rc.3** (npm tag `next`): `npm install -g --prefix ~/.local
  @deepseek-ai/dsh@0.1.5-rc.3`. The `latest` tag (0.1.5-rc.2) does not boot on a fresh
  install: its launcher allows `@deepseek-ai/cordis@^4.0.2`, npm resolves 4.0.4, and
  `dsh-sandbox-local` (pinned to 4.0.2) fails with "cannot create effect on inactive context".
  0.1.5-rc.3 pins cordis 4.0.2 exactly.
- **Environment.** The service or shell that starts dsh needs `DSH_HOME`, the provider key
  named by `apiKeyEnv` below (`OLLAMA_API_KEY`), and `DSH_PERMISSION_MODE=danger-full-access`.
  The last one is not optional: dsh derives both the sandbox mode and the approval policy from
  it, and without it approval is `ask` — a headless session then stalls on its first tool call
  with nobody to answer. Keep these in a mode-600 environment file, never in a repo.
- **The skills root** (`customSkillDirs` in the presets) must hold every skill directory of
  **both** ossify and dsh-crew, flat — `<root>/<skill>/SKILL.md` — because the spine persona
  and every implementer load ossify's `work-item`, and the executor loads `dsh-executor` and
  `dsh-brief`. dsh follows symlinks, so links into the installed plugins' versioned cache
  directories (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>`) are
  enough; re-link after a plugin update.
- **How the rows compose.** The web profile disables the model-facing tools at host level and
  each preset turns them on for its own sessions; the subagent seam (`subagent`, the `spawn`
  provider) is already mounted. So the web profile patch carries only the route and host
  settings (§1), and everything a session sees — persona, tools, skills root, the two child
  tools — lives in the preset (§2–§4). A child joins its parent's composition, minus its
  `toolFilter`.

## 1. Web profile patch — `~/.dsh/profiles/web/cordis.patch.yml`

The provider route, the default model for fresh sessions, the default permission preset, and a
bash timeout long enough for test suites and `oss` (the shipped default is 60 s).

```yaml
- id: llm-pi-ai
  config:
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
- id: agent-default-model
  config:
    provider: ollama-local
    model: deepseek-v4.1-flash:cloud
- id: permission
  config:
    defaultPreset: danger-full-access
- id: bash-sandbox
  config:
    timeoutMs: 600000
```

`baseURL` has no `/v1`: pi-ai's `anthropic-messages` client appends `/v1/messages` itself, and
`…/v1` answers 404. The permission row's id is `permission`. `contextWindow` and `maxTokens`
are set because an undescribed model falls back to a 262,144-token window and compacts early.

## 2. `~/.dsh/.agent-presets/crew-spine/agent.cordis.yml`

The spine session: the shipped `standard` preset with its persona replaced, the skills root
set, and its delegation group reduced to the two configured child tools plus the subagent
control tools (no generic `subagent`, `subagent_fork`, `workflow` or `ralph`, so every child
is one of the two). The spine session itself runs ossify's close — which commits and merges —
so its persona forbids commits outside the lane, not commits as such; the children never
commit.

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You drive one ossify spine inside DeepSeek Harness, powered by {{model}}. When the
      operator asks you to run a spine, accept exactly `<spine-id> --external-executor` and
      refuse anything else before any mutation, as ossify's run-spine command does; then
      read the `work-item` skill's references/round-orchestration.md end to end and follow
      it with that spine id, executing each round through the `dsh-executor` skill. Never
      edit ossify state except through `oss`. Commit, merge and push only where ossify's
      lane and close tell you to; your children never commit. ossify state is the single
      authority.

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - /home/<user>/.local/share/dsh-crew/skills

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'

- id: command-goal
  name: '@deepseek-ai/dsh-command-goal'

- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'

- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'
      config:
        section: |
              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

              Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

              The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

              Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

              Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

              When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.

- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

- id: delegation
  name: cordis:group
  group: true
  config:
    - id: tool-subagent-control
      name: '@deepseek-ai/dsh-tool-subagent-control'
    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
    - id: tool-subagent-implementer
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_implementer
        persona: |
          You are ossify's work-item executor. Load the `work-item` skill with the skill tool as
          your first action; it is your binding system prompt. One handoff in, one JSON return out.
          You never commit.
        toolFilter:
          deny: [subagent_implementer, subagent_verifier]
    - id: tool-subagent-verifier
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_verifier
        persona: |
          You are the crew's verifier for one ossify work item. Load the `dsh-brief` skill and
          follow its verifier prompt as sent to you: read the spec, the handoff, the report and the
          staged worktree; run the declared checks; return PASS or FAIL with the failing claims
          named. You change no file and you never commit.
        toolFilter:
          deny: [subagent_implementer, subagent_verifier, edit, write]
- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
    searchTimeoutMs: 60000

- id: present
  name: '@deepseek-ai/dsh-tool-present'
```

Beside it, `preset.yml` (the picker's display name):

```yaml
name: crew spine
description: Drives one ossify spine; executes rounds through dsh-executor with two configured child tools.
```

## 3. `~/.dsh/.agent-presets/crew-implementer/agent.cordis.yml`

For a human running one item by hand: `standard` with the implementer persona and the skills
root, and no delegation group.

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are ossify's work-item executor, powered by {{model}}. Load the `work-item` skill
      with the skill tool as your first action; it is your binding system prompt. One handoff
      in, one JSON return out. You never commit.

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - /home/<user>/.local/share/dsh-crew/skills

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'

- id: command-goal
  name: '@deepseek-ai/dsh-command-goal'

- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'

- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'
      config:
        section: |
              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

              Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

              The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

              Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

              Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

              When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.

- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
    searchTimeoutMs: 60000

- id: present
  name: '@deepseek-ai/dsh-tool-present'
```

`preset.yml`:

```yaml
name: crew implementer
description: ossify work-item executor, for running one item by hand.
```

## 4. `~/.dsh/.agent-presets/crew-verifier/agent.cordis.yml`

The same shape with the verifier persona. Read-only by its prompt, not by its tool set: `bash`
stays because the verifier's claim N builds a disposable copy, and dsh 0.1.5-rc.3's `tool-fs`
has no read-only mode. The `subagent_verifier` child that the spine session starts is
tighter — its `toolFilter` removes `edit` and `write`.

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are the crew's verifier for one ossify work item, powered by {{model}}. Load the
      `dsh-brief` skill and follow its verifier prompt: read the spec, the handoff, the report
      and the staged worktree; run the declared checks; return PASS or FAIL with the failing
      claims named. You change no file and you never commit.

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - /home/<user>/.local/share/dsh-crew/skills

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'

- id: command-goal
  name: '@deepseek-ai/dsh-command-goal'

- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'

- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'
      config:
        section: |
              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

              Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

              The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

              Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

              Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

              When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.

- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
    searchTimeoutMs: 60000

- id: present
  name: '@deepseek-ai/dsh-tool-present'
```

`preset.yml`:

```yaml
name: crew verifier
description: Verifier for one ossify work item; read-only by its prompt.
```

## 5. The headless `crew` profile — a spine run with no browser

`dsh --profile crew --from-default-profile headless` creates a profile over dsh's headless
bundle, which has no preset roster. This patch (`~/.dsh/profiles/crew/cordis.patch.yml`) gives
it §1's rows and the `crew-spine` composition, so `dsh --profile crew "<task>"` — run from the
AI workspace, with the environment above — is a one-shot spine session that prints its final
answer and exits 0 only on a completed turn.

```yaml
- id: llm-pi-ai
  config:
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
- id: agent-default-model
  config:
    provider: ollama-local
    model: deepseek-v4.1-flash:cloud
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
      authority.
- id: skill-filesystem
  config:
    customSkillDirs:
      - /home/<user>/.local/share/dsh-crew/skills
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
        persona: |
          You are ossify's work-item executor. Load the `work-item` skill with the skill tool as
          your first action; it is your binding system prompt. One handoff in, one JSON return out.
          You never commit.
        toolFilter:
          deny: [subagent_implementer, subagent_verifier]
    - id: tool-subagent-verifier
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent_verifier
        persona: |
          You are the crew's verifier for one ossify work item. Load the `dsh-brief` skill and
          follow its verifier prompt as sent to you: read the spec, the handoff, the report and the
          staged worktree; run the declared checks; return PASS or FAIL with the failing claims
          named. You change no file and you never commit.
        toolFilter:
          deny: [subagent_implementer, subagent_verifier, edit, write]
```
