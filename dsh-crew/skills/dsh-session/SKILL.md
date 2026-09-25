---
name: dsh-session
description: How an orchestrator outside DeepSeek Harness drives a dsh session through the dsh web /api — log in, create a session on a preset where it shows in the operator's web UI, select its model, send it messages (steer, never queue, to a running spine driver), change a queued message, and read its transcript for delivery, pending questions, turn end and context fill; then hand a spine to a successor session. Use when the user says spawn a dsh session, start a spine in dsh, message or steer the dsh driver, is the driver waiting on a question, how full is its context, or hand the spine to a fresh dsh session. Not the spine's own procedure (dsh-executor) and not the child prompts (dsh-brief).
---

# dsh session — driving a dsh session from outside

## 1. You are here

You are an orchestrator outside dsh, with a shell on the dsh host. The operator's surface is
the **browser**: every dsh session you start is created through the web `/api`, so it appears
in the web UI at once, where the operator watches it and answers its questions. Never start a
spine as a headless `dsh --profile …` run. dsh never registers such a session in the UI, and it
cannot ask, so its first gap ends it (`references/presets.md` §5 and §7 in this plugin).

Every call below is **one HTTP POST**. Compose it with `curl` from what this file says; there
is no client library, by design. The exception is the transcript (§7), which you read from
disk.

## 2. Log in

- **Server.** `http://127.0.0.1:3080`, the loopback address `dsh web` listens on, from the dsh
  host itself. That address needs no `--trusted-host`; any other authority does.
- **Token.** `dsh web` logs `dsh web: http://127.0.0.1:3080/?token=…` at every start; take
  the newest one. **The token is a credential**: capture it straight into a variable and
  never let it reach stdout, a message, a file you keep, or a commit. A bare lookup
  pipeline prints it into your transcript, so never run one on its own.
- **Cookie.** `GET /?token=…` with a cookie jar answers 303 and sets the session cookie. Every
  `/api` call sends that jar. Keep the jar in a private temp directory and delete it when you
  are done. For `dsh web` as a systemd user unit, capture and log in in one command, printing
  only the status code (`journalctl` reads the journal files, so a fresh non-login shell
  needs no session variables for this):

  ```bash
  jar="$(mktemp -d)/jar"
  tok="$(journalctl --user -u dsh-web | grep -oE 'token=[A-Za-z0-9_-]+' | tail -1)"
  curl -s -o /dev/null -w '%{http_code}\n' -c "$jar" "http://127.0.0.1:3080/?$tok"; unset tok
  ```

  The shell may not keep variables or files between your tool calls, so when it is fresh per
  call, run the calls you need in that same command.
- **Status codes.** 401 means not logged in. 403 means the authority is not trusted; it is
  checked before login.

## 3. The call shape

`POST /api/<method>`, `content-type: application/json`, body:

```json
{"type": "client-request", "rpcId": "<fresh uuid>", "method": "<method>",
 "payload": {"args": {"request": { … }}}}
```

The request object always goes inside `payload.args.request`. The answer is
`{"type": "server-response", "rpcId": …, "result": {"ok": true, "value": { … }}}`. Read
`result.ok` on every call, and on `false` stop and report the whole `result`.

| Method | `request` | `value` |
|---|---|---|
| `session/create` | `{"cwd": "<abs path>", "agentPreset": "<preset>"}`, or `workspaceId` in place of `cwd` | `{"sessionId", "agentPreset"}` |
| `session/selectModel` | `{"sessionId", "provider", "model", "reasoningEffort"?}` | `{"selected": {"provider", "model", "reasoningEffort"}}` |
| `session/prompt` | `{"requestId": "<fresh uuid>", "sessionId", "mode": "steer" \| "queue", "content": [{"type": "text", "text": "…"}]}` | `{"accepted": true}` |
| `session/updateQueue` | `{"sessionId", "itemId", "action": {"kind": "remove"} \| {"kind": "steer"} \| {"kind": "edit", "content": […]}}` | `{"accepted": true}` |
| `session/rename` | `{"sessionId", "title"}` | `{"title", "seq"}` |
| `session/cancel` | `{"sessionId"}`: ends the active turn and keeps pending messages | `{"accepted": true}` |
| `workspace/archiveSession` | `{"sessionId"}`: hides the session from the workspace list; its transcript stays on disk, and there is no hard delete. Only with no open turn (§7). | `{"archivedSessionIds": [ … ]}`, the complete set |

## 4. Spawn a session

1. **Create.** `session/create` with `cwd`, the absolute path the session works in (for a
   spine: the project's AI workspace), and `agentPreset` (for a spine: `crew-spine`). Check
   that `value.agentPreset` echoes the preset you asked for. The session is in the UI now.
2. **Select its model. Always, before the first prompt.** A new session takes the model
   **last selected anywhere on the host**, on any profile, not its preset's. Pass the route
   the operator chose for this session; with none named, use `agent-default-model` from
   `~/.dsh/settings.yaml`. The provider must be a route defined there. Check `value.selected`,
   because it is what the session will run.
3. **Prompt it** (§5), and **name it** with `session/rename` so the operator can find it.
   Then tell the operator its title and `sessionId`.

## 5. Send a message

`session/prompt` with a **fresh `requestId` that you keep**: it is how you confirm delivery
(§7). `accepted: true` means the message entered the session's inbox, not that the model has
read it.

- **Always `steer`.** `queue` waits for the end of the **turn**, and a spine is one long turn:
  a queued message can wait hours, and a stale one landing late can re-run steps that are
  already done. `steer` lands at the next **step** boundary. A session with no open turn
  starts one either way.
- **A steer can still wait.** A step blocked on an `ask_user_question` card, or on a child job,
  holds a steer until the step ends; 68 minutes has been measured. So **write every message to
  read true whenever it lands**: state conditions, not moments ("if PR 12 is not merged yet,
  stop at step 2 and wait"), and never "now" or "just".
- **Keep any question you ask it to relay short.** A long `ask_user_question` card in the UI
  hides its options and its Submit button (§8).

## 6. A message stuck in the queue

A queued message (yours, or one the operator sent with Ctrl/Cmd+Enter) can be changed while it
is still pending. Use `session/updateQueue` with that message's `itemId`, and one of:
`{"kind": "remove"}`, `{"kind": "steer"}` to promote it to a steer, or
`{"kind": "edit", "content": [text parts]}`. The `itemId` is in the transcript: the
`agent/inbox/spliced` event whose `data.target` is `"next-turn"` and whose `data.inserted[]`
entry has `source.rpcId` equal to that message's `requestId`. The item id is that entry's
`id`. `remove` has been used in anger; `steer` and `edit` are in dsh's API types and not yet
exercised here.

## 7. Read the session

The transcript is `~/.dsh/sessions/<cwd-slug>/<sessionId>/session.v3.jsonl.zstd`; find it with
`ls -d ~/.dsh/sessions/*/<sessionId>`. Read it with `zstd -dc`, which works while the session
is live. One JSON object per line, `{"type", "seq", "time", "data"}`. Skip a final line that
does not parse, because it may still be being written. A child's transcript is the bare-UUID
directory beside its parent's, named by the parent's `subagent/catalog` events (`data.childId`,
`data.label`).

| Question | What answers it |
|---|---|
| Was my message delivered? | A `user/message` whose `data.source.rpcId` equals your `requestId`. Before that, it sits in an `agent/inbox/spliced` entry: `data.target` `next-step` for a steer, `next-turn` for a queued message. |
| Which model is it running? | The newest `request/header`, at `data.header.config` (`provider`, `model`, `reasoningEffort`). A `model/selection` event records each `selectModel`. |
| Is it waiting on the operator? | A `tool/call` with `data.name` `ask_user_question` and no `tool/result` yet whose `data.message.source.callId` equals that call's `data.callId`. A result whose `data.error.code` is `ASK_CANCELLED` means the question was cancelled. |
| Is the turn over? | A `turn/end` whose `data.turn` matches the newest `turn/start`; `data.reason.kind` says how it ended (`completed` on success). An open turn with no pending question is working. |
| How full is its context? | The newest `assistant/message` `data.usage.totalTokens`, divided by the newest `request/context` `data.contextWindow`. |

**The session cannot see its own context fill.** You can, so watching it is your job. When the
operator's ceiling is near, hand the spine off (§9).

## 8. Questions are the operator's

A session's `ask_user_question` card is pushed to the one browser tab that holds the session,
and only that tab can answer it. You cannot answer it through `/api`. When a session is waiting
(§7), tell the operator. Include the question's text, which you can read in the `tool/call`'s
`arguments`, so the operator can decide before opening the tab.

A long card has its header capped with no scroll, and its options and Submit are unreachable.
The way out is the card's **✕**, which cancels the question: the session gets "cancelled" and
carries on, reading any message steered to it. So when a card is stuck, steer the operator's
answer to the session first (written to read true whenever it lands), then have the operator
press ✕.

## 9. Hand a spine to a successor

A spine outlives one session's context. The `crew-spine` persona carries both halves:

1. **Steer the hand-off** to the running driver: name the spine, the state you know it is in,
   and what the successor will do next, and tell it to hand off following its hand-off rule.
   It stops at the next persisted round barrier (never mid-round, so this can take a whole
   round: hand off before the ceiling, not at it), writes an ossify handoff, commits only that
   file, and reports the path. Confirm delivery, then wait for its turn to end (§7).
2. **Spawn the successor** (§4) on `crew-spine` in the same `cwd`, select its model, and
   prompt it to resume from that handoff path following its resume rule, then to carry on
   (continue the spine, or run `/close <spine-id>`). Decisions still go to the operator
   through `ask_user_question`; say so in the prompt.

## 10. Rules that cost a run to learn

- Spawn through `/api`, where the UI shows the session; never headless for a spine.
- `selectModel` on every spawn, before the first prompt.
- Always `steer`; never `queue` to a running driver.
- Write every message to read true whenever it lands.
- Confirm delivery by your `requestId` appearing as `rpcId` on a `user/message`.
- Keep questions short, and post the detail as a message first.
- Do not restart `dsh-web` while any session has an open turn. It may end that session; this
  is expected, not yet tested.
