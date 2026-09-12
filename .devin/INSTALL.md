# Install The Devin Surface

The Devin surface is the repository itself: the root `.devin-plugin/plugin.json`
is a **meta-plugin** whose `requiredPlugins` list auto-installs the five-plugin
baseline. One install brings the whole set; each plugin also installs on its
own.

Devin plugins are in **beta** — behavior and configuration may change in future
Devin releases, and the floor below is the measured support boundary, not a
guarantee.

## Requirements

- Devin CLI or Devin Desktop >= `3000.10.21` on macOS or Linux, using Devin
  Local agents. The contract is measured on `3000.10.21`; older builds are
  unsupported.
- Bash, Git, `jq`, and the standard `awk`/`sed`/`find` tools the canonical
  skill bodies already assume.
- **Cloud Devin sessions are not covered.** Skills and rules load wherever
  plugins load, but the verified support claim is the local surfaces — the CLI
  and Devin Desktop. In particular, `ossify`'s work-item execution delegates to
  a subagent worker (`ossify:work-item-worker`); plugin subagent behavior in
  cloud sessions is not part of this contract.

## The Baseline

Installing the meta-plugin installs exactly these five, and nothing else:

| Plugin | Devin surface |
|---|---|
| `workspace-init` | All 3 skills |
| `ai-mentor` | All 4 skills |
| `architect-critic` | All 6 skills — **host-only**, see below |
| `ossify` | 6 skills (`start`, `plan-release`, `plan-spine`, `work-item`, `close`, `doctor`) plus the `work-item-worker` subagent. `adopt`, `challenge`, and `wayfinder` are deliberately not advertised on this surface. |
| `code-judo` | All 4 skills |

`scaffold`, `scaffold-onboard`, `scaffold-dev`, `claude-security-audit`, and
`orca-crew` are not published to Devin.

## Installation

From a local checkout (linked — edits apply on the next session):

```bash
devin plugins install --local .            # the repo root: meta-plugin + baseline
devin plugins install --local ./code-judo  # or any single plugin directory
```

From GitHub, once this branch is merged to the default branch:

```bash
devin plugins install pulseai-labs/claude-agent-scaffolding
```

The remote form fetches each baseline plugin by `git-subdir` out of the same
repository. Merging to the default branch **is** the release event — new
sessions pick up the new content automatically, so review the merged
default-branch content before updating while plugins remain in beta.

## Invocation

Installed skills are namespaced: `/<plugin>:<skill>` — e.g. `/ossify:start`,
`/ai-mentor:grill-me`, `/code-judo:deep-review`. There are no unqualified
aliases: Claude Code `commands/` shims are a Claude surface and are not
recreated here.

## Architect Critic Under Devin

`architect-critic` runs **host-only**: the critique executes in-conversation on
the Devin agent itself (`HOST_AGENT=devin`), records
`adversaries_used=["devin"]`, and shares its durable state directory with
Claude Code at `~/.claude/architect-critic`. It does not dispatch Codex,
Claude, or any fresh-frame adversary, and it never appends `external_runs[]`.
An explicit async request is refused outright — no silent foreground fallback.

## Ossify Worker Under Devin

Work-item execution uses the skill-as-subagent path: `ossify:work-item-worker`
runs as a `subagent_general` worker and delegates to the canonical
`work-item` contract rather than carrying a copied body. The canonical
boundaries hold unchanged — the worker never runs `git commit`, `push`,
`pull`, or `fetch`, returns the structured work-item envelope, and does not
spawn nested agents.

## Managing Installs

```bash
devin plugins list            # installed plugins, versions, blocked status
devin plugins info ossify     # a plugin's skills, rules, required/optional/forbidden lists
devin plugins update          # re-fetch and re-install at latest HEAD
devin plugins remove ossify   # remove one plugin (auto-installed requireds stay)
devin plugins prune           # drop requirements whose repo no longer exists
```

## Trust Boundary

The surface ships prose skills, triggered rules, thin Devin-only wrappers, and
deterministic dispatchers — no compiled code runs at install. The shared
mutable surface is `~/.claude/architect-critic` (above); ossify's worker holds
the Git prohibition described in the canonical contract. Everything else a
skill does is what its `SKILL.md` body says — the skills are the trust surface,
so review the five plugin directories before installing, the same review you
would give the Claude or Codex manifests.

## Diagnostics

- `devin plugins list` shows all six entries — the five baseline plugins plus
  the `claude-agent-scaffolding-devin` meta-plugin.
- `devin plugins info <name>` lists advertised skills; on the baseline install,
  ossify shows exactly its six skills plus `work-item-worker` — `adopt`,
  `challenge`, and `wayfinder` absent is correct, not a load failure.
- `ossify:doctor` reports its loaded-body versus expected version and bounds
  any mismatch to ossify activity already evidenced in the session.
- A local `--local` install is linked to the checkout; if an edited skill does
  not appear, start a new session — installed-plugin state is read at session
  start.
