#!/usr/bin/env bash
# lib/state.sh — state.json CRUD for architect-critic (schema v3, #39)
# Linux + macOS bash 3.2 portable; no declare -A; explicit lock release before each return.
#
# Schema v3 (#39):
#   {
#     "schema_version": 3,
#     "recent_runs": [ {request_id, completed_at, depth, adversaries_used[],
#                       challenge_count, concessions, skill_invoked, elapsed_ms} ],
#     "external_runs": [ {run_id, host_agent, adversary, artifact_path, depth, status,
#                         started_at, completed_at, result_path, codex_session_id,
#                         resolved_run_request_id} ],
#     "principle_promotions": [...],
#     "candidate_promotions": [...],
#     "declined_candidates": [...],
#     "auto_promote_suppressions": [ {fingerprint, suppressed_at, expires_at, reason_score} ]
#   }
# v3 changes vs v2 (#39): adds external_runs[] — durable async external-adversary job
#   memory (status/result/resume + re-resume idempotency via resolved_run_request_id).
# v2 changes vs v1: dropped the per-request in-flight tracker and per-run USD field;
#   added concessions + skill_invoked to recent_runs; added auto_promote_suppressions[].

# Returns the absolute path to state.json.
ac_state_path() {
  echo "$(ac_data_dir)/state.json"
}

# Initialise state.json with an empty schema v3 if it does not already exist.
# If the file exists at the immediate predecessor (v2), upgrade it in place via
# ac_state_migrate (adds external_runs[], bumps to 3). A schema_version higher
# than this build knows (>3) is preserved untouched with an info log
# (forward-compatibility tolerance). Files < 2 are the v0.1→v0.2 filesystem
# migration's responsibility (lib/migration.sh), not touched here.
ac_state_init() {
  local state_file
  state_file="$(ac_state_path)"
  local data_dir
  data_dir="$(ac_data_dir)"
  if [[ ! -f "$state_file" ]]; then
    mkdir -p "$data_dir"
    printf '%s\n' '{"schema_version":3,"recent_runs":[],"external_runs":[],"principle_promotions":[],"candidate_promotions":[],"declined_candidates":[],"auto_promote_suppressions":[]}' > "$state_file"
  else
    local on_disk_ver
    on_disk_ver="$(jq -r '.schema_version // 0' "$state_file" 2>/dev/null || echo 0)"
    if [[ "$on_disk_ver" -gt 3 ]] 2>/dev/null; then
      ac_log_info "state.json has future schema_version=${on_disk_ver}; preserving without modification"
    elif [[ "$on_disk_ver" -eq 2 ]] 2>/dev/null; then
      ac_state_migrate
    fi
  fi
}

# ac_state_migrate — upgrade an existing state.json to the current schema (v3),
# idempotently. v2 → add external_runs[] (if absent) + set schema_version=3,
# preserving every existing field. Files already >=3 are left untouched; files
# <2 are the v0.1→v0.2 filesystem migration's job and are not touched here.
ac_state_migrate() {
  local state_file lock_path ver
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  [[ -f "$state_file" ]] || return 0
  ver="$(jq -r '.schema_version // 0' "$state_file" 2>/dev/null || echo 0)"
  [[ "$ver" =~ ^[0-9]+$ ]] || ver=0
  if [[ "$ver" -ge 3 || "$ver" -lt 2 ]]; then
    return 0
  fi
  ac_lock_acquire "$lock_path" || return 1
  local rc
  if ac_guarded_jq_write "$state_file" \
    '.external_runs = (.external_runs // []) | .schema_version = 3' \
    "$state_file"; then
    rc=0
  else
    rc=$?
  fi
  ac_lock_release "$lock_path"
  return $rc
}

# Emit the raw contents of state.json to stdout.
# Caller is responsible for piping to jq.
ac_state_read() {
  cat "$(ac_state_path)"
}

# Atomically update a single field in state.json.
# Args: <jq_path> <value>
# <jq_path> must be a valid jq left-hand path expression (e.g. ".schema_version").
# <value> is passed as the --argjson value (must be valid JSON or a plain number/string).
# Uses ac_lock_acquire/release around the write transaction.
ac_state_write_field() {
  local jq_path="$1"
  local value="$2"
  local state_file lock_path
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"

  ac_lock_acquire "$lock_path" || return 1
  ac_guarded_jq_write "$state_file" --argjson v "$value" "${jq_path} = \$v" "$state_file"
  local rc=$?
  ac_lock_release "$lock_path"
  return $rc
}

# Append a completed run to recent_runs (schema v2+), then trim to the last 20 entries.
# Args: <request_id> <depth> <adversaries_used_json> <challenge_count> <concessions> <skill_invoked> <elapsed_ms>
#   adversaries_used_json: a JSON array literal, e.g. '["claude"]', '["claude","codex"]', or '["devin"]' (Devin host-only run)
#   Optional flags: --auto-applied-count <int> (default 0), --escalated-count <int> (default 0)
ac_state_append_run() {
  local request_id="" depth="" adversaries_json="" challenge_count="" concessions="" skill_invoked="" elapsed_ms=""
  local deferred_count="0" deferred_challenges_json="[]"
  local auto_applied_count="0" escalated_count="0"

  if [[ "${1:-}" == --* ]]; then
    local adversaries_raw=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --request-id) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --request-id requires a value"; return 2; }; request_id="$2"; shift 2 ;;
        --depth) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --depth requires a value"; return 2; }; depth="$2"; shift 2 ;;
        --adversaries) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --adversaries requires a value"; return 2; }; adversaries_raw="$2"; shift 2 ;;
        --challenge-count) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --challenge-count requires a value"; return 2; }; challenge_count="$2"; shift 2 ;;
        --concessions) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --concessions requires a value"; return 2; }; concessions="$2"; shift 2 ;;
        --deferred-count) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --deferred-count requires a value"; return 2; }; deferred_count="$2"; shift 2 ;;
        --deferred-challenges) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --deferred-challenges requires a value"; return 2; }; deferred_challenges_json="$2"; shift 2 ;;
        --auto-applied-count) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --auto-applied-count requires a value"; return 2; }; auto_applied_count="$2"; shift 2 ;;
        --escalated-count) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --escalated-count requires a value"; return 2; }; escalated_count="$2"; shift 2 ;;
        --skill-invoked) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --skill-invoked requires a value"; return 2; }; skill_invoked="$2"; shift 2 ;;
        --elapsed-ms) [[ $# -ge 2 ]] || { ac_log_error "ac_state_append_run: --elapsed-ms requires a value"; return 2; }; elapsed_ms="$2"; shift 2 ;;
        *)
          ac_log_error "ac_state_append_run: unknown flag: $1"
          return 2
          ;;
      esac
    done
    if [[ "$adversaries_raw" == \[* ]]; then
      adversaries_json="$adversaries_raw"
    else
      adversaries_json="$(printf '%s\n' "$adversaries_raw" \
        | awk -F',' 'BEGIN { printf "[" } { for (i=1;i<=NF;i++) { gsub(/^[ \t]+|[ \t]+$/, "", $i); if ($i != "") { if (n++) printf ","; gsub(/"/, "\\\"", $i); printf "\"%s\"", $i } } } END { printf "]" }')"
    fi
  else
    request_id="${1:-}"
    depth="${2:-}"
    adversaries_json="${3:-}"
    challenge_count="${4:-}"
    concessions="${5:-}"
    skill_invoked="${6:-}"
    elapsed_ms="${7:-}"
  fi

  if [[ -z "$request_id" || -z "$depth" || -z "$adversaries_json" || -z "$challenge_count" || -z "$concessions" || -z "$skill_invoked" || -z "$elapsed_ms" ]]; then
    ac_log_error "ac_state_append_run: usage: ac_state_append_run <request_id> <depth> <adversaries_json> <challenge_count> <concessions> <skill_invoked> <elapsed_ms>"
    return 2
  fi
  if ! printf '%s' "$adversaries_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
    ac_log_error "ac_state_append_run: adversaries must be a JSON array or CSV list"
    return 2
  fi
  if ! printf '%s' "$deferred_challenges_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
    ac_log_error "ac_state_append_run: deferred challenges must be a JSON array"
    return 2
  fi

  local state_file lock_path completed_at
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  completed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  ac_lock_acquire "$lock_path" || return 1
  local rc
  if ac_guarded_jq_write "$state_file" \
    --arg rid "$request_id" \
    --arg cat "$completed_at" \
    --arg dep "$depth" \
    --argjson adv "$adversaries_json" \
    --argjson cc "$challenge_count" \
    --argjson con "$concessions" \
    --argjson dc "$deferred_count" \
    --argjson dch "$deferred_challenges_json" \
    --argjson aac "$auto_applied_count" \
    --argjson esc "$escalated_count" \
    --arg skl "$skill_invoked" \
    --argjson elm "$elapsed_ms" \
    '.recent_runs = ((.recent_runs + [{
       "request_id": $rid,
       "completed_at": $cat,
       "depth": $dep,
       "adversaries_used": $adv,
       "challenge_count": $cc,
       "concessions": $con,
       "deferred_count": $dc,
       "deferred_challenges": $dch,
       "auto_applied_count": $aac,
       "escalated_count": $esc,
       "skill_invoked": $skl,
       "elapsed_ms": $elm
     }]) | if length > 20 then .[-20:] else . end)' \
    "$state_file"; then
    rc=0
  else
    rc=$?
  fi
  ac_lock_release "$lock_path"
  return $rc
}

# Append a promotion record to principle_promotions.
# Args: <source> <text> <scope>
# source: "manual" | "auto"
# scope:  "user"   | "project"
ac_state_append_promotion() {
  local source="$1"
  local text="$2"
  local scope="$3"
  local state_file lock_path timestamp
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  ac_lock_acquire "$lock_path" || return 1
  ac_guarded_jq_write "$state_file" \
    --arg src "$source" \
    --arg txt "$text" \
    --arg scp "$scope" \
    --arg ts "$timestamp" \
    '.principle_promotions += [{"timestamp":$ts,"source":$src,"text":$txt,"scope":$scp}]' \
    "$state_file"
  local rc=$?
  ac_lock_release "$lock_path"
  return $rc
}

# Append a declined candidate to declined_candidates.
# Args: <text> <suppress_until>
# suppress_until: ISO-8601 timestamp string (e.g. "2026-06-14T00:00:00Z")
ac_state_append_declined() {
  local text="$1"
  local suppress_until="$2"
  local state_file lock_path declined_at
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  declined_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  ac_lock_acquire "$lock_path" || return 1
  ac_guarded_jq_write "$state_file" \
    --arg txt "$text" \
    --arg da "$declined_at" \
    --arg su "$suppress_until" \
    '.declined_candidates += [{"text":$txt,"declined_at":$da,"suppress_until":$su}]' \
    "$state_file"
  local rc=$?
  ac_lock_release "$lock_path"
  return $rc
}

# _ac_date_add_days <iso-8601-utc> <days> — echo the timestamp + N days, UTC.
# Portable across macOS/BSD (`date -j -f -v`) and Linux (GNU coreutils `date -d`).
# BSD is tried FIRST: its `-j` fails cleanly on GNU date, whereas GNU's `-d`
# syntax makes BSD date emit non-empty GARBAGE (its `-d` means daylight-saving),
# so "first non-empty wins" would silently return the wrong value on macOS. Each
# branch is therefore also validated against a strict ISO-8601 regex so no
# non-conforming output can slip through. Echoes empty + rc1 if neither parses.
_ac_date_add_days() {
  local ts="$1" days="$2" out
  local re='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
  # BSD: -v MUST precede -f — BSD getopt stops at the first positional, so a -v
  # placed after the input date is silently ignored (returns the input unchanged).
  if out="$(date -u -j "-v+${days}d" -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)" && [[ "$out" =~ $re ]]; then
    echo "$out"; return 0
  fi
  if out="$(date -u -d "$ts +$days days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)" && [[ "$out" =~ $re ]]; then
    echo "$out"; return 0
  fi
  echo ""; return 1
}

# Append an auto-promote suppression entry by fingerprint.
# Args: <fingerprint> <reason_score>
#   fingerprint: opaque string identifying the candidate (caller computes SHA-256)
#   reason_score: integer 4 → 30-day window; 5 → 90-day window
# Window arithmetic is portable (GNU date -d OR BSD date -v) via _ac_date_add_days.
ac_state_add_suppression() {
  local fingerprint="$1"
  local reason_score="$2"
  local state_file lock_path suppressed_at expires_at days
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  suppressed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  case "$reason_score" in
    5) days=90 ;;
    4) days=30 ;;
    *)
      ac_log_warn "ac_state_add_suppression: reason_score=$reason_score not in {4,5}; defaulting to 30-day window"
      days=30
      ;;
  esac

  # Portable date arithmetic (GNU date -d on Linux, BSD date -v on macOS).
  expires_at="$(_ac_date_add_days "$suppressed_at" "$days")"
  if [[ -z "$expires_at" ]]; then
    ac_log_error "ac_state_add_suppression: failed to compute expires_at from $suppressed_at (+${days}d)"
    return 1
  fi

  ac_lock_acquire "$lock_path" || return 1
  ac_guarded_jq_write "$state_file" \
    --arg fp "$fingerprint" \
    --arg sa "$suppressed_at" \
    --arg ea "$expires_at" \
    --argjson rs "$reason_score" \
    '.auto_promote_suppressions += [{
       "fingerprint": $fp,
       "suppressed_at": $sa,
       "expires_at": $ea,
       "reason_score": $rs
     }]' \
    "$state_file"
  local rc=$?
  ac_lock_release "$lock_path"
  return $rc
}

# ═════════════════════════════════════════════════════════════════════════════
# external_runs[] — durable async external-adversary job memory (schema v3, #39).
# Each function calls ac_state_init first (creates a v3 file / lazily migrates a
# v2 file), so external_runs[] always exists before read/write.
# ═════════════════════════════════════════════════════════════════════════════

# ac_state_external_run_add --run-id R --host H --adversary A --artifact P --depth D
#                           --result-path RP [--codex-session-id S]
# Appends a {status:"running"} record (started_at=now). Retains every unresolved
# record, and caps only resolved history to fit the last 20 when possible.
ac_state_external_run_add() {
  local run_id="" host="" adversary="" artifact="" depth="" result_path="" session_id="" neutral_mode="false" walk_mode="false"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-id) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --run-id requires a value"; return 2; }; run_id="$2"; shift 2 ;;
      --host) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --host requires a value"; return 2; }; host="$2"; shift 2 ;;
      --adversary) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --adversary requires a value"; return 2; }; adversary="$2"; shift 2 ;;
      --artifact) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --artifact requires a value"; return 2; }; artifact="$2"; shift 2 ;;
      --depth) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --depth requires a value"; return 2; }; depth="$2"; shift 2 ;;
      --result-path) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --result-path requires a value"; return 2; }; result_path="$2"; shift 2 ;;
      --codex-session-id) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --codex-session-id requires a value"; return 2; }; session_id="$2"; shift 2 ;;
      --neutral-mode) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --neutral-mode requires a value"; return 2; }; neutral_mode="$2"; shift 2 ;;
      --walk-mode) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_add: --walk-mode requires a value"; return 2; }; walk_mode="$2"; shift 2 ;;
      *) ac_log_error "ac_state_external_run_add: unknown flag: $1"; return 2 ;;
    esac
  done
  if [[ -z "$run_id" || -z "$host" || -z "$adversary" || -z "$artifact" || -z "$depth" || -z "$result_path" ]]; then
    ac_log_error "ac_state_external_run_add: --run-id --host --adversary --artifact --depth --result-path are required"
    return 2
  fi
  case "$neutral_mode" in
    true|false) ;;
    *) ac_log_error "ac_state_external_run_add: --neutral-mode must be true or false"; return 2 ;;
  esac
  case "$walk_mode" in
    true|false) ;;
    *) ac_log_error "ac_state_external_run_add: --walk-mode must be true or false"; return 2 ;;
  esac
  ac_state_init
  local state_file lock_path started_at
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  ac_lock_acquire "$lock_path" || return 1
  local rc
  if ac_guarded_jq_write "$state_file" \
    --arg rid "$run_id" --arg host "$host" --arg adv "$adversary" \
    --arg art "$artifact" --arg dep "$depth" --arg rp "$result_path" \
    --arg sid "$session_id" --argjson neutral "$neutral_mode" --argjson walk "$walk_mode" --arg sa "$started_at" \
    'def unresolved:
       select(.resolved_run_request_id == null);
     def trim_external_runs:
       if length <= 20 then .
       else
         ([.[] | unresolved] as $unresolved |
          [.[] | select(.resolved_run_request_id != null)] as $resolved |
          (20 - ($unresolved | length)) as $budget |
          ((if $budget > 0 then ($resolved | .[(-$budget):]) else [] end) + $unresolved))
       end;
     .external_runs = (((.external_runs // []) + [{
       "run_id": $rid,
       "host_agent": $host,
       "adversary": $adv,
       "artifact_path": $art,
       "depth": $dep,
       "status": "running",
       "started_at": $sa,
       "completed_at": null,
       "result_path": $rp,
       "codex_session_id": (if $sid == "" then null else $sid end),
       "neutral_mode": $neutral,
       "walk_mode": $walk,
       "resolved_run_request_id": null
     }]) | trim_external_runs)' \
    "$state_file"; then
    rc=0
  else
    rc=$?
  fi
  ac_lock_release "$lock_path"
  return $rc
}

# ac_state_external_run_set_status <run-id> <status> [--completed-at TS]
# Terminal statuses (completed/failed/cancelled/stalled/capped) auto-stamp
# completed_at when not supplied. rc1 if run-id absent.
ac_state_external_run_set_status() {
  local run_id="${1:-}" status="${2:-}"
  shift 2 2>/dev/null || true
  local completed_at=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --completed-at) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_set_status: --completed-at requires a value"; return 2; }; completed_at="$2"; shift 2 ;;
      *) ac_log_error "ac_state_external_run_set_status: unknown flag: $1"; return 2 ;;
    esac
  done
  if [[ -z "$run_id" || -z "$status" ]]; then
    ac_log_error "ac_state_external_run_set_status: usage: <run-id> <status> [--completed-at TS]"
    return 2
  fi
  case "$status" in
    running|completed|failed|cancelled|stalled|capped|error) ;;
    *) ac_log_error "ac_state_external_run_set_status: invalid status: $status"; return 2 ;;
  esac
  ac_state_init
  local state_file lock_path
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  case "$status" in
    completed|failed|cancelled|stalled|capped|error)
      [[ -z "$completed_at" ]] && completed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" ;;
  esac
  ac_lock_acquire "$lock_path" || return 1
  if ! jq -e --arg rid "$run_id" '(.external_runs // []) | any(.run_id == $rid)' "$state_file" >/dev/null 2>&1; then
    ac_log_error "ac_state_external_run_set_status: run-id not found: $run_id"
    ac_lock_release "$lock_path"
    return 1
  fi
  local rc
  if ac_guarded_jq_write "$state_file" \
    --arg rid "$run_id" --arg st "$status" --arg ca "$completed_at" \
    '.external_runs = ((.external_runs // []) | map(
       if .run_id == $rid then
         (.status = $st) | (if $ca != "" then .completed_at = $ca else . end)
       else . end))' \
    "$state_file"; then
    rc=0
  else
    rc=$?
  fi
  ac_lock_release "$lock_path"
  return $rc
}

# ac_state_external_run_get <run-id> — echo the record (compact JSON); rc1 absent.
ac_state_external_run_get() {
  local run_id="${1:-}"
  if [[ -z "$run_id" ]]; then
    ac_log_error "ac_state_external_run_get: run-id required"; return 1
  fi
  ac_state_init
  local state_file rec
  state_file="$(ac_state_path)"
  rec="$(jq -c --arg rid "$run_id" '(.external_runs // []) | map(select(.run_id == $rid)) | .[0] // empty' "$state_file" 2>/dev/null || echo "")"
  if [[ -z "$rec" ]]; then
    return 1
  fi
  printf '%s\n' "$rec"
  return 0
}

# ac_state_external_run_list [--status S] — echo a JSON array (optionally filtered).
ac_state_external_run_list() {
  local filter=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_list: --status requires a value"; return 2; }; filter="$2"; shift 2 ;;
      *) ac_log_error "ac_state_external_run_list: unknown flag: $1"; return 2 ;;
    esac
  done
  ac_state_init
  local state_file
  state_file="$(ac_state_path)"
  if [[ -n "$filter" ]]; then
    jq -c --arg st "$filter" '(.external_runs // []) | map(select(.status == $st))' "$state_file" 2>/dev/null || echo "[]"
  else
    jq -c '(.external_runs // [])' "$state_file" 2>/dev/null || echo "[]"
  fi
  return 0
}

# ac_state_external_run_resolve <run-id> <request-id>
# Set resolved_run_request_id ONCE (re-resume idempotency guard). rc1 if the run
# is absent OR already resolved (caller treats an already-resolved run as
# inspect-only).
ac_state_external_run_resolve() {
  local run_id="${1:-}" request_id="${2:-}"
  if [[ -z "$run_id" || -z "$request_id" ]]; then
    ac_log_error "ac_state_external_run_resolve: usage: <run-id> <request-id>"
    return 2
  fi
  ac_state_init
  local state_file lock_path existing
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  ac_lock_acquire "$lock_path" || return 1
  if ! jq -e --arg rid "$run_id" '(.external_runs // []) | any(.run_id == $rid)' "$state_file" >/dev/null 2>&1; then
    ac_log_error "ac_state_external_run_resolve: run-id not found: $run_id"
    ac_lock_release "$lock_path"
    return 1
  fi
  existing="$(jq -r --arg rid "$run_id" '(.external_runs // []) | map(select(.run_id == $rid)) | .[0].resolved_run_request_id // "null"' "$state_file" 2>/dev/null || echo "null")"
  if [[ "$existing" != "null" && -n "$existing" ]]; then
    ac_log_warn "ac_state_external_run_resolve: run $run_id already resolved to $existing (inspect-only)"
    ac_lock_release "$lock_path"
    return 1
  fi
  local rc
  if ac_guarded_jq_write "$state_file" \
    --arg rid "$run_id" --arg req "$request_id" \
    '.external_runs = ((.external_runs // []) | map(
       if .run_id == $rid then .resolved_run_request_id = $req else . end))' \
    "$state_file"; then
    rc=0
  else
    rc=$?
  fi
  ac_lock_release "$lock_path"
  return $rc
}

# ac_state_external_run_finalize_resume --run-id R --request-id Q --depth D
#   --adversaries JSON_OR_CSV --challenge-count N --concessions N
#   --skill-invoked S --elapsed-ms N
#   Optional flags: --auto-applied-count <int> (default 0), --escalated-count <int> (default 0)
# Atomically appends the completed critique to recent_runs[] and pins
# external_runs[].resolved_run_request_id. rc1 if the external run is absent or
# already resolved; callers then treat resume as inspect-only.
ac_state_external_run_finalize_resume() {
  local run_id="" request_id="" depth="" adversaries_raw="" adversaries_json=""
  local challenge_count="" concessions="" skill_invoked="" elapsed_ms=""
  local deferred_count="0" deferred_challenges_json="[]"
  local auto_applied_count="0" escalated_count="0"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-id) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --run-id requires a value"; return 2; }; run_id="$2"; shift 2 ;;
      --request-id) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --request-id requires a value"; return 2; }; request_id="$2"; shift 2 ;;
      --depth) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --depth requires a value"; return 2; }; depth="$2"; shift 2 ;;
      --adversaries) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --adversaries requires a value"; return 2; }; adversaries_raw="$2"; shift 2 ;;
      --challenge-count) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --challenge-count requires a value"; return 2; }; challenge_count="$2"; shift 2 ;;
      --concessions) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --concessions requires a value"; return 2; }; concessions="$2"; shift 2 ;;
      --deferred-count) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --deferred-count requires a value"; return 2; }; deferred_count="$2"; shift 2 ;;
      --deferred-challenges) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --deferred-challenges requires a value"; return 2; }; deferred_challenges_json="$2"; shift 2 ;;
      --auto-applied-count) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --auto-applied-count requires a value"; return 2; }; auto_applied_count="$2"; shift 2 ;;
      --escalated-count) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --escalated-count requires a value"; return 2; }; escalated_count="$2"; shift 2 ;;
      --skill-invoked) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --skill-invoked requires a value"; return 2; }; skill_invoked="$2"; shift 2 ;;
      --elapsed-ms) [[ $# -ge 2 ]] || { ac_log_error "ac_state_external_run_finalize_resume: --elapsed-ms requires a value"; return 2; }; elapsed_ms="$2"; shift 2 ;;
      *) ac_log_error "ac_state_external_run_finalize_resume: unknown flag: $1"; return 2 ;;
    esac
  done
  if [[ -z "$run_id" || -z "$request_id" || -z "$depth" || -z "$adversaries_raw" || -z "$challenge_count" || -z "$concessions" || -z "$skill_invoked" || -z "$elapsed_ms" ]]; then
    ac_log_error "ac_state_external_run_finalize_resume: --run-id --request-id --depth --adversaries --challenge-count --concessions --skill-invoked --elapsed-ms are required"
    return 2
  fi
  if [[ "$adversaries_raw" == \[* ]]; then
    adversaries_json="$adversaries_raw"
  else
    adversaries_json="$(printf '%s\n' "$adversaries_raw" \
      | awk -F',' 'BEGIN { printf "[" } { for (i=1;i<=NF;i++) { gsub(/^[ \t]+|[ \t]+$/, "", $i); if ($i != "") { if (n++) printf ","; gsub(/"/, "\\\"", $i); printf "\"%s\"", $i } } } END { printf "]" }')"
  fi
  if ! printf '%s' "$adversaries_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
    ac_log_error "ac_state_external_run_finalize_resume: adversaries must be a JSON array or CSV list"
    return 2
  fi
  if ! printf '%s' "$deferred_challenges_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
    ac_log_error "ac_state_external_run_finalize_resume: deferred challenges must be a JSON array"
    return 2
  fi

  ac_state_init
  local state_file lock_path existing completed_at
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  completed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  ac_lock_acquire "$lock_path" || return 1
  if ! jq -e --arg rid "$run_id" '(.external_runs // []) | any(.run_id == $rid)' "$state_file" >/dev/null 2>&1; then
    ac_log_error "ac_state_external_run_finalize_resume: run-id not found: $run_id"
    ac_lock_release "$lock_path"
    return 1
  fi
  existing="$(jq -r --arg rid "$run_id" '(.external_runs // []) | map(select(.run_id == $rid)) | .[0].resolved_run_request_id // "null"' "$state_file" 2>/dev/null || echo "null")"
  if [[ "$existing" != "null" && -n "$existing" ]]; then
    ac_log_warn "ac_state_external_run_finalize_resume: run $run_id already resolved to $existing (inspect-only)"
    ac_lock_release "$lock_path"
    return 1
  fi

  local rc
  if ac_guarded_jq_write "$state_file" \
    --arg run "$run_id" \
    --arg rid "$request_id" \
    --arg cat "$completed_at" \
    --arg dep "$depth" \
    --argjson adv "$adversaries_json" \
    --argjson cc "$challenge_count" \
    --argjson con "$concessions" \
    --argjson dc "$deferred_count" \
    --argjson dch "$deferred_challenges_json" \
    --argjson aac "$auto_applied_count" \
    --argjson esc "$escalated_count" \
    --arg skl "$skill_invoked" \
    --argjson elm "$elapsed_ms" \
    '.recent_runs = (((.recent_runs // []) + [{
       "request_id": $rid,
       "completed_at": $cat,
       "depth": $dep,
       "adversaries_used": $adv,
       "challenge_count": $cc,
       "concessions": $con,
       "deferred_count": $dc,
       "deferred_challenges": $dch,
       "auto_applied_count": $aac,
       "escalated_count": $esc,
       "skill_invoked": $skl,
       "elapsed_ms": $elm
     }]) | if length > 20 then .[-20:] else . end)
     | .external_runs = ((.external_runs // []) | map(
       if .run_id == $run then .resolved_run_request_id = $rid else . end))' \
    "$state_file"; then
    rc=0
  else
    rc=$?
  fi
  ac_lock_release "$lock_path"
  return $rc
}
