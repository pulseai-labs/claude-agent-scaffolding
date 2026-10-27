# Changelog

All notable changes to the `bot-on-openbot` plugin.

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
