# omp-roles

The OMP role pack for default mode: coordinator role files, worker agents (`implementer`, `reviewer`), and `omp-seat`, the launcher that pins the `seat-mods`, `molt` and `autonomic` OMP extensions onto a seat. OMP only: it has no `.claude-plugin/` and Claude Code never loads it.

## Install

```bash
omp plugin marketplace add pulseai-labs/claude-agent-scaffolding
omp plugin install omp-roles@claude-agent-scaffolding
omp plugin install seat-mods@claude-agent-scaffolding
omp plugin install molt@claude-agent-scaffolding
omp plugin install autonomic@claude-agent-scaffolding
```

Put the launcher on `PATH` (the plugin's `bin/omp-seat` lands with a later task of this pack):

```bash
ln -s "$(ls -d ~/.omp/plugins/cache/plugins/claude-agent-scaffolding___omp-roles___*/ | tail -n 1)bin/omp-seat" ~/.local/bin/omp-seat
```

Pinned and tested on omp 18.8.9; an upgrade is a PR.
