# Changelog

All notable changes to the `bot-on-openbot` plugin.

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
