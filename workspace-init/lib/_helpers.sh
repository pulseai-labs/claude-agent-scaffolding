#!/usr/bin/env bash
# lib/_helpers.sh — shared primitives for workspace-init.
# Bash 3.2+ compatible (stock macOS). Requires: jq.
# Source via: source "${WI_LIB_DIR}/_helpers.sh"
#
# Mirrors architect-critic/lib/_helpers.sh structure (ac_* → wi_*) and
# claude-security-audit/lib/helpers.sh realpath-fallback pattern, but does NOT
# use `set -e` — callers do explicit return-code checks.

set -u

# --- Logging (all to stderr, INFO/WARN/ERROR prefixes per spec §4) ---

wi_log_info()  { echo "INFO: $*"  >&2; }
wi_log_warn()  { echo "WARN: $*"  >&2; }
wi_log_error() { echo "ERROR: $*" >&2; }

# --- Path canonicalization (no GNU `realpath` dependency) -----------------
# Resolves symlinks and `..` via `cd -P`. On macOS this expands /tmp →
# /private/tmp, /var → /private/var, etc. — the canonical form.
# For non-existing paths, best-effort: canonicalize parent + append basename.
wi_realpath() {
  local target_path="$1"
  if [[ -d "$target_path" ]]; then
    ( cd "$target_path" 2>/dev/null && pwd -P )
    return 0
  fi
  if [[ -e "$target_path" ]]; then
    local dir base
    dir="$(dirname "$target_path")"
    base="$(basename "$target_path")"
    ( cd "$dir" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$base" )
    return 0
  fi
  # Not yet existing — canonicalize parent if possible.
  local dir base
  dir="$(dirname "$target_path")"
  base="$(basename "$target_path")"
  if [[ -d "$dir" ]]; then
    printf '%s/%s\n' "$( cd "$dir" 2>/dev/null && pwd -P )" "$base"
  else
    printf '%s\n' "$target_path"
  fi
}

# wi_resolve_root <path>
# Canonicalize to an absolute physical path, like wi_realpath, but also anchor
# relative input at $PWD first so the result is absolute even when the target
# (or a parent) does not yet exist. Always prints a non-empty line for
# non-empty input; empty input prints empty.
wi_resolve_root() {
  local p="$1"
  [[ -z "$p" ]] && { printf '\n'; return 0; }
  [[ "$p" != /* ]] && p="${PWD}/${p}"
  local resolved
  resolved="$(wi_realpath "$p")"
  printf '%s\n' "${resolved:-$p}"
}

# wi_tmpname_beside <target>
# Print a random temp name beside <target> for a tmp-then-mv write, without
# creating it. A predictable ${target}.tmp.$$ name lets anyone who can write
# the directory plant a symlink there first, which the writer's redirect
# follows — overwriting the link's target — and the rename then installs
# (#582). Nothing exists under the name until wi_write_new creates it, so a
# watcher of the directory has no file to find and swap beforehand.
# Returns 1, printing nothing, if no name can be made.
wi_tmpname_beside() {
  mktemp -u "${1}.tmp.XXXXXX" 2>/dev/null
}

# wi_write_new <path> <mode> <command> [args...]
# Create <path>, which must not exist yet, and run <command> with its stdout on
# the new file. <mode> is the octal mode to create it with; "" gives what a
# plain redirect gives, 0666 less the umask. A redirect creates from 0666, so
# execute bits in <mode> are not set: a caller that needs them adds them.
#
# A file created by name and written by name later can be swapped for a
# symlink in between by anyone who can write the directory, and the write then
# lands on the link's target (#582). So the file is opened once, here, and
# written only through that descriptor. noclobber makes bash create it with
# O_EXCL, which refuses any existing entry — a symlink too, dangling or not —
# except a non-regular file (a device, or a link to one), which bash opens
# without O_EXCL; the -f test on the descriptor (bash fstat()s /dev/fd/N)
# refuses that. The mode is set at creation through the umask, never by a
# chmod on the path afterwards: a descriptor opened for writing stays writable
# even when the mode it created the file with (0400, 0444) is not.
# Returns non-zero if the file cannot be created or <command> fails; the
# caller removes <path>.
wi_write_new() {
  local path="$1" mode="$2"
  shift 2
  (
    set -C
    if [[ -n "$mode" ]]; then
      umask "$(printf '%o' $(( 0777 & ~0$mode )))" || exit 1
    fi
    { exec 3>"$path"; } 2>/dev/null || exit 1
    [[ -f /dev/fd/3 ]] || exit 1
    "$@" >&3
  )
}

# wi_file_mode <file>
# Print the permission bits of <file> (not following a symlink) as octal, read
# from `ls -ld`: POSIX fixes its first ten characters on GNU and BSD alike,
# where `stat` differs. setuid, setgid and sticky are not carried: s and t
# count as the execute bit they sit on, S and T as its absence.
wi_file_mode() {
  local line m=0 i c
  line="$(ls -ld "$1" 2>/dev/null)" || return 1
  for (( i = 1; i <= 9; i++ )); do
    c="${line:i:1}"
    m=$(( m << 1 ))
    case "$c" in
      -|S|T) : ;;
      *) m=$(( m | 1 )) ;;
    esac
  done
  printf '%o\n' "$m"
}

# --- File-based locking via `set -o noclobber` ----------------------------
# Mirror of architect-critic's ac_lock_acquire pattern. Retry budget is
# configurable via WI_LOCK_RETRIES (default 5, one second between attempts)
# so tests can fail-fast on a held lock.
wi_lock_acquire() {
  local lock="$1"
  local max="${WI_LOCK_RETRIES:-5}"
  local i=0
  while (( i < max )); do
    if ( set -o noclobber; > "$lock" ) 2>/dev/null; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  wi_log_warn "could not acquire lock $lock after ${max}s"
  return 1
}

wi_lock_release() {
  # Idempotent: -f swallows "no such file" so re-release is safe.
  rm -f "$1"
  return 0
}

# --- Init-log entry append ------------------------------------------------
# Format: OP\tPATH[\tDETAIL]\n
# Appends one line; creates parent directory if missing.
wi_log_op() {
  local logfile="$1"
  local op="$2"
  local target_path="$3"
  local detail="${4:-}"
  local dir
  dir="$(dirname "$logfile")"
  [[ -d "$dir" ]] || mkdir -p "$dir"
  if [[ -n "$detail" ]]; then
    printf '%s\t%s\t%s\n' "$op" "$target_path" "$detail" >> "$logfile"
  else
    printf '%s\t%s\n' "$op" "$target_path" >> "$logfile"
  fi
}

# --- Template render with ${VAR} substitution -----------------------------
# Args: wi_render_template <tmpl> <out> [VAR1=val1 VAR2=val2 ...]
# Substitutes literal `${VAR}` placeholders in the template body. Pure-bash
# parameter expansion — no shell metachar evaluation, so values can safely
# contain `$`, backticks, etc.
wi_render_template() {
  local tmpl="$1"
  local out="$2"
  shift 2
  if [[ ! -f "$tmpl" ]]; then
    wi_log_error "template not found: $tmpl"
    return 1
  fi
  local content
  content="$(cat "$tmpl")"
  local pair var val
  while (( $# > 0 )); do
    pair="$1"; shift
    var="${pair%%=*}"
    val="${pair#*=}"
    # Replace every literal ${VAR} with val. Bash 3.2-safe pattern expansion.
    content="${content//\$\{${var}\}/${val}}"
  done
  local outdir
  outdir="$(dirname "$out")"
  [[ -d "$outdir" ]] || mkdir -p "$outdir"
  printf '%s\n' "$content" > "$out"
}
