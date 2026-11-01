# Changelog

All notable changes to the `bot-on-openbot` plugin.

## 0.3.0 - 2026-11-01

- Fixes #1002: a question for a wait notice ("unit moved to a stage", such as the spine PR's Merge
  question) now settles when its unit leaves that stage. `settled()` compared the unit's park only,
  and a wait notice has none, so it stayed open until the run was done: after a hand merge it held
  back the run's next park. The stage comes from the notice's key, so a question left open by 0.2.x
  settles on upgrade.
- Fixes #1018: a unit park's card and Show question say why it parked. A `stop` park shows the stop
  file's text (baton 0.11.0 names the file in the park event), and Show question shows a driver's
  escalate action. Both are seat text: read up to 8 KiB from a regular file, control characters
  removed, cut at 800 (action 400) characters, each line quoted with `> `, never interpreted.
  Show question lists `questions:` only when the park recorded some. Unpark already names the unit
  (`baton unpark <run> <unit>`); a test pins it.

## 0.2.2 - 2026-10-29

Tests and docs only; no behaviour change (#975, the non-blocking items from PR #960).

- Added: a control test that No on a run park's Disarm, and No after Merge, say "Cancelled." and ask
  nothing again.
- Added: asserts that a plain unit park's re-ask carries no picker, and that a pick from a blocked
  park's restored picker runs `baton answer <run> <unit> --park <at> --screen <n> <label>`.
- Changed: the root README row says the re-ask happens only while the run is armed or parked and the
  unit is still at that park.

## 0.2.1 - 2026-10-29

- Fixes #959: a No (after Disarm) or a Cancel (on the stage page) on a unit park's question, while the
  run is armed or parked and the unit is still at that park, asks the park's own question again on
  the same agent, its text starting "Cancelled; nothing ran.". A blocked park comes back with the
  worker's options and its picker. Before, a mistaken No closed the notice's last question and nothing
  on the phone could act on the park. No after Merge, No on a run park's Disarm, and any No once the
  park has cleared still send "Cancelled." only.

## 0.2.0 - 2026-10-28

- Closes #945: one OpenBot agent per project. `serve` reads the run's `run.json` `params.repo`, takes
  the repo name from `git -C <repo> remote get-url origin` (GitHub https, `git@github.com:` and
  `ssh://git@github.com/` shapes only) and sends the notice to `agents[<name>]` from the config, else
  `<name>_autopilot`, when OpenBot has that agent. Any other case goes to the default agent (`agent`),
  with a first line saying why, e.g. `[pulse360: no OpenBot agent pulse360_autopilot — sent to
  Autopilot]`. The note also heads a blocked park's question (above the draft's summary), and each
  fallback logs one line. A found route is cached per run for the life of `serve`; a fallback is not,
  and a refused run drops its run's route, so an agent deleted or renamed since is resolved again.
- Agent names are compared case-insensitively (outer spaces ignored), as OpenBot resolves them, in
  the drain's one-open-per-agent check and in `status`; the stored name is kept as given.
- New optional config key `agents`: repo name to agent name or id.
- One delivery is open per agent, not one overall. The spool drains in order within each agent. A
  refused or failed run holds only its agent for the loop; an OpenBot outage while routing stops the
  drain. Follow-ups stay on their parent's agent. The 30-runs-per-hour limit is per agent.
- `deliveries.jsonl` records carry `agent`; a 0.1.x record without it counts as the default agent.
- `status` prints one `agent:` line per agent (found or NOT FOUND, `, open: <keys>`).
- Known limits added: the two-open-in-one-project case (and the reordering it allows), `origin`-only
  GitHub remotes, `params.repo`-only routing, a missing automation `url` or `token` stopping the whole
  drain (0.1.x sent through `openbot-cli` alone), and the per-loop cost of a waiting fallback (none
  for no project, one `git` call for no GitHub origin, one `git` and one `/v1/agents` call for a
  missing agent).
- Setup: one agent per project named `<repo>_autopilot`, Local scripts on for each.

## 0.1.3 - 2026-10-28

- Fixes #943: an OpenBot restart resolves the open question with `resolution.status: "expired"` and
  no responses, and interrupts its delivery. The bridge read that row as unreadable and told the
  operator their answer could not be read. `resolved()` now returns `expired` for that recorded shape
  (any other odd shape stays unreadable). Nothing runs: the question is asked again once while its
  park is open (the run armed or parked, the unit still at that park), on the same one re-ask a
  malformed prompt spends (`reasks: 1`, run id `<key>#reask`) and with the normal wording (record field
  `expired: true`); else, or the second time, it closes as `gone` and the operator gets a message that
  the question expired because OpenBot restarted.
- Fixes #943: the delivery status `starting` (the first seconds of a run) is read as not ended. It was
  logged as "a delivery state this bot does not know", which aborted that poll loop.

## 0.1.2 - 2026-10-28

- Fixes #941: OpenBot's question tool takes at most 5 options; with more, the agent asks with none,
  and a blocked park offered 7. No offer now shows more than 5 labels (`MAX_SHOWN`). An offer option
  carries `shown` (default true): the agent is told only the shown labels, and the prompt-shape check
  compares only those, in order. A tap or a typed answer still matches every recorded label exactly,
  shown or not.
- A blocked park with 1-4 worker options shows them (the recommended one first, marked) and `More…`,
  which asks Show question, Unpark and Disarm as a follow-up; Show question there asks the worker's
  options again. Those three stay accepted, not shown, on the first question. With 5 or more worker
  options it shows only Show question, Unpark and Disarm; every worker option is accepted, not shown,
  and the text's last line asks the operator to type one option's exact label, listing them.
- `Unpark to stage…` pages the recipe's stages 4 at a time, with `More stages…` while more remain
  and `Cancel` on the last page. Every stage, and Cancel, is accepted on every page.
- An offer with labels not shown tells the agent to let the operator type an answer.
- The recommended worker option's own label stays accepted (not shown), so typing it picks that
  option, even when it equals an action label such as `Unpark`.

## 0.1.1 - 2026-10-28

- Fixes #939: the agent could ask a question without its options (`options: null` on `/pending`, the
  labels a list inside the question, the drafted summary gone). While a question waits, `serve` now
  finds its prompt on `/pending` by title and checks that it offers exactly the offered labels, in
  order. A malformed prompt is answered `settled` (dismissed) and the question asked once more with
  firmer wording (record field `reasks: 1`, run id `<key>#reask`). A second malformed prompt is
  dismissed, the question closed as `gone`, and the operator gets a plain message to act in the Orca
  terminal or with baton.
- Settling also finds a prompt by its title when its text or labels differ, so a malformed prompt of
  a cleared park is dismissed. A prompt whose title is not the bridge's is never answered.
- `pending()` reads `options: null` as no options, and returns each prompt's `header`.
- A resolved `settled` the question never offered is read as the bridge's own dismissal: it runs
  nothing, not even typed text to a blocked worker.
- Settling answers a prompt only while the question's own delivery still runs. The agent runs one turn
  at a time, so after that delivery ends, a prompt of the same title is a later question's.

## 0.1.0 - 2026-10-27

- First release. `notify <key> <message>` spools a baton notice without touching the network;
  `serve` sends the spool, one OpenBot delivery at a time, through `openbot-cli`; `service
  install|remove` manages the systemd user unit; `status` reports the agent (and whether `openbot-cli
  list` finds it), the service, the spool, open deliveries and baton's `notify`.
- Ordinary notices are asked with the bot-on-telegram actions (Unpark, Unpark to stage, Show question,
  Disarm; Merge with Yes/No and the reviewed-head check, Open PR); the run-end summary is a message.
- A blocked park is drafted by the agent, then asked with the worker's own options from `baton screen`,
  the recommended one first. A tap runs `baton answer --screen`; typed text runs `--screen-text`.
- The tapped label is read from `openbot.db` (read-only), never from the agent's text, and runs only
  the command recorded with that option. An unreadable row runs nothing and tells the operator.
- A question whose park cleared is answered `settled` and closed.
- Needs baton 0.7.0 or later and OpenBot v0.50.x.
