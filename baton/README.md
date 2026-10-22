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
The service keeps `BATON_STATE_DIR` and `BATON_CONFIG` as they were set at install time; change
either and run `baton timer install` again.

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

`unpark` acts on a parked unit; a unit that is running (a live session, not parked) is refused
with rc 2.

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

## Example: an ossify spine

`examples/ossify-spine/` is a recipe that runs one planned ossify spine on T3: the detached
run-spine lane queues each round's work items, an implementer per item, gap re-entry, close and
correction, ordered merges onto the spine branch, the spine PR's review rounds, and the spine
close. The briefs it names are prose; `common.md` is read first by every seat.

Copy the example outside the plugin cache first, and pass that copy's `briefs` path: a plugin
update moves the cache, and a run armed on the old path would lose its briefs.

    cp -r <plugin root>/examples/ossify-spine ~/baton-recipes/ossify-spine
    baton arm ~/baton-recipes/ossify-spine/recipe.json --run r0-s6 \
      --param spine=r0.s6 \
      --param spine_branch=<output of: oss branch_name <spine> <slug>> \
      --param spine_dir=<absolute AI-workspace spine directory> \
      --param ai_root=<AI workspace root> \
      --param ai_project=<T3 project title of the AI workspace> \
      --param repo=<canonical root> \
      --param project=<T3 project title of the canonical> \
      --param state_file=<output of: oss state_path, run in the AI workspace root> \
      --param oss=<absolute path of <ossify plugin root>/bin/oss> \
      --param briefs=$HOME/baton-recipes/ossify-spine/briefs \
      --param via=omp-deepseek-cpa

Each unit's files live in `<state>/runs/<run>/out/<unit>/`. Operator runbook:

- **A stop parks the unit.** Read its `stop` file, write the ruling into the work item handoff's
  `## Clarifications` (or into the file the stop names), delete the `stop` file, then
  `baton unpark <run> <unit>`. A stop file left in place parks the unit again.
- **After a gap stop**, send the item back to its implementer: `baton unpark <run> <wi> --to implement`.
- **A reversal before the spine merges**: write it to `out/spine-pr/operator.md`, then
  `baton unpark <run> spine-pr --to spine_work`; that round does it first and then removes the file.
- **A spine PR conflict parks `spine-pr`** in `spine_wait`. Resolve it on the spine branch in the
  canonical root (merge the base in; never rebase or force-push), push, delete
  `out/spine-pr/review.md`, then `baton unpark <run> spine-pr --to spine_review`.
- **The spine PR ack.** On the "merge it by hand" notice, read the PR's needs-you list, then merge
  it; baton sees the merge and runs the second spine close.
- **`--to spine_work` is refused while `spine-pr` has a live session** (a review is running): wait
  for the review to end, then unpark.
- **A `land` park** names its reason. `run failed`: the canonical root is not on the spine branch
  (or the fast-forward failed); check the spine branch out there, then `baton unpark <run> <wi>`.
  `outcome`: the item PR's checks are red or it conflicts; fix it on the item branch, then unpark.
  `pr closed`: reopen the PR and unpark, or finish the item by hand. `not landed`: the PR merged
  but its head is not on the spine branch (a squash or rebase); the recipe cannot record that
  landing, so finish the item by hand.
- **A run-level park** (`invalid record …`): fix or remove the record file, then `baton unpark <run>`.
- **A seat stopped mid-work leaves its worktree dirty.** work-item's Gate 3 refuses a dirty
  worktree on a plain `unpark` of `implement`, and a correction's packet no longer matches the
  staged tree: clean the worktree, or finish the work by hand, before you unpark.
- **A cheap build**: implementers and corrections hold the `build` slot (1 by default), so they run
  one at a time. Raise `slots.build` in the config to run more at once.

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
