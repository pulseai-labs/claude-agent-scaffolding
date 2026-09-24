# dsh-crew

The crew for DeepSeek Harness (dsh). A spine session on the `crew-spine` preset runs
ossify's `run-spine <spine-id> --external-executor`: each work item goes to a configured
`subagent_implementer` child, is verified by a `subagent_verifier` child, gets one
correction on FAIL, and comes back as ossify's result record computed from git. A round
can also stop for the operator: a second verifier FAIL or an unusable child return writes
no record, and the round is not handed back. ossify state is the single authority; this plugin adds nothing to its contract, ships no lib, no
state and no commands.

## Skills

- `dsh-executor` — the round as a dsh spine session runs it: resolve the roles, dispatch,
  collect, check each child's route, verify, one correction, compute the record, hand the
  round back; at close, the reviewer's second pass. Mirrors ossify's
  `work-item/references/external-executor.md`; `references/records.md` quotes the records.
- `dsh-brief` — the implementer, verifier, correction and reviewer prompts, and the two
  personas the child tools are configured with.
- `dsh-session` — for an orchestrator outside dsh: spawn a session through the web `/api` so
  it shows in the operator's browser, select its model, steer it, read its transcript for
  delivery, pending questions, turn end and context fill, and hand a spine to a successor.

## Presets

`presets/crew-spine` is the spine preset as files; copy the directory into
`~/.dsh/.agent-presets/`. `references/presets.md` is the rest of the operator's dsh home,
measured against dsh 0.1.5-rc.3: `~/.dsh/settings.yaml` as the one home for provider routes,
the web profile rows, a headless `crew` profile, browser access to the web UI, and the optional
Claude Code reviewer child. Installing them is machine configuration, not this plugin's job.

## Roles

Each project names the model for each crew role (implementer, verifier, reviewer) in
`.dsh-crew/roles.md` at its AI workspace root. `references/presets.md` §9 is the file's
contract. With no file, children run the driver's route and there is no reviewer pass.

## Requirements

- DeepSeek Harness `@deepseek-ai/dsh` **0.1.5-rc.3** (the `latest` tag, 0.1.5-rc.2, does
  not boot on a fresh install; `references/presets.md` §0 says why), started with
  `DSH_PERMISSION_MODE=danger-full-access` and the provider key in its environment.
- One flat skills root, `~/.local/share/dsh-crew/skills`, holding every skill directory of
  this plugin and of ossify (`skill-filesystem` `customSkillDirs` in the presets); symlinks
  into the plugin cache work. Beside it, `~/.local/share/dsh-crew/ossify-references` links to
  the installed ossify's `references/`, for the spine persona's hand-off and resume.
- ossify ≥ 1.8.0 on the same skills root; `oss` on the bash tool's PATH. ossify's
  `run-spine` is a command, not a skill: the `crew-spine` persona accepts
  `<spine-id> --external-executor` and follows the command's lane, the `work-item` skill's
  `references/round-orchestration.md`.
- A provider the session can reach, defined in `~/.dsh/settings.yaml`; the reference defines
  the local Ollama daemon route (`deepseek-v4.1-flash:cloud`), Z.AI and OpenCode Go.
- For `dsh-session`: a shell on the dsh host, `curl`, `zstd`, and `dsh web` running.

## Tests

`bash dsh-crew/run-tests.sh` — frontmatter lint, fidelity pins, ossify contract parity
(against the sibling `ossify/` or `OSSIFY_ROOT`), and the presets: the files, the reference's
YAML, and the facts a copy must not drift from.
