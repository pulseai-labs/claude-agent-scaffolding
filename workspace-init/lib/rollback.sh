#!/usr/bin/env bash
# lib/rollback.sh — undo init-log ops in reverse order.
#
# Per SPEC §8.9, when any mid-init task fails we walk the init-log in REVERSE
# and execute the inverse of each op. Pair-with mode (§8.9 step 3) MUST NOT
# touch the pre-existing canonical: the user owns that state, so even ops we
# performed against it (e.g. HOOK_INSTALL on canonical's .git/hooks) are
# deliberately left in place — the user can manually remove them if desired.
#
# Init-log line format (per lib/_helpers.sh wi_log_op):
#     OP\tPATH[\tDETAIL]\n
#
# Ops & inverses:
#     MKDIR        → rm -rf <path>            (fresh-mode strategy; we own dirs we created)
#     WRITE_FILE   → rm -f  <path>            (idempotent on missing)
#     GIT_INIT     → rm -rf <path>/.git       (the working dir survives; .git is what GIT_INIT created)
#     HOOK_INSTALL → rm -f  <path>/.git/hooks/commit-msg  (sibling hooks/sample files preserved)
#     GIT_STAGE    → no-op                    (staging isn't destructive)
#
# Requires: lib/_helpers.sh (wi_log_*).

set -u

if ! declare -F wi_log_op >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_helpers.sh"
fi
if ! declare -F _wi_trace_filter_is_our_hook >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/trace-filter.sh"
fi

# ---------------------------------------------------------------------------
# wi_rollback <init-log-path> [--pair-with <existing-canonical>]
#
# Walks the log in reverse order, runs the inverse op per line, prints a tally
# message to stderr. Always returns 0 — rollback is best-effort and a failed
# inverse op is a warning, not a fatal (we still try the next inverse).
# ---------------------------------------------------------------------------
wi_rollback() {
  if (( $# < 1 )); then
    wi_log_error "wi_rollback: usage: wi_rollback <init-log> [--pair-with <path>]"
    return 1
  fi

  local log="$1"
  shift
  local pair_with=""
  while (( $# > 0 )); do
    case "$1" in
      --pair-with)
        if [[ -z "${2:-}" ]]; then
          wi_log_error "wi_rollback: --pair-with requires PATH"
          return 1
        fi
        pair_with="$2"
        shift 2
        ;;
      *)
        wi_log_error "wi_rollback: unknown arg: $1"
        return 1
        ;;
    esac
  done

  # Canonicalize pair-with so prefix matching is reliable across symlinks /
  # trailing slashes / etc.
  if [[ -n "$pair_with" ]]; then
    local _canon
    _canon="$(wi_realpath "$pair_with" 2>/dev/null)"
    [[ -n "$_canon" ]] && pair_with="$_canon"
    # Strip trailing slash for clean prefix comparison.
    pair_with="${pair_with%/}"
  fi

  if [[ ! -f "$log" ]]; then
    wi_log_warn "wi_rollback: log not found (no-op): $log"
    return 0
  fi

  # Read entries into an array, then iterate in reverse.
  local -a entries=()
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    entries+=("$line")
  done < "$log"

  local total=${#entries[@]}
  local reverted=0
  local skipped_pair_with=0
  local skipped_unknown=0
  local warnings=0

  local i entry op rest target_path
  for (( i = total - 1; i >= 0; i-- )); do
    entry="${entries[$i]}"

    # Split on TAB: first field = op, second field = path. (Detail field is
    # ignored — no current op records one, but the parser tolerates it.)
    op="${entry%%	*}"
    if [[ "$entry" == *"	"* ]]; then
      rest="${entry#*	}"
      target_path="${rest%%	*}"
    else
      target_path=""
    fi

    # Pair-with safety: skip ANY op whose path equals or is under the
    # pre-existing canonical (per SPEC §8.9 step 3). Canonicalize the log path
    # too so the prefix match survives symlink legs (e.g. /var → /private/var
    # on macOS, where `mktemp -d -t` returns /var/folders/... but `pwd -P`
    # resolves the same dir as /private/var/folders/...).
    if [[ -n "$pair_with" && -n "$target_path" ]]; then
      local cmp_path="${target_path%/}"
      local cmp_canon=""
      cmp_canon="$(wi_realpath "$cmp_path" 2>/dev/null)"
      cmp_canon="${cmp_canon%/}"
      if [[ "$cmp_path"  == "$pair_with" || "$cmp_path"  == "$pair_with"/* \
         || "$cmp_canon" == "$pair_with" || "$cmp_canon" == "$pair_with"/* ]]; then
        skipped_pair_with=$((skipped_pair_with + 1))
        continue
      fi
    fi

    case "$op" in
      MKDIR)
        if [[ -z "$target_path" ]]; then
          wi_log_warn "wi_rollback: MKDIR entry missing path; skipping"
          warnings=$((warnings + 1))
          continue
        fi
        if [[ -d "$target_path" ]]; then
          if rm -rf -- "$target_path" 2>/dev/null; then
            reverted=$((reverted + 1))
          else
            wi_log_warn "wi_rollback: rm -rf failed: $target_path"
            warnings=$((warnings + 1))
          fi
        else
          # Already gone (parent was rm -rf'd earlier this loop, or user removed it).
          reverted=$((reverted + 1))
        fi
        ;;
      WRITE_FILE)
        if [[ -z "$target_path" ]]; then
          wi_log_warn "wi_rollback: WRITE_FILE entry missing path; skipping"
          warnings=$((warnings + 1))
          continue
        fi
        # rm -f is idempotent on missing files.
        if rm -f -- "$target_path" 2>/dev/null; then
          reverted=$((reverted + 1))
        else
          wi_log_warn "wi_rollback: rm -f failed: $target_path"
          warnings=$((warnings + 1))
        fi
        ;;
      GIT_INIT)
        if [[ -z "$target_path" ]]; then
          wi_log_warn "wi_rollback: GIT_INIT entry missing path; skipping"
          warnings=$((warnings + 1))
          continue
        fi
        if rm -rf -- "${target_path}/.git" 2>/dev/null; then
          reverted=$((reverted + 1))
        else
          wi_log_warn "wi_rollback: rm -rf .git failed: ${target_path}/.git"
          warnings=$((warnings + 1))
        fi
        ;;
      HOOK_INSTALL)
        if [[ -z "$target_path" ]]; then
          wi_log_warn "wi_rollback: HOOK_INSTALL entry missing path; skipping"
          warnings=$((warnings + 1))
          continue
        fi
        local hook="${target_path}/.git/hooks/commit-msg"
        # Never delete a hook we did not write: install refuses foreign hooks,
        # so a foreign commit-msg here means the user replaced ours (or the log
        # line is stale). Leave it and warn (#457). Install never writes a
        # symlink and refuses to replace one (#490), so ANY symlink here —
        # dangling, or pointing at a copy of our hook — is the user's.
        if [[ -L "$hook" ]] || { [[ -e "$hook" ]] && ! _wi_trace_filter_is_our_hook "$hook"; }; then
          wi_log_warn "wi_rollback: commit-msg hook not installed by workspace-init; leaving in place: $hook"
          warnings=$((warnings + 1))
          continue
        fi
        if rm -f -- "$hook" 2>/dev/null; then
          reverted=$((reverted + 1))
        else
          wi_log_warn "wi_rollback: rm -f hook failed: $hook"
          warnings=$((warnings + 1))
        fi
        ;;
      GIT_STAGE)
        # Staging is non-destructive. Count it as reverted for an accurate tally.
        reverted=$((reverted + 1))
        ;;
      *)
        wi_log_warn "wi_rollback: unknown op '$op' (entry: $entry); skipping"
        skipped_unknown=$((skipped_unknown + 1))
        ;;
    esac
  done

  local total_skipped=$((skipped_pair_with + skipped_unknown))
  if (( total_skipped > 0 )); then
    wi_log_info "wi_rollback: rolled back $reverted of $total ops; $total_skipped skipped (pair-with safety: $skipped_pair_with; unknown ops: $skipped_unknown)"
  else
    wi_log_info "wi_rollback: rolled back $reverted of $total ops"
  fi

  if (( warnings > 0 )); then
    wi_log_warn "wi_rollback: $warnings inverse op(s) emitted warnings"
  fi

  return 0
}
