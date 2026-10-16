#!/usr/bin/env bash
# test-state-writer-init.sh — #512 item 4: every state writer creates state.json
# when it is ABSENT, and only then. An existing file that is unparseable,
# unreadable, or not a regular file (a directory, a dangling symlink, a FIFO) is
# still refused and left as it was. The create takes state.lock and re-checks
# absence under it. Checks go through bin/arc (`set -euo pipefail`); W7 also
# runs the external writers sourced, where no errexit stops them.
# W9 creates the path while the writer waits for the lock.
set -u

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$(cd "$TESTS_DIR/../lib" && pwd)"
PLUGIN_ROOT="$(cd "$TESTS_DIR/.." && pwd)"

source "$TESTS_DIR/_helpers.sh"
source "$LIB_DIR/_helpers.sh"
source "$LIB_DIR/state.sh"

ARC="$PLUGIN_ROOT/bin/arc"
WRITERS="append_run append_promotion write_field external_run_add"

echo "=== test-state-writer-init.sh ==="

fresh() {
  setup_tmp_repo > /dev/null
  STATE_FILE="$CLAUDE_PLUGIN_DATA/state.json"
  LOCK_FILE="$CLAUDE_PLUGIN_DATA/state.lock"
}

# run_writer <writer> — one arc call that writes one record. Bounded by
# timeout so a writer that blocks on a FIFO fails instead of hanging the suite.
run_writer() {
  case "$1" in
    append_run)
      timeout 15 bash "$ARC" state_append_run --request-id req-new --depth close \
        --adversaries claude --challenge-count 1 --concessions 0 \
        --skill-invoked critiquing-spec --elapsed-ms 5 ;;
    append_promotion)
      timeout 15 bash "$ARC" state_append_promotion manual "a principle" user ;;
    write_field)
      timeout 15 bash "$ARC" state_write_field .note '"hello"' ;;
    external_run_add)
      timeout 15 bash "$ARC" state_external_run_add --run-id r-1 --host claude \
        --adversary codex --artifact /tmp/spec.md --depth close \
        --result-path "$CLAUDE_PLUGIN_DATA/async/r-1/result.json" ;;
  esac
}

# probe <writer> — prints the one value that writer's record sets.
probe() {
  case "$1" in
    append_run)       jq -r '.recent_runs | map(.request_id) | join(",")' "$STATE_FILE" ;;
    append_promotion) jq -r '.principle_promotions | map(.text) | join(",")' "$STATE_FILE" ;;
    write_field)      jq -r '.note' "$STATE_FILE" ;;
    external_run_add) jq -r '.external_runs | map(.run_id) | join(",")' "$STATE_FILE" ;;
  esac 2>/dev/null
}

expected_probe() {
  case "$1" in
    append_run) echo "req-new" ;;
    append_promotion) echo "a principle" ;;
    write_field) echo "hello" ;;
    external_run_add) echo "r-1" ;;
  esac
}

sha() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; }

# ---------------------------------------------------------------------------
echo "W1: a writer on an absent state.json creates it and writes one record"
for w in $WRITERS; do
  fresh
  run_writer "$w" >/dev/null 2>"$TMP_DIR/err.txt"
  assert_eq "$w on absent state.json: rc0" "0" "$?"
  assert_eq "$w on absent state.json: schema_version 3" "3" "$(jq -r '.schema_version' "$STATE_FILE" 2>/dev/null)"
  assert_eq "$w on absent state.json: its record" "$(expected_probe "$w")" "$(probe "$w")"
  assert_file_missing "$LOCK_FILE"
done

echo "W2: a writer with no data dir at all creates the dir and the file"
for w in $WRITERS; do
  fresh
  rm -rf "$CLAUDE_PLUGIN_DATA"
  run_writer "$w" >/dev/null 2>&1
  assert_eq "$w with no data dir: rc0" "0" "$?"
  assert_eq "$w with no data dir: its record" "$(expected_probe "$w")" "$(probe "$w")"
done

echo "W3: the run-id writers on an absent state.json report not-found, not a jq open error"
fresh
bash "$ARC" state_external_run_set_status r-x completed >/dev/null 2>"$TMP_DIR/err.txt"
assert_eq "set_status on absent: rc1" "1" "$?"
assert_eq "set_status on absent: run-id not found" "0" "$(grep -q 'run-id not found' "$TMP_DIR/err.txt"; echo $?)"
fresh
bash "$ARC" state_external_run_resolve r-x req-x >/dev/null 2>"$TMP_DIR/err.txt"
assert_eq "resolve on absent: rc1" "1" "$?"
assert_eq "resolve on absent: run-id not found" "0" "$(grep -q 'run-id not found' "$TMP_DIR/err.txt"; echo $?)"
fresh
bash "$ARC" state_external_run_finalize_resume --run-id r-x --request-id q --depth close \
  --adversaries claude --challenge-count 0 --concessions 0 --skill-invoked s --elapsed-ms 1 \
  >/dev/null 2>"$TMP_DIR/err.txt"
assert_eq "finalize_resume on absent: rc1" "1" "$?"
assert_eq "finalize_resume on absent: run-id not found" "0" "$(grep -q 'run-id not found' "$TMP_DIR/err.txt"; echo $?)"

# ---------------------------------------------------------------------------
# W4 (controls for the loosening): writers now accept an ABSENT file, so pin
# that every existing shape they cannot use is still refused and left as it was.
echo "W4: an existing unusable state.json is refused and left as it was"
for w in $WRITERS; do
  # Unparseable: byte-identical.
  fresh
  printf 'this is not json{\n' > "$STATE_FILE"
  before="$(sha "$STATE_FILE")"
  run_writer "$w" >/dev/null 2>&1; rc=$?
  assert_eq "$w on unparseable: refused" "1" "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo 1 || echo "rc=$rc")"
  assert_eq "$w on unparseable: byte-identical" "$before" "$(sha "$STATE_FILE")"

  # Unreadable (a valid document the process cannot read): byte-identical.
  fresh
  printf '%s\n' '{"schema_version":3,"recent_runs":[{"request_id":"mine"}],"external_runs":[],"principle_promotions":[]}' > "$STATE_FILE"
  before="$(sha "$STATE_FILE")"
  chmod 000 "$STATE_FILE"
  if [[ -r "$STATE_FILE" ]]; then
    echo "  - $w on unreadable: skipped (running as a user that can read mode 000)"
  else
    run_writer "$w" >/dev/null 2>&1; rc=$?
    chmod 600 "$STATE_FILE"
    assert_eq "$w on unreadable: refused" "1" "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo 1 || echo "rc=$rc")"
    assert_eq "$w on unreadable: byte-identical" "$before" "$(sha "$STATE_FILE")"
  fi
  chmod 600 "$STATE_FILE" 2>/dev/null

  # A directory: still an empty directory.
  fresh
  mkdir "$STATE_FILE"
  run_writer "$w" >/dev/null 2>&1; rc=$?
  assert_eq "$w on a directory: refused" "1" "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo 1 || echo "rc=$rc")"
  assert_eq "$w on a directory: still an empty directory" "dir:" "$([[ -d "$STATE_FILE" ]] && echo "dir:$(ls -A "$STATE_FILE")")"

  # A dangling symlink: still dangling, its target never created.
  fresh
  ln -s "$TMP_DIR/elsewhere/state.json" "$STATE_FILE"
  mkdir -p "$TMP_DIR/elsewhere"
  run_writer "$w" >/dev/null 2>&1; rc=$?
  assert_eq "$w on a dangling symlink: refused" "1" "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo 1 || echo "rc=$rc")"
  assert_eq "$w on a dangling symlink: still a link, target absent" "link:absent" \
    "$([[ -L "$STATE_FILE" ]] && echo link):$([[ -e "$TMP_DIR/elsewhere/state.json" ]] && echo present || echo absent)"

  # A FIFO: refused promptly (timeout's 124 is a hang, not a refusal).
  fresh
  mkfifo "$STATE_FILE"
  run_writer "$w" >/dev/null 2>&1; rc=$?
  assert_eq "$w on a FIFO: refused without blocking" "1" "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo 1 || echo "rc=$rc")"
  assert_eq "$w on a FIFO: still a FIFO" "fifo" "$([[ -p "$STATE_FILE" ]] && echo fifo)"
  assert_file_missing "$LOCK_FILE"
done

# ---------------------------------------------------------------------------
echo "W5: the create takes state.lock — a foreign lock means no file is created"
fresh
printf 'foreign-owner-token' > "$LOCK_FILE"
run_writer append_run >/dev/null 2>&1
[[ $? -ne 0 ]]
assert_eq "append_run on absent under a foreign lock: refused" "0" "$?"
assert_file_missing "$STATE_FILE"
assert_eq "foreign lock survives" "foreign-owner-token" "$(cat "$LOCK_FILE" 2>/dev/null)"

echo "W6: absence is re-checked under the lock — another owner's document is kept"
fresh
printf 'foreign-owner-token' > "$LOCK_FILE"
( sleep 0.5
  printf '%s\n' '{"schema_version":3,"recent_runs":[{"request_id":"kept"}],"external_runs":[],"principle_promotions":[]}' > "$STATE_FILE"
  rm -f "$LOCK_FILE" ) &
w6_bg=$!
run_writer append_run >/dev/null 2>&1
assert_eq "append_run after the other owner's create: rc0" "0" "$?"
wait "$w6_bg"
assert_eq "the other owner's record is kept, ours appended" "kept,req-new" "$(probe append_run)"
assert_file_missing "$LOCK_FILE"

# ---------------------------------------------------------------------------
# W7: sourced, with no errexit to stop them, the run-id writers still return
# when ac_state_init refuses — they never go on to read a FIFO and block.
echo "W7: sourced external writers stop when init refuses (no errexit)"
for verb in \
  "ac_state_external_run_add --run-id r-1 --host claude --adversary codex --artifact /tmp/a --depth close --result-path /tmp/r" \
  "ac_state_external_run_set_status r-1 completed" \
  "ac_state_external_run_resolve r-1 req-1" \
  "ac_state_external_run_finalize_resume --run-id r-1 --request-id q --depth close --adversaries claude --challenge-count 0 --concessions 0 --skill-invoked s --elapsed-ms 1"; do
  fresh
  mkfifo "$STATE_FILE"
  timeout 15 bash -c 'source "$1/_helpers.sh"; source "$1/state.sh"; shift; eval "$*"' _ "$LIB_DIR" "$verb" >/dev/null 2>&1; rc=$?
  assert_eq "sourced ${verb%% *} on a FIFO: returns non-zero without blocking" "1" "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo 1 || echo "rc=$rc")"
done

# ---------------------------------------------------------------------------
# W8: a writer runs ac_state_init first, so a v2 file is upgraded on write —
# external_runs[] added, schema_version 3 — and keeps every field it had.
echo "W8: a writer on a v2 state.json upgrades it and keeps its fields"
for w in append_run append_promotion write_field; do
  fresh
  printf '%s\n' '{"schema_version":2,"recent_runs":[{"request_id":"old"}],"principle_promotions":[],"extra_unknown":{"k":"v"}}' > "$STATE_FILE"
  run_writer "$w" >/dev/null 2>&1
  assert_eq "$w on v2: rc0" "0" "$?"
  assert_eq "$w on v2: upgraded to schema 3 with external_runs[]" "3:array" \
    "$(jq -r '"\(.schema_version):\(.external_runs | type)"' "$STATE_FILE" 2>/dev/null)"
  assert_eq "$w on v2: earlier fields kept" "old:v" \
    "$(jq -r '"\(.recent_runs[0].request_id):\(.extra_unknown.k)"' "$STATE_FILE" 2>/dev/null)"
done

# ---------------------------------------------------------------------------
# W9: a path that appears while the create waits for state.lock is checked like
# any existing path, never trusted (PR #830 round 1): a FIFO is refused without
# blocking, and a v2 document is upgraded before the write.
echo "W9: a path created during the lock wait is checked, not trusted"
fresh
printf 'foreign-owner-token' > "$LOCK_FILE"
( sleep 0.5; mkfifo "$STATE_FILE"; rm -f "$LOCK_FILE" ) &
w9_bg=$!
run_writer append_run >/dev/null 2>&1; rc=$?
wait "$w9_bg"
assert_eq "append_run, FIFO created during the wait: refused without blocking" "1" \
  "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo 1 || echo "rc=$rc")"
assert_eq "the FIFO is left as it was" "1" "$([[ -p "$STATE_FILE" ]] && echo 1 || echo 0)"

fresh
printf 'foreign-owner-token' > "$LOCK_FILE"
( sleep 0.5
  printf '%s\n' '{"schema_version":2,"recent_runs":[{"request_id":"kept"}],"principle_promotions":[]}' > "$STATE_FILE"
  rm -f "$LOCK_FILE" ) &
w9_bg=$!
run_writer append_run >/dev/null 2>&1
assert_eq "append_run, v2 created during the wait: rc0" "0" "$?"
wait "$w9_bg"
assert_eq "the v2 document is upgraded, its record kept, ours appended" "3:array:kept,req-new" \
  "$(jq -r '"\(.schema_version):\(.external_runs | type):\([.recent_runs[].request_id] | join(","))"' "$STATE_FILE" 2>/dev/null)"

# W10: the same for 0.8.1's blank re-seed — a blank file replaced while the
# re-seed waits for state.lock is checked again, never read if it is a FIFO.
echo "W10: a blank file replaced during the re-seed's lock wait is checked again"
fresh
: > "$STATE_FILE"
printf 'foreign-owner-token' > "$LOCK_FILE"
( sleep 0.5; rm -f "$STATE_FILE"; mkfifo "$STATE_FILE"; rm -f "$LOCK_FILE" ) &
w10_bg=$!
run_writer append_run >/dev/null 2>&1; rc=$?
wait "$w10_bg"
assert_eq "append_run, blank swapped for a FIFO during the wait: refused without blocking" "1" \
  "$([[ $rc -ne 0 && $rc -ne 124 ]] && echo 1 || echo "rc=$rc")"

fresh
: > "$STATE_FILE"
printf 'foreign-owner-token' > "$LOCK_FILE"
( sleep 0.5
  printf '%s\n' '{"schema_version":2,"recent_runs":[{"request_id":"kept"}],"principle_promotions":[]}' > "$STATE_FILE"
  rm -f "$LOCK_FILE" ) &
w10_bg=$!
run_writer append_run >/dev/null 2>&1
assert_eq "append_run, blank filled with v2 during the wait: rc0" "0" "$?"
wait "$w10_bg"
assert_eq "the v2 document is upgraded, its record kept, ours appended" "3:array:kept,req-new" \
  "$(jq -r '"\(.schema_version):\(.external_runs | type):\([.recent_runs[].request_id] | join(","))"' "$STATE_FILE" 2>/dev/null)"

# ---------------------------------------------------------------------------
report_results
