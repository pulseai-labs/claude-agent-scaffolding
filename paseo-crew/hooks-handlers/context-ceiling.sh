#!/usr/bin/env bash
# context-ceiling.sh — paseo-crew's context-ceiling notice (#456).
#
# Tells a session its own context figure once that figure reaches the ceiling, at the
# two moments new work starts: a prompt or a wake (UserPromptSubmit) and a Paseo
# new-work command (PreToolUse on Bash or on one of three mcp__paseo__* tools). It never
# allows, denies or asks, and it always exits 0: a hook failure must not stop a seat.
# Every Paseo agent is told, since a session does not declare what it is; only a
# coordinator seat rotates on it, and what a unit is — for that, and for a leaf's
# finish-and-report — is prose: lifecycle.md, "Rotation past the context ceiling".
#
# The figure is input + cache_creation + cache_read tokens of the latest
# non-sidechain assistant record in the transcript Claude Code names in the
# hook input. One message's usage repeats on several transcript lines, so the
# latest record is read, never a sum. The transcript format is undocumented: a
# figure that cannot be read is reported as unavailable, never guessed, and a
# usage object that does not carry all three counters as numbers does not carry
# the figure.

set +e

[ -n "${PASEO_AGENT_ID:-}" ] || exit 0    # inert outside Paseo agents

DEFAULT_CEILING=500000
TAIL_BYTES=4000000    # the latest assistant record sits in the transcript's tail

# The ceiling is the manifest's `context_ceiling` option, and the two ends have to agree on what a
# valid one is (#611). The manifest states the widest thing its schema can — `type: number, min: 1`;
# Claude Code 2.1.284's option schema is `z(["string","number","boolean","directory","file"])` on a
# strict object, so a manifest cannot say "integer" — and a hook is handed `String(value)` of the
# stored number. `100000.5` therefore arrives as that text, `1e+21` as the exponent form `String()`
# switches to past 1e21, and `Infinity` for a literal past 1e308, where the digits-only guard this
# replaces dropped all three to the default in silence, at the threshold the operator chose.
#
# The value is jq's answer, not a case pattern's — the same parser the rest of this hook already
# trusts. The SPELLING is stated here rather than left to that parser, because jq's is wider than the
# schema's and not the same in every build. Measured on 1.7.1 and 1.8.1: `tonumber` reads `" 12 "`,
# `12 `, `12<TAB>` and `12<NL>` on the first where the second refuses every one of them, and both
# builds read `+5` and `1.` — none of which `String()` of a JSON number ever emits. The pattern below
# is the JSON number grammar, anchored `\A`/`\z` rather than `^`/`$`: measured, `$` matches before a
# trailing newline, so `12<NL>` would pass as 12.
#
# Three rules, and the option's description states the same three: the spelling must be a JSON number;
# the value must be a number equal to itself — the one number that is not is NaN, and NaN is not a
# ceiling — and at least 1, the schema's `min`; anything else is the default. `Infinity` is the one
# spelling `String()` emits that JSON cannot hold, and it is kept as its own text: it is above every
# figure a transcript can carry, and reporting the default instead would name a ceiling nobody set.
#
# Two variables, because the two jobs differ. `ceiling_raw` is the setting as it arrived. `ceiling` is
# the text the notices name as the ceiling in force: jq's rendering where jq decided it, and on the
# paths where jq cannot run at all — no jq on PATH, or a jq that fails — the setting itself, kept only
# when every character of it is one a number may carry and no other, so that splicing it into the
# notice cannot break the JSON this hook prints. Arbitrary text names no ceiling: it is never escaped
# by hand, and it is never replaced by the default either, because that would report a ceiling the
# operator did not set (#615 F1, F2).
ceiling_raw="${CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING:-}"
case "$ceiling_raw" in
  '')                ceiling="$DEFAULT_CEILING" ;;    # no option: the default is the ceiling in force
  *[!0-9.eE+-]*)     ceiling='' ;;                    # text no unescaped splice may carry
  *)                 ceiling="$ceiling_raw" ;;        # number-shaped: name it as the operator wrote it
esac

input="$(cat)"

# Paseo's new-work forms, in one list: the fast path below and the PreToolUse
# matcher both read it, so a verb rename is one edit and the suite's seven-form
# loop keys on the same seven strings — three mcp__paseo__* tool names, matched
# against the whole hook input, and four CLI verb substrings, matched against
# tool_input.command. Matched by substring, so a command that merely mentions
# one of those forms also fires; that is deliberate — the notice is advisory and
# never a block, and narrowing the pattern risks missing the real forms (a
# wrapper alias for `paseo send`, a profile-qualified `paseo run`). `paseo
# inspect`, `paseo ls`, `paseo status` and the two read-only MCP tools carry
# none of the seven and stay silent.
NEW_WORK_VERBS=('mcp__paseo__create_agent' 'mcp__paseo__send_agent_prompt' 'mcp__paseo__create_workspace' 'paseo run' 'paseo send' 'paseo agent run' 'paseo agent send')

new_work() { # <text> — does the text carry one of those verbs?
  for verb in "${NEW_WORK_VERBS[@]}"; do
    case "$1" in *"$verb"*) return 0 ;; esac
  done
  return 1
}

case "$input" in    # fast path: most Bash calls are not Paseo new-work commands
  *UserPromptSubmit*) ;;
  *) new_work "$input" || exit 0 ;;
esac

# molt wins the context boundary (autonomic + molt spec, D9). In a session where the
# molt mod is active, molt hands the session off in place at its own threshold, and
# this notice would order a second, conflicting rotation: two tops on one run. molt
# keeps one marker per session fresh on every prompt and turn. A marker older than a
# day is stale (a crash skipped its removal) and is ignored. Without find on PATH the
# marker cannot be dated, so the hook speaks as before.
session_of() { # <hook input> — its session_id, or empty
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r '.session_id? // "" | tostring' 2>/dev/null
  else
    case "$1" in *'"session_id":"'*) s="${1#*\"session_id\":\"}"; printf '%s' "${s%%\"*}" ;; esac
  fi
}
molt_active() { # <session id> — is a fresh molt marker there for it?
  case "$1" in ''|*[!A-Za-z0-9_-]*) return 1 ;; esac
  [ -n "${HOME:-}" ] || return 1
  m="$HOME/.claude/state/molt/active/$1"
  [ -f "$m" ] || return 1
  [ -n "$(find "$m" -mmin -1440 2>/dev/null)" ]
}
molt_active "$(session_of "$input")" && exit 0

# say <event> <line> — every caller passes a line with no double quote or backslash. The ceiling in a
# line is jq's rendering of the number in force; on the paths where jq cannot run it is the setting
# itself, and only when every character of that is one a number may carry (the `case` at the top).
# Nothing else reaches a line, which is what keeps this template's output parseable JSON (#615 F1).
say() {
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$1" "$2"
}

unavailable() { # <event> <reason>
  # Two forms, because there are two states of knowing: a ceiling in force that can be named, and a
  # setting nothing could read. The second names no number at all — quoting the default there would
  # report a ceiling the operator did not set, which is what F1 and F2 are about.
  if [ -n "$ceiling" ]; then
    say "$1" "paseo-crew: context figure unavailable ($2); the ceiling of $ceiling tokens was not checked."
  else
    say "$1" "paseo-crew: context figure unavailable ($2); no ceiling could be read from the setting, so none was checked."
  fi
}

# event_in_raw <input> — the event the raw input names, for the two paths where
# the input is read as text because jq cannot read it: jq is not on PATH, or it
# failed on the input. The fast path above has already matched, so the spelling
# settles only which event a notice belongs to: a prompt, or a new-work command
# on the wake path this plugin's own doorbell makes ordinary.
#
# The separators are the three a JSON writer produces — compact, one space after
# the colon, and one space on either side of it (an indented or tab-indented
# writer still emits one of the three between the key and its colon). What stays
# outside is other spacing between the key and its colon: two spaces, a tab, a
# newline. No standard writer emits those, and the key/value adjacency is kept
# deliberately — a pattern loose enough to match any whitespace would also let a
# mention inside a command's own text attribute a notice to the wrong event.
event_in_raw() {
  case "$1" in
    *'"hook_event_name":"UserPromptSubmit"'*|*'"hook_event_name": "UserPromptSubmit"'*|*'"hook_event_name" : "UserPromptSubmit"'*) printf '%s' UserPromptSubmit ;;
    *'"hook_event_name":"PreToolUse"'*|*'"hook_event_name": "PreToolUse"'*|*'"hook_event_name" : "PreToolUse"'*) printf '%s' PreToolUse ;;
  esac
}

if ! command -v jq >/dev/null 2>&1; then
  # Without jq there is no figure to read on either event, so both are told — and no comparison
  # either, so the ceiling the notice names is what the `case` above kept: number-shaped text as the
  # operator wrote it, or nothing at all for text no unescaped splice may carry.
  event="$(event_in_raw "$input")"
  [ -n "$event" ] && unavailable "$event" "jq not found"
  exit 0
fi

# The option's verdict, before any notice can quote a ceiling. `tostring` of the number in force is
# what the notices print — for every setting an operator writes in decimal it is the text they wrote,
# and for an exponent form it is jq's spelling of the same number — so out of a value jq has read, a
# quote, a backslash or a newline cannot reach a line this hook prints as JSON.
#
# `// null` is what makes the program total, and the exit status is the other half of it. A
# `tonumber?` that refuses a spelling yields NO value rather than null, so without the `//` the
# program would print nothing and this layer could not tell a refused spelling from a jq that never
# ran — which is the distinction this repair rests on:
#
#   jq ran and refused the spelling → it has answered: the default is in force (a refusal and a value
#                                    below 1 are the same answer, and the description says so);
#   jq failed, or jq is not there   → it has answered nothing, and the setting `case`d above stands.
#
# Taking the verdict only on jq's success is that rule in one line, and it is the whole of F2: a
# ceiling the operator set is never overwritten by one they did not because a parser broke.
#
# This is one jq spawn on the armed paths, and it is deliberately not folded into the field pass
# below: that pass reads the hook payload, its fields' emptiness is already three verdicts, and the
# raw path a failed jq takes — where this setting still has to be quoted — has no fields at all.
if [ -n "$ceiling_raw" ]; then
  verdict="$(jq -nr --arg s "$ceiling_raw" --argjson d "$DEFAULT_CEILING" '
    (($s | tonumber?) // null) as $c
    | if $s == "Infinity" then $s
      elif ($s | test("\\A-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][-+]?[0-9]+)?\\z"))
           and ($c == $c) and $c >= 1
        then ($c | tostring)
        else ($d | tostring) end' 2>/dev/null)" && ceiling="$verdict"
fi

# One jq pass reads the three fields the verdicts need — the event, the
# PreToolUse command, and the transcript path — where each had its own spawn
# before: two on a prompt, three on an armed new-work command. The tail's own
# pass below is separate and stays, since it reads a file's tail rather than the
# payload. The pass is gated exactly as the three spawns were: a jq that fails
# on the input leaves all three fields empty, and each field's emptiness is then
# the verdict it always was — the event's gate below runs the raw path, an empty
# command fails the new-work match (a non-new-work command stays silent), and an
# empty transcript is its own notice.
#
# The command field carries tool_name ahead of tool_input.command, space-joined:
# an mcp__paseo__* new-work call has no tool_input.command at all, only a
# tool_name, so the field the deep match runs on must hold both — the fast path
# above already reads the whole raw input and would otherwise pass an MCP call
# through to a match this field alone could not win.
#
# `.tool_input.command?` is optional indexing, not `.tool_input.command`: this
# hook now reads .tool_input on the prompt path too, where the per-field spawns
# never did, and a `tool_input` that is a scalar or an array raises on the index
# — an error `// ""` cannot catch, which would take the whole pass down with it
# and move the verdict in both directions (a prompt losing the figure's own
# notice, a wake command inventing a "could not read" one). The other two fields
# need no guard: they raise only when the payload itself is not an object, and
# then the hook's first field raises too, which is the raw path both hooks take.
#
# @tsv, never a literal tab join: it escapes the bytes that would break the row
# — a tab, a newline, a carriage return and a backslash, as `\t`, `\n`, `\r`
# and `\\`, and a NUL as `\0` beside them — so the record can split only at the
# two tabs jq emitted. The decode below is the spec for those five.
# `map(tostring)` keeps a field that is not a string the text the per-field
# spawns printed — @tsv refuses a container outright ("object (...) is not valid
# in a csv row"), and one such field would take the whole pass, event included,
# down the raw path with it — and `// ""` keeps an absent field empty instead of
# the string "null", which is what the event's gate below reads.
fields="$(printf '%s' "$input" | jq -r '[(.hook_event_name // ""), ((.tool_name // "" | tostring) + " " + (.tool_input.command? // "" | tostring)), (.transcript_path // "")] | map(tostring) | @tsv' 2>/dev/null)"
# Split at the two tabs jq emitted: parameter expansion, not `read`. With IFS
# set to a tab, `read` collapses a run of tabs, so an empty command between two
# non-empty fields — a Bash call whose command field is empty — would take the
# transcript's place and read the wrong record.
event="${fields%%$'\t'*}"
rest="${fields#*$'\t'}"
command="${rest%%$'\t'*}"
transcript="${rest#*$'\t'}"
# The three fields are put back the way those spawns' captures had them: every
# verdict below was built on that text, so none of them may read differently.
# The capture is `$( )`, which did two things to each value, and the decode does
# both: a NUL byte cannot live in a bash variable, so it dropped every one, and
# it strips every trailing newline.
#
# The escapes are jq's own `@tsv` definition plus one it does not document.
# Measured on jq-1.8.1, every `\u00XX` from 00 to ff written in a value and read
# back with `jq -r '[.a] | @tsv'`: a tab, a newline, a carriage return and a
# backslash arrive as `\t`, `\n`, `\r` and `\\`, and a NUL as `\0`. Nothing else
# is backslashed — the rest of the control bytes, DEL, VT and FF included, pass
# through raw — so a field is runs of text and those five two-character escapes,
# and there is no sixth for a decoder to guess at.
#
# The order is the whole difficulty, and the first substitution is what makes
# the rest safe. A value's own backslash arrives as `\\`, so `win\\temp` is the
# characters `\`, `\`, `t`, `e`...: decode `\t` before that pair and a name with
# a backslash-t in it becomes a name with a tab, which is the name that exists
# nowhere. `\\` therefore becomes a sentinel first — a backslash and a tab, a
# pair no field can hold, because @tsv escapes every tab a value carries and the
# split above has already taken jq's two. After it, every backslash left
# introduces exactly one of t, n, r or 0, so each later substitution matches the
# escape it names and nothing else, and the sentinel is the only backslash-tab.
#
# printf's `%b` is not this decode either, and both halves of that are measured:
# it reads `\0` as the head of a C octal escape — the field `a\0123b`, which is
# what a NUL followed by `123` arrives as, comes back `aSb` where the capture
# had `a123b` — and it cuts the field off at the NUL, where the capture dropped
# the byte and kept the rest of the text.
#
# The capture's own reading is the one the verdicts are built on, and one row of
# it is visible: a value ending in a newline is stripped to the name before it —
# the name the spawns opened, and the name the guards below test — so a path
# whose OWN name ends in a newline is not opened here, where the round trip's
# exact name would have opened it. Measured against the base hook (`5973a7b`):
# base silent, this head silent, the round trip's exact name reads a figure.
# That is the capture's reading and not a new rule, taken because every row a
# writer can produce keeps the base hook's verdict with it.
decode_tsv() { # <name> — decode that variable's value in place
  local field="${!1}" bs='\\' byte='\' tab=$'\t' nl=$'\n' cr=$'\r' sent
  case "$field" in *\\*) ;; *) return 0 ;; esac    # nothing escaped: every path
  sent="$byte$tab"
  field="${field//$bs$bs/$sent}"      # a value's own backslash, out of the way first
  field="${field//$bs'0'/}"           # a NUL byte: dropped, as the capture dropped it
  field="${field//$bs't'/$tab}"       # a tab
  field="${field//$bs'n'/$nl}"        # a newline
  field="${field//$bs'r'/$cr}"        # a carriage return
  field="${field//$bs$tab/$byte}"     # and the value's own backslashes back
  while [ "${field%$nl}" != "$field" ]; do field="${field%$nl}"; done   # the capture's strip
  printf -v "$1" '%s' "$field"
}
decode_tsv event
decode_tsv command
decode_tsv transcript
if [ -z "$event" ]; then
  # jq read no event: the input is malformed, or the jq on PATH is broken.
  # Either way the figure was not read, and the same raw spellings say which
  # event a notice belongs to — silence here would be the very pass this hook
  # exists to prevent.
  event="$(event_in_raw "$input")"
  [ -n "$event" ] && unavailable "$event" "jq could not read the hook input"
  exit 0
fi
case "$event" in
  UserPromptSubmit) ;;
  PreToolUse) new_work "$command" || exit 0 ;;
  *) exit 0 ;;
esac

if [ -z "$transcript" ]; then unavailable "$event" "hook input has no transcript_path"; exit 0; fi
# A session's first prompt can precede its transcript, so a path that names
# nothing at all is silent. A path that names something the handler cannot read
# is not that case: an unreadable file, a directory, a fifo or a broken link is
# drift under a running session, the figure was not read, and the header forbids
# passing that over in silence. `-f` also keeps the tail off an entry that would
# block on it.
if [ ! -e "$transcript" ] && [ ! -L "$transcript" ]; then exit 0; fi
if [ ! -f "$transcript" ] || [ ! -r "$transcript" ]; then
  unavailable "$event" "transcript is not a readable file"; exit 0
fi

# One jq pass over the tail classifies it: "figure <n>" (the latest assistant
# record's usage summed), "nousage" (that record's usage is not a readable
# object carrying all three counters — an older record's figure is never
# substituted), "stale" (an unparseable line sits AFTER the latest parseable
# assistant record, so a newer figure may exist unread — the older figure is
# never passed off as the current one), "none" (no assistant record and every
# line parses) or "partial" (no assistant record readable — a malformed or
# truncated tail cannot be told from a lost record). A whitespace-only line is
# not unparseable content: it carries no record. A malformed line BEFORE the
# record the figure comes from is tolerated — the `tail -c` cut opens on a
# half line by construction.
#
# The tail's own status is the verdict's business, and the pipeline is the only
# place it can be read: without pipefail the substitution reports jq's status, so
# a tail that cannot be run at all — a PATH without one — exits 0 here and its
# empty output classifies as "none": a silence with a figure unread, which is the
# class this hook exists to remove. A read that fails where `-r` passed, and a jq
# that fails on the tail, land here too; in all three the tail's content could
# not be read, which is what the notice says.
set -o pipefail
verdict="$(tail -c "$TAIL_BYTES" "$transcript" 2>/dev/null | jq -Rrn '
  [inputs] as $lines
  | [ range(0; ($lines | length)) as $i
      | ($lines[$i] | try {ok: fromjson} catch {bad: true}) as $r
      | {i: $i, raw: $lines[$i], ok: ($r | has("ok")), record: ($r.ok // null)} ] as $rows
  | ([$rows[] | select(.ok and .record.type? == "assistant"
                       and .record.isSidechain? != true)]) as $a
  | if ($a | length) > 0 then
      ($a[-1].i) as $last
      # Position is the whole point: unparseable text that may be NEWER than the
      # record the figure would come from ("stale") is not the same case as
      # unparseable text before it, which the tail cut explains.
      | if ([$rows[] | select((.ok | not) and .i > $last
                               and ((.raw | test("^\\s*$")) | not))] | length) > 0
        then "stale"
        else
      (try ($a[-1].record.message.usage) catch null) as $u
      # Every one of the three counters must be present as a number. Reading
      # them with `// 0` turned an absent or renamed counter into a real figure
      # of zero — below any ceiling, so the check passed in silence. A usage
      # object the handler cannot read that way is "nousage": never a guess.
      # Keys the handler does not know are none of its business.
      | if ($u | type) == "object"
           and ($u.input_tokens | type) == "number"
           and ($u.cache_creation_input_tokens | type) == "number"
           and ($u.cache_read_input_tokens | type) == "number"
        then "figure \($u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens)"
        else "nousage" end
        end
    elif ([$rows[] | select(.ok | not)] | length) > 0 then "partial"
    else "none" end' 2>/dev/null)"
tail_status=$?
set +o pipefail
if [ "$tail_status" -ne 0 ]; then
  unavailable "$event" "the transcript's tail could not be read"; exit 0
fi

case "$verdict" in
  figure\ *) figure="${verdict#figure }" ;;
  nousage) unavailable "$event" "no readable usage in the latest assistant record"; exit 0 ;;
  stale) unavailable "$event" "unparseable content newer than the last assistant record"; exit 0 ;;
  none)
    # The tail is the whole transcript only when the file fits in it; a longer
    # transcript may have put its latest assistant record before the tail. The
    # size is read under its own guard: the redirection can still fail on a file
    # that became unreadable after the guard above, and an empty size would take
    # the `-gt` test to an integer-expression error and out of the handler with
    # no notice, which is the same defect one line down.
    size="$(wc -c < "$transcript" 2>/dev/null | tr -d '[:space:]')"
    case "$size" in
      ''|*[!0-9]*) unavailable "$event" "the transcript's size could not be read"; exit 0 ;;
    esac
    if [ "$size" -gt "$TAIL_BYTES" ]; then
      unavailable "$event" "no assistant record in the last $TAIL_BYTES transcript bytes"; exit 0
    fi
    exit 0 ;;    # no assistant turn yet: nothing to measure
  *) unavailable "$event" "no readable assistant record in the transcript tail"; exit 0 ;;
esac

case "$figure" in
  ''|*[!0-9]*) unavailable "$event" "no readable usage in the latest assistant record"; exit 0 ;;
esac

# jq compares, and bash does not: the ceiling may be a fraction — `100000.5` fires at the next whole
# token, which is the exact `figure >= ceiling` for a whole-number figure, not a floor — or an
# exponent form, which `-ge` would refuse outright rather than compare. `false` and a ceiling jq
# cannot parse — the empty text included, which is the state of a setting nothing could read — are the
# same verdict here, silence, and for the largest value jq holds that verdict is the exact one: no
# figure reaches it.
[ "$(jq -n --arg f "$figure" --arg c "$ceiling" '($f | tonumber) >= ($c | tonumber)' 2>/dev/null)" = true ] || exit 0
say "$event" "paseo-crew: context $figure >= ceiling $ceiling tokens. Finish the unit in hand and start no new one; a coordinator seat rotates at its next boundary (paseo-crew lifecycle.md, Rotation past the context ceiling)."
exit 0
