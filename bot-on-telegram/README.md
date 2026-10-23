# bot-on-telegram

Sends [baton](../baton) notices to one Telegram chat, with buttons, and turns a button press into the
matching `baton` or `gh` command. A CLI and a long-running service; no skill, no dependencies beyond
[bun](https://bun.sh). It needs baton 0.3.1 or later (the `{key}` placeholder in `notify`).

## How it works

- `bot-on-telegram notify <key> <message>` is what baton runs for each notice. It only writes a file
  into `<state>/spool/` and exits, so baton's tick never waits on the network.
- `bot-on-telegram serve` (the service) sends the spool, in order, and long-polls Telegram for
  presses. One press runs one fixed command, with no shell and arguments taken from the button's
  own record, never from the chat.
- Only the one configured chat can press anything. A press from anywhere else is logged and ignored.

## Install

```sh
ln -sf "$PWD/bot-on-telegram/bin/bot-on-telegram" ~/.local/bin/bot-on-telegram
```

Point the symlink at the plugin directory again after a plugin update moves it. Then:

```sh
bot-on-telegram service install     # writes the user unit, enable --now
bot-on-telegram service remove
bot-on-telegram status
```

The unit carries `BATON_STATE_DIR`, `BATON_CONFIG`, `BOT_ON_TELEGRAM_CONFIG_DIR` and
`BOT_ON_TELEGRAM_STATE_DIR` as they are set when you run `service install`.

## Token and chat

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Save it where only you can read it:

   ```sh
   mkdir -p ~/.config/bot-on-telegram
   install -m 600 /dev/stdin ~/.config/bot-on-telegram/token   # paste the token, then Ctrl-D
   ```

   A token file that is not mode 600 is refused.
3. Send `/start` to your bot, then open
   `https://api.telegram.org/bot<token>/getUpdates` once and read `message.chat.id`.
4. Write `~/.config/bot-on-telegram/config.json`: `{ "chat_id": 123456789 }`.

`bot-on-telegram status` shows which of these are in place; it never prints the token.

## The baton line

In `~/.config/baton/config.json`, spell out the absolute path. The `notify` argv runs with no shell,
so `~` is not expanded:

```json
{ "notify": ["/home/<user>/.local/bin/bot-on-telegram", "notify", "{key}", "{message}"] }
```

## Buttons

| Notice | Buttons | A press runs |
|---|---|---|
| Unit parked | Unpark | `baton unpark <run> <unit>` |
| | Unpark to stage... | a stage picker, then `baton unpark <run> <unit> --to <stage>` |
| | Show question | sends the park's questions and thread; runs nothing |
| | Disarm | asks Yes/No, then `baton disarm <run>` |
| Unit moved to a stage | Merge | asks Yes/No, then `gh pr merge <pr> --merge --match-head-commit <reviewed head>` |
| | Open PR | opens the PR URL |
| | Disarm | as above |
| Run parked | Disarm | as above |

A button works once and for seven days. Pressing a spent or expired one answers "already done" or
"expired".

## State

`${BOT_ON_TELEGRAM_STATE_DIR:-~/.local/state/bot-on-telegram}`: `spool/`, `spool-failed/`,
`buttons.jsonl`, `presses.jsonl` (every press and its result), `offset`, `serve.lock`.
Only one `serve` runs at a time; a second exits with code 3.

## Known limits

- One chat only.
- A unit literally named `run` reads as a run-level park.
- Merge appears only when the unit has a PR and the ossify-spine `review.md` head line says which
  commit was reviewed.
- Delivery is at least once: a crash between a send and the spool delete sends that one notice again.
- A notice Telegram rejects permanently (a 4xx other than 429) is set aside in `spool-failed/`.
- A second poller on the same bot makes Telegram answer 409; `serve` logs one line and retries every 5 s.
