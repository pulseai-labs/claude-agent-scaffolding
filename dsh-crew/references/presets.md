# Presets and profile rows for dsh-crew

Copy source for the operator's dsh home. Nothing here is loaded by this plugin; the dotfiles
session installs it. Validate every row against the installed dsh with
`dsh --profile web --dump-config-schema` before use: field names below were read from
`deepseek-ai/deepseek-harness` master on 2026-09-22 (`@deepseek-ai/dsh` 0.1.6-alpha.2) and
the pinned release may differ.

## 1. Profile patch rows — `~/.dsh/profiles/web/cordis.patch.yml`

The provider (the local Ollama daemon route today's seats use), the custom skills root,
the default permission preset, and the subagent seam with two configured child tools.

```yaml
- id: llm-pi-ai
  config:
    providers:
      ollama-local:
        api: anthropic-messages
        baseURL: http://127.0.0.1:11434/v1
        apiKeyEnv: OLLAMA_API_KEY
        reasoning: max
        models:
          - id: deepseek-v4.1-flash:cloud
            input: [text, image]
            reasoningEfforts:
              off:
              low: low
              medium: medium
              high: high
              max: max
- id: skill-filesystem
  config:
    customSkillDirs:
      - /home/dev/.local/share/dsh-crew/skills
- id: permission-presets
  config:
    defaultPreset: danger-full-access
- insert:
    - id: subagent
      name: '@deepseek-ai/dsh-subagent'
    - id: subagent-spawn
      name: '@deepseek-ai/dsh-subagent-spawn-in-process'
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
          deny: [subagent_implementer, subagent_verifier, plugin_manager]
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
          deny: [subagent_implementer, subagent_verifier, plugin_manager, str_replace_editor]
```

If the web profile already mounts `@deepseek-ai/dsh-subagent` and the spawn provider (the
dump-config shows their rows), drop those two rows from the `insert` and keep the two tool
rows.

## 2. `~/.dsh/.agent-presets/crew-spine/agent.cordis.yml`

The spine session. Everything the shipped `standard` preset has, plus the two child tools.

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You drive one ossify spine inside DeepSeek Harness, powered by {{model}}. When the
      operator invokes run-spine, load the `run-spine` skill and follow it; execute each
      round through the `dsh-executor` skill; never edit ossify state except through `oss`;
      never commit and never push. ossify state is the single authority.
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
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
      deny: [subagent_implementer, subagent_verifier, plugin_manager]
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
      deny: [subagent_implementer, subagent_verifier, plugin_manager, str_replace_editor]
```

The child-tool rows appear both here and in §1: keep the ones the installed dsh honours
(preset rows are the intended home; the profile rows are the fallback if presets cannot
mount tool instances on this release) and delete the other, so a tool name is registered
once.

## 3. `~/.dsh/.agent-presets/crew-implementer/agent.cordis.yml`

For a human running one item by hand. Same rows as `crew-spine` without the child tools
and without the `planning` group; the persona is the `subagent_implementer` persona above.

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
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
```

## 4. `~/.dsh/.agent-presets/crew-verifier/agent.cordis.yml`

Read-only tool set: no `tool-fs` write path is mounted (`tool-fs` is omitted; `tool-fs-search`
stays), no editor.

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
- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
```
