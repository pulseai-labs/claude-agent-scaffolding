# Changelog

All notable changes to the `dsh-crew` plugin.

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
