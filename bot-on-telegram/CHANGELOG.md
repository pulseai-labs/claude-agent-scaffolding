# Changelog

All notable changes to the `bot-on-telegram` plugin.

## 0.1.0 - 2026-10-23

- First release. `notify <key> <message>` spools a baton notice without touching the network;
  `serve` sends the spool and long-polls for button presses; `service install|remove` manages the
  systemd user unit; `status` reports the token mode, chat, service, spool and baton's `notify`.
- Buttons for parked units (Unpark, Unpark to stage, Show question, Disarm), moved units (Merge,
  Open PR, Disarm) and parked runs (Disarm), with Yes/No confirms for Merge and Disarm.
- Single-use, expiring buttons; a chat lock so only the configured chat can press; every press
  logged to `presses.jsonl`.
- Needs baton 0.3.1 or later.
