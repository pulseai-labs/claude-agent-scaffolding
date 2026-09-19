#!/usr/bin/env bash
# architect-critic shared helpers — sourced by every other lib.

ac_log_info()  { echo "[architect-critic INFO] $*" >&2; }
ac_log_warn()  { echo "[architect-critic WARN] $*" >&2; }
ac_log_error() { echo "[architect-critic ERROR] $*" >&2; }

# ${CLAUDE_PLUGIN_DATA} is set by Claude Code; fallback for tests.
ac_data_dir() {
  echo "${CLAUDE_PLUGIN_DATA:-$HOME/.claude/architect-critic}"
}

# jq-then-mv guard: the replacement is written to a temp file and atomically
# mv'd to target only when it is exactly one JSON object. jq exits 0 on an
# empty or multi-document stream, so exit status alone is not a guard (#451):
# a generator-shaped program that emits nothing would otherwise mv a 0-byte
# file over state.json. On any refusal the tmp file is removed, the target is
# left byte-identical, and rc is non-zero.
# Args: <target> <jq command pieces...>
ac_guarded_jq_write() {
  local target="$1"; shift
  local tmp
  tmp="$(mktemp "${target}.XXXXXX")" || return 1
  if ! jq "$@" > "$tmp"; then
    rm -f "$tmp"
    ac_log_error "jq failed during write to $target"
    return 1
  fi
  if ! jq -e -s 'length == 1 and (.[0] | type == "object")' "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    ac_log_error "refusing to write $target: jq output is not exactly one JSON object"
    return 1
  fi
  mv "$tmp" "$target"
}

# Lock-file pattern (mirror of scaffold-onboard's compose.lock).
# Args: <lock_path>
ac_lock_acquire() {
  local lock="$1"
  local i
  for ((i=0; i<5; i++)); do
    if ( set -o noclobber; > "$lock" ) 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  ac_log_warn "could not acquire lock $lock after 5s"
  return 1
}

ac_lock_release() {
  rm -f "$1"
}
