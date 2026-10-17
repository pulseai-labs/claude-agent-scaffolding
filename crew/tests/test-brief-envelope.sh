#!/usr/bin/env bash
#
# crew — the shared brief envelope, mechanical facts only.
#
# Spec §4.4: a brief names the layer's *send*, not one layer's command. The `PING:` and
# `MOLT:` lines and the `NOTIFY_RUN=` clause are the same in every template, so a seat
# needs to know nothing about the layer beyond the command its own brief hands it. The
# copies stay — a template is a whole contract (this file's own rule) — and only their
# layer part becomes the `<PING_SEND>` slot, defined once in the layer's `Send`.
#
# Facts:
#   1. every `PING:` line across the four brief files is byte-identical, carries the
#      `<PING_SEND>` slot, and names no layer command;
#   2. every `MOLT:` line carries the slot and the `MOLT WARNING` clause; only the line's
#      own tail differs by design (the spine session's warning returns `rotate:`, the
#      work-PR's returns `open:`), so the identity check is over the send clause;
#   3. every `NOTIFY_RUN=` clause names the layer as the one that can address the
#      dispatcher's seat, and names no layer command;
#   4. `layers/herdr.md`'s `Send` defines the slot, exactly once.
#
# Usage:   bash crew/tests/test-brief-envelope.sh
# Exit:    0 if every fact holds; 1 otherwise.
# Deps:    bash 3.2+, grep, sort, awk.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="$PLUGIN_ROOT/skills/orchestrate/references"
LAYER_MD="$REF/layers/herdr.md"

# The four files that carry a brief envelope. Each names them the same way: a template is
# whole, so its envelope is whole too.
ENVELOPE_FILES='briefs.md ossify-briefs.md ossify-pr-briefs.md ossify-close-writer.md'

# The MOLT send clause. `grep -E` for the per-line test, and the same text as the identity
# check's subject: everything from `MOLT:` through the `(read as PING says; ...)` clause.
MOLT_CLAUSE_RE='^MOLT: if molt warns you, send one ping, `<PING_SEND> '"'"'MOLT WARNING <pct> <(task id|SPINE_ID)>'"'"'` \(read as PING says; never when NOTIFY_RUN is `none`\)'

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

# One line per violation, reading the four files out of <dir>. A directory, not the real
# tree, so the controls below can run the same predicate over a fixture.
envelope_findings() { # <dir holding the four brief files>
  local dir="$1" files ping n molts notifies l

  files=""
  for l in $ENVELOPE_FILES; do files="$files $dir/$l"; done

  # 1. The PING: lines: one byte-identical line, with the slot, naming no layer command.
  ping="$(grep -h '^PING:' $files)"
  if [ -z "$ping" ]; then
    printf 'no PING: line in the four brief files\n'
  else
    n="$(printf '%s\n' "$ping" | sort -u | wc -l | tr -d ' ')"
    [ "$n" -eq 1 ] || printf 'the PING: lines are %s distinct lines, not one\n' "$n"
    printf '%s\n' "$ping" | grep -F '<PING_SEND>' >/dev/null || printf 'a PING: line carries no <PING_SEND> slot\n'
    printf '%s\n' "$ping" | grep -F 'herdr' >/dev/null && printf 'a PING: line names a layer command\n'
  fi

  # 2. The MOLT: lines: every one carries the same send clause.
  molts="$(grep -hc '^MOLT:' $files | awk '{s += $1} END {print s + 0}')"
  n="$(grep -hE "$MOLT_CLAUSE_RE" $files | wc -l | tr -d ' ')"
  [ "$n" -eq "$molts" ] || printf '%s of %s MOLT: lines carry the MOLT WARNING clause through <PING_SEND>\n' "$n" "$molts"
  grep -h '^MOLT:' $files | grep -F 'herdr' >/dev/null && printf 'a MOLT: line names a layer command\n'

  # 3. The NOTIFY_RUN= clause: the layer addresses the dispatcher's seat.
  notifies="$(grep -h 'NOTIFY_RUN=' $files)"
  printf '%s\n' "$notifies" | grep -F "when the layer can address the dispatcher's seat" >/dev/null \
    || printf 'a NOTIFY_RUN= clause does not say the layer can address the dispatcher'"'"'s seat\n'
  printf '%s\n' "$notifies" | grep -F 'herdr' >/dev/null && printf 'a NOTIFY_RUN= clause names a layer command\n'
}

printf '%screw brief envelope%s\n\n' "$DIM" "$RST"

section "the envelope names the layer's Send"

findings="$(envelope_findings "$REF")"
if [ -z "$findings" ]; then
  pass "the PING/MOLT lines and the NOTIFY_RUN clause name no layer command"
else
  fail "the PING/MOLT lines and the NOTIFY_RUN clause name no layer command" "$findings"
fi

# One envelope per template. A dropped `PING:` line leaves every fact above green — the
# survivors are still one byte-identical line — so the count is the fact that catches it:
# in each file, `PING:`, `MOLT:`, `NOTIFY_RUN=` and `PING_SEND=` are as many as the file's
# `REPORT_PATH=` fill lines (one per template).
envelope_counts() { # <file> -> "<report_path> <ping> <molt> <notify_run> <ping_send>"
  printf '%s %s %s %s %s\n' \
    "$(grep -c '^REPORT_PATH=' "$1")" \
    "$(grep -c '^PING:' "$1")" \
    "$(grep -c '^MOLT:' "$1")" \
    "$(grep -c 'NOTIFY_RUN=' "$1")" \
    "$(grep -c '^PING_SEND=' "$1")"
}
for l in $ENVELOPE_FILES; do
  set -- $(envelope_counts "$REF/$l")
  if [ "$1" -ge 1 ] && [ "$1" -eq "$2" ] && [ "$2" -eq "$3" ] && [ "$3" -eq "$4" ] && [ "$4" -eq "$5" ]; then
    pass "$l: $1 templates, one PING/MOLT/NOTIFY_RUN/PING_SEND line each"
  else
    fail "$l: one envelope line per template" \
      "REPORT_PATH=$1 PING=$2 MOLT=$3 NOTIFY_RUN=$4 PING_SEND=$5 — the counts must be equal"
  fi
done
n_ping="$(grep -h '^PING:' "$REF"/briefs.md "$REF"/ossify-briefs.md "$REF"/ossify-pr-briefs.md "$REF"/ossify-close-writer.md | wc -l | tr -d ' ')"
n_molt="$(grep -h '^MOLT:' "$REF"/briefs.md "$REF"/ossify-briefs.md "$REF"/ossify-pr-briefs.md "$REF"/ossify-close-writer.md | wc -l | tr -d ' ')"
pass "the envelope covers $n_ping PING lines and $n_molt MOLT lines"

pin "$LAYER_MD" 'PING_SEND=herdr agent prompt <that pane>' \
  "the layer's Send defines the PING_SEND slot"

# Controls: the predicate reads a directory, so plant one. The clean copy is the adjacent
# control — a predicate that reported a finding for everything would pass the plant alone.
ctl="$(mktemp -d)"
for l in $ENVELOPE_FILES; do cp "$REF/$l" "$ctl/$l"; done
out="$(envelope_findings "$ctl")"
if [ -z "$out" ]; then
  pass "control: the predicate passes a clean copy of the four files"
else
  fail "control: the predicate passes a clean copy of the four files" "$out"
fi
awk '{ if (!done && /^PING:/) { sub(/<PING_SEND>/, "`herdr agent prompt <that pane>`"); done = 1 } print }' \
  "$ctl/briefs.md" > "$ctl/briefs.mut" && mv "$ctl/briefs.mut" "$ctl/briefs.md"
out="$(envelope_findings "$ctl")"
if [ "$(printf '%s\n' "$out" | grep -c .)" -eq 2 ] \
   && printf '%s' "$out" | grep -F 'a PING: line names a layer command' >/dev/null \
   && printf '%s' "$out" | grep -F 'distinct lines' >/dev/null; then
  pass "control: one PING line carrying a layer command again fails, both halves named"
else
  fail "control: one PING line carrying a layer command again fails, both halves named" "got: ${out:-<none>}"
fi
rm -rf "$ctl"
if [ ! -e "$ctl" ]; then
  pass "control: the envelope controls leave no fixture behind"
else
  fail "control: the envelope controls leave no fixture behind" "$ctl survived its cleanup"
fi

section "the hoisted counters are not re-copied"
assert_hoisted_counters

report
