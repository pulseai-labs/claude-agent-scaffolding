# Changelog

All notable changes to the `bot-on-openbot` plugin.

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
