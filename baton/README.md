# baton

A recipe-driven engine. On a systemd timer it launches model sessions on a host when a unit is
due, waits on closed signals (a done-file, a thread's turn end, a PR's checks) at no token cost,
merges a pull request only by the recipe's rule, and notifies on parks, stalls and a host outage.
It judges nothing: anything that needs judgment is a session the recipe launches. It ships a CLI,
a claim launcher and a timer, and no skill, so Codex has nothing to load. Needs `bun`.

## Install

Install the plugin, then link the two executables onto `PATH`:

    ln -sf <plugin root>/bin/baton ~/.local/bin/baton
    ln -sf <plugin root>/bin/omp-t3-claim ~/.local/bin/omp-t3-claim

The timer's unit runs `~/.local/bin/baton tick`, so re-point the symlinks after a plugin update
and the timer follows. `baton timer install` writes `baton.service` and `baton.timer` under
`~/.config/systemd/user` and enables the timer (it ticks 2 min after boot, then every 90 s);
`baton arm` does the same unless it gets `--no-timer`. `baton timer remove` undoes it.

## T3 login

The T3 host calls T3's tailnet `/mcp` endpoint with an OAuth token. Run `baton t3 login`: it
registers a client, prints an authorize URL and listens on a loopback port. Run
`t3 auth pairing create` on the T3 host, open the URL with that pairing, and approve **above
read-only**. The code is exchanged the moment the callback arrives and the token is written
(mode 600) to `~/.config/spine-autopilot/t3-token.json`; it is never printed. The token lasts 30
days and the re-approval is manual: `baton t3 token-status` shows the days left.

## Commands

    baton validate <recipe.json>
    baton arm <recipe.json> --run <id> [--param k=v]... [--no-timer]
    baton status [<run>]            baton report <run>
    baton disarm <run>              baton tick [--run <id>]
    baton unpark <run> [<unit>] [--to <stage>]
    baton t3 login | token-status | call <tool> <json-object>
    baton timer install|remove

## State and config

State lives in `${BATON_STATE_DIR:-~/.local/state/baton}`: `runs/<id>/run.json` and
`events.jsonl`, `claims/` (one env file per launch directory, plus `lookup.log`), `launch/`
(per-launch worktrees), `notify.log`, and a `lock`.

Config is the optional `${BATON_CONFIG:-$HOME/.config/baton/config.json}`; every key is optional:

- `t3.base`: the T3 `/mcp` URL (default `https://draco-desk.tail71316d.ts.net:8445/mcp`).
- `t3.tokenFile`: the token path, `~` expanded (default `~/.config/spine-autopilot/t3-token.json`).
- `notify`: an argv run with no shell for each notice, `{message}` replaced by the notice text,
  bounded at 30 s; its failure never fails a tick. Each notice is sent once per key and is always
  appended to `<state>/notify.log`, which is the only sink when `notify` is unset.
- `slots`: per-slot caps on concurrent sessions across all runs (positive integers), over the
  recipe's `slots`, over the defaults `{"session": 2, "build": 1}`.

```json
{
  "t3": { "base": "https://draco-desk.tail71316d.ts.net:8445/mcp" },
  "notify": ["notify-send", "baton", "{message}"],
  "slots": { "session": 3 }
}
```

`bin/omp-t3-claim` is the launcher a T3 provider instance points at: it applies the claim for its
working directory and then runs `omp-t3`; with no claim the instance is untouched.

## Known limits

- A stage whose `cwd` is a project root starts by default in a detached per-launch worktree, not
  at the root, so its brief must name the paths it works in, and writes to tracked files there
  are lost on `release`. A stage that needs the real checkout sets `launch_dir: "root"`.
- While a `launch_dir: "root"` session runs, a hand-started thread at that root reads its claim.
  A hand-started thread bound to a baton launch directory or a live item worktree also reads that
  claim.
- A coordinator seat still has bash (`crontab`, background `sleep`); its brief governs.
- A Claude DAG seat would also need T3's MCP wake tools removed; none is in use.
- A seat that clears in place without a handoff line is seen only through the quiet window.
- `findByNonce` depends on T3 keeping the thread title.
- The 30-day token re-approval is manual.
