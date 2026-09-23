# dsh-crew

The crew for DeepSeek Harness (dsh). A spine session on the `crew-spine` preset runs
ossify's `run-spine <spine-id> --external-executor`: each work item goes to a configured
`subagent_implementer` child, is verified by a `subagent_verifier` child, gets one
correction on FAIL, and comes back as ossify's result record computed from git. ossify
state is the single authority; this plugin adds nothing to its contract, ships no lib, no
state and no commands.

## Skills

- `dsh-executor` — the round as a dsh spine session runs it: dispatch, collect, verify,
  one correction, compute the record, hand the round back. Mirrors ossify's
  `work-item/references/external-executor.md`; `references/records.md` quotes the records.
- `dsh-brief` — the implementer, verifier and correction prompts, and the two personas the
  child tools are configured with.

## Presets

`references/presets.md` is the copy source for the operator's dsh home: profile rows
(provider, custom skills root, permission preset, the two child tools) and the three
presets `crew-spine`, `crew-implementer`, `crew-verifier`. Installing them is machine
configuration, not this plugin's job.

## Requirements

- DeepSeek Harness (`@deepseek-ai/dsh`) with the web profile; the skills root includes
  this plugin's and ossify's skills (`skill-filesystem` `customSkillDirs`).
- ossify ≥ 1.8.0 (`run-spine --external-executor`) on the same skills root; `oss` on the
  bash tool's PATH.
- A provider the session can reach; the reference uses the local Ollama daemon route with
  `deepseek-v4.1-flash:cloud`.

## Tests

`bash dsh-crew/run-tests.sh` — frontmatter lint, fidelity pins, ossify contract parity
(against the sibling `ossify/` or `OSSIFY_ROOT`), presets YAML.
