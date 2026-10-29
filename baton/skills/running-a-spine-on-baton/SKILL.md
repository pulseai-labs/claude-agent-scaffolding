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
  `oss spine_inventory <spine>` shows no `halt:` row.
- **No run of this project is armed or parked.** `baton status` does not show params. Read each
  `<state>/runs/*/run.json` (state is `${BATON_STATE_DIR:-~/.local/state/baton}`). A run with
  `status` `armed` or `parked` and `params.repo` equal to this project's canonical root blocks.
  Runs of other projects do not block.
- **The bridge is up.** `bot-on-openbot status` shows `service: active` and
  `baton notify: … resolves`. Without it, no question reaches the phone.
- **The project's agent.** The repo name comes from `git -C <canonical root> remote get-url
  origin`. List OpenBot's agents with the CLI from `~/.config/bot-on-openbot/config.json` `cli`
  (default `bun /opt/OpenBot/app/resources/cli/openbot-cli.mjs list`). If `<repo>_autopilot` is
  missing, questions go to the default agent with a note. Report that. It does not stop.
- **Orca knows both repos.** The AI workspace and the canonical appear in `orca repo list`.
  Their display names there are the values of the `ai_project` and `project` params.
- **The recipe copy.** `~/baton-recipes/ossify-spine/` exists. Compare it with the installed
  baton's `examples/ossify-spine/` (ignore `*.bak*`). On a difference, report it. Propose a
  refresh only when no run of any project is armed or parked, because every armed run reads its
  briefs from this shared copy. Otherwise arm on the existing copy. Never overwrite it unasked.

## 2. Propose, then stop

Work out every `--param` of the README's arm example:

- Plugin roots come from `~/.claude/plugins/installed_plugins.json` `installPath` of
  `ossify@claude-agent-scaffolding` and `baton@claude-agent-scaffolding`. Never use a cache glob:
  the cache keeps old versions.
- `ai_root` and `repo` (the canonical root) come from the AI workspace's
  `.workspace/pairing.json`, with `${HOME}` expanded. If it is missing, ask.
- `spine` is the id asked for. `spine_dir` is its directory in the AI workspace, absolute; the
  `<slug>` is that directory's name after `<spine>-`. `briefs` is the shared copy's `briefs/`.
- `spine_branch` is `oss branch_name <spine> <slug>`. `state_file` is `oss state_path`, run in
  the AI workspace root.
- The run id is the spine id with `.` as `-` (`r3.s7` → `r3-s7`). If that run dir exists,
  append `-2`, `-3`, … and say so.
- `via` comes from the operator's current rule (memory, standing orders in `AGENTS.md` or
  `CLAUDE.md`). Never copy it from an old run or the README. If no rule is found, ask.

Show the full `baton arm` command. Under it, write one line per value saying where it came from.
Ask any open question (such as `via`) in the same reply, under the command. Then end your turn
and wait for an explicit yes to that command.

"Just arm it", "no need to show me" and "I trust you" do not waive this step. The operator
approves a command they have seen. Show it once, short, and still wait.

## 3. Arm

Run exactly the approved command. Confirm `baton status <run>` lists it and
`systemctl --user is-active baton.timer` says `active`. Then tell the operator: questions come
to `<repo>_autopilot` (or the default agent) on the phone, and this session may be closed now.
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
| "The last run used this `via`" | Old runs are not the rule. Ask. |
