# Install The OpenCode Bundle

The OpenCode adapter is distributed as one pinned, git-backed package. Its
bundle version is independent of the versions of the source plugins it
contains.

The `bundle-v0.1.0` value below is an example release tag, not a claim that the
tag is already published. Installation starts only after that immutable tag is
published. At that point, replace the example with the published tag you have
reviewed.

## Requirements

- OpenCode >=1.18.13 on macOS or Linux. Windows is unsupported.
- Bash 3.2 or newer, Git, `jq`, Node.js, and the standard `awk`, `sed`,
  `mktemp`, `shasum`, and `find` command-line tools used by the canonical
  plugins and diagnostics below.
- Architect Critic's synchronous close-depth foreground path requires an
  installed and authenticated Codex CLI >=0.125. The default shallow path does
  not require it.
- OpenCode async additionally requires a compatible `codex-companion.mjs`.
  Resolve it with `ARCHITECT_CRITIC_CODEX_COMPANION` set to an absolute path or
  from the canonical OpenAI Codex Claude-plugin cache. The root bundle does not
  ship a compatible live companion; its packaged test shim is not supported for
  live use. `/critique-doctor` and a live compatibility smoke are required
  before async use. An explicit async request that fails preflight stops with
  remediation and never falls back to foreground. Synchronous
  `/critique --close` remains an option when the companion is unavailable.

## Default Installation

Add the plain pinned GitHub package spec to the native `plugin` array in the
user config at `~/.config/opencode/opencode.json` or a project's
`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "github:draco28/claude-agent-scaffolding#bundle-v0.1.0"
  ]
}
```

Restart OpenCode after saving the config. The default enables only
`workspace-init`, `ai-mentor`, and `architect-critic`.

## Ossify Opt-In

Ossify is not among the default three. To opt in, use OpenCode's native
`[specifier, options]` tuple and the exact four-name allowlist:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "github:draco28/claude-agent-scaffolding#bundle-v0.1.0",
      {
        "plugins": [
          "workspace-init",
          "ai-mentor",
          "architect-critic",
          "ossify"
        ]
      }
    ]
  ]
}
```

Restart OpenCode after changing the options. Ossify is in the Claude and Codex
marketplaces as of v1.0.0; in this bundle it stays an explicit opt-in.

## Plugins This Bundle Does Not Carry

**The allowlist accepts only the names in the inventory below, and neither
`code-judo` nor `orca-crew` is one of them.** They ship to the Claude and Codex
marketplaces but are deliberately not in the OpenCode bundle yet.

Adding a name the bundle does not carry does not produce a helpful error. The adapter
throws `Unknown OpenCode plugin: <name>` from its config hook, OpenCode catches
config-hook errors (see the diagnostics below), and `opencode debug config` can still
exit 0 — with every skill, command, and alias from **every** selected plugin missing
from resolved config. One unknown name silently disables the whole bundle, not just
that plugin.

If skills vanish after a config change, check the allowlist against the inventory
first and read the ERROR log for the unknown-name line.

## Native Skills And Commands

OpenCode discovers the package's canonical skills lazily and exposes every
selected skill as a same-name native slash command. The complete inventory is:

| Plugin | Availability | Native commands |
|---|---|---|
| `workspace-init` | Default | `/initializing-dual-repo-workspace`, `/pairing-canonical-repo`, `/pairing-existing-dual` |
| `ai-mentor` | Default | `/grill-me`, `/council`, `/eli10`, `/fool` |
| `architect-critic` | Default | `/critiquing-spec`, `/reviewing-critique-history`, `/listing-principles`, `/promoting-principle`, `/checking-adversary-readiness`, `/managing-async-critique` |
| `ossify` | Opt-in | `/start`, `/adopt`, `/plan-spine`, `/work-item`, `/close`, `/plan-release`, `/doctor`, `/challenge`, `/wayfinder` |

## Differing Aliases

Same-name native commands do not receive extra aliases. The package adds only
these nine aliases, where the existing command name differs from its skill:

| Alias | Native skill |
|---|---|
| `/init-workspace` | `initializing-dual-repo-workspace` |
| `/pair-workspace` | `pairing-canonical-repo` |
| `/pair-existing-dual` | `pairing-existing-dual` |
| `/critique` | `critiquing-spec` |
| `/critique-list` | `reviewing-critique-history` |
| `/principles-list` | `listing-principles` |
| `/promote-principle` | `promoting-principle` |
| `/critique-doctor` | `checking-adversary-readiness` |
| `/critique-jobs` | `managing-async-critique` |

Ossify's native skills drive its lifecycle. Work-item execution can dispatch
the registered `ossify-implementer-agent` subagent through OpenCode's `task`
tool or an explicit `@ossify-implementer-agent` mention. The subagent inherits
the invoking model and cannot nest another task.

The canonical worker prompt/transcript contract forbids Git commit, push, pull,
and fetch anywhere in its Bash tool-call log; that prohibition is unchanged.
The package pre-hook audits the full literal command text and rejects direct or
normalized literal Git forms, unknown or alias-capable subcommands, and other
literal forms covered by the adapter tests. It is not an OS/process sandbox.
Deliberately constructed or dynamically substituted executable names and
indirect helper programs are outside its explicit mechanical boundary. Pin and
review the trusted package and rely on prompt/transcript audit for that residual
boundary.

## Updating And Restarting

Every config, plugin tag, or options change requires an OpenCode restart. To
update, review a new immutable `bundle-v<semver>` tag and its diff, change the
pinned spec, then restart OpenCode. Do not use floating branches, `HEAD`, or a
moving latest ref.

Root bundle semver and `bundle-v<semver>` tags are independent of each bundled
source plugin's version. After the PR lands, bundle releases run the repository
security audit and model-free gates before tagging, including adapter tests,
live loader checks, and package checks. Credentialed model-backed smoke checks
remain a separate release gate; documentation never treats an unpublished tag
as an available release.

Task 7 validates the native package export and options shapes with a direct
`file://` package spec. It does not validate GitHub transport; that transport
waits for the first gated immutable bundle tag to be published.

## Trust Boundary

This package is trusted startup JavaScript. Before pinning a tag, review the
package entrypoint and its shipped plugin assets. At startup it registers
hooks, mutates the resolved config to add selected skill paths, aliases, and
the optional Ossify agent, and injects a shell environment with package-owned
`wi`, `arc`, and `oss` wrappers. Other hooks translate package-owned prompts,
carry transient invocation state, run Architect Critic's canonical session
handler once per session, and guard Ossify implementer Bash calls.

Those hooks do not independently read credentials or invoke a model at
startup. Invoked skills can run the canonical shell workflows, and Architect
Critic uses the active OpenCode model and, for configured adversary paths, the
user's Codex CLI. Pinning and reviewing an immutable release is therefore the
security boundary.

## Diagnostics

Restart first if the config, plugin tag, or options changed. Then inspect the
resolved state and startup logs without destructive cache cleanup:

```sh
opencode debug paths
find "<cache>/packages" -type f -path "*/node_modules/claude-agent-scaffolding-opencode/package.json" -print
opencode --print-logs --log-level WARN debug skill
opencode --print-logs --log-level ERROR debug config
opencode --print-logs --log-level DEBUG debug config
opencode debug agent ossify-implementer-agent
```

- Start with `opencode debug paths`. Use the `cache` value from
  `opencode debug paths` as `<cache>`. Do not assume `~/.cache/opencode`.
  Replace the placeholder in the `find` command above, which searches only
  `<cache>/packages` for the exact
  `*/node_modules/claude-agent-scaffolding-opencode/package.json` path. Do not
  guess the sanitized cache-entry name or search unrelated cache directories.
- If multiple immutable tags are cached, inspect each matching cache entry
  root's package metadata and dependency spec, then compare its recorded
  dependency with the configured pinned GitHub spec. For each matched
  package.json path, apply `dirname` three times: the first parent is the
  installed package directory, the second is `node_modules`, and the third is
  the cache entry root immediately before `node_modules`. Inspect
  `<entry-root>/package.json` and compare its recorded dependency spec with the
  configured pinned GitHub spec. This path-derived rule remains valid when a
  GitHub spec creates nested cache directories; do not count segments below
  `<cache>/packages`.
- Inspect only the matched cache entry's
  `node_modules/claude-agent-scaffolding-opencode` subtree. The `config` value
  from `debug paths` is likewise authoritative rather than an assumed
  `~/.config/opencode` location. Architect Critic state remains under
  `~/.claude/architect-critic`.
- DEBUG logs remain useful for load failures and collisions, but OpenCode 1.18.13
  does not log successful resolved plugin targets. Use logs as failure evidence,
  not as the successful cache-entry locator.
- OpenCode 1.18.13 warns and overwrites duplicate skills; it does not fail
  loading for that collision. `debug skill` shows only the winning definition,
  while the WARN log names the duplicate. Use that path evidence to decide
  which config or skill source should change.
- OpenCode catches adapter config-hook errors, so `opencode debug config` can
  still exit 0. With a reserved `ossify-implementer-agent` collision, the
  selected package skill paths, aliases, and Ossify agent can all be absent
  from resolved config. The ERROR log exposes the reserved-name collision;
  rename the caller agent, restart, and inspect resolved config again.
- Caller-defined command collisions remain caller-preserved rather than being
  replaced by package aliases. Compare the command entry in resolved config
  with the differing-alias table before changing it.
- Confirm resolved `plugin` contains one pinned package entry. The default is a
  string; the Ossify opt-in is one tuple with the exact allowlist above. Never
  clear OpenCode's entire cache as a first response; change a targeted config or
  resolved package subtree only after the diagnostics identify it, then
  restart.
