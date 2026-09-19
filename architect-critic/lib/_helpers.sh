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
# left byte-identical, and rc is non-zero. The funnel never touches the state
# lock — the lock's owner releases it (see ac_lock_acquire's EXIT trap, #483).
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

# Lock-file pattern (mirror of scaffold-onboard's compose.lock), hardened so a
# held lock is released on EVERY exit path — normal return, a funnel refusal,
# or an errexit anywhere inside the locked region under bin/arc's
# `set -euo pipefail` — while no path ever removes a lock this process does
# not hold (#483):
#   - ownership is recorded in-process (AC_HELD_LOCK) and on-disk (the lock
#     file carries a per-acquire token written atomically by noclobber);
#   - ac_lock_release removes the file only while it is still ours — the path
#     matches what we hold and its content matches our token — so a second
#     release, or a release after another owner replaced the file, is a no-op;
#   - the EXIT trap installed on first acquire releases a still-held lock when
#     the owning process exits for any reason. It runs only at subshell depth
#     0 so a command substitution inside a locked region cannot release the
#     parent's lock, and it chains any EXIT trap that predates ours.
AC_HELD_LOCK=""
_AC_LOCK_TOKEN=""
_AC_LOCK_TRAP_INSTALLED=""
_AC_PRIOR_EXIT_TRAP=""
_AC_IN_EXIT_TRAP=""

# Args: <lock_path>
ac_lock_acquire() {
  local lock="$1"
  local token="$$-$RANDOM-$RANDOM"
  local i
  for ((i=0; i<5; i++)); do
    if ( set -o noclobber; printf '%s' "$token" > "$lock" ) 2>/dev/null; then
      AC_HELD_LOCK="$lock"
      _AC_LOCK_TOKEN="$token"
      _ac_lock_install_trap
      return 0
    fi
    sleep 1
  done
  ac_log_warn "could not acquire lock $lock after 5s"
  return 1
}

# Args: <lock_path>. Removes the file only while it is still the lock we hold;
# clears our registration either way, so after this returns we hold nothing.
ac_lock_release() {
  local lock="$1"
  if [[ -n "$lock" && "$AC_HELD_LOCK" == "$lock" ]]; then
    AC_HELD_LOCK=""
    if [[ -f "$lock" && "$(cat "$lock" 2>/dev/null)" == "$_AC_LOCK_TOKEN" ]]; then
      rm -f "$lock"
    fi
  fi
  return 0
}

# EXIT-trap handler: release the lock iff this process still holds it and we
# are exiting the top-level shell (a command substitution must not release
# the parent's lock), then run any EXIT trap that predates ours.
_ac_lock_on_exit() {
  if [[ -n "$_AC_IN_EXIT_TRAP" ]]; then
    return 0
  fi
  _AC_IN_EXIT_TRAP=1
  if [[ ${BASH_SUBSHELL:-0} -eq 0 && -n "$AC_HELD_LOCK" ]]; then
    ac_lock_release "$AC_HELD_LOCK"
  fi
  if [[ -n "$_AC_PRIOR_EXIT_TRAP" ]]; then
    eval "$_AC_PRIOR_EXIT_TRAP"
  fi
}

# Install the EXIT trap once, preserving whatever trap the caller set before
# us (bin/arc sets none today; the chain keeps that promise if it ever does).
_ac_lock_install_trap() {
  local prior
  if [[ -z "$_AC_LOCK_TRAP_INSTALLED" ]]; then
    prior="$(trap -p EXIT | sed -n "s/^trap -- '\(.*\)' EXIT\$/\1/p")"
    if [[ "$prior" == "_ac_lock_on_exit" ]]; then
      prior=""
    fi
    _AC_PRIOR_EXIT_TRAP="$prior"
    trap '_ac_lock_on_exit' EXIT
    _AC_LOCK_TRAP_INSTALLED=1
  fi
}
