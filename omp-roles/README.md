# omp-roles

The OMP role pack for default mode. 0.2.0 ships `omp-seat`, the launcher that pins the `seat-mods`, `molt` and `autonomic` OMP extensions onto a seat, and the `implementer` and `seat-reviewer` agents. The launcher accepts `worker` (`omp-seat worker`); coordinator role files arrive in a later release. OMP only: it has no `.claude-plugin/` and Claude Code never loads it.

The `implementer` autoloads ossify's `work-item` skill and returns its JSON after staging, without committing. Install ossify 1.18.0 for `run-spine`'s OMP dispatch by agent name. Under `omp-seat`, implementer children use seat-mods' verifier profile, which denies commit, push and PR creation. The `seat-reviewer` reads a diff and writes only the report path its brief names; its first line records the reviewed HEAD, followed by findings or `Findings: none`.

Under `omp-seat`, the coordinator's launch must list each hosting repo's worktree root in `SEAT_MODS_ALLOW` (e.g. `SEAT_MODS_ALLOW=/path/to/repo/.worktrees`).

## Install

```bash
omp plugin marketplace add pulseai-labs/claude-agent-scaffolding
omp plugin install omp-roles@claude-agent-scaffolding
omp plugin install seat-mods@claude-agent-scaffolding
omp plugin install molt@claude-agent-scaffolding
omp plugin install autonomic@claude-agent-scaffolding
```

Put the launcher on `PATH`. `omp plugin list` shows the installed version; the path is in the install record:

```bash
ln -sf "$(jq -r '.plugins["omp-roles@claude-agent-scaffolding"] | (map(select(.scope == "user")) + .)[0].installPath' ~/.omp/plugins/installed_plugins.json)/bin/omp-seat" ~/.local/bin/omp-seat
```

Run it again after an upgrade: the link points at one version's folder. `omp-seat` needs `bun`.

`omp-seat` needs molt 0.3.0 and autonomic 0.6.0, the first releases that ship their OMP extensions; with an older install it refuses with an "is missing" message.

Pinned and tested on omp 18.8.9; an upgrade is a PR.
