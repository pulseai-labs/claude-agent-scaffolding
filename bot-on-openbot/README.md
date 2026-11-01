# bot-on-openbot

Sends [baton](../baton) notices to the operator as OpenBot questions on the phone,
and turns a tapped option into the matching `baton` or `gh` command. For a worker blocked on a question
in its terminal, the OpenBot agent drafts a summary and a recommendation, the question offers the
worker's own options, and a tap answers the worker through baton's screen check. A CLI and a
long-running service; no skill, no dependencies beyond [bun](https://bun.sh). It needs baton 0.7.0 or
later (`baton screen` and `baton answer --screen`), OpenBot v0.50.x with an agent whose Local scripts
are on, and `gh` (with its own auth) and `baton` on the service's PATH.

## How it works

- `bot-on-openbot notify <key> <message>` is what baton runs for each notice. It only writes a file
  into `<state>/spool/` and exits, so baton's tick never waits on the network.
- `bot-on-openbot serve` (the service) sends the spool in order through `openbot-cli run <agent> -
  --id <notice key> --json`, one delivery at a time per agent. Each task is fixed wording plus data: ask the
  operator one question with exactly these labels, send a message verbatim, or draft a summary of a
  screen as JSON. The agent asks; it never answers alone.
- Each notice goes to its project's agent. `serve` reads the run's `run.json` `params.repo`, asks
  `git -C <repo> remote get-url origin` for the repo name (GitHub `https://github.com/<owner>/<repo>`,
  `git@github.com:<owner>/<repo>` and `ssh://git@github.com/<owner>/<repo>` only, `.git` optional),
  and sends to `agents[<name>]` from the config, else the agent `<name>_autopilot`. That agent must
  exist in OpenBot (found by id, or by exactly one name match, case ignored). A run whose agent
  cannot be found goes to the default agent (see Agent).
- The tapped label is read from OpenBot's own database (`openbot.db`, opened read-only: the
  `prompt.resolved` row of the delivery's turn), never from the agent's reply text. It is matched
  exactly against the options recorded for that question, and runs the one fixed command recorded
  with that option, with no shell. A label that matches nothing runs nothing.
- A blocked park: `serve` calls `baton screen <run> <unit>` and takes the picker baton parsed. The
  agent drafts first (a summary, a recommended option number, a reason); the question then offers the
  worker's options in screen order with the recommended one first, marked `(recommended)`, then
  `More…`, which asks Show question, Unpark and Disarm as a follow-up. OpenBot's question tool takes at
  most 5 options, so a picker of 5 or more shows only Show question, Unpark and Disarm, and the text
  asks the operator to type one option's exact label (see Options). A tap runs `baton answer <run> <unit> --park <at> --screen <n> <label>`,
  which sends the keys only while the same park and the same label on line n are still on screen.
  Typed text, when the worker's picker has an Other row, runs `baton answer … --screen-text <text>
  --question <line>` under the same check.
- When the park clears by any route, the question is answered `settled` and closed (see Settling).
- While a question waits, `serve` checks the agent asked it as told: its prompt on OpenBot's `/pending`
  (the one whose header, or the first line of its question, is the question's title) must offer exactly
  the shown labels, in order. A prompt asked another way, such as the labels as text with no
  buttons, is answered `settled` to dismiss it, and the question is asked once more with firmer
  wording. If that one is malformed too, it is dismissed, the question closes, and a message says to
  act in the Orca terminal or with baton.

## Install

```sh
ln -sf "$PWD/bot-on-openbot/bin/bot-on-openbot" ~/.local/bin/bot-on-openbot
```

Point the symlink at the plugin directory again after a plugin update moves it. Then:

```sh
bot-on-openbot service install     # writes the user unit, enable --now
bot-on-openbot service remove
bot-on-openbot status
```

The unit carries `BATON_STATE_DIR`, `BATON_CONFIG`, `BOT_ON_OPENBOT_CONFIG_DIR` and
`BOT_ON_OPENBOT_STATE_DIR` as they are set when you run `service install`, and a `PATH` that reaches
`~/.local/bin` (baton), `~/.bun/bin` (bun) and `/usr/bin` (gh).

## Agent

One OpenBot agent per project, plus a default agent.

1. In OpenBot, make one agent per project, named `<repo>_autopilot` after the GitHub repo name
   (`pulse360_autopilot` for `pulse360`), and turn its **Local scripts** on. Do the same for the
   default agent (the one this was built with is `Autopilot`). OpenBot then writes
   `~/.config/OpenBot/automation/{url,token}`.
2. Write `~/.config/bot-on-openbot/config.json`:

   ```json
   { "agent": "Autopilot", "agents": { "some-repo": "Some Agent" } }
   ```

   `agent` is the default agent's name or id. `agents` is optional: it maps a repo name to the agent
   that repo uses, where the name `<repo>_autopilot` does not fit. Other optional keys, each with its default:
   `"cli": ["bun", "/opt/OpenBot/app/resources/cli/openbot-cli.mjs"]`,
   `"db": "~/.config/OpenBot/openbot.db"`, `"automationDir": "~/.config/OpenBot/automation"`
   (spell paths out in full: they must be absolute).

The bot reads OpenBot's token from the automation folder on each call and sends it only in a request
header. It never writes it to a file, a log line or an error. `bot-on-openbot status` prints one
`agent:` line per agent: the default, then the `agents` values, then any agent with an open delivery.
Each line says whether `openbot-cli list` finds it (`finds it` or `NOT FOUND`) and ends with
`, open: <keys>` when it has open deliveries. It does not route spooled notices. It never prints the
token.

**The default agent.** A notice that cannot reach a project agent goes to the default agent, with a
first line saying why: `[pulse360: no OpenBot agent pulse360_autopilot — sent to Autopilot]` (the
prefix is the GitHub repo name), `[run r9: no project — sent to Autopilot]` (no `params.repo`), or
`[run r9: no GitHub origin for <repo> — sent to Autopilot]`. A blocked park's question carries the
note too, above the draft's summary. Each fallback logs one line, `<notice key>: <note>`, when the
notice goes. A run-done notice is routed like any other run notice, and can fall back with a note.
Only a notice whose key names no run goes straight to the default agent, with no note. A found route
is kept per run for the life of `serve`; a fallback is not, so an agent created mid-run is used from
the run's next notice. When OpenBot refuses a run, its run's route is dropped, so an agent deleted or
renamed since is resolved again on the next loop (and falls back with a note). Agent names are
compared as OpenBot resolves them, case and outer spaces ignored: `Autopilot` and `autopilot` are one
agent, one queue and one `status` line.

## The baton line

In `~/.config/baton/config.json`, spell out the absolute path. The `notify` argv runs with no shell,
so `~` is not expanded:

```json
{ "notify": ["/home/<user>/.local/bin/bot-on-openbot", "notify", "{key}", "{message}"] }
```

baton's `notify` names one program, so only the bot it names receives notices. Switching from
bot-on-telegram is this one edit.

## Notices

| Notice | Sent as |
|---|---|
| Unit parked | a question: Unpark, Unpark to stage…, Show question, Disarm; on a `stop` park its text ends with the stop file's text (see Why a unit parked) |
| Unit blocked on a question in its terminal | a drafted question: the worker's options, one marked recommended, then More… (Show question, Unpark, Disarm); with 5 or more worker options, Show question, Unpark, Disarm and a line asking for an option's exact label |
| Unit moved to a stage | a question: Merge (when the unit has a PR and a reviewed head), Open PR (when it has a PR), Disarm |
| Run parked | a question: Disarm |
| Run done, and anything else | a plain message, verbatim (a run-done notice still goes to its project's agent) |

One delivery is open per agent: an unanswered OpenBot question blocks that agent's queue, so the next
notice for it waits in the spool until the open one is answered, settled or ends. Other agents are
not held, and the spool drains in order within each agent. A follow-up question stays on its parent's
agent.

## Options

| Option | Runs | Then |
|---|---|---|
| Unpark | `baton unpark <run> <unit>` | a message with the result |
| Unpark to stage… | nothing | a question listing the recipe's stages 4 at a time, then More stages… while more remain, else Cancel |
| More stages… | nothing | the next 4 stages, the same way |
| More… (a blocked park) | nothing | a question: Show question, Unpark, Disarm; Show question there asks the worker's options again |
| a stage | `baton unpark <run> <unit> --to <stage>` | a message with the result |
| Show question | nothing (a blocked park: `baton screen <run> <unit>`) | the same question again, its text the unit's stage, park reason, why it parked (see Why a unit parked), the questions when the park recorded any, the thread, and for a blocked park the screen's tail |
| Disarm | nothing | a Yes/No question |
| Yes (Disarm) | `baton disarm <run>` | a message with the result |
| Merge | `gh pr view <pr> --json number,baseRefName` | a Yes/No question naming the PR, head and base; a failed check is a message saying why |
| Yes (Merge) | `gh pr merge <pr> --merge --match-head-commit <reviewed head>` | a message with the result |
| No, Cancel | nothing | on a unit park still at its park: the park's question again, its text starting "Cancelled; nothing ran."; else the message "Cancelled." |
| Open PR | nothing | a message with the PR URL |
| a worker option, tapped or typed exactly | `baton answer <run> <unit> --park <at> --screen <n> <label>` | a message; refused: the question again, its text `Not sent: <baton's reason>`, with Show question and Disarm |
| typed text, on a blocked park whose picker has an Other row | `baton answer <run> <unit> --park <at> --screen-text <text> --question <line>` | as a worker option |
| typed text, anywhere else | nothing | the message "Typed answers only go to a blocked worker; nothing ran." |
| a label not offered | nothing | one log line, and the message "That option is not one I offered; nothing ran." |

A question shows at most 5 options, the limit of OpenBot's question tool. Some labels an offer
accepts are not shown: the worker's options when the picker has 5 or more, Show question, Unpark and
Disarm under a blocked park's `More…`, and the stages and Cancel of other stage pages. Typed exactly,
such a label is that option; typed text that equals no label is handled as typed text below.

A command's result arrives as a message: `<title>: <what> — done`, or `— failed: <first error line>`.
A question is closed before its command runs, so one answer runs at most one command. A tap on a
closed question (settled, or answered already) runs nothing and says it is no longer open.

## Why a unit parked

A `stop` park has no questions: baton parks the unit because a seat wrote its stop file. The park
event names that file (`stop_file`, baton 0.11.0 and later). The first screen of a unit park's
question, and Show question, then show the file's text under `stop file (text a seat wrote, shown as
data):`, each line quoted with `> `. A driver's `escalate` action is in baton's notice already; Show
question repeats it under `driver action (text a driver wrote, shown as data):`. Both texts come
from a seat, so they are data: the file is read up to 8 KiB and only if it is a regular file, control
characters and bidi overrides are removed, and the text is cut at 800 characters (the action at 400).
Nothing reads them to decide anything, and the bot sends no part of them to a command. An empty
file shows `stop file: empty`, an unreadable one `stop file: not readable`. Text from an event of
another park is not shown. Show question lists `questions:` only when the park recorded some.
Unpark runs `baton unpark <run> <unit>` and names the unit; a round barrier's stop text says an
unpark before the specs exist stops again (see baton's runbook).

## Settling

When the unit is no longer in the park a question was asked for (you answered in the Orca terminal,
a driver or a later tick moved it), or the unit is no longer at the stage a wait notice ("moved to
a stage", for example the spine PR's Merge question) was asked for (you merged by hand), or its run
is disarmed or done, the bot closes the question and
answers its OpenBot prompt with the label `settled`, so the agent's queue moves on. The bot finds its
prompt on OpenBot's `/pending` list by its question text and its exact labels, or else by its title
(a prompt the agent asked another way); a prompt with another title is never answered. A question not shown
yet is closed at once and answered once it shows. Settling is checked on every `serve` loop.

## State

`${BOT_ON_OPENBOT_STATE_DIR:-~/.local/state/bot-on-openbot}`: `spool/`, `spool-bad/`,
`deliveries.jsonl` (every delivery, the `agent` it went to, what it offered, and how it closed; a
0.1.x record has no `agent` and counts as the default agent), `taps.jsonl` (every answer,
its act and the command's exit code; typed text is not logged), `serve.lock`.
Only one `serve` runs at a time; a second exits with code 3.

## Known limits

- The answer is read from `openbot.db`, an internal OpenBot schema with no docs, and OpenBot's updater
  stays on. When an update changes its shape, nothing runs, one line is logged, and the operator gets
  a message to act in the Orca terminal or with baton.
- One question at a time per agent: an unanswered question holds that agent's later notices, a merge
  included, until it is answered, settled or ends.
- A notice with no project agent goes to the default agent. Routing reads only `params.repo` in the
  run's `run.json`, so an ad hoc run without it goes there. Only the `origin` remote is read, and only
  GitHub URLs of the three shapes above; any other remote falls back.
- Two open in one project: a project's notice that fell back to the default agent stays open there
  when the project's own agent is created. The next notice opens on the new agent, so the project
  has a question open on each until the first is answered. Likewise, order within a project can
  break: a notice that fell back and waits behind the busy default agent can go after a later notice
  of its project that resolved to the project's own agent.
- `status` does not route spooled notices: it shows the spool count, not which agent each spooled
  notice will reach. That is known only when the notice is delivered.
- A fallback notice that waits in the spool is routed again every loop. A no-project fallback costs
  no call, a no-GitHub-origin fallback one `git` call, and a missing-agent fallback one `git` and
  one `/v1/agents` call.
- If OpenBot cannot be reached while routing, the whole drain stops for that loop; the spool keeps
  its order. Routing reads `/v1/agents` over Local scripts' HTTP side, so a missing automation `url`
  or `token` blocks it too, and the whole drain waits until they are back. 0.1.x delivered through
  `openbot-cli` alone and did not need them to send.
- OpenBot allows 30 runs per agent per hour. A refused or failed run keeps the notice in the spool, in
  order, and holds only that agent for the loop; a busy spine waits there. Follow-up questions and result messages each take a run.
- A picker that is neither omp's ask picker nor omp's numbered `/review` picker reads as no picker: the
  question then offers only Show question, Unpark and Disarm, and says to answer in the Orca terminal.
- Free text reaches a worker only through a picker's Other row; elsewhere typed text runs nothing.
- Settling, and dismissing a malformed prompt, answer it with `settled`, a label it never offered;
  OpenBot accepts that today. If the agent rewords the title as well, the bot cannot find its prompt on
  `/pending`: a malformed one is not dismissed, and a settled one stays open on the phone until the
  operator answers it (the answer then runs nothing).
- A malformed prompt costs a second run (the re-ask), and the shape check reads `/pending` on every
  loop while a question waits. A typed answer `settled`, where `settled` is not an offered label, reads
  as the bridge's own dismissal: nothing runs and the question is asked again (or closed, the second
  time).
- An OpenBot restart expires an open question. Nothing runs; the bridge asks it again once while its
  park is open, else closes it and tells the operator (seen once, dry run 2026-10-28).
- Delivery is at least once: a crash between a run and the spool delete runs it again with the same
  `--id`, which OpenBot answers with the same delivery.
- The draft is the model's: its summary and recommendation can be wrong. A draft that is not the JSON
  asked for, or recommends a number not on the picker, is dropped and the question goes without one.
- A typed answer that equals an offered label, shown or not, is that option, not text. So text meant
  for the worker that equals Show question, Unpark or Disarm is that escape.
- A picker of 5 or more options has no buttons for the worker's options: the operator types one
  exactly. A worker label equal to Show question, Unpark or Disarm is then the escape's, and only the
  Orca terminal can pick it.
- On a stage page that shows More stages…, Cancel is not a button; type it, or page to the end.
- A wait notice settles when its unit is not at the stage; a unit that leaves the stage and comes
  back to it before the next `serve` loop (about 5 s) leaves the old question open.
- A stop file's text is shown only for a park whose event names it (baton 0.11.0 and later); with
  an older baton, or a stop file the seat has not written yet, Show question says why only by
  the park's reason and thread. A seat that rewrites the file after the card is sent changes what
  Show question shows, not the card.
- `deliveries.jsonl` and `taps.jsonl` are never compacted.
- The unit's `ExecStart` path is not quoted: keep the install path free of spaces and `%`.
- A command that runs past 60 s is sent SIGTERM only; one that ignores it keeps running, and `serve`
  waits for it.
