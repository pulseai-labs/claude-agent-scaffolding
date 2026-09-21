#!/usr/bin/env bash
# lib/codex.sh — codex CLI dispatch (v0.2, codex 0.125+ semantics)
#
# Public API:
#   ac_codex_available()
#     Returns 0 if `codex` binary is on PATH, 1 otherwise.
#
#   ac_codex_run_audit <prompt> <output_dir> [--model NAME] [--timeout SECS]
#     Runs codex in the v0.2 invocation shape (per SPEC §5.1 step 6):
#         codex exec --json \
#           --output-schema "${CLAUDE_PLUGIN_ROOT}/templates/output-schema.json" \
#           --output-last-message "${output_dir}/codex-audit-${REQ_ID}.json" \
#           --ignore-user-config --ignore-rules \
#           --skip-git-repo-check \
#           [-c model="<NAME>"] \
#           "<prompt>"
#     - Default timeout: 300s (5 min). Overridable via env
#       ARCHITECT_CRITIC_CODEX_TIMEOUT_S, or the `--timeout SECS` flag (flag wins).
#     - Parses the file written via --output-last-message; validates the JSON
#       has the required schema shape (challenges:[] with text/severity/rationale
#       on each item).
#     - On success: prints the parsed JSON to stdout, returns 0.
#     - On timeout: returns 124 (GNU timeout convention), logs warn,
#       prints empty result {"challenges":[]} to stdout.
#     - On non-zero codex exit, missing/invalid JSON, or schema violation:
#       returns 1, logs warn, prints {"challenges":[]} to stdout.
#
# Env overrides:
#   ARCHITECT_CRITIC_CODEX_TIMEOUT_S   integer seconds (default 300)
#   CLAUDE_PLUGIN_ROOT                 plugin root used to locate output-schema.json;
#                                      falls back to two-levels-up from this file.
#
# Differences from v0.1:
#   - `codex exec` subcommand with positional prompt (v0.1 piped via stdin).
#   - `--json` streaming output (machine-readable JSONL on stdout).
#   - `--output-schema` constrains the model's final answer to a JSON Schema.
#   - `--output-last-message` is the canonical source of the parsed result.
#   - `--ignore-user-config --ignore-rules --skip-git-repo-check` ensure a clean
#     run that doesn't pick up the user's ~/.codex/config.toml, AGENTS.md, or
#     git-repo nuances.
#   - No hardcoded `--model`; respects the user's codex default. The `--model`
#     flag translates to `-c model="<NAME>"`.
#
# Portability — timeout implementation:
#   GNU coreutils' timeout(1) is Linux-native; on macOS it may be installed as
#   gtimeout via Homebrew or absent. We use a portable bash-only background
#   subshell + kill pattern that works on bash 3.2+ (macOS) and bash 4+ (Linux).

# Ensure _helpers.sh is sourced (safe to double-source).
_AC_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v ac_log_info >/dev/null 2>&1; then
  # shellcheck source=./_helpers.sh
  source "$_AC_LIB_DIR/_helpers.sh"
fi

# Default timeout in seconds (5 min per SPEC §5.1 step 6).
_AC_CODEX_DEFAULT_TIMEOUT_S=300

# ac_codex_available — returns 0 if codex binary found in PATH, 1 otherwise.
ac_codex_available() {
  command -v codex >/dev/null 2>&1
}

# _ac_codex_schema_path — locate templates/output-schema.json.
# Honors CLAUDE_PLUGIN_ROOT (set by Claude Code); falls back to two levels up
# from this file.
_ac_codex_schema_path() {
  if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -f "${CLAUDE_PLUGIN_ROOT}/templates/output-schema.json" ]]; then
    printf '%s' "${CLAUDE_PLUGIN_ROOT}/templates/output-schema.json"
    return 0
  fi
  local guess
  guess="$(cd "$_AC_LIB_DIR/.." && pwd)/templates/output-schema.json"
  printf '%s' "$guess"
}

# _ac_codex_validate_json <file-or-json-string>
# Minimal jq-based schema validation: the argument is either a path to a file
# holding the JSON (sync path: --output-last-message file) OR a literal JSON
# string (async path: the fenced block extracted from Codex output). Valid when
# it is an object with a challenges:[] array whose items each carry
# text/severity/rationale strings; an optional gaps key, if present, must be an
# array of objects so consolidation can source-tag each item. Returns 0 if
# valid, 1 otherwise.
_ac_codex_validate_json() {
  local input="$1" json
  if [[ -f "$input" ]]; then
    json="$(cat "$input")"
  else
    json="$input"
  fi
  printf '%s' "$json" | jq -e '
    type == "object" and
    (.challenges | type == "array") and
    (.challenges | all(
      type == "object" and
      (.text | type == "string") and
      (.severity as $severity |
        ($severity | type == "string") and
        (["premise", "gap", "alternative"] | index($severity) != null)) and
      (.rationale | type == "string")
    )) and
    (.gaps == null or ((.gaps | type == "array") and (.gaps | all(type == "object"))))
  ' >/dev/null 2>&1
}

# _ac_codex_run_with_timeout <timeout_secs> <output_last_msg_file> <argv...>
# Runs `codex "$@"` in background with a portable timeout watcher.
# Returns the codex exit code on completion, or 124 if timed out.
_ac_codex_run_with_timeout() {
  local timeout_secs="$1"; shift
  local last_msg_file="$1"; shift   # reserved for future use / debug logs
  # Remaining "$@" is the codex argv.

  local codex_ec_file
  codex_ec_file="$(mktemp)" || return 1

  (
    codex "$@" >/dev/null 2>&1
    printf '%d' $? > "$codex_ec_file"
  ) &
  local codex_bgpid=$!

  (sleep "$timeout_secs") &
  local sleep_bgpid=$!

  local winner=""
  local poll_interval=0.2
  while true; do
    if ! kill -0 "$codex_bgpid" 2>/dev/null; then
      winner="codex"; break
    fi
    if ! kill -0 "$sleep_bgpid" 2>/dev/null; then
      winner="timeout"; break
    fi
    sleep "$poll_interval"
  done

  if [[ "$winner" == "codex" ]]; then
    kill "$sleep_bgpid" 2>/dev/null
    wait "$sleep_bgpid" 2>/dev/null
    local ec=0
    [[ -f "$codex_ec_file" ]] && ec="$(cat "$codex_ec_file" 2>/dev/null || echo 1)"
    rm -f "$codex_ec_file"
    return "$ec"
  else
    kill "$codex_bgpid" 2>/dev/null
    wait "$codex_bgpid" 2>/dev/null
    rm -f "$codex_ec_file"
    return 124
  fi
}

# ac_codex_run_audit <prompt> <output_dir> [--model NAME] [--timeout SECS]
ac_codex_run_audit() {
  local prompt="$1"; shift || true
  local output_dir="$1"; shift || true

  local model_override=""
  local timeout_override=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model)
        if ! _ac_codex_require_value "ac_codex_run_audit" "$1" "${2:-}"; then
          printf '%s' '{"challenges":[]}'
          return 1
        fi
        model_override="$2"; shift 2 ;;
      --timeout)
        if ! _ac_codex_require_nonnegative_int "ac_codex_run_audit" "$1" "${2:-}"; then
          printf '%s' '{"challenges":[]}'
          return 1
        fi
        timeout_override="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  if [[ -z "$prompt" || -z "$output_dir" ]]; then
    ac_log_warn "ac_codex_run_audit: prompt and output_dir are required"
    printf '%s' '{"challenges":[]}'
    return 1
  fi

  mkdir -p "$output_dir" 2>/dev/null || {
    ac_log_warn "ac_codex_run_audit: cannot create output_dir $output_dir"
    printf '%s' '{"challenges":[]}'
    return 1
  }

  if ! ac_codex_available; then
    ac_log_info "codex not available in PATH; skipping codex audit"
    printf '%s' '{"challenges":[]}'
    return 1
  fi

  local timeout_secs
  if [[ -n "$timeout_override" ]]; then
    timeout_secs="$timeout_override"
  else
    timeout_secs="${ARCHITECT_CRITIC_CODEX_TIMEOUT_S:-$_AC_CODEX_DEFAULT_TIMEOUT_S}"
  fi

  # REQ_ID: timestamp + 6-char random suffix; macOS bash 3.2 compatible.
  local req_id
  req_id="$(date +%s)-$(printf '%06x' $((RANDOM * RANDOM)) | head -c 6)"

  local last_msg_file="${output_dir}/codex-audit-${req_id}.json"
  local schema_path
  schema_path="$(_ac_codex_schema_path)"

  # Build argv. Note: model override uses two arg slots (-c, model="NAME").
  local -a argv
  argv=(
    exec
    --json
    --output-schema "$schema_path"
    --output-last-message "$last_msg_file"
    --ignore-user-config
    --ignore-rules
    --skip-git-repo-check
  )
  if [[ -n "$model_override" ]]; then
    argv+=( -c "model=\"${model_override}\"" )
  fi
  argv+=( "$prompt" )

  _ac_codex_run_with_timeout "$timeout_secs" "$last_msg_file" "${argv[@]}"
  local codex_ec=$?

  if [[ $codex_ec -eq 124 ]]; then
    ac_log_warn "codex timed out after ${timeout_secs}s; falling back to claude-only"
    # Surface partial result if codex wrote anything before being killed.
    if _ac_codex_validate_json "$last_msg_file"; then
      cat "$last_msg_file"
    else
      printf '%s' '{"challenges":[]}'
    fi
    return 124
  fi

  if [[ $codex_ec -ne 0 ]]; then
    ac_log_warn "codex exited with non-zero code ${codex_ec}; falling back to claude-only"
    printf '%s' '{"challenges":[]}'
    return 1
  fi

  if [[ ! -f "$last_msg_file" ]]; then
    ac_log_warn "codex produced no output file; falling back to claude-only"
    printf '%s' '{"challenges":[]}'
    return 1
  fi

  if ! _ac_codex_validate_json "$last_msg_file"; then
    ac_log_warn "codex output failed schema validation; falling back to claude-only"
    printf '%s' '{"challenges":[]}'
    return 1
  fi

  cat "$last_msg_file"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# Back-compat shim — v0.1 callers (commands/critique.md) invoke ac_codex_audit.
# Will be removed once all callers migrate to ac_codex_run_audit.
# This shim writes the audit to a tmp dir and emits the JSON to stdout.
# ─────────────────────────────────────────────────────────────────────────────
ac_codex_audit() {
  local prompt_text="${1:-}"
  local tmp_dir
  tmp_dir="$(mktemp -d -t ac-codex-compat.XXXXXX)" || return 1
  # Translate legacy env var name if set without the _S suffix.
  if [[ -z "${ARCHITECT_CRITIC_CODEX_TIMEOUT_S:-}" && -n "${ARCHITECT_CRITIC_CODEX_TIMEOUT:-}" ]]; then
    export ARCHITECT_CRITIC_CODEX_TIMEOUT_S="$ARCHITECT_CRITIC_CODEX_TIMEOUT"
  fi
  local out ec
  out="$(ac_codex_run_audit "$prompt_text" "$tmp_dir")"
  ec=$?
  rm -rf "$tmp_dir"
  if [[ $ec -eq 0 ]]; then
    printf '%s' "$out"
    return 0
  fi
  return 1
}

# ═════════════════════════════════════════════════════════════════════════════
# Async external adversary (#39 / v0.3) — companion `task --background` spine.
#
# Ported from scaffold-onboard/lib/codex.sh (SS-5.1), itself ported from
# scaffold-dev (SS-5). MINUS the synthesizer/implementer-only legs: the
# architect-critic adversary only READS the audited artifact (embedded in the
# prompt-file) and RETURNS {challenges,gaps} JSON — it writes nothing — so the
# dispatch runs WITHOUT `--write` (read-only; strictly safer than the scaffold
# paths). target_root is still resolved for companion state-keying + trust.
#   Open item (real-codex smoke): if a companion build rejects a no-`--write`
#   task, re-add `--write` here and require target-root trust.
#
# LOAD-BEARING (SS-4 lesson): bin/arc runs `set -euo pipefail` and dispatches
# these via `arc codex_<verb>`. Every external command is captured set-e-safe
# and ac_codex_wait NEVER throws (always rc=0) so the orchestrator keeps control.
# Invoke from skill prose as `arc codex_<verb> …`, never bare `ac_codex_*`.
#
# State coupling: the companion keys job state by sha256(git-toplevel) under
# $CLAUDE_PLUGIN_DATA — every helper `cd`s into <target-root> before any node
# call, and the caller must keep $CLAUDE_PLUGIN_DATA stable across dispatch+polls.
#
# Overrides (testing): ARCHITECT_CRITIC_CODEX_COMPANION (absolute .mjs path,
# wins), ARCHITECT_CRITIC_CODEX_CACHE_DIRS (colon-separated cache roots),
# CODEX_HOME (trusted-projects config root, default ~/.codex).
# ═════════════════════════════════════════════════════════════════════════════

_ac_codex_default_cache_dirs() {
  echo "${HOME}/.claude/plugins/cache"
  echo "${HOME}/.claude/plugins/marketplaces"
  echo "${CODEX_HOME:-$HOME/.codex}/plugins/cache"
}

# _ac_codex_version_gt <a> <b> — true (rc=0) when version <a> sorts AFTER <b>.
# Pure-bash field-wise compare (macOS/BSD `sort` lacks GNU `sort -V`).
_ac_codex_version_gt() {
  local a="$1" b="$2"
  [[ -z "$b" ]] && return 0
  local IFS=.
  local -a av=() bv=()
  read -ra av <<<"$a"
  read -ra bv <<<"$b"
  local max="${#av[@]}"
  [[ "${#bv[@]}" -gt "$max" ]] && max="${#bv[@]}"
  local i ai bi
  for ((i = 0; i < max; i++)); do
    ai="${av[$i]:-0}"
    bi="${bv[$i]:-0}"
    [[ "$ai" =~ ^([0-9]+) ]] && ai="${BASH_REMATCH[1]}" || ai=0
    [[ "$bi" =~ ^([0-9]+) ]] && bi="${BASH_REMATCH[1]}" || bi=0
    if (( 10#$ai > 10#$bi )); then return 0; fi
    if (( 10#$ai < 10#$bi )); then return 1; fi
  done
  [[ "$a" > "$b" ]]
}

# ac_codex_resolve_companion — echo absolute codex-companion.mjs path (rc0), or
# fail loud (rc1) with remediation. ARCHITECT_CRITIC_CODEX_COMPANION wins; else
# glob the newest version across cache roots.
ac_codex_resolve_companion() {
  if [[ -n "${ARCHITECT_CRITIC_CODEX_COMPANION:-}" ]]; then
    if [[ -f "$ARCHITECT_CRITIC_CODEX_COMPANION" ]]; then
      echo "$ARCHITECT_CRITIC_CODEX_COMPANION"
      return 0
    fi
    ac_log_error "ac_codex_resolve_companion: ARCHITECT_CRITIC_CODEX_COMPANION points at a missing file: $ARCHITECT_CRITIC_CODEX_COMPANION"
    return 1
  fi

  local roots=()
  if [[ -n "${ARCHITECT_CRITIC_CODEX_CACHE_DIRS:-}" ]]; then
    local IFS=":"
    for d in $ARCHITECT_CRITIC_CODEX_CACHE_DIRS; do roots+=("$d"); done
  else
    while IFS= read -r d; do roots+=("$d"); done < <(_ac_codex_default_cache_dirs)
  fi

  local cache_matches=() mkt_matches=() root m
  for root in "${roots[@]+"${roots[@]}"}"; do
    [[ -z "$root" || ! -d "$root" ]] && continue
    for m in "$root"/openai-codex/codex/*/scripts/codex-companion.mjs; do
      [[ -f "$m" ]] && cache_matches+=("$m")
    done
    for m in "$root"/openai-codex/plugins/codex/scripts/codex-companion.mjs; do
      [[ -f "$m" ]] && mkt_matches+=("$m")
    done
  done

  if [[ "${#cache_matches[@]}" -gt 0 ]]; then
    local best="" best_v="" v
    for m in "${cache_matches[@]}"; do
      v="$(printf '%s' "$m" | sed -nE 's#.*/openai-codex/codex/([^/]+)/scripts/codex-companion\.mjs$#\1#p')"
      if _ac_codex_version_gt "$v" "$best_v"; then
        best="$m"; best_v="$v"
      fi
    done
    if [[ -n "$best" ]]; then echo "$best"; return 0; fi
  fi

  if [[ "${#mkt_matches[@]}" -gt 0 ]]; then
    echo "${mkt_matches[0]}"; return 0
  fi

  ac_log_error "ac_codex_resolve_companion: codex-plugin-cc companion not found. Install OpenAI's codex plugin (/plugin install codex from the openai-codex marketplace), or set ARCHITECT_CRITIC_CODEX_COMPANION to the absolute codex-companion.mjs path."
  return 1
}

# ac_codex_target_root <artifact-path> — echo the git toplevel containing the
# audited artifact (else its nearest existing ancestor) for companion
# state-keying + trust. rc1 if none resolvable.
ac_codex_target_root() {
  local out="${1:-}"
  if [[ -z "$out" ]]; then
    ac_log_error "ac_codex_target_root: artifact path required"; return 1
  fi
  local dir; dir="$(dirname "$out")"
  while [[ -n "$dir" && "$dir" != "/" && ! -d "$dir" ]]; do dir="$(dirname "$dir")"; done
  if [[ ! -d "$dir" ]]; then
    ac_log_error "ac_codex_target_root: no existing ancestor dir for: $out"; return 1
  fi
  local root
  if root="$(cd "$dir" && git rev-parse --show-toplevel 2>/dev/null)" && [[ -n "$root" ]]; then
    echo "$root"; return 0
  fi
  ( cd "$dir" && pwd -P )
}

# _ac_codex_dir_trusted <dir>
# 0 = under a trusted project root; 1 = positively outside all trusted roots;
# 2 = undetermined (no config / none trusted).
_ac_codex_dir_trusted() {
  local dir="$1"
  local config="${CODEX_HOME:-$HOME/.codex}/config.toml"
  [[ -f "$config" ]] || return 2
  local dir_real
  dir_real="$(cd "$dir" 2>/dev/null && pwd -P)" || dir_real="$dir"
  local trusted
  trusted="$(awk '
    /^\[projects\."/ { line=$0; sub(/^\[projects\."/, "", line); sub(/"\].*$/, "", line); cur=line; next }
    /^\[/ { cur=""; next }
    /trust_level[[:space:]]*=[[:space:]]*"trusted"/ { if (cur!="") print cur }
  ' "$config")"
  [[ -z "$trusted" ]] && return 2
  local p
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    if [[ "$dir_real" == "$p" || "$dir_real" == "$p"/* ]]; then return 0; fi
  done <<<"$trusted"
  return 1
}

# ac_codex_preflight <target-root> — hard gate before dispatch. rc0 ready; rc1
# unavailable (with remediation). Hard-fails on companion missing, setup
# not-ready (codex uninstalled / not authed), or target-root positively outside
# all trusted roots. Undetermined trust warns and proceeds (approval=never).
ac_codex_preflight() {
  local root="${1:-}"
  if [[ -z "$root" ]]; then
    ac_log_error "ac_codex_preflight: target-root path required"; return 1
  fi
  local companion
  if ! companion="$(ac_codex_resolve_companion)"; then return 1; fi
  local out
  if out="$(cd "$root" && node "$companion" setup --json 2>&1)"; then :; else
    ac_log_error "ac_codex_preflight: \`setup\` failed: $out"; return 1
  fi
  local ready
  ready="$(printf '%s' "$out" | jq -r '.ready // false' 2>/dev/null || echo false)"
  if [[ "$ready" != "true" ]]; then
    local codex_ok auth_ok
    codex_ok="$(printf '%s' "$out" | jq -r '.codex.available // false' 2>/dev/null || echo false)"
    auth_ok="$(printf '%s' "$out" | jq -r '.auth.loggedIn // false' 2>/dev/null || echo false)"
    if [[ "$codex_ok" != "true" ]]; then
      ac_log_error "ac_codex_preflight: Codex CLI not available. Install it (https://github.com/openai/codex) and ensure \`codex --version\` works."
    elif [[ "$auth_ok" != "true" ]]; then
      ac_log_error "ac_codex_preflight: Codex not authenticated. Run \`codex login\`, then retry."
    else
      ac_log_error "ac_codex_preflight: Codex not ready: $out"
    fi
    return 1
  fi
  local trust_rc=0
  if _ac_codex_dir_trusted "$root"; then trust_rc=0; else trust_rc=$?; fi
  case "$trust_rc" in
    1)
      ac_log_error "ac_codex_preflight: target root is outside every Codex-trusted project root: $root. Add it to ~/.codex/config.toml ([projects.\"<path>\"] trust_level = \"trusted\")."
      return 1 ;;
    2)
      ac_log_warn "ac_codex_preflight: could not verify trust for $root (no ~/.codex/config.toml projects); proceeding under approval=never." ;;
  esac
  return 0
}

_ac_codex_require_value() {
  local fn="$1" flag="$2" value="${3:-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    ac_log_error "$fn: missing value for $flag"; return 1
  fi
  return 0
}

_ac_codex_require_nonnegative_int() {
  local fn="$1" flag="$2" value="${3:-}"
  if ! _ac_codex_require_value "$fn" "$flag" "$value"; then return 1; fi
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    ac_log_error "$fn: $flag must be a non-negative integer: $value"; return 1
  fi
  return 0
}

# ac_codex_dispatch <target-root> <prompt-file> [--model M]
# Launches a background, READ-ONLY Codex task carrying the prompt-file. Echoes
# the job-id + rc0, or rc1 on failure. No --write (the adversary returns JSON,
# writes nothing).
ac_codex_dispatch() {
  local root="${1:-}" pf="${2:-}"
  shift 2 2>/dev/null || true
  if [[ -z "$root" || -z "$pf" ]]; then
    ac_log_error "ac_codex_dispatch: usage: arc codex_dispatch <target-root> <prompt-file> [--model M]"; return 1
  fi
  if [[ ! -f "$pf" ]]; then
    ac_log_error "ac_codex_dispatch: prompt-file not found: $pf"; return 1
  fi
  local pf_abs
  pf_abs="$(cd "$(dirname "$pf")" && pwd)/$(basename "$pf")"

  local model=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model)
        if ! _ac_codex_require_value "ac_codex_dispatch" "$1" "${2:-}"; then return 1; fi
        model="$2"; shift 2 ;;
      *) ac_log_error "ac_codex_dispatch: unknown arg: $1"; return 1 ;;
    esac
  done

  local companion
  if ! companion="$(ac_codex_resolve_companion)"; then return 1; fi

  local args=(task --background --prompt-file "$pf_abs" --json)
  [[ -n "$model" ]] && args+=(--model "$model")

  local out
  if out="$(cd "$root" && node "$companion" "${args[@]}" 2>&1)"; then :; else
    ac_log_error "ac_codex_dispatch: launch failed: $out"; return 1
  fi
  local job_id
  job_id="$(printf '%s' "$out" | jq -r '.jobId // empty' 2>/dev/null || echo "")"
  if [[ -z "$job_id" ]]; then
    ac_log_error "ac_codex_dispatch: no jobId in launch output: $out"; return 1
  fi
  echo "$job_id"
  return 0
}

# _ac_codex_mtime <file> — epoch mtime (GNU + macOS/BSD), or empty.
_ac_codex_mtime() {
  local v=""
  if v="$(stat -c %Y "$1" 2>/dev/null)" && [[ "$v" =~ ^[0-9]+$ ]]; then echo "$v"; return 0; fi
  if v="$(stat -f %m "$1" 2>/dev/null)" && [[ "$v" =~ ^[0-9]+$ ]]; then echo "$v"; return 0; fi
  echo ""
}

# ac_codex_wait <target-root> <job-id> [--poll N] [--stall N] [--cap N]
# Polls to a terminal disposition. ALWAYS rc0 (non-throwing); echoes one token:
#   completed | failed | cancelled | stalled | capped | error
# stalled/capped also issue `cancel` (best-effort) before returning.
ac_codex_wait() {
  local root="${1:-}" job="${2:-}"
  shift 2 2>/dev/null || true
  if [[ -z "$root" || -z "$job" ]]; then
    ac_log_error "ac_codex_wait: usage: arc codex_wait <target-root> <job-id> [--poll N] [--stall N] [--cap N]"
    echo "error"; return 0
  fi
  local poll=45 stall=300 cap=1200
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --poll)
        if ! _ac_codex_require_nonnegative_int "ac_codex_wait" "$1" "${2:-}"; then echo "error"; return 0; fi
        poll="$2"; shift 2 ;;
      --stall)
        if ! _ac_codex_require_nonnegative_int "ac_codex_wait" "$1" "${2:-}"; then echo "error"; return 0; fi
        stall="$2"; shift 2 ;;
      --cap)
        if ! _ac_codex_require_nonnegative_int "ac_codex_wait" "$1" "${2:-}"; then echo "error"; return 0; fi
        cap="$2"; shift 2 ;;
      *) ac_log_error "ac_codex_wait: unknown arg: $1"; echo "error"; return 0 ;;
    esac
  done

  local companion
  if ! companion="$(ac_codex_resolve_companion)"; then echo "error"; return 0; fi

  local start now elapsed status out logfile lmtime since
  start="$(date +%s)"
  while :; do
    if out="$(cd "$root" && node "$companion" status "$job" --json 2>&1)"; then :; else
      ac_log_error "ac_codex_wait: status call failed: $out"; echo "error"; return 0
    fi
    status="$(printf '%s' "$out" | jq -r '.job.status // empty' 2>/dev/null || echo "")"
    case "$status" in
      completed|done) echo "completed"; return 0 ;;
      failed|cancelled) echo "$status"; return 0 ;;
      ""|null) ac_log_error "ac_codex_wait: unparseable status: $out"; echo "error"; return 0 ;;
    esac

    logfile="$(printf '%s' "$out" | jq -r '.job.logFile // empty' 2>/dev/null || echo "")"
    now="$(date +%s)"
    if [[ -n "$logfile" && -f "$logfile" ]]; then
      lmtime="$(_ac_codex_mtime "$logfile")"
      if [[ -n "$lmtime" ]]; then
        since=$(( now - lmtime ))
        if [[ "$since" -gt "$stall" ]]; then
          _ac_codex_cancel "$root" "$companion" "$job"
          echo "stalled"; return 0
        fi
      fi
    fi

    elapsed=$(( now - start ))
    if [[ "$elapsed" -ge "$cap" ]]; then
      _ac_codex_cancel "$root" "$companion" "$job"
      echo "capped"; return 0
    fi

    if [[ "$poll" -gt 0 ]]; then sleep "$poll"; fi
  done
}

# ac_codex_status <target-root> <job-id>
# Single non-mutating status probe. ALWAYS rc0; echoes one token:
#   running | completed | failed | cancelled | stalled | capped | error
ac_codex_status() {
  local root="${1:-}" job="${2:-}"
  if [[ -z "$root" || -z "$job" ]]; then
    ac_log_error "ac_codex_status: usage: arc codex_status <target-root> <job-id>"
    echo "error"; return 0
  fi
  local companion
  if ! companion="$(ac_codex_resolve_companion)"; then echo "error"; return 0; fi
  local out status
  if out="$(cd "$root" && node "$companion" status "$job" --json 2>&1)"; then :; else
    ac_log_error "ac_codex_status: status call failed: $out"; echo "error"; return 0
  fi
  status="$(printf '%s' "$out" | jq -r '.job.status // empty' 2>/dev/null || echo "")"
  case "$status" in
    done) echo "completed" ;;
    running|completed|failed|cancelled|stalled|capped) echo "$status" ;;
    ""|null) ac_log_error "ac_codex_status: unparseable status: $out"; echo "error" ;;
    *) ac_log_warn "ac_codex_status: unknown companion status: $status"; echo "error" ;;
  esac
  return 0
}

# ac_codex_cancel <target-root> <job-id>
# Terminal-aware public cancel. If the job already completed/failed/etc., preserve
# that terminal token and do not call companion cancel. ALWAYS rc0.
ac_codex_cancel() {
  local root="${1:-}" job="${2:-}"
  if [[ -z "$root" || -z "$job" ]]; then
    ac_log_error "ac_codex_cancel: usage: arc codex_cancel <target-root> <job-id>"
    echo "error"; return 0
  fi
  local status companion out cancel_status
  status="$(ac_codex_status "$root" "$job")"
  case "$status" in
    completed|failed|cancelled|stalled|capped|error) echo "$status"; return 0 ;;
  esac
  if ! companion="$(ac_codex_resolve_companion)"; then echo "error"; return 0; fi
  if out="$(cd "$root" && node "$companion" cancel "$job" --json 2>&1)"; then :; else
    ac_log_warn "ac_codex_cancel: cancel reported non-zero (job may already be terminal): $out"
    echo "error"; return 0
  fi
  cancel_status="$(printf '%s' "$out" | jq -r '.job.status // empty' 2>/dev/null || echo "")"
  case "$cancel_status" in
    done) echo "completed" ;;
    running|completed|failed|cancelled|stalled|capped) echo "$cancel_status" ;;
    ""|null) ac_log_error "ac_codex_cancel: unparseable cancel status: $out"; echo "error" ;;
    *) ac_log_warn "ac_codex_cancel: unknown companion cancel status: $cancel_status"; echo "error" ;;
  esac
  return 0
}

# _ac_codex_cancel <target-root> <companion> <job> — best-effort cancel + confirm.
_ac_codex_cancel() {
  local root="$1" companion="$2" job="$3" out
  if out="$(cd "$root" && node "$companion" cancel "$job" --json 2>&1)"; then :; else
    ac_log_warn "ac_codex_wait: cancel reported non-zero (job may already be terminal): $out"
  fi
  ( cd "$root" && node "$companion" status "$job" --json >/dev/null 2>&1 ) || true
}

# ac_codex_result <target-root> <job-id>
# Reads the finished job and echoes the fenced {challenges,gaps} JSON block Codex
# was instructed to emit. rc0 + compact JSON on success; rc1 when no parseable
# block with a challenges[] array is present (caller re-dispatches once / aborts).
ac_codex_result() {
  local root="${1:-}" job="${2:-}"
  if [[ -z "$root" || -z "$job" ]]; then
    ac_log_error "ac_codex_result: usage: arc codex_result <target-root> <job-id>"; return 1
  fi
  local companion
  if ! companion="$(ac_codex_resolve_companion)"; then return 1; fi
  local out
  if out="$(cd "$root" && node "$companion" result "$job" --json 2>&1)"; then :; else
    ac_log_error "ac_codex_result: result call failed: $out"; return 1
  fi
  local raw
  raw="$(printf '%s' "$out" | jq -r '.storedJob.result.rawOutput // .storedJob.result.codex.stdout // empty' 2>/dev/null || echo "")"
  if [[ -z "$raw" ]]; then
    ac_log_error "ac_codex_result: no rawOutput in result payload"; return 1
  fi

  # Extract the LAST fenced ```json … ``` (or bare ```) block; ignore non-JSON
  # fences so reasoning transcripts before the final return don't desync state.
  local block
  block="$(printf '%s\n' "$raw" | awk '
    function fence_tag(line, t) {
      t=line
      sub(/^```[[:space:]]*/, "", t)
      sub(/[[:space:]]*$/, "", t)
      return tolower(t)
    }
    /^```[[:space:]]*([[:alnum:]_-]+)?[[:space:]]*$/ {
      if (infence) {
        if (keep) last=buf
        infence=0; keep=0; buf=""
      } else {
        infence=1
        tag=fence_tag($0)
        keep=(tag=="" || tag=="json")
        buf=""
      }
      next
    }
    infence && keep { buf = buf $0 "\n" }
    END { printf "%s", last }
  ')"
  if [[ -z "$block" ]]; then
    ac_log_error "ac_codex_result: no fenced JSON block in Codex output"; return 1
  fi
  if ! _ac_codex_validate_json "$block"; then
    ac_log_error "ac_codex_result: fenced block is not a {challenges,gaps} object"; return 1
  fi
  printf '%s' "$block" | jq -c .
  return 0
}

# _ac_probe_bin <name> — echo one readiness line for a binary (always rc0).
_ac_probe_bin() {
  local name="$1" ver
  if command -v "$name" >/dev/null 2>&1; then
    ver="$("$name" --version 2>/dev/null | head -1)"
    echo "  ✓ ${name}: ${ver:-present}"
  else
    echo "  ✗ ${name}: not found on PATH — install it to use ${name} as an adversary"
  fi
}

# ac_codex_doctor — print an adversary-readiness report and ALWAYS return 0
# (fail-soft, advisory by design — never blocks). Probes the codex + claude
# binaries, resolves the companion, and reads companion `setup --json` for
# auth/schema readiness. Each not-ready line carries an actionable fix; install
# and `codex login` stay user-driven (non-goal: auto-install).
ac_codex_doctor() {
  echo "architect-critic adversary readiness:"
  _ac_probe_bin codex
  _ac_probe_bin claude

  local companion
  if companion="$(ac_codex_resolve_companion 2>/dev/null)"; then
    echo "  ✓ codex companion: ${companion}"
    local setup_out ready codex_ok auth_ok
    if setup_out="$(node "$companion" setup --json 2>/dev/null)"; then
      ready="$(printf '%s' "$setup_out" | jq -r '.ready // false' 2>/dev/null || echo false)"
      codex_ok="$(printf '%s' "$setup_out" | jq -r '.codex.available // false' 2>/dev/null || echo false)"
      auth_ok="$(printf '%s' "$setup_out" | jq -r '.auth.loggedIn // false' 2>/dev/null || echo false)"
      if [[ "$ready" == "true" ]]; then
        echo "  ✓ codex ready (installed + authenticated + schema-capable)"
      else
        [[ "$codex_ok" == "true" ]] || echo "  ✗ codex CLI not available — install: https://github.com/openai/codex"
        [[ "$auth_ok" == "true" ]] || echo "  ✗ codex not authenticated — run: codex login"
      fi
    else
      echo "  ✗ codex companion 'setup' did not run — ensure node is installed and the companion is current"
    fi
  else
    echo "  ✗ codex companion: not found — install the openai-codex plugin (/plugin install codex), or set ARCHITECT_CRITIC_CODEX_COMPANION to the codex-companion.mjs path"
  fi

  echo "  • sync timeout: ${ARCHITECT_CRITIC_CODEX_TIMEOUT_S:-300}s (env ARCHITECT_CRITIC_CODEX_TIMEOUT_S)"
  echo "  • async poll/stall/cap defaults: 45s / 300s / 1200s (arc codex_wait --poll/--stall/--cap)"
  echo ""
  echo "Async close-depth audits run Claude-host → Codex-adversary only; Codex-host keeps the synchronous path."
  return 0
}

# ac_codex_size_hint <artifact-path> — advisory recommendation for foreground vs
# background based on artifact size. Echoes "background" when the artifact has
# >= ARCHITECT_CRITIC_ASYNC_HINT_LINES lines (default 400), else "foreground".
# Always rc0; a missing/unreadable artifact → "foreground" (conservative).
ac_codex_size_hint() {
  local artifact="${1:-}"
  local thresh="${ARCHITECT_CRITIC_ASYNC_HINT_LINES:-400}"
  local lines=0
  if [[ ! "$thresh" =~ ^[0-9]+$ ]]; then
    ac_log_warn "ac_codex_size_hint: ARCHITECT_CRITIC_ASYNC_HINT_LINES must be a non-negative integer; using 400"
    thresh=400
  fi
  [[ -f "$artifact" ]] && lines="$(wc -l < "$artifact" 2>/dev/null | tr -d ' ')"
  [[ "$lines" =~ ^[0-9]+$ ]] || lines=0
  if [[ "$lines" -ge "$thresh" ]]; then
    echo "background"
  else
    echo "foreground"
  fi
  return 0
}
