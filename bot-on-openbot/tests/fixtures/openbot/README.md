# Recorded OpenBot replies

Recorded on draco-desk, OpenBot v0.50.x with the agent `Autopilot`, on 2026-10-27, during the
OpenBot-bridge spike (plan Task 1). Account names, member ids and e-mail addresses are replaced
with `<redacted>`; no token appears in any file.

- `run-queued.json`, `run-same-id.json`: `openbot-cli run Autopilot - --id <key> --json` with no
  `--wait`, the second with the same `--id` (same deliveryId back).
- `status-*.json`: `openbot-cli status Autopilot <deliveryId> --json`, while a question waits
  (`running`) and after it was answered (`completed`; `answer` is the model's text).
- `pending-prompt.json`: `GET <url>/v1/agents/<agent id>/pending` while one question waited.
- `answer-unoffered-label.txt`, `answer-second-409.txt`: `POST …/prompts/<requestId>/answer` with
  `{"answers":{"reply":["settled"]}}`, the reply body and its HTTP status, once and again.
- `openbot-db-*.json`: `payload_json` of `orchestration_events` rows in `~/.config/OpenBot/openbot.db`
  (`prompt.requested`; `prompt.resolved` after a phone tap, `green`, and after typed text, `teal`).
  `openbot-db-orchestration-events.schema.sql` is that table's schema; tests seed temp databases
  from it.
- `draft-reply.json`: a completed draft run (`status --json`); its `answer` is the JSON the draft
  wording asks for.
