---
name: running-a-spine-on-baton
description: Use when asked to run, start, arm or hand off a planned ossify spine "on baton" (the timer-driven autopilot), or asked how a baton run is going or what to do about a park. "On baton" names this plugin's `baton arm`, not `/ossify:run-spine` in this session.
---

# Running a spine on baton

baton runs a planned ossify spine on a systemd timer, so this session keeps its tokens for
decisions. Check, propose the exact `baton arm` command, and arm it only on the operator's yes.
**After arming, spend no tokens on the run.** Questions reach the phone through bot-on-openbot.

The commands, the arm example and the runbook are in the baton plugin's `README.md`
("Commands", "Example: an ossify spine"). Read them there.

## 1. Preflight (read-only)

Stop and report if any check fails. Do not arm around a failure.

- **The spine is planned.** Its spine directory and work items exist in the AI workspace, and
  `oss spine_inventory <spine>`, run in the AI workspace root, shows no `halt:` row. Its items
  share one `target_repo`: the lane stops on a spine with two.
- **No run of this project is armed or parked.** `baton status` does not show params. Read each
  `<state>/runs/*/run.json` (state is `${BATON_STATE_DIR:-~/.local/state/baton}`). A run with
  `status` `armed` or `parked` and `params.repo` equal to this project's canonical root blocks.
  Runs of other projects do not block.
- **The bridge is up.** `bot-on-openbot status` shows `service: active` and
  `baton notify: … resolves`; baton's config (`${BATON_CONFIG:-~/.config/baton/config.json}`)
  has a `notify` argv that runs `bot-on-openbot notify`; and bot-on-openbot is 0.2.0 or later
  (`installed_plugins.json`). Without all three, questions do not reach the project's agent.
- **baton on `PATH`.** `~/.local/bin/baton` resolves to the installed baton's `bin/baton`: the
  timer runs that link.
- **The project's agent.** The repo name comes from `git -C <canonical root> remote get-url
  origin`. The agent is `agents[<repo>]` in `~/.config/bot-on-openbot/config.json` if set, else
  `<repo>_autopilot`. List OpenBot's agents with that config's `cli` (default
  `bun /opt/OpenBot/app/resources/cli/openbot-cli.mjs list`). If the agent is missing, questions
  go to the default agent with a note. Report that. It does not stop.
- **Orca knows both repos.** The AI workspace and the canonical appear in `orca repo list`.
  Their display names there are the values of the `ai_project` and `project` params.
- **Who walks the `user:` lines.** `oss get '[.demo_ledger[] | select(.source_spine == "<spine>" and .type == "user")]'`,
  run in the AI workspace root, lists them, planned ones included. Read the standing orders as the
  base branch has them (ossify's `cumulative-demo.md` §3). A spine with a `user:` line and no order
  that gives the demo walk to the `spine_finish` seat's role is not a failed check: say in the proposal
  that the run parks after the merge (`spine-pr`, reason `stop`) until the operator walks the lines
  or an order is added first.
- **The recipe copy.** `~/baton-recipes/ossify-spine/` exists; if not, propose the README's copy
  step. Compare it with the installed baton's `examples/ossify-spine/` (ignore `*.bak*`). A
  difference is reported, not a failed check. Propose a refresh only when no run of any project
  is armed or parked, because every armed run reads its briefs from this shared copy. If a run
  is, or the operator declines, arm on the existing copy. Never overwrite it unasked.

## 2. Propose, then stop

Work out every `--param` of the README's arm example:

- Plugin roots come from `~/.claude/plugins/installed_plugins.json` `installPath` of
  `ossify@claude-agent-scaffolding` and `baton@claude-agent-scaffolding`: the entry whose
  `projectPath` is the AI workspace root, else the `user` entry. Never use a cache glob: the
  cache keeps old versions.
- `ai_root` and `repo` (the canonical root) come from the AI workspace's
  `.workspace/pairing.json`, with `${HOME}` expanded, else `oss repo_root ai_workspace` and
  `oss repo_root canonical`. Use a root only if it exists on this host; otherwise ask.
- `spine` is the id asked for. `spine_dir` is its directory in the AI workspace, absolute; the
  `<slug>` is that directory's name after `<spine>-`. `briefs` is the shared copy's `briefs/`.
- `spine_branch` is `oss branch_name <spine> <slug>`. `state_file` is `oss state_path`, run in
  the AI workspace root.
- The run id is the spine id with `.` as `-` (`r3.s7` → `r3-s7`). If that run dir exists,
  append `-2`, `-3`, … and say so.
- The seat file is `--seats /home/<user>/baton-recipes/seats/<run>.json` (Seats, below): an
  absolute path with `$HOME` expanded by you, never `~/…`, because `baton arm` does no tilde
  expansion and a quoted `~` stays literal. `baton arm` copies it into the run as `seats.json`.

**Seats.** Read `.crew/roles.md` (walk up from this session's working directory; the first one
found wins) and `~/.claude/crew/agents.md`. For each recipe stage with a `role` (the `triage`
and `driver` stages included), pick one agent for that role for the whole run from the
`## Seats` rows, applying `## Conditions` and the file's other rules, and any fallback row, now:
baton never chooses between rows later. A role with no row is one question, and arms nothing.
When the project has no rows for the recipe's roles yet, propose rows for them in
`.crew/roles.md` first and get them approved (crew's project-file approval). Propose only
agents the machine file lists.

Each picked agent's entry becomes that role's row of the seat file (schema in the README):

- `agent` is the entry's name; `expected_model`, `effort` and `brief_delivery` are its fields.
- `argv` is `command:` split on spaces, only when its first word is a program on `PATH`
  (`command -v` in a non-interactive shell prints a path) and no word holds a quote, `$`, `~`
  or another shell character. A command that is a shell function or an alias (`claude-plain`,
  `omp-glm`) cannot be exec'd: that is one question, for a machine-file entry that runs the
  program itself. End a Devin agent's argv with `--`: Devin reads a prompt that does not
  follow `--` as a path.
- `env` is `{}` unless the entry's note names a key the agent itself needs. The stage sets the
  seat's marking.
- `review`, on the reviewer's row, is the entry's `review:` command. In it,
  drop a trailing `<PR_URL>` or `<PR>`: the stage appends the PR. No `review:` field, or a
  placeholder left after that, is one question.
- An entry whose `host:` is another machine is one question: baton launches on this one.

Show the full `baton arm` command, each value quoted where it has a space or shell character.
Under it, write one line per value saying where it came from, then the seats as one table,
one line per stage, `From` naming the `roles.md` row or condition:

| Stage | Role | Agent | Command | Model | Effort | From |
|---|---|---|---|---|---|---|

Ask any open question in the same reply, under the table. Then end your turn and
wait for an explicit yes to that command and table.
A yes that changes or supplies a value is not that yes, and neither is one that changes a
seat: show them again with the change in, and wait.

"Just arm it", "no need to show me" and "I trust you" do not waive this step. The operator
approves a command they have seen. Show it once, short, and still wait.

## 3. Arm

Write the seat file only after the yes: the approved seats as the README's JSON, at the
`--seats` path (`mkdir -p "$HOME/baton-recipes/seats"`). Then run exactly the approved command.
Confirm `<state>/runs/<run>/run.json` has `status` `armed` and
`systemctl --user is-active baton.timer` says `active`. Then tell the operator: questions come
to the project's agent (or the default agent) on the phone, and this session may be closed now.
End the turn.

## 4. After arming

- **No watching.** No polling, `sleep` loop, Monitor, wakeup, cron, `/loop`, push
  notification, or a seat told to report back. "Keep an eye on it" is not a status request: run
  no command. Answer in words that baton already watches the run and the phone gets every
  question, and offer a status check when they ask for one.
- **Status on request only.** `baton status <run>` or `baton report <run>`. Read
  `out/<unit>/` files only when the operator asks about that unit. Do not read seat transcripts.
- **A park, on request.** Point to the README runbook. The fallbacks are
  `baton unpark <run> <unit> [--to <stage>]` and `baton disarm <run>`. A mistaken No on a unit
  park asks again on its own (bot-on-openbot 0.2.1).
- **The end.** The operator merges the spine PR. baton sees the merge and runs the second spine
  close itself. Do not start `/ossify:close` beside it.

## Red flags

| Thought | Reality |
|---|---|
| "On baton" means `/ossify:run-spine` here | It means `baton arm`. This session must not run the rounds. |
| "They said just arm it" | Show the command once and wait for a yes. |
| "One quick check before they leave" | Arming already checked. Run no command until asked. |
| "This role has no row; the usual agent will do" | No default seat. Ask, and arm nothing. |
| "The last run's seat file still fits" | Old runs are not the rule. Resolve the seats from crew's files. |
