# The dsh spine driver — spine and close seats inside DeepSeek Harness

An agent of `kind: dsh-spine-driver` is a DeepSeek Harness (dsh) session on the
`crew-spine` preset of the `dsh-crew` plugin, created through dsh's web API rather than by
running a command. It fills two roles and no other: an activated spine's **spine
session**, on the external-executor lane, and each of that spine's **close sessions**.
Every dsh mechanic below is the `dsh-session` skill's (dsh-crew); this file says when,
never how. Install `dsh-crew` beside this plugin, with the dsh home its
`references/presets.md` describes.

## 1. The agent entry

```markdown
### dsh-driver
kind: dsh-spine-driver
preset: crew-spine
route: <provider/model, as ~/.dsh/settings.yaml names it>
effort: <one of that model's reasoningEfforts>
model_shows: transcript
brief_delivery: api
can: —
```

- `kind:` marks the entry. It has no `command:`: the seat is created through the dsh web
  API, where it appears in the operator's browser at once.
- `preset:` is the dsh preset the session is created on: `crew-spine`.
- `route:` is what the session runs and the model it must show; it must be a route
  `~/.dsh/settings.yaml` defines. `effort:` is passed with it on every spawn.
- `model_shows: transcript` reads the launched model from the session's newest
  `request/header`, never from a screen.
- `brief_delivery: api` sends the brief as one steered message.
- `can: —`. The persona accepts `<spine-id> --external-executor` and `/close <spine-id>`
  as plain text; neither is a slash command.

Its resolved profile, wherever one travels:

`dsh:<preset> | model: <route> | effort: <effort> | model_shows: transcript | brief_delivery: api`

## 2. Where it can sit

| role | started by | needs |
|---|---|---|
| spine session, external-executor lane | a steered `<spine-id> --external-executor` | — |
| close session | a steered `/close <spine-id>`, in a fresh session | — |

Any other seat naming a `kind: dsh-spine-driver` agent is a configuration defect, named at
approval. The spine and close seats may name the same agent; each close is still a fresh
session.

## 3. At spine planning — `.dsh-crew/roles.md` in place of item rows

When the `spine session` seat names a `kind: dsh-spine-driver` agent, the items get no
seats from this plugin. Their implementers and verifiers are dsh child tools, with one
route per role for the whole project, from `.dsh-crew/roles.md` at the AI workspace root
(dsh-crew's `references/presets.md` §9). In the one approval phase of
`ossify-execution.md` §3:

- Recommend the three coordinator seats as usual. Where the per-item rows would go,
  recommend that file's three rows: the implementer and verifier routes and efforts, from
  the `subagent-model-selection` allow-list in `~/.dsh/settings.yaml`, and the reviewer
  (`claude-code`, `codex`, or `driver` for none).
- A reviewer other than `driver` is a tool the web profile must mount (dsh-crew's
  `references/presets.md` §8). Confirm with the operator, at approval, that the profile's
  pinned provider matches the row; the driver can check only that the tool exists.
- On approval, write `.dsh-crew/roles.md`, and record in `.herdr-crew/roles.md`'s section
  for this spine that its items run under it, with no item rows.

Unlike a brief's seats, this file is read live: the driver reads it at every round start,
and a successor re-reads it. So an edit to it reaches the next round, and it is changed
only as a new operator decision.

## 4. The item procedure is dsh-crew's

A dsh-driven spine runs its items through dsh-crew's `dsh-executor` skill, not through the
fixed procedures in `ossify-execution.md` §3 or the round procedure in
`ossify-nested-run.md` §3. There is no worker-authored plan gate. The first verifier
failure gets one correction from the driver itself, and then the driver stops the round
for the operator, never with a three-option ask. Nested worker depth is not confirmed
(`ossify-nested-run.md` §1): the child tools' `maxDepth: 1` is dsh's guard. ossify's
contract is the same on both paths.

## 5. Launching and watching

- **Spawn** each session as `dsh-session` §4 says: on its `preset:`, with the AI
  workspace as its working directory, its model selected to `route:` and `effort:` before
  the first message, and renamed so the operator can find it. Confirm the selection it
  echoes, then the transcript's first `request/header`. A mismatch is a failed launch,
  reported, exactly as a wrong model is on any seat.
- **Brief** it with one steered message (`dsh-session` §5): `<spine-id>
  --external-executor` for a spine session, with `Resume from <handoff path>, then
  continue.` prepended on a rotation; for a close, the text in §6. Confirm delivery by
  your request id.
- **The operator's questions.** The driver asks the operator in the browser itself, and
  nothing you send can answer those questions. When the transcript shows one pending, tell the
  operator its text (`dsh-session` §7, §8). This is the one place where a seat other
  than the top talks to the operator.
- **Wait** token-free: one shell wait that ends when the transcript shows the turn has
  ended, a question pending, or a context figure at or past the plugin setting
  `context_ceiling` (default 500000 tokens), bounded at 15 minutes. A timeout is a
  checkpoint, never a failure. Never spend a turn per poll.
- **The completion** is the session's final assistant message, when its turn ends with
  `reason.kind` `completed`. Treat it exactly as `ossify-nested-run.md` §4 treats the
  spine or close session's completion. A turn that ended any other way is a failed
  dispatch: report it, and dispatch nothing downstream.
- **Rotation.** dsh has no context hook, so the driver cannot see its own figure. At
  the ceiling, steer the hand-off and spawn the successor as `dsh-session` §9 says; the
  handoff path it reports is this lane's rotation completion.
- **Never** send a queued message to a running driver, and never restart `dsh web` while
  any of its sessions has an open turn.

## 6. The close, in a fresh dsh session

Every close `ossify-nested-run.md` §4 dispatches goes to **a fresh session** on the close
seat, never the spine driver's: the first close, each re-dispatch after a halt, and the
record pass. In that session dsh-crew's reviewer pass runs at close review when
`.dsh-crew/roles.md` names a reviewer, and a correction the close sends back to an item
runs through that session's own `dsh-executor`. Its one steered message:

```text
/close <spine-id>

This close is one dispatch. A `fix now` disposition of the close review ends it: stop,
and reply `halted: close-review` followed by the ledger, naming each finding, its
target_repo, its decision and the reason. On a record pass, write the accepted findings
of these ledgers into the retrospective's carried-and-lessons section, by class:
<every close review's ledger for this spine, oldest first, verbatim, or "none">.
When you stop, your last message is exactly one of: one line per PR the close opened,
`<repo> #<number> <url>`; the single word `closed`; or `halted: <step> — <evidence>`,
followed on its own line by `opened: <repo> #<n> <url> …` or `opened: none`. Whenever
the close review ran, add its ledger verbatim.
```

The close-review writers stay this plugin's own seats (`ossify-close-writer.md`).

## 7. The handoff

A handoff the top writes carries both seats' resolved profiles, the id of every dsh
session it spawned for the spine, and the fact that `.dsh-crew/roles.md` governs the
items. A resumed top reads the sessions' transcripts before sending anything.
