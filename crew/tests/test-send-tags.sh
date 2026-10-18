#!/usr/bin/env bash
#
# crew — the send tag (#867), mechanical facts only.
#
# Every message crew sends another session starts with its tag, `[crew <kind> <role>]`
# (`layers/herdr.md`, Send), and the brief templates carry their own seat's role word
# inside it. The legacy `REPORT READY:` and `MOLT WARNING` forms stay *accepted* — a
# top still receives pings from workers a brief older than 0.3.1 dispatched — so this
# file pins the acceptance clause in place instead of forbidding the words.
#
# Facts:
#   1. every `PING:` line carries the report tag — `[crew report <role>] <task id>`;
#   2. every `MOLT:` line carries the molt tag — `[crew molt <role>] <pct> <task id>`;
#   3. every send line (`<PING_SEND>`) opens with one of those tags — an untagged
#      send under `references/` is a finding;
#   4. per template fence the role word is the template's own seat role (table below):
#      facts 1–3 see a tag, never whether it names the right seat;
#   5. the correction request's re-ping is tagged;
#   6. the legacy forms stay accepted: completion.md states the acceptance clause;
#   7. `layers/herdr.md`'s `Send` states the tag rule and the rotation-resume exception;
#   8. `SKILL.md` states the status block — its five labels, once each, in order.
#
# Wiring: crew/run-tests.sh discovers `tests/test-*.sh` by glob, so this file is the
# wiring; the runner's own output names it.
#
# Usage:   bash crew/tests/test-send-tags.sh
# Exit:    0 if every fact holds; 1 otherwise.
# Deps:    bash 3.2+, awk, grep, sed, sort.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="$PLUGIN_ROOT/skills/orchestrate/references"
LAYER_MD="$REF/layers/herdr.md"
SKILL_MD="$PLUGIN_ROOT/skills/orchestrate/SKILL.md"
COMPLETION_MD="$REF/completion.md"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

# The fifteen dispatched templates, by fence order, and the seat role each is marked
# with (`roles.md`: implementer, verifier and reviewer are the guarded roles;
# coordinator is the spine, lane driver, doctor, close and work-PR marking).
# `<file>:<fence>:<role>` — the correction request carries no seat and is fence 10 of
# briefs.md, so it appears nowhere here.
EXPECTED_ROLES='briefs.md:1:implementer
briefs.md:2:implementer
briefs.md:3:reviewer
briefs.md:4:verifier
briefs.md:5:implementer
briefs.md:6:coordinator
briefs.md:7:coordinator
briefs.md:8:implementer
briefs.md:9:coordinator
ossify-briefs.md:1:coordinator
ossify-briefs.md:2:implementer
ossify-briefs.md:3:verifier
ossify-pr-briefs.md:1:coordinator
ossify-pr-briefs.md:2:coordinator
ossify-close-writer.md:1:implementer'

printf '%screw send tags%s\n\n' "$DIM" "$RST"

section "every send line opens with its tag"

# One line per finding, reading a references/ dir so the controls below can plant
# fixtures. Rule 3 is the widest: whatever a send line is, the text after the
# `<PING_SEND>` slot's opening quote is a tag, never a bare legacy form.
class_findings() { # <references dir>
  local dir="$1" f
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    awk -v F="${f##*/}" '
      /^PING: / && $0 !~ /\[crew report [a-z-]+\] <task id/ { print F ": " FNR ": a PING line carries no [crew report <role>] tag" }
      /^MOLT: / && $0 !~ /\[crew molt [a-z-]+\] <pct>/ { print F ": " FNR ": a MOLT line carries no [crew molt <role>] tag" }
      /<PING_SEND>/ && $0 !~ /<PING_SEND> .\[crew (report|molt) [a-z-]+\]/ { print F ": " FNR ": a send line carries no tag" }
    ' "$f"
  done
}
findings="$(class_findings "$REF")"
if [ -z "$findings" ]; then
  pass "every PING line, MOLT line and send line carries its tag"
else
  fail "every PING line, MOLT line and send line carries its tag" "$findings"
fi

n_ping="$(grep -h '^PING:' "$REF"/*.md | wc -l | tr -d ' ')"
n_molt="$(grep -h '^MOLT:' "$REF"/*.md | wc -l | tr -d ' ')"
if [ "$n_ping" -ge 15 ] && [ "$n_molt" -ge 15 ]; then
  pass "the sweep covers $n_ping PING lines and $n_molt MOLT lines (the floor, so a dropped line is not a shorter sweep)"
else
  fail "the sweep covers every send line" "PING=$n_ping MOLT=$n_molt, want >= 15 each — check the reads"
fi

ctl="$(mktemp -d)"; mkdir -p "$ctl/clean" "$ctl/dirty"
printf 'PING: x `<PING_SEND> '"'"'[crew report implementer] <task id> <kind> <path>'"'"'` y\nMOLT: x `<PING_SEND> '"'"'[crew molt implementer] <pct> <task id>'"'"'` y\n' > "$ctl/clean/a.md"
cp "$ctl/clean/a.md" "$ctl/dirty/a.md"
printf 'PING: x `<PING_SEND> '"'"'REPORT READY: <task id> <kind> <path>'"'"'` y\n' >> "$ctl/dirty/a.md"
printf 'MOLT: x `<PING_SEND> '"'"'MOLT WARNING <pct> <task id>'"'"'` y\n' >> "$ctl/dirty/a.md"
out="$(class_findings "$ctl/clean")"
if [ -z "$out" ]; then pass "control: the tags pass, including the send-line rule"
else fail "control: the tags pass, including the send-line rule" "$out"; fi
out="$(class_findings "$ctl/dirty")"
n="$(printf '%s\n' "$out" | grep -c .)"
if [ "$n" -eq 4 ] \
   && printf '%s\n' "$out" | grep -F 'a PING line carries no' >/dev/null \
   && printf '%s\n' "$out" | grep -F 'a MOLT line carries no' >/dev/null \
   && printf '%s\n' "$out" | grep -F 'a send line carries no tag' >/dev/null; then
  pass "control: both legacy forms are caught, as the line and as the send"
else
  fail "control: both legacy forms are caught, as the line and as the send" "got: ${out:-<none>}"
fi
rm -rf "$ctl"
if [ ! -e "$ctl" ]; then pass "control: the class controls leave no fixture behind"
else fail "control: the class controls leave no fixture behind" "$ctl survived its cleanup"; fi

section "each template carries its own role word"

roles_of() { # <references dir> <PING|MOLT> -> "<file>:<fence>:<role>" per send line
  local dir="$1" kind="$2" f
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    awk -v F="${f##*/}" -v K="$kind" '
      /^```text/ { n++ }
      index($0, K ": ") == 1 {
        if (match($0, /\[crew (report|molt) [a-z-]+\]/)) {
          s = substr($0, RSTART, RLENGTH)
          sub(/^\[crew (report|molt) /, "", s)
          sub(/\]$/, "", s)
          print F ":" n ":" s
        } else print F ":" n ":none"
      }
    ' "$f"
  done
}
for kind in PING MOLT; do
  actual="$(roles_of "$REF" "$kind")"
  if [ "$(printf '%s\n' "$actual" | sort)" = "$(printf '%s\n' "$EXPECTED_ROLES" | sort)" ]; then
    pass "the $kind lines carry each template's own role word (15)"
  else
    fail "the $kind lines carry each template's own role word" "got: $(printf '%s\n' "$actual" | sort | tr '\n' ' ')"
  fi
done

ctl="$(mktemp -d)"
{ printf '```text\n'; printf 'PING: x `<PING_SEND> '"'"'[crew report implementer] <task id> <kind> <path>'"'"'` y\n'; printf '```\n'; } > "$ctl/a.md"
before="$(roles_of "$ctl" PING)"
sed 's/\[crew report implementer\]/[crew report reviewer]/' "$ctl/a.md" > "$ctl/b.md" && rm "$ctl/a.md"
after="$(roles_of "$ctl" PING)"
if [ "$before" = 'a.md:1:implementer' ] && [ "$after" = 'b.md:1:reviewer' ]; then
  pass "control: a swapped role word is read as a swap"
else
  fail "control: a swapped role word is read as a swap" "before=$before after=$after"
fi
rm -rf "$ctl"

section "the correction request's re-ping is tagged"

corr_bare() { # <references dir> — lines telling a seat to ping again without the tag
  grep -h 'ping again' "$1"/*.md | grep -v '\[crew report ' || true
}
n_corr="$(grep -h 'ping again' "$REF"/*.md | wc -l | tr -d ' ')"
bare="$(corr_bare "$REF")"
if [ "$n_corr" -ge 1 ] && [ -z "$bare" ]; then
  pass "the re-ping sentence carries the tag ($n_corr line(s) checked)"
else
  fail "the re-ping sentence carries the tag" "lines $n_corr, untagged: ${bare:-<none>}"
fi
ctl="$(mktemp -d)"
printf 'send the `REPORT READY` ping again after the rename\n' > "$ctl/a.md"
out="$(corr_bare "$ctl")"
if [ "$(printf '%s\n' "$out" | grep -c .)" -eq 1 ]; then
  pass "control: an untagged re-ping is flagged"
else
  fail "control: an untagged re-ping is flagged" "got: ${out:-<none>}"
fi
rm -rf "$ctl"

section "the legacy forms stay accepted"

pin "$COMPLETION_MD" 'A brief older than 0.3.1 still sends the legacy `MOLT WARNING` form; read either as this ping.' \
  "completion.md states the legacy form stays accepted" flat

section "the layer's Send states the rule"

send_section() { # <file>
  awk '/^## Send$/{on=1;next} on && /^## /{exit} on' "$1"
}
span="$(mktemp)"
send_section "$LAYER_MD" > "$span"
n="$(grep -c . "$span" | tr -d ' ')"
if [ "$n" -ge 5 ]; then
  pin "$span" '[crew <kind> <role>]' "the tag grammar is stated"
  pin "$span" 'stays untagged' "the one untagged send is named"
  pin "$span" '/ossify:handoff-resume <path>' "the Claude resume form is named"
  pin "$span" 'skill://handoff-resume <path>' "the OMP resume form is named"
  pin "$span" 'prefix would break the command' "the exception gives its reason"
else
  fail "the Send section spans enough lines to carry the rule" "got $n line(s) — an unreadable extraction fails closed"
fi
rm -f "$span"

section "the status block is stated"

pin "$SKILL_MD" 'your reply is only the status block' "SKILL.md states the rule once"
for label in '**What I ruled:**' '**What the PR(s) will carry:**' '**Next steps:**' '**Waiting on (seats live):**' '**Operator decision pending:**'; do
  pin "$SKILL_MD" "$label" "SKILL.md carries $label once"
done
order_findings() { # <file> — the five labels, once each, in this order
  awk '
    BEGIN { L[1]="**What I ruled:**"; L[2]="**What the PR(s) will carry:**"; L[3]="**Next steps:**"; L[4]="**Waiting on (seats live):**"; L[5]="**Operator decision pending:**"; e=1 }
    { for (i=1;i<=5;i++) if (i == e && index($0, L[i])) { e++ } else if (i != e && index($0, L[i])) { print "line " NR ": label " i " out of order or repeated"; exit } }
    END { if (e != 6) print "only " e-1 " of the five labels are on a line" }
  ' "$1"
}
out="$(order_findings "$SKILL_MD")"
if [ -z "$out" ]; then pass "the five labels are in order"
else fail "the five labels are in order" "$out"; fi
ctl="$(mktemp -d)"
printf '%s\n' '**Next steps:**' '**What I ruled:**' > "$ctl/a.md"
out="$(order_findings "$ctl/a.md")"
if [ -n "$out" ]; then pass "control: a reversed order is flagged"
else fail "control: a reversed order is flagged" "accepted a reversed fixture"; fi
rm -rf "$ctl"

section "the hoisted counters are not re-copied"
assert_hoisted_counters

report
