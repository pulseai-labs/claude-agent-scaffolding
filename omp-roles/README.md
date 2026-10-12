# omp-roles

The OMP role pack for default mode. 0.1.0 ships `omp-seat`, the launcher that pins the `seat-mods`, `molt` and `autonomic` OMP extensions onto a seat, and one role, `worker` (`omp-seat worker`); any other role is refused. The worker agents (`implementer`, `reviewer`) and the coordinator role files arrive in later releases. OMP only: it has no `.claude-plugin/` and Claude Code never loads it.

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

`omp-seat` needs molt 0.3.0 and autonomic 0.6.0, which ship their OMP extensions in the next release; until then it refuses with an "is missing" message.

Pinned and tested on omp 18.8.9; an upgrade is a PR.
