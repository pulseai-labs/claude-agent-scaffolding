# dsh-crew

The crew for DeepSeek Harness (dsh). A spine session on the `crew-spine` preset runs
ossify's `run-spine <spine-id> --external-executor`: each work item goes to a configured
`subagent_implementer` child, is verified by a `subagent_verifier` child, gets one
correction on FAIL, and comes back as ossify's result record computed from git. A round
can also stop for the operator: a second verifier FAIL or an unusable child return writes
no record, and the round is not handed back. ossify state is the single authority; this plugin adds nothing to its contract, ships no lib, no
state and no commands.

## Skills

- `dsh-executor` — the round as a dsh spine session runs it: dispatch, collect, verify,
  one correction, compute the record, hand the round back. Mirrors ossify's
  `work-item/references/external-executor.md`; `references/records.md` quotes the records.
- `dsh-brief` — the implementer, verifier and correction prompts, and the two personas the
  child tools are configured with.

## Presets

`references/presets.md` is the copy source for the operator's dsh home, measured against
dsh 0.1.5-rc.3: the web profile rows (provider route, default model, permission preset, bash
timeout), the three presets `crew-spine`, `crew-implementer`, `crew-verifier`, and a headless
`crew` profile that runs a spine from a shell with no browser. Installing them is machine
configuration, not this plugin's job.

## Requirements

- DeepSeek Harness `@deepseek-ai/dsh` **0.1.5-rc.3** (the `latest` tag, 0.1.5-rc.2, does
  not boot on a fresh install; `references/presets.md` §0 says why), started with
  `DSH_PERMISSION_MODE=danger-full-access` and the provider key in its environment.
- One flat skills root holding every skill directory of this plugin and of ossify
  (`skill-filesystem` `customSkillDirs` in the presets); symlinks into the plugin cache work.
- ossify ≥ 1.8.0 on the same skills root; `oss` on the bash tool's PATH. ossify's
  `run-spine` is a command, not a skill: the `crew-spine` persona accepts
  `<spine-id> --external-executor` and follows the command's lane, the `work-item` skill's
  `references/round-orchestration.md`.
- A provider the session can reach; the reference uses the local Ollama daemon route with
  `deepseek-v4.1-flash:cloud`.

## Tests

`bash dsh-crew/run-tests.sh` — frontmatter lint, fidelity pins, ossify contract parity
(against the sibling `ossify/` or `OSSIFY_ROOT`), presets YAML.
