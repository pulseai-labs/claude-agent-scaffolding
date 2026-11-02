#!/usr/bin/env bash
#
# crew — bin/crew-run, the run-file writer (#754).
#
# Every case runs the real script against the real `dagr check --strict`. dagr is REQUIRED: with
# none on PATH this suite fails, never skips, because a suite that skips when the validator is
# missing certifies a writer nobody checked. dagr is found the way the script finds it
# ($DAGR_BIN, PATH, $HERDR_PLUGIN_ROOT).
#
# dagr ignores fields it does not know, so crew's own (`phase`, `locator.machine`,
# `locator.report`, `locator.status`, `locator.seen`) get no feedback from it; they are asserted
# here with jq.
#
# Facts:
#   1. each verb's result passes `dagr check --strict`, and carries the fields crew reads;
#   2. each refusal exits 2, and every failing verb leaves the run file byte-identical and no
#      temp file behind;
#   3. the linter's findings exit 1; dagr's own failure, silence and another contract exit 2;
#   4. dagr is found in the producer contract's order and `cargo` is never run;
#   5. each class the writer reaches (E150 ... W208): a hand-built document real dagr rejects,
#      then the verb's result, which it passes;
#   6. a whole lifecycle: a retry, a send-back, and a rebind by `commit`;
#   7. free text round-trips byte-for-byte.
#
# Wiring: crew/run-tests.sh discovers `tests/test-*.sh` by glob.
#
# Usage:   bash crew/tests/test-crew-run.sh
# Exit:    0 if every fact holds; 1 otherwise.
# Deps:    bash 3.2+, jq, dagr (contract v3).

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CREW_RUN="$PLUGIN_ROOT/bin/crew-run"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

unset -f jq rg dagr 2>/dev/null || true

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
CR_TMP="$T/tmp"; mkdir -p "$CR_TMP"
D=""; R=""; OUT=""; ERR=""; RC=0; LIST0=""

# --- dagr: required --------------------------------------------------------------------

DAGR_REAL="${DAGR_BIN:-}"
[ -n "$DAGR_REAL" ] || DAGR_REAL="$(command -v dagr 2>/dev/null || true)"
[ -n "$DAGR_REAL" ] || DAGR_REAL="${HERDR_PLUGIN_ROOT:+$HERDR_PLUGIN_ROOT/bin/dagr}"
section "dagr is present (this suite fails without it, never skips)"
if [ -z "$DAGR_REAL" ] || [ ! -x "$DAGR_REAL" ]; then
  fail "dagr is on PATH, in DAGR_BIN or under HERDR_PLUGIN_ROOT" "install dagr 0.3.1 (herdr-dagr); CI installs it before this suite"
  report
  exit 1
fi
DAGR_VERSION="$("$DAGR_REAL" --version 2>&1)"
case "$DAGR_VERSION" in
  *"contract v3"*) pass "dagr says contract v3: $DAGR_VERSION" ;;
  *) fail "dagr says contract v3" "got: $DAGR_VERSION"; report; exit 1 ;;
esac

# --- helpers ---------------------------------------------------------------------------

# CR_ENV is the environment the script sees: a space-separated list of NAME=value (no spaces in
# the values). The default names the real dagr; a case that tests the lookup sets its own.
# DAGR_BIN, DAGR_RUN and HERDR_PLUGIN_ROOT from the caller's shell never leak in.
CR_ENV="DAGR_BIN=$DAGR_REAL"
# shellcheck disable=SC2086
cr() { OUT="$(env -u DAGR_BIN -u DAGR_RUN -u HERDR_PLUGIN_ROOT TMPDIR="$CR_TMP" $CR_ENV "$CREW_RUN" "$@" 2>"$T/err")"; RC=$?; ERR="$(cat "$T/err")"; }

ck() { # <label> <command...> — pass when the command succeeds
  local label=$1; shift
  if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label" "command failed: $*"; fi
}
eq() { # <label> <got> <want>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "got: $2 | want: $3"; fi
}
has() { # <label> <haystack> <needle>
  case "$2" in *"$3"*) pass "$1" ;; *) fail "$1" "missing: $3 | in: $2" ;; esac
}
jt() { # <label> <jq filter> [file] — pass when the filter is true of the run file
  local label=$1 f=$2 file="${3:-$R}"
  if jq -e "$f" "$file" >/dev/null 2>&1; then pass "$label"; else fail "$label" "$f"; fi
}
jta() { # <label> <jq filter> <arg value> — as jt with $a bound
  if jq -e --arg a "$3" "$2" "$R" >/dev/null 2>&1; then pass "$1"; else fail "$1" "$2 (a=$3)"; fi
}
lints() { # <file> — real dagr, strict, JSON, empty array
  local o rc=0
  o="$("$DAGR_REAL" check "$1" --strict --json 2>/dev/null)" || rc=$?
  [ "$rc" -eq 0 ] && printf '%s' "$o" | jq -e 'type == "array" and length == 0' >/dev/null 2>&1
}
codes() { # <file> — the finding codes of real dagr, one line
  "$DAGR_REAL" check "$1" --strict --json 2>/dev/null | jq -r '[.[].code] | join(" ")'
}
stamp_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

base_doc() {
  jq -n '{dagr: 3,
    run: {id: "run-crew-run-test", title: "crew-run test", started_at: "2026-11-01T09:00:00Z", orchestrator: {pane: "w1:p1"}},
    generated_at: "2026-11-01T09:00:00Z", projects: [],
    tasks: [
      {id: "IMPL", title: "impl: lane", kind: "impl", owner: "imp", state: "queued", deps: [], attempts: []},
      {id: "REV", title: "review: lane", kind: "review", owner: "rev", state: "queued", deps: ["IMPL"], attempts: []}],
    events: []}'
}

fresh() { # <name> — a directory holding a v3 run.json with two queued tasks
  D="$T/$1"; R="$D/run.json"; mkdir -p "$D"; base_doc > "$R"; LIST0="$(ls -A "$D")"
}
opened() { # <name> — fresh, with IMPL·a1 opened by the verb
  fresh "$1"
  cr open --run "$R" --task IMPL --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md" --status "$D/imp.md.molt-status"
  LIST0="$(ls -A "$D")"
}
edit() { jq -c "$1" "$R" > "$R.new" && mv "$R.new" "$R"; }

# refusal <label> <want rc> <stderr fragment> <crew-run args...> — the run file is byte-identical,
# the directory holds nothing new, and nothing is left in TMPDIR.
refusal() {
  local label=$1 want=$2 frag=$3
  shift 3
  cp "$R" "$T/snap"
  cr "$@"
  if [ "$RC" -eq "$want" ]; then pass "$label: exit $want"; else fail "$label: exit $want" "rc=$RC | out: $OUT | err: $ERR"; fi
  has "$label: says why" "$ERR" "$frag"
  if cmp -s "$R" "$T/snap"; then pass "$label: run.json byte-identical"; else fail "$label: run.json byte-identical"; fi
  eq "$label: no temp file left" "$(ls -A "$D")|$(ls -A "$CR_TMP")" "$LIST0|"
}

# --- the script -------------------------------------------------------------------------

section "the script"
ck "crew-run is executable" test -x "$CREW_RUN"
eq "crew-run sets -euo pipefail once" "$(awk '/^set -euo pipefail$/ {n++} END {print n+0}' "$CREW_RUN")" "1"
eq "its shebang is env bash" "$(head -n 1 "$CREW_RUN")" "#!/usr/bin/env bash"
cr help
eq "help exits 0" "$RC" "0"
for v in open settle send-back commit; do has "help names $v" "$OUT" "crew-run $v"; done
cr
eq "no arguments is usage, exit 2" "$RC" "2"
cr frobnicate
eq "an unknown verb is exit 2" "$RC" "2"
has "an unknown verb is named" "$ERR" "unknown verb frobnicate"

# --- the base document ------------------------------------------------------------------

section "the base document the cases start from"
fresh base
ck "the base document passes dagr check --strict" lints "$R"

# --- open -------------------------------------------------------------------------------

section "open: a new attempt, the task working"
fresh open1
T0="$(stamp_now)"
cr open --run "$R" --task IMPL --actor imp --model sonnet --pane w1:p2 --machine m1 \
  --report "$D/imp.md" --status "$D/imp.md.molt-status" --seen-hash abc123 --seen-identity "7:1700"
T1="$(stamp_now)"
eq "open exits 0" "$RC" "0"
eq "open prints the attempt id" "$OUT" "IMPL·a1"
ck "the result passes dagr check --strict" lints "$R"
eq "only run.json is in the directory" "$(ls -A "$D")" "run.json"
jt "the task is working" '.tasks[0].state == "working"'
jt "the other task is untouched" '.tasks[1] == {"id":"REV","title":"review: lane","kind":"review","owner":"rev","state":"queued","deps":["IMPL"],"attempts":[]}'
jt "attempt 1 is id IMPL·a1, n 1, cause initial" '.tasks[0].attempts[0] | .id == "IMPL·a1" and .n == 1 and .cause == {"type":"initial"}'
jt "the attempt is working, actor and model recorded" '.tasks[0].attempts[0] | .state == "working" and .actor == "imp" and .model == "sonnet"'
jt "phase is recorded" '.tasks[0].attempts[0].phase == "recorded"'
jt "the locator holds pane, machine, report and status" \
  '.tasks[0].attempts[0].locator | .pane == "w1:p2" and .machine == "m1" and .status != null and (.report | endswith("/imp.md")) and (.status | endswith("/imp.md.molt-status"))'
jt "locator.seen is {hash, identity}" '.tasks[0].attempts[0].locator.seen == {"hash":"abc123","identity":"7:1700"}'
jt "liveness is populated: unacknowledged, count 0" '.tasks[0].attempts[0].liveness | .prompt_acknowledged == false and .queued_input == 0 and (.last_output_at | type) == "string"'
jt "started_at equals the liveness stamp and generated_at" '.tasks[0].attempts[0] as $a | $a.started_at == $a.liveness.last_output_at and .generated_at == $a.started_at'
STAMP="$(jq -r '.generated_at' "$R")"
if [ "$STAMP" \> "$T0" ] || [ "$STAMP" = "$T0" ]; then
  if [ "$STAMP" \< "$T1" ] || [ "$STAMP" = "$T1" ]; then pass "the stamp is the clock's ($T0 <= $STAMP <= $T1)"; else fail "the stamp is the clock's" "$STAMP > $T1"; fi
else fail "the stamp is the clock's" "$STAMP < $T0"; fi
jta "one attempt_started event, ordered and stamped" '.events == [{"at": .generated_at, "type":"attempt_started","task":"IMPL","attempt":"IMPL·a1","actor":"imp"}]' ""

fresh open2
cr open --run "$R" --task IMPL --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md"
eq "open without --seen exits 0" "$RC" "0"
jt "no seen, no status, no model when none was given" '.tasks[0].attempts[0] | (.locator | has("seen") | not) and (.locator | has("status") | not) and has("model") == false'
ck "it still passes dagr" lints "$R"

section "open: --cause, a retry"
opened open3
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome failed --tier heuristic --reason "pane died"
cr open --run "$R" --task IMPL --actor imp --pane w1:p4 --machine m1 --report "$D/imp.md" --cause followup --ref "IMPL·a1" --reason "retry after the pane died"
eq "a second attempt opens" "$RC" "0"
eq "it is IMPL·a2" "$OUT" "IMPL·a2"
ck "the retry passes dagr" lints "$R"
jt "its cause is {followup, ref, reason}" '.tasks[0].attempts[1].cause == {"type":"followup","ref":"IMPL·a1","reason":"retry after the pane died"}'
jt "the first attempt is untouched: failed with its outcome" '.tasks[0].attempts[0] | .state == "failed" and .outcome.result == "failed" and .outcome.evidence == "heuristic"'
jt "the task is working again" '.tasks[0].state == "working"'
for ct in gate_failed superseded sent_back; do
  opened "open-$ct"
  cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome failed --tier heuristic
  cr open --run "$R" --task IMPL --actor imp --pane w1:p4 --machine m1 --report "$D/imp.md" --cause "$ct" --ref "IMPL·a1" --by someone
  eq "--cause $ct opens" "$RC" "0"
  jta "--cause $ct is recorded with its ref and by" '.tasks[0].attempts[1].cause == {"type":$a,"ref":"IMPL·a1","by":"someone"}' "$ct"
  ck "--cause $ct passes dagr" lints "$R"
done
fresh open-cause-other-task
cr open --run "$R" --task IMPL --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md" --cause initial
eq "--cause initial on attempt 1 opens" "$RC" "0"
jt "and is cause initial" '.tasks[0].attempts[0].cause == {"type":"initial"}'

# --- settle -----------------------------------------------------------------------------

section "settle: each outcome moves the task to match"
for pair in done:done failed:failed rejected:rejected settled_unverified:settled_unverified; do
  oc="${pair%%:*}"; ts="${pair##*:}"
  opened "settle-$oc"
  T0="$(stamp_now)"
  cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome "$oc" --tier reported --receipt "receipt for $oc"
  eq "settle $oc: exit 0" "$RC" "0"
  eq "settle $oc: prints the attempt id" "$OUT" "IMPL·a1"
  ck "settle $oc: dagr strict clean" lints "$R"
  jta "settle $oc: the attempt carries state, ended_at and outcome" '.tasks[0].attempts[0] | .state == $a and .outcome == {"result":$a,"evidence":"reported","receipt":("receipt for " + $a)} and (.ended_at | length) > 0 and .ended_at >= .started_at' "$oc"
  jta "settle $oc: the task is $ts" '.tasks[0].state == $a' "$ts"
  jta "settle $oc: one attempt_settled event after attempt_started" '[.events[].type] == ["attempt_started","attempt_settled"] and .events[1].attempt == "IMPL·a1" and .events[1].detail == $a' "$oc"
  jt "settle $oc: locator and phase survive" '.tasks[0].attempts[0] | .phase == "recorded" and .locator.machine == "m1"'
done
opened settle-lost
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome lost --reason "pane gone"
eq "settle lost: exit 0" "$RC" "0"
ck "settle lost: dagr strict clean" lints "$R"
jt "settle lost: the attempt is lost, with no outcome" '.tasks[0].attempts[0] | .state == "lost" and has("outcome") == false and (.ended_at | length) > 0'
jt "settle lost: the task is failed" '.tasks[0].state == "failed"'
jt "settle lost: the reason is the event's detail" '.events[1].detail == "pane gone"'

opened settle-ended
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier verified --receipt "cargo test 4/4" --ended-at 2030-01-01T00:00:00Z
eq "--ended-at is accepted" "$RC" "0"
jt "ended_at is the given time, the event's at is the clock's" '.tasks[0].attempts[0].ended_at == "2030-01-01T00:00:00Z" and .events[1].at < "2030-01-01T00:00:00Z"'

opened settle-canceled
edit '.tasks[0].state = "canceled"'
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
jt "a canceled task keeps canceled: a withdrawal is not an attempt's to undo" '.tasks[0].state == "canceled" and .tasks[0].attempts[0].state == "done"'

fresh settle-not-latest
# a1 working (stale), a2 done: settling a1 must not move the task off a2's done.
jq '.tasks[0].state = "done"
  | .tasks[0].attempts = [
     {"id":"IMPL·a1","n":1,"cause":{"type":"initial"},"actor":"imp","locator":{"pane":"w1:p2"},"state":"working","started_at":"2026-11-01T10:00:00Z","liveness":{"prompt_acknowledged":true,"last_output_at":"2026-11-01T10:00:00Z","queued_input":0}},
     {"id":"IMPL·a2","n":2,"cause":{"type":"followup","ref":"IMPL·a1"},"actor":"imp","state":"done","started_at":"2026-11-01T11:00:00Z","ended_at":"2026-11-01T12:00:00Z","outcome":{"result":"done","evidence":"reported"}}]' "$R" > "$R.new" && mv "$R.new" "$R"
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome lost
eq "settling a stale earlier attempt exits 0" "$RC" "0"
jt "the task stays done: its latest attempt is a2" '.tasks[0].state == "done" and .tasks[0].attempts[0].state == "lost"'

# --- send-back --------------------------------------------------------------------------

section "send-back: three records in one write"
opened sb1
cr open --run "$R" --task REV --actor rev --pane w1:p3 --machine m1 --report "$D/rev.md"
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported --ended-at 2030-01-01T00:00:00Z
cr send-back --run "$R" --task IMPL --attempt "IMPL·a1" --review "REV·a1" --by rev --reason "error paths untested" --tier reported --receipt "verdict: changes-required" --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md" --status "$D/imp.md.molt-status" --seen-hash h1 --seen-identity i1
eq "send-back exits 0 (review working, reviewed done)" "$RC" "0"
eq "it prints the new attempt id" "$OUT" "IMPL·a2"
ck "the result passes dagr check --strict" lints "$R"
jt "the review attempt settled done, its task done" '.tasks[1].attempts[0] | .state == "done" and .outcome.result == "done" and .outcome.evidence == "reported" and .outcome.receipt == "verdict: changes-required"'
jt "the review task is done" '.tasks[1].state == "done"'
jt "the reviewed attempt settled rejected with the reason and receipt" '.tasks[0].attempts[0] | .state == "rejected" and .outcome == {"result":"rejected","evidence":"reported","reason":"error paths untested","receipt":"verdict: changes-required"}'
jt "the reviewed attempt kept the ended_at it had when it was done" '.tasks[0].attempts[0].ended_at == "2030-01-01T00:00:00Z"'
jt "the new attempt carries cause {sent_back, by, ref, reason}" '.tasks[0].attempts[1].cause == {"type":"sent_back","by":"rev","ref":"REV·a1","reason":"error paths untested"}'
jt "the new attempt is working, recorded, with its full locator and seen" '.tasks[0].attempts[1] | .id == "IMPL·a2" and .n == 2 and .state == "working" and .phase == "recorded" and .locator.pane == "w1:p2" and .locator.machine == "m1" and (.locator.report | endswith("imp.md")) and (.locator.status | endswith("molt-status")) and .locator.seen == {"hash":"h1","identity":"i1"} and .liveness.queued_input == 0'
jt "the reviewed task is working again" '.tasks[0].state == "working"'
jt "events: review settled, reviewed settled, new attempt started, in order" '[.events[] | .type + ":" + .attempt] | .[-3:] == ["attempt_settled:REV·a1","attempt_settled:IMPL·a1","attempt_started:IMPL·a2"]'
eq "events are in time order" "$(jq -r '[.events[].at] == ([.events[].at] | sort)' "$R")" "true"

opened sb2
cr open --run "$R" --task REV --actor rev --pane w1:p3 --machine m1 --report "$D/rev.md"
cr settle --run "$R" --task REV --attempt "REV·a1" --outcome done --tier reported
cr send-back --run "$R" --task IMPL --attempt "IMPL·a1" --review "REV·a1" --by rev --reason r --tier reported --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md"
eq "send-back with the review already done and the reviewed attempt working" "$RC" "0"
ck "it passes dagr" lints "$R"
jt "the review attempt is left as it was: one settled event for it only" '[.events[] | select(.attempt == "REV·a1" and .type == "attempt_settled")] | length == 1'
jt "the reviewed attempt was working: rejected with ended_at set" '.tasks[0].attempts[0] | .state == "rejected" and (.ended_at | length) > 0'
jt "no seen without the pair" '.tasks[0].attempts[1].locator | has("seen") | not'

# --- commit -----------------------------------------------------------------------------

section "commit: check, then rename"
fresh commit1
jq '.generated_at = "2026-11-01T10:00:00Z" | .tasks[0].title = "impl: renamed"' "$R" > "$D/run.json.tmp"
cp "$D/run.json.tmp" "$T/cand.expect"
cr commit --run "$R" "$D/run.json.tmp"
eq "commit exits 0" "$RC" "0"
ck "the candidate became the run file, byte for byte" cmp -s "$R" "$T/cand.expect"
eq "the candidate is gone" "$(ls -A "$D")" "run.json"

fresh commit-new
rm "$R"; base_doc > "$D/run.json.tmp"
cr commit --run "$R" "$D/run.json.tmp"
eq "commit creates a run file that is not there yet" "$RC" "0"
ck "and it is the document" lints "$R"

fresh commit-v2
jq '.dagr = 2' "$R" > "$D/run.json.tmp"
cr commit --run "$R" "$D/run.json.tmp"
eq "commit takes any version dagr accepts (v2)" "$RC" "0"
jt "the v2 document is in place" '.dagr == 2'

fresh commit-bad
jq '.tasks[0].state = "working"' "$R" > "$D/run.json.tmp"
cp "$R" "$T/snap"; LIST1="$(ls -A "$D")"
cr commit --run "$R" "$D/run.json.tmp"
eq "a candidate with findings exits 1" "$RC" "1"
has "the finding code is printed" "$ERR" "E150"
ck "the run file is byte-identical" cmp -s "$R" "$T/snap"
eq "the candidate is left for the seat to fix" "$(ls -A "$D")" "$LIST1"
eq "nothing in TMPDIR" "$(ls -A "$CR_TMP")" ""

fresh commit-garbage
printf 'not json' > "$D/run.json.tmp"
cp "$R" "$T/snap"
cr commit --run "$R" "$D/run.json.tmp"
eq "a candidate dagr cannot parse exits 1 (dagr: E001), never renames" "$RC" "1"
ck "run file unchanged" cmp -s "$R" "$T/snap"

fresh commit-usage
cp "$R" "$D/elsewhere.tmp"; LIST0="$(ls -A "$D")"
refusal "commit without a candidate" 2 "commit needs the candidate" commit --run "$R"
refusal "commit with a missing candidate" 2 "candidate not found" commit --run "$R" "$D/nope.tmp"
mkdir -p "$T/other"; cp "$R" "$T/other/run.json.tmp"
refusal "a candidate in another directory" 2 "must sit in the run file's directory" commit --run "$R" "$T/other/run.json.tmp"
refusal "a candidate that is the run file" 2 "same file" commit --run "$R" "$R"
refusal "two candidates" 2 "one argument only" commit --run "$R" "$D/elsewhere.tmp" "$D/elsewhere.tmp"

# --- refusals ---------------------------------------------------------------------------

section "refusals: exit 2, the file untouched, no temp left"
fresh ref1
OA="--actor imp --pane w1:p2 --machine m1 --report $D/imp.md"
refusal "open: unknown task" 2 "unknown task NOPE" open --run "$R" --task NOPE $OA
refusal "settle: unknown task" 2 "unknown task NOPE" settle --run "$R" --task NOPE --attempt "NOPE·a1" --outcome done --tier reported
refusal "send-back: unknown task" 2 "unknown task NOPE" send-back --run "$R" --task NOPE --attempt "NOPE·a1" --review "REV·a1" --by rev --reason r --tier reported $OA
refusal "settle: unknown attempt" 2 "has no attempt IMPL·a9" settle --run "$R" --task IMPL --attempt "IMPL·a9" --outcome done --tier reported
opened ref2
refusal "open: while an attempt is working" 2 "already has a working attempt" open --run "$R" --task IMPL $OA
refusal "settle: an attempt that is not in that task" 2 "has no attempt IMPL·a1" settle --run "$R" --task REV --attempt "IMPL·a1" --outcome done --tier reported
refusal "send-back: unknown review attempt" 2 "unknown attempt REV·a1" send-back --run "$R" --task IMPL --attempt "IMPL·a1" --review "REV·a1" --by rev --reason r --tier reported $OA
refusal "send-back: unknown reviewed attempt" 2 "has no attempt IMPL·a7" send-back --run "$R" --task IMPL --attempt "IMPL·a7" --review "IMPL·a1" --by rev --reason r --tier reported $OA
refusal "send-back: the same attempt twice" 2 "are the same" send-back --run "$R" --task IMPL --attempt "IMPL·a1" --review "IMPL·a1" --by rev --reason r --tier reported $OA
for st in done failed rejected settled_unverified lost; do
  opened "ref-settled-$st"
  LIST0="$(ls -A "$D")"
  oc="$st"; tier="--tier reported"; [ "$st" = lost ] && tier=""
  cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome "$oc" $tier
  LIST0="$(ls -A "$D")"
  refusal "settle: an attempt already $st" 2 "is already $st" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
done

opened ref-cause
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome failed --tier heuristic
LIST0="$(ls -A "$D")"
refusal "open: attempt 2 without --cause" 2 "needs --cause" open --run "$R" --task IMPL $OA
refusal "open: a cause without its --ref" 2 "needs --ref" open --run "$R" --task IMPL $OA --cause followup
refusal "open: a --ref no attempt carries (E134 never reaches the file)" 2 "unknown attempt IMPL·a9" open --run "$R" --task IMPL $OA --cause followup --ref "IMPL·a9"
refusal "open: a cause type outside the vocabulary (E133 never reaches the file)" 2 "--cause takes" open --run "$R" --task IMPL $OA --cause retry --ref "IMPL·a1"
refusal "open: initial takes no ref" 2 "takes no --ref" open --run "$R" --task IMPL $OA --cause initial --ref "IMPL·a1"
refusal "settle: an outcome outside the vocabulary (E132 never reaches the file)" 2 "--outcome takes" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome complete --tier reported
refusal "settle: a tier outside the vocabulary (E142 never reaches the file)" 2 "--tier takes" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier high
refusal "settle: no tier" 2 "--tier is required" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done
refusal "settle: lost with a tier" 2 "carries no outcome" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome lost --tier reported
refusal "settle: a malformed --ended-at" 2 "--ended-at takes" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported --ended-at yesterday
refusal "open: --seen-hash without --seen-identity" 2 "--seen-identity is required" open --run "$R" --task IMPL $OA --cause followup --ref "IMPL·a1" --seen-hash abc
refusal "open: a missing required option" 2 "--pane is required" open --run "$R" --task IMPL --actor imp --machine m1 --report r
refusal "open: an unknown option" 2 "unknown option --frob" open --run "$R" --task IMPL $OA --frob x
refusal "open: an option with no value" 2 "needs a value" open --run "$R" --task IMPL $OA --model
refusal "open: a stray argument" 2 "unexpected argument stray" open --run "$R" stray
refusal "settle: --pane is not a settle option" 2 "unknown option --pane" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome failed --tier reported --pane x

opened ref-canceled
edit '.tasks[1].state = "canceled"'
LIST0="$(ls -A "$D")"
refusal "open: a canceled task" 2 "is canceled" open --run "$R" --task REV --actor rev --pane p --machine m --report r

opened ref-sbstate
cr open --run "$R" --task REV --actor rev --pane w1:p3 --machine m1 --report "$D/rev.md"
cr settle --run "$R" --task REV --attempt "REV·a1" --outcome failed --tier reported
LIST0="$(ls -A "$D")"
refusal "send-back: a review attempt that failed" 2 "must be working or done" send-back --run "$R" --task IMPL --attempt "IMPL·a1" --review "REV·a1" --by rev --reason r --tier reported $OA

opened ref-sbrejected
cr open --run "$R" --task REV --actor rev --pane w1:p3 --machine m1 --report "$D/rev.md"
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome rejected --tier reported
LIST0="$(ls -A "$D")"
refusal "send-back: a reviewed attempt already rejected" 2 "only a working or done attempt is sent back" send-back --run "$R" --task IMPL --attempt "IMPL·a1" --review "REV·a1" --by rev --reason r --tier reported $OA

opened ref-sbother
cr open --run "$R" --task REV --actor rev --pane w1:p3 --machine m1 --report "$D/rev.md"
edit '.tasks[0].attempts += [{"id":"IMPL·a2","n":2,"cause":{"type":"followup","ref":"IMPL·a1"},"actor":"imp","locator":{"pane":"x"},"state":"working","started_at":"2030-01-01T00:00:00Z","liveness":{"prompt_acknowledged":true}}]'
LIST0="$(ls -A "$D")"
refusal "send-back: the task has another working attempt" 2 "has another working attempt" send-back --run "$R" --task IMPL --attempt "IMPL·a1" --review "REV·a1" --by rev --reason r --tier reported $OA

section "refusals: the run file"
fresh file1
refusal "a missing run file" 2 "run file not found" open --run "$D/missing.json" --task IMPL $OA
refusal "no --run and no DAGR_RUN" 2 "--run FILE is required" open --task IMPL $OA
cp "$R" "$T/dagr-run-ok.json"
OUT="$(DAGR_RUN="$R" DAGR_BIN="$DAGR_REAL" TMPDIR="$CR_TMP" "$CREW_RUN" open --task IMPL $OA 2>&1)"; RC=$?
eq "DAGR_RUN names the run file when --run is absent" "$RC" "0"
for ver in 1 2; do
  fresh "file-v$ver"
  jq ".dagr = $ver" "$R" > "$R.new" && mv "$R.new" "$R"; LIST0="$(ls -A "$D")"
  for v in "open --task IMPL $OA" "settle --task IMPL --attempt IMPL·a1 --outcome done --tier reported" "send-back --task IMPL --attempt IMPL·a1 --review REV·a1 --by rev --reason r --tier reported $OA"; do
    # shellcheck disable=SC2086
    refusal "v$ver file, ${v%% *}" 2 "is not a dagr 3 file" ${v%% *} --run "$R" ${v#* }
  done
done
fresh file-nover
jq 'del(.dagr)' "$R" > "$R.new" && mv "$R.new" "$R"; LIST0="$(ls -A "$D")"
refusal "a file with no dagr field" 2 "is not a dagr 3 file" open --run "$R" --task IMPL $OA
fresh file-notjson
printf 'this is not json\n' > "$R"; LIST0="$(ls -A "$D")"
refusal "a file that is not JSON" 2 "is not a JSON object" open --run "$R" --task IMPL $OA
fresh file-empty
: > "$R"; LIST0="$(ls -A "$D")"
refusal "an empty run file" 2 "is empty" open --run "$R" --task IMPL $OA
fresh file-array
printf '[1,2]\n' > "$R"; LIST0="$(ls -A "$D")"
refusal "a JSON array" 2 "is not a JSON object" open --run "$R" --task IMPL $OA
fresh file-notasks
jq 'del(.tasks)' "$R" > "$R.new" && mv "$R.new" "$R"; LIST0="$(ls -A "$D")"
refusal "no tasks array" 2 "no tasks array" open --run "$R" --task IMPL $OA
fresh file-dup
jq '.tasks += [.tasks[0]]' "$R" > "$R.new" && mv "$R.new" "$R"; LIST0="$(ls -A "$D")"
refusal "a task id declared twice" 2 "declared more than once" open --run "$R" --task IMPL $OA

# --- the linter's findings: exit 1 -------------------------------------------------------

section "findings: exit 1, the file untouched"
fresh find1
edit '.tasks[1].deps = ["NOWHERE"]'
LIST0="$(ls -A "$D")"
refusal "a document already broken elsewhere (E120) is not published" 1 "E120" open --run "$R" --task IMPL $OA
fresh find2
edit '.events = [{"at":"2030-01-01T00:00:00Z","type":"note","detail":"later"}]'
LIST0="$(ls -A "$D")"
refusal "an event later than the clock (W207, strict) is not published" 1 "W207" open --run "$R" --task IMPL $OA
has "the finding line carries the path and message" "$ERR" "events - events are not in ascending time order"

# --- dagr: lookup order, contract, verdicts ----------------------------------------------

section "dagr: found in the contract's order, never cargo, never a silent pass"
mkdir -p "$T/stub-a" "$T/stub-b" "$T/stub-c/bin" "$T/stub-c/target/release" "$T/stub-d" "$T/sys" "$T/cargo-bin"
# A stub logs which one ran, then answers as its mode says (a file, so a value needs no quoting
# through env), else passes the call to the real dagr.
write_stub() { # <path> <name>
  cat > "$1" <<STUBEOF
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then
  if [ -e "$T/stub-version" ]; then cat "$T/stub-version"; else echo "dagr 0.3.1 (contract v3; reads v1/v2)"; fi
  exit 0
fi
printf '%s\n' "$2" >> "$T/stub.log"
mode=pass; [ -e "$T/stub-mode" ] && mode="\$(cat "$T/stub-mode")"
case "\$mode" in
  empty) exit 0 ;;
  exit2) echo "dagr check: cannot read the file" >&2; exit 2 ;;
  exit3) exit 3 ;;
  text0) echo "all good"; exit 0 ;;
  findings0) echo '[{"level":"error","code":"E999","path":"x","msg":"m"}]'; exit 0 ;;
  exit1) echo '[{"level":"error","code":"E999","path":"x","msg":"m"}]'; exit 1 ;;
  exit1empty) exit 1 ;;
esac
exec "$DAGR_REAL" "\$@"
STUBEOF
  chmod +x "$1"
}
write_stub "$T/stub-a/dagr" A
write_stub "$T/stub-b/dagr" B
write_stub "$T/stub-c/bin/dagr" Cbin
write_stub "$T/stub-c/target/release/dagr" Ctarget
for tool in bash env jq mktemp cp mv rm dirname basename date cat head mkdir sleep; do
  p="$(command -v "$tool" 2>/dev/null || true)"
  [ -z "$p" ] || ln -sf "$p" "$T/sys/$tool"
done
NODAGR="$T/sys"
ran() { tr '\n' ' ' < "$T/stub.log"; }

: > "$T/stub.log"
fresh dg1; cr open --run "$R" --task IMPL $OA
CR_ENV="DAGR_BIN=$T/stub-a/dagr PATH=$T/stub-b:$PATH HERDR_PLUGIN_ROOT=$T/stub-c" cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
eq "DAGR_BIN beats PATH and HERDR_PLUGIN_ROOT" "$(ran)|$RC" "A |0"
: > "$T/stub.log"
fresh dg2; cr open --run "$R" --task IMPL $OA
: > "$T/stub.log"
CR_ENV="PATH=$T/stub-b:$PATH HERDR_PLUGIN_ROOT=$T/stub-c" cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
eq "PATH beats HERDR_PLUGIN_ROOT" "$(ran)|$RC" "B |0"
fresh dg3; cr open --run "$R" --task IMPL $OA
: > "$T/stub.log"
CR_ENV="PATH=$NODAGR HERDR_PLUGIN_ROOT=$T/stub-c" cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
eq "HERDR_PLUGIN_ROOT is the last stop: target/release first" "$(ran)|$RC" "Ctarget |0"
rm "$T/stub-c/target/release/dagr"
fresh dg4; cr open --run "$R" --task IMPL $OA
: > "$T/stub.log"
CR_ENV="PATH=$NODAGR HERDR_PLUGIN_ROOT=$T/stub-c" cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
eq "then bin/dagr, where an installed plugin keeps it" "$(ran)|$RC" "Cbin |0"

fresh dg5
CR_ENV="PATH=$NODAGR" refusal "no dagr anywhere" 2 "no dagr" open --run "$R" --task IMPL $OA
printf '#!/usr/bin/env bash\necho cargo-ran >> "%s/cargo.log"\nexit 1\n' "$T" > "$T/cargo-bin/cargo"; chmod +x "$T/cargo-bin/cargo"
: > "$T/cargo.log"; printf '[package]\nname="dagr"\n' > "$T/stub-d/Cargo.toml"
CR_ENV="PATH=$NODAGR:$T/cargo-bin HERDR_PLUGIN_ROOT=$T/stub-d" refusal "a dagr repo with no built binary is not a fallback" 2 "no dagr" open --run "$R" --task IMPL $OA
eq "cargo was never run" "$(wc -c < "$T/cargo.log" | tr -d ' ')" "0"
CR_ENV="DAGR_BIN=$T/nope" refusal "DAGR_BIN set to something that is not executable" 2 "not an executable file" open --run "$R" --task IMPL $OA
printf '{}' > "$D/run.json.x"; LIST0="$(ls -A "$D")"
CR_ENV="PATH=$NODAGR" refusal "commit with no dagr" 2 "no dagr" commit --run "$R" "$D/run.json.x"
rm -f "$D/run.json.x"; LIST0="$(ls -A "$D")"

for v in "dagr 9.0.0 (contract v4)" "dagr 0.3.1 (contract v30; reads v1/v2)" "dagr 0.3.1" ""; do
  printf '%s\n' "$v" > "$T/stub-version"
  CR_ENV="DAGR_BIN=$T/stub-a/dagr" refusal "a dagr that says '$v' is another contract" 2 "is not contract v3" open --run "$R" --task IMPL $OA
done
rm -f "$T/stub-version"
fresh dg6
cr open --run "$R" --task IMPL $OA
for mode in empty text0 exit2 exit3; do
  printf '%s' "$mode" > "$T/stub-mode"
  CR_ENV="DAGR_BIN=$T/stub-a/dagr" refusal "dagr verdict '$mode' is exit 2, never a pass" 2 "" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
done
printf 'exit2' > "$T/stub-mode"
CR_ENV="DAGR_BIN=$T/stub-a/dagr" cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
has "dagr's own message is passed on" "$ERR" "cannot read the file"
for mode in exit1 findings0 exit1empty; do
  printf '%s' "$mode" > "$T/stub-mode"
  CR_ENV="DAGR_BIN=$T/stub-a/dagr" refusal "dagr verdict '$mode' is exit 1" 1 "is unchanged" settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported
done
rm -f "$T/stub-mode"

# --- the classes the writer reaches -----------------------------------------------------

section "classes in reach: a hand-built document dagr rejects, then the verb's result, which it passes"

# What a careful hand write looks like, so each class deviates from something that passes.
GOOD_OPEN='.tasks[0].state = "working"
  | .tasks[0].attempts = [{"id":"IMPL·a1","n":1,"cause":{"type":"initial"},"actor":"imp","locator":{"pane":"w1:p2"},"state":"working","started_at":"2026-11-01T10:00:00Z","liveness":{"prompt_acknowledged":true,"last_output_at":"2026-11-01T10:00:00Z","queued_input":0}}]
  | .events += [{"at":"2026-11-01T10:00:00Z","type":"attempt_started","task":"IMPL","attempt":"IMPL·a1","actor":"imp"}]'
GOOD_SETTLE='.tasks[0].state = "done"
  | .tasks[0].attempts[0] |= (.state = "done" | .ended_at = "2030-01-01T00:00:00Z" | .outcome = {"result":"done","evidence":"reported"})
  | .events += [{"at":"2030-01-01T00:00:00Z","type":"attempt_settled","task":"IMPL","attempt":"IMPL·a1","actor":"imp"}]'
GOOD_RETRY='.tasks[0].state = "working"
  | .tasks[0].attempts += [{"id":"IMPL·a2","n":2,"cause":{"type":"followup","ref":"IMPL·a1"},"actor":"imp","locator":{"pane":"w1:p2"},"state":"working","started_at":"2030-01-01T00:00:00Z","liveness":{"prompt_acknowledged":true,"last_output_at":"2030-01-01T00:00:00Z","queued_input":0}}]
  | .events += [{"at":"2030-01-01T00:00:00Z","type":"attempt_started","task":"IMPL","attempt":"IMPL·a2","actor":"imp"}]'

pre_base() { fresh "$1"; }
pre_open() { opened "$1"; }
pre_failed() { opened "$1"; cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome failed --tier heuristic; }
verb_open1() { cr open --run "$R" --task IMPL --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md"; }
verb_settle1() { cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier reported; }
verb_retry() { cr open --run "$R" --task IMPL --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md" --cause followup --ref "IMPL·a1"; }
verb_lost() { cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome lost; }

# class <code> <pre fn> <hand-edit jq over the pre-state> <verb fn>
class_case() {
  local code=$1 pre=$2 hand=$3 verb=$4 name="class-$1"
  "$pre" "$name"
  jq "$hand" "$R" > "$T/hand.json"
  case " $(codes "$T/hand.json") " in
    *" $code "*) pass "$code: the hand-built document is rejected with $code" ;;
    *) fail "$code: the hand-built document is rejected with $code" "dagr says: $(codes "$T/hand.json")" ;;
  esac
  "$verb"
  eq "$code: the verb writes (exit 0)" "$RC" "0"
  ck "$code: the verb's result passes dagr check --strict" lints "$R"
  case " $(codes "$R") " in *" $code "*) fail "$code: absent from the verb's result" ;; *) pass "$code: absent from the verb's result" ;; esac
}

# controls: the careful hand writes pass, so each class below deviates from something clean
fresh ctl-open;  jq "$GOOD_OPEN" "$R" > "$T/g1.json";  ck "control: a careful hand-written open passes" lints "$T/g1.json"
pre_open ctl-settle; jq "$GOOD_SETTLE" "$R" > "$T/g2.json"; ck "control: a careful hand-written settle passes" lints "$T/g2.json"
pre_failed ctl-retry; jq "$GOOD_RETRY" "$R" > "$T/g3.json"; ck "control: a careful hand-written retry passes" lints "$T/g3.json"

class_case E150 pre_base   "$GOOD_OPEN | .tasks[0].state = \"queued\"" verb_open1
class_case W204 pre_base   "$GOOD_OPEN | del(.tasks[0].attempts[0].locator)" verb_open1
class_case W208 pre_base   "$GOOD_OPEN | del(.tasks[0].attempts[0].liveness)" verb_open1
class_case E133 pre_failed "$GOOD_RETRY | .tasks[0].attempts[1].cause.type = \"retry\"" verb_retry
class_case E112 pre_open   "$GOOD_SETTLE | .tasks[0].state = \"finished\"" verb_settle1
class_case E132 pre_open   "$GOOD_SETTLE | .tasks[0].attempts[0].state = \"complete\"" verb_settle1
class_case E140 pre_open   "$GOOD_SETTLE | del(.tasks[0].attempts[0].outcome)" verb_settle1
class_case E141 pre_open   "$GOOD_SETTLE | .tasks[0].attempts[0].outcome.result = \"failed\"" verb_settle1
class_case E142 pre_open   "$GOOD_SETTLE | .tasks[0].attempts[0].outcome.evidence = \"high\"" verb_settle1
class_case W203 pre_open   "$GOOD_SETTLE | del(.tasks[0].attempts[0].ended_at)" verb_settle1
class_case E181 pre_open   "$GOOD_SETTLE | .tasks[0].attempts[0].ended_at = \"2020-01-01T00:00:00Z\"" verb_settle1
class_case E170 pre_open   "$GOOD_SETTLE | .events[-1].type = \"attempt_finished\"" verb_settle1
class_case W207 pre_open   "$GOOD_SETTLE | .events += [{\"at\":\"2026-11-01T10:05:00Z\",\"type\":\"note\",\"detail\":\"late write, early stamp\"}]" verb_settle1

# W209 needs a stale working attempt under a settled task: the hand-built document is the pre-state.
STALE='.tasks[0].state = "done"
  | .tasks[0].attempts = [
     {"id":"IMPL·a1","n":1,"cause":{"type":"initial"},"actor":"imp","locator":{"pane":"w1:p2"},"state":"working","started_at":"2026-11-01T10:00:00Z","liveness":{"prompt_acknowledged":true,"last_output_at":"2026-11-01T10:00:00Z","queued_input":0}},
     {"id":"IMPL·a2","n":2,"cause":{"type":"followup","ref":"IMPL·a1"},"actor":"imp","state":"done","started_at":"2026-11-01T11:00:00Z","ended_at":"2026-11-01T12:00:00Z","outcome":{"result":"done","evidence":"reported"}}]'
fresh class-W209
jq "$STALE" "$R" > "$R.new" && mv "$R.new" "$R"
case " $(codes "$R") " in *" W209 "*) pass "W209: the hand-built document is rejected with W209" ;; *) fail "W209: the hand-built document is rejected with W209" "dagr says: $(codes "$R")" ;; esac
verb_lost
eq "W209: settle writes (exit 0)" "$RC" "0"
ck "W209: the verb's result passes dagr check --strict" lints "$R"

# --- the whole lifecycle ----------------------------------------------------------------

section "a whole lifecycle: retry, send-back, and a rebind by commit"
fresh life
step_ok() { # <label> — the last verb exited 0 and the file passes real dagr
  eq "$1: exit 0" "$RC" "0"
  ck "$1: dagr strict clean" lints "$R"
}
cr open --run "$R" --task IMPL --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md" --status "$D/imp.md.molt-status"; step_ok "open IMPL·a1"
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome failed --tier heuristic --reason "provider errors"; step_ok "settle IMPL·a1 failed"
cr open --run "$R" --task IMPL --actor imp --pane w1:p5 --machine m1 --report "$D/imp.md" --cause followup --ref "IMPL·a1" --reason "relaunched"; step_ok "retry: open IMPL·a2"
jt "the retry is attempt 2, phase recorded, a new pane" '.tasks[0].attempts[1] | .id == "IMPL·a2" and .phase == "recorded" and .locator.pane == "w1:p5"'
# the phase flip is a hand edit, committed
jq '.tasks[0].attempts[1].phase = "delivered" | .tasks[0].attempts[1].liveness.prompt_acknowledged = true' "$R" > "$D/run.json.tmp"
cr commit --run "$R" "$D/run.json.tmp"; step_ok "commit the phase flip"
jt "phase is delivered after the commit" '.tasks[0].attempts[1].phase == "delivered"'
cr settle --run "$R" --task IMPL --attempt "IMPL·a2" --outcome done --tier reported --receipt "report: 3 commits"; step_ok "settle IMPL·a2 done"
cr open --run "$R" --task REV --actor rev --pane w1:p6 --machine m1 --report "$D/rev.md"; step_ok "open REV·a1"
cr settle --run "$R" --task REV --attempt "REV·a1" --outcome done --tier reported --receipt "changes-required, 2 findings"; step_ok "settle REV·a1 done"
cr send-back --run "$R" --task IMPL --attempt "IMPL·a2" --review "REV·a1" --by rev --reason "2 findings" --tier reported --actor imp --pane w1:p5 --machine m1 --report "$D/imp.md"; step_ok "send-back IMPL·a2"
eq "the send-back opened IMPL·a3" "$OUT" "IMPL·a3"
# a rebind by commit: a new top takes run.orchestrator
jq '.run.orchestrator = {"pane":"w9:p1","machine":"m1","session":{"agent":"claude","id":"s-2"}} | .generated_at = "2030-01-01T00:00:00Z"' "$R" > "$D/run.json.tmp"
cr commit --run "$R" "$D/run.json.tmp"; step_ok "rebind by commit"
jt "run.orchestrator is the new top's, with machine and session" '.run.orchestrator == {"pane":"w9:p1","machine":"m1","session":{"agent":"claude","id":"s-2"}}'
cr settle --run "$R" --task IMPL --attempt "IMPL·a3" --outcome done --tier verified --receipt "cargo test 12/12"; step_ok "settle IMPL·a3 done"
jt "IMPL: a1 failed, a2 rejected, a3 done; the task is done" '[.tasks[0].attempts[] | .id + ":" + .state] == ["IMPL·a1:failed","IMPL·a2:rejected","IMPL·a3:done"] and .tasks[0].state == "done"'
jt "IMPL·a3's cause is the send-back" '.tasks[0].attempts[2].cause == {"type":"sent_back","by":"rev","ref":"REV·a1","reason":"2 findings"}'
jt "REV is done with one attempt" '.tasks[1].state == "done" and (.tasks[1].attempts | length) == 1'
jt "the run is complete: every attempt is terminal" '[.tasks[].attempts[].state] | all(. == "failed" or . == "rejected" or . == "done")'
jt "attempt ids are unique" '[.tasks[].attempts[].id] | (length == (unique | length))'
eq "the nine writes left only run.json" "$(ls -A "$D")" "run.json"
eq "the event log never lost an event: 4 started, 5 settled" "$(jq -r '[.events[].type] as $t | [($t | map(select(. == "attempt_started")) | length), ($t | map(select(. == "attempt_settled")) | length)] | map(tostring) | join(" ")' "$R")" "4 5"

# --- the lock and stale candidates -----------------------------------------------------

section "the lock: overlapping calls lose nothing; a held lock refuses, live or dead"
fresh par
jq '.tasks += [range(1; 13) | {id: ("P" + tostring), title: "p", kind: "impl", owner: "imp", state: "queued", deps: [], attempts: []}]' "$R" > "$R.new" && mv "$R.new" "$R"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  env -u DAGR_BIN -u DAGR_RUN -u HERDR_PLUGIN_ROOT TMPDIR="$CR_TMP" DAGR_BIN="$DAGR_REAL" "$CREW_RUN" open --run "$R" --task "P$i" --actor imp --pane "w1:p$i" --machine m1 --report "$D/p$i.md" >/dev/null 2>"$T/par$i.err" &
done
wait
eq "twelve overlapping opens: twelve attempts written" "$(jq '[.tasks[] | select(.id | startswith("P")) | .attempts | length] | add' "$R")" "12"
eq "twelve overlapping opens: twelve attempt_started events" "$(jq '[.events[] | select(.type == "attempt_started")] | length' "$R")" "12"
ck "twelve overlapping opens: dagr strict clean" lints "$R"
eq "twelve overlapping opens: only run.json is left" "$(ls -A "$D")" "run.json"
fresh held
printf '%s\n' "$$" > "$R.lock"
LIST0="$(ls -A "$D")"
CR_ENV="DAGR_BIN=$DAGR_REAL CREW_RUN_LOCK_WAIT=1"
refusal "a lock held by a live pid" 2 "holds $R.lock" open --run "$R" --task IMPL --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md"
eq "the live holder's lock is left alone" "$(cat "$R.lock")" "$$"
rm -f "$R.lock"
fresh dead
sh -c 'exit 0' & DEADPID=$!; wait "$DEADPID"
printf '%s\n' "$DEADPID" > "$R.lock"
LIST0="$(ls -A "$D")"
refusal "a lock whose holder is dead is never taken over" 2 "not running on this host" open --run "$R" --task IMPL --actor imp --pane w1:p2 --machine m1 --report "$D/imp.md"
eq "the dead holder's lock is left for the seat" "$(cat "$R.lock")" "$DEADPID"
rm -f "$R.lock"
CR_ENV="DAGR_BIN=$DAGR_REAL"

section "commit and --run: a stale candidate and a directory are refused"
fresh stale
jq '.generated_at = "2026-11-01T09:00:01Z"' "$R" > "$D/run.json.tmp"
touch -d '2001-01-01 00:00:00' "$D/run.json.tmp" 2>/dev/null || touch -t 200101010000 "$D/run.json.tmp"
LIST0="$(ls -A "$D")"
refusal "commit of a candidate older than the run file" 2 "changed after" commit --run "$R" "$D/run.json.tmp"
ck "the stale candidate is left for the seat" test -f "$D/run.json.tmp"
fresh dirrun
mkdir "$D/asdir"; jq . "$R" > "$D/cand.json"
cr commit --run "$D/asdir" "$D/cand.json"
eq "commit onto a directory: exit 2" "$RC" "2"
has "commit onto a directory: says why" "$ERR" "is a directory"
ck "commit onto a directory: the candidate stays where it was" test -f "$D/cand.json"
ck "commit onto a directory: nothing moved into it" test -z "$(ls -A "$D/asdir")"
cr open --run "$D/nodir/run.json" --task IMPL --actor imp --pane p --machine m --report r
eq "a run file in a missing directory: exit 2" "$RC" "2"
has "a run file in a missing directory: says why" "$ERR" "no directory for"

# --- free text --------------------------------------------------------------------------

section "free text round-trips; it is only ever a jq --arg value"
NASTY="$(printf 'a "quoted" $(touch %s/pwned) `touch %s/pwned2` \\n back\\slash\nnew line; --flag * ? {x}' "$T" "$T")"
opened text1
cr settle --run "$R" --task IMPL --attempt "IMPL·a1" --outcome done --tier asserted --receipt "$NASTY" --reason "$NASTY"
eq "settle with nasty text exits 0" "$RC" "0"
ck "it passes dagr" lints "$R"
jta "the receipt is byte-for-byte" '.tasks[0].attempts[0].outcome.receipt == $a' "$NASTY"
jta "the reason is byte-for-byte" '.tasks[0].attempts[0].outcome.reason == $a' "$NASTY"
ck "nothing was executed" test ! -e "$T/pwned" -a ! -e "$T/pwned2"
opened text2
cr open --run "$R" --task REV --actor "$NASTY" --pane "$NASTY" --machine "$NASTY" --report "$NASTY"
jta "open's actor, pane, machine and report are byte-for-byte" '.tasks[1].attempts[0] | .actor == $a and .locator.pane == $a and .locator.machine == $a and .locator.report == $a' "$NASTY"
ck "nothing was executed (open)" test ! -e "$T/pwned" -a ! -e "$T/pwned2"

report
