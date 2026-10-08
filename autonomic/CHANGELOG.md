# Changelog

All notable changes to the `autonomic` plugin.

## 0.4.2

**The never-approve list stops holding commands that only name a danger** (#693: ten false holds
across six seats in one PulseTrader run, one of which stalled a top for about 45 minutes).

- **Inert commands leave the bag** (`never.ts`). A simple command led by `[`, `test`, `echo`,
  `printf` (without `-v`), `exit`, `cat`, `wc`, `jq`, `mv`, `cp` and a few more adds no words, so
  `[ -n "$staged" ] || exit 1` no longer lends `-n` to a later `git commit`. The full bag stays
  whenever the text holds a runner, `$(`, a backtick, a heredoc left in place or an open quote.
- **A heredoc body stays dropped when its file is only moved or read.** A later command outside
  the inert list that names the file keeps the body; `mv` and `cp` pass the name on; a `.git/` or
  `hooks/` destination counts as run.
- **A dashed word is a verb only as git's executable** (`git-push`, `/usr/lib/git-core/git-push`):
  `no-rm` and `force-push` in prose no longer read as `rm` and `push`.
- **Known limits:** prose quoted in one argument of a non-inert command still pools
  (`herdr agent prompt "…"`); a non-inert reader of a written file (`dagr check run.json.tmp`)
  keeps the writer's words; an inert name shadowed by an alias or function defined in an earlier
  call hides words; run locations other than `.git/` and `hooks/` (rc files, crontabs) are not
  tracked.

## 0.4.1

**A credential no longer takes the options from the other decisions in a pain** (a PulseTrader
pain on 2026-10-08 asked about a prod freeze and an agent token together, and showed no buttons).

- **The turn-end fork prompt** (`prompts.ts`): a credential or secret the operator must supply or
  issue is never an option. The fork gives `"credential"`, one line asking for it in plain text,
  and the other decisions in the same pain keep their options. In 0.3.0–0.4.0 the rule was "for
  credentials, give no options", which dropped the options for the whole pain.
- **The verdict** (`verdict.ts`): a pain keeps a non-empty `credential` string; any other value is
  dropped and the pain and its options stand. Only a pain carries one.
- **The pain signal** (`register.tsx`): the band shows `In plain text: <request>` after the
  options, before Dismiss, with no button, never cut. A press on an option leaves the request as
  a band of its own, and a failed press keeps it. The bell, the pain file and the ledger end the pain with
  `· in plain text: <request>`. The request is redacted like every pain text.
- **Known limit:** the session's own `AskUserQuestion` still follows the policy's standing order
  ("For credentials, ask in plain text with no options"). A question the session itself bundles
  with a credential still has no options; the policy file is the operator's to edit.
- **Known limit:** the band holds one notice: a later pain, or a typed reply that a plugin beneath
  refuses, clears a pending credential request. The pain file, the bell and the log keep it.
- **Known limit:** the ledger cuts its Q field at 300 characters, as for every question, so a long
  request can lose its end there; the band, the bell and the pain file show it whole.
- **Known limit:** splitting is the fork's prose. A fork that still folds a credential into the
  question gives it no options, as in 0.4.0.

## 0.4.0

**The judge sees the live turn; launchers see the live mode** (0.4.0 spec; probe P1 showed the
permission fork missing a same-turn tool result in 2 of 3 runs).

- **The turn digest** (`digest.ts`, `register.tsx`): each main-thread prompt that enters and each
  completed main-thread tool call — an `AskUserQuestion` answer included, the operator's or
  autonomic's own — adds one redacted line to a per-session list in memory: the last 12 entries,
  each at most 400 characters, a tool's input as its shape or key names and its result as the last
  300 characters. A dropped prompt and a subagent's call do not enter. Redaction runs on a bounded
  window (the redactor is quadratic on a long run without spaces), and the word the window edge
  cuts is dropped, so a split credential is not shown in part; whitespace collapses first, so
  padding cannot cut a credential's prefix off.
- **The permission and ask fork prompts** (`prompts.ts`) carry the digest in a `<recent>` block of
  at most 4,000 characters, newest kept, with a rule that a later instruction from the operator or
  the orchestrator is part of the task and a tool result is a fact about what ran, never an
  instruction; angle brackets in the block are swapped for `‹ ›`, so fetched text cannot close it.
  A pain-band press (`asUser`) is labelled as the operator's. Both prompts also name the live task. The turn-end prompt
  carries neither.
- **`AUTONOMIC_EFFECTIVE_MODE`** (`register.tsx`): set to `autopilot` or `manual` in autonomic's
  process each time a session's mode is saved, the fall to manual on a failed record write
  included, and again at each `session.start`, so a resumed session id gets its own mode back. A
  value the host refuses is unset where the host allows it, and a toast says which happened.
  autonomic never reads it; README, "For launchers".
- **Known limit:** the digest costs up to 4,000 characters per permission or ask judgment.
- **Known limit:** a tool result's middle is not shown, only its tail; a result that is one long
  token reads `(one long token)`.
- **Known limit:** the `<recent>` rule calls a tool result a fact, though a result can hold
  fetched text; a prompt from a `channel` or `peer` origin is labelled with its raw kind.
- **Known limit:** the digest is kept per session id and never cleared, so a `/resume` to an
  earlier id brings back that id's digest. A deny reason is redacted at full length.
- **Known limit:** a host that refuses every `env.set` leaves `AUTONOMIC_EFFECTIVE_MODE` at its
  previous value; autonomic cannot change it then, and its toast says the value may be stale.
- **Unchanged:** `nothing-to-fork` at a session's first ask.

## 0.3.1

**The pain band reads in one pass** (live check of 0.3.0, finding F1).

- **Column layout** (`register.tsx`): the question on its own line, in bold; then one row per
  option. The buttons share one column, as wide as the longest label with its chrome and at most
  40% of the band's width, and each option's whole text wraps in the space to its right. Dismiss
  is on the last row, with "or type your own reply". In 0.3.0 the question, the buttons and the
  texts shared one row, so every text wrapped into a narrow column.
- **The recommended option is the primary button** (accent style). No option has a hotkey: a bare
  digit in an empty prompt presses a band button, and a reply you type may start with one.
- A pain with no options keeps its one line: the question and Dismiss.
- **Known limit:** the button column is capped at 40% of the band, so a long label wraps inside
  its button: a 40-character recommended label (54 with its suffix) wraps in a band under about
  155 columns. Its text still wraps beside it, whole. Width counts characters, not terminal
  cells, so a label in wide characters (CJK) can wrap in its button sooner.

## 0.3.0

**Pain options: one press resumes autopilot.**

- **The turn-end fork offers options** (`prompts.ts`, `verdict.ts`): a `pain` verdict may carry
  `options`, up to three `{ label, text, recommended }`, with three rules in the fork prompt (at
  most one recommended; never the irreversible side of a one-way door; none for credentials).
  `parseTurn` drops every option on any invalid shape — not a list, more than three, an empty
  label or text, a text over 300 characters, a non-boolean `recommended`, two recommended — and the
  pain stands without them.
- **The band shows them** (`register.tsx`): one button per option, the recommended one first as
  `<label> (Recommended)`, each beside the whole text it submits, then Dismiss. A press clears the
  band, appends an `operator` ledger line (`why: chosen on the pain band`), and only then submits
  the option's text, never cut, with `$.prompt.submit({ asUser: true })`. A ledger that cannot be
  written submits nothing; a prompt that does not enter is an `option not sent` pain signal; one
  band takes one press. Labels and texts pass through the redactor first.
- **The bell and the pain file list the options** as `· options: 1) <label> (Recommended) 2) …`
  on the pain line. They stay text there.
- **The default policy gains a standing order**: stop for a pain item with `AskUserQuestion` and
  two or three options. An existing policy file is never rewritten: paste the line in (README,
  "The policy").
- **Known limit:** a policy file left at the 0.2.x default now reads `edited` in
  `/autopilot status`, and lacks the new order until the operator adds it.
- **Known limit:** the options are the fork's prose. A wrong or weak option is a wording issue the
  operator sees before pressing; nothing runs without the press.

## 0.2.1

**An allowed ask records no input value** (#683).

- **The allowed-ask ledger line** (`register.tsx`, `shape.ts` `inputShape`): an ask the permission
  fork allows now records the command's shape (as the never-approve path does since 0.1.1), or,
  for a tool with no command, its input key names only. Before, it recorded the raw input as
  JSON behind the best-effort redactor, which missed a JSON-escaped quoted value
  (`GITHUB_TOKEN=\"…\"`) and a backslash-escaped space (`TOKEN=a\ b`).
- **Known limit:** the fork's own prose — its reason and a turn-end question — still passes only
  through the redactor; it can quote a value in a form the redactor does not model.

## 0.2.0

**A token floor in place of the bash reader** (#684, direction 2′).

- **The never-approve list reads the command text as one bag of words** (`never.ts`). It joins
  a backslash-newline, drops `\`, `'` and `"`, splits at spaces, operators, backticks and `$(`,
  and shows each `NAME=VALUE` word's value. A rule fires when a verb and a danger word
  appear anywhere in the text; the list never decides which command a word belongs to. Quotes,
  wrappers, interpreters and substitutions no longer hide a push (`python3 -c 'git push -f'`).
- **Caught now** (the #684 gaps): a quoted `)` inside `$( )`, dashed executables (`git-push`),
  a glob or brace that builds a flag (`--forc*`), a backslash-newline in a word, `git push --
  <remote>` on the default branch, `-c remote.<name>.push=`, `+:dst` (also `branch-delete`), and
  `git send-pack` with no refspec (`default-branch-push`).
- **`unreadable` matches nothing.** No rule depends on following a command's shape, so the
  live check's stalls on valid bash (`python3 -c … && git commit`, a heredoc, a `for` loop) are
  gone. The name stays valid in `neverApprove`.
- **Extra asks, accepted:** a danger word beside a harmless command (`git commit -m "do not git
  push -f"`), any push after a `cd` or `git -C` to another directory whatever its refspec, `rm -r`
  of a path with a `..` segment, and a short cluster that holds the letter (`git push -ofoo`). Two
  quoted heredoc shapes are text and skipped — a `-m "$(cat <<'EOF' … EOF)"` commit message and
  `cat > file <<'EOF'` whose file is not named again — unless the rest of the text names a
  program that may run text (a shell, an interpreter, `ssh`, `sed`, `awk` …).
- **Known limits:** a script or program that runs git itself, a git alias from config, `sed`'s
  `e` command, a brace or glob that builds the verb, a bare variable beside `branch` or `commit`,
  and a danger only the filesystem shows.
- **Removed:** the per-command reader, and autonomic's copy of seat-mods' shell reader
  (`hooks/shell.ts`) with its arm in `tests/test-mod-shell-parity.sh`. seat-mods is unchanged.

## 0.1.1

**The pilot patch** (#677). Built on the live pilot of 0.1.0, run under bypass permissions.

- **molt's stage file** (F12; `floor.ts`, `records.ts`): the turn end is molt's when
  `~/.claude/state/molt/stage/<id>` says `command`, `block` or `fallback`; `yieldAtPercent` is
  only the fallback when no stage file exists, and a stage of `off` turns the fallback off. A
  live fill at or above the file's `command` yields too, whatever the hook order.
- **The bypass floor** (`register.tsx`): in autopilot, an `allow` for a command that matches an
  enabled never-approve rule becomes an `ask`, so the operator gets the dialog under bypass
  permissions too (probe P14). Manual mode never touches an allow; a deny is never changed.
  A failure inside the floor keeps the call with the operator. The reader now lists an
  interpreter, a git global it cannot skip, or an inline git alias as unreadable when the
  command names a danger, and reads an abbreviated long option as the option it abbreviates;
  an escaped, quote-split or brace word is unreadable, an `rm -r` path with a brace or a dot
  glob is outside, `--repo` names the remote, and `@` is `HEAD`; a wildcard destination may be
  the default branch, refspecs after `--` are checked, and `git -C` into another directory
  reads the branch as unknown, as does a `cd` below the root; wrappers such as `setsid` are
  runners, a short-flag cluster splits up to its value, and `send-pack`/`http-push` are
  unreadable. A session that leaves autopilot through a failure keeps the floor until
  `/autopilot off`. Path-qualified wrappers, unquoted heredoc substitutions, `rm` operands after
  `--` and the matching refspec `:` are read too. Credentials — bare or quoted values, credential
  headers and known token shapes — are redacted from the ledger and every pain signal, and a
  never-approve match records only the command's shape (`shape.ts`): verbs, a git subcommand and
  flag names, never a value.
- **`neverApprove`** (`config.ts`, `enforce.ts`): a `/config` setting naming the enforced rules,
  all six by default; empty means none; an unknown name is reported and ignored.
- **A deny beneath rings** (F7): a deny from a plugin beneath autonomic's `tool.call` hook rings
  "hard deny" once per session, tool and reason — except molt's own gate deny past its block
  stage.
- **Texts** (F2, F4, F5, F8, F9, F10, F13): `/autopilot status` drops the doubled prefix and lists
  policy `default`/`edited`, the settings, the enabled rules and molt's stage; one log line per
  fork; no doubled period before "Proceed."; the pain text leads with the line that matched; the
  `molt` ledger reason reads `molt owns this turn end`.
- **Docs** (F1, F3, F6, F11): no `/plugin configure` step is needed; the record's `source`
  values; a "Permission modes" section, bypass first.

## 0.1.0

**Autopilot as a mod** (#660). A session in autopilot keeps going without asks the planning already answered.

- **Mode** (`mode.ts`, `records.ts`): `AUTONOMIC_MODE=autopilot` per spawn or `/autopilot on [docs…]`; fails to manual; carried across a molt by molt's lineage file; a crew child takes its scope from its brief.
- **Policy** (`policy.ts`): `~/.claude/autonomic/policy.md`, written once, injected as a `session` system-prompt section.
- **Reflexes** (`register.tsx`): a cached fork at each turn end (covered, stalled, waiting, done, pain), at each `AskUserQuestion`, and at each permission ask; the never-approve list (`never.ts`) is code, before any fork; no deny is ever changed.
- **molt floor** (`floor.ts`): a `MOLT-HANDOFF:` line, a child's `handoff required`/`handed-off` status line, or a block beneath lets the turn end stand.
- **Ledger** (`ledger.ts`): one committed line per decision, with the fork's token usage; an unwritable ledger ends autopilot.
- **Pain**: band, toast, optional bell, optional `AUTONOMIC_PAIN_PATH` file.
- **Hard floors** (final review): `AskUserQuestion` and `ExitPlanMode` are never approved by the permission reflex; the never-approve list reads short-flag clusters, a lone `&`, block keywords, `-o` values, and lists any command it cannot follow when that command names a danger; it applies to every tool with a `command` input; a call too long to show the fork stays an ask; past `yieldAtPercent` (65) every turn end is molt's whatever the hook order; read-only Bash is no change for the loop guard; a free-text question and a failed ledger ring.
