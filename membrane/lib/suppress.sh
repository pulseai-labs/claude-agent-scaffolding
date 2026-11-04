#!/usr/bin/env bash
# lib/suppress.sh — suppression management for membrane.
# Requires: lib/helpers.sh, lib/state.sh
# Bash 3.2+ compatible (macOS portability).

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# _csa_iso_to_epoch <iso8601>
# Convert ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ) to epoch seconds.
# Supports BSD (macOS) and GNU date.
_csa_iso_to_epoch() {
  local iso="$1"
  # BSD (macOS): use TZ=UTC to ensure the literal timestamp is parsed as UTC.
  if TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%SZ" "$iso" +%s 2>/dev/null; then return; fi
  # GNU date fallback.
  TZ=UTC date -d "$iso" +%s 2>/dev/null
}

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

# csa_suppress_path <project_root>
# Echo absolute path to suppressions.json.
csa_suppress_path() {
  local root="$1"
  printf '%s/.claude/audits/suppressions.json' "$root"
}

# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------

# csa_suppress_init <project_root>
# Create .claude/audits/suppressions.json with schema_version=1 and empty suppressions array.
csa_suppress_init() {
  local root="$1"
  local sup_file; sup_file="$(csa_suppress_path "$root")"
  mkdir -p "$(dirname "$sup_file")"
  jq -n '{schema_version: 1, suppressions: []}' > "$sup_file"
}

# ---------------------------------------------------------------------------
# Add
# ---------------------------------------------------------------------------

# csa_suppress_add <project_root> <finding_uid_or_display_id> <rule_severity> <note>
# Refuse if severity == "critical" (exit non-zero, message to stderr).
# Refuse if state has findings[finding_uid].first_seen < 60s ago (race window).
# Resolve display_id → finding_uid via state.findings[*].last_display_id lookup.
# If finding_uid already in suppressions, skip (idempotent).
# Else append entry; suppressed_by from $USER or "unknown".
csa_suppress_add() {
  local root="$1"
  local id_arg="$2"
  local severity="$3"
  local note="$4"

  # Refuse Critical.
  local severity_lower; severity_lower="$(printf '%s' "$severity" | tr '[:upper:]' '[:lower:]')"
  if [[ "$severity_lower" == "critical" ]]; then
    printf 'ERROR: Cannot suppress a critical-severity finding.\n' >&2
    return 1
  fi

  local sup_file; sup_file="$(csa_suppress_path "$root")"

  # Init if missing.
  if [[ ! -f "$sup_file" ]]; then
    csa_suppress_init "$root"
  fi

  # Resolve display_id → finding_uid if needed.
  # If id_arg is found as a last_display_id in state.findings, use the corresponding key.
  local fuid="$id_arg"
  local state_json; state_json="$(csa_state_read "$root")"

  local resolved; resolved="$(printf '%s' "$state_json" | jq -r \
    --arg did "$id_arg" \
    '(.findings // {}) | to_entries[] | select(.value.last_display_id == $did) | .key' 2>/dev/null | head -1)"
  if [[ -n "$resolved" ]]; then
    fuid="$resolved"
  fi

  # Race-window check: refuse if first_seen < 60s ago.
  local first_seen; first_seen="$(printf '%s' "$state_json" | jq -r \
    --arg k "$fuid" '.findings[$k].first_seen // empty' 2>/dev/null)"
  if [[ -n "$first_seen" ]]; then
    local fs_epoch; fs_epoch="$(_csa_iso_to_epoch "$first_seen")"
    local now_epoch; now_epoch="$(date -u +%s)"
    if [[ -n "$fs_epoch" && -n "$now_epoch" ]]; then
      local age=$(( now_epoch - fs_epoch ))
      if [[ "$age" -lt 60 ]]; then
        printf 'ERROR: Cannot suppress finding %s — less than 60s since first_seen (%s). Wait and retry.\n' \
          "$fuid" "$first_seen" >&2
        return 1
      fi
    fi
  fi

  # Idempotent: skip if finding_uid already in suppressions.
  local already; already="$(jq -r --arg k "$fuid" \
    '.suppressions[] | select(.finding_uid == $k) | .finding_uid' "$sup_file" | head -1)"
  if [[ -n "$already" ]]; then
    return 0
  fi

  # Append suppression entry.
  local suppressed_by="${USER:-unknown}"
  local now; now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local tmp; tmp="$(dirname "$sup_file")/suppressions.json.tmp.$$"
  jq \
    --arg fuid "$fuid" \
    --arg note "$note" \
    --arg by "$suppressed_by" \
    --arg at "$now" \
    '.suppressions += [{finding_uid: $fuid, suppressed_by: $by, suppressed_at: $at, note: $note}]' \
    "$sup_file" > "$tmp" && mv "$tmp" "$sup_file"
}

# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

# csa_suppress_list <project_root>
# Emit each suppression as a JSONL line on stdout.
csa_suppress_list() {
  local root="$1"
  local sup_file; sup_file="$(csa_suppress_path "$root")"
  [[ -f "$sup_file" ]] || return 0
  jq -c '.suppressions[]' "$sup_file"
}

# ---------------------------------------------------------------------------
# Filter
# ---------------------------------------------------------------------------

# csa_suppress_filter <findings_jsonl_file> <project_root>
# Emit only findings whose finding_uid is NOT in suppressions.json.
csa_suppress_filter() {
  local findings_file="$1"
  local root="$2"
  local sup_file; sup_file="$(csa_suppress_path "$root")"

  # Build set of suppressed finding_uids as a jq-compatible JSON array.
  local suppressed_uids='[]'
  if [[ -f "$sup_file" ]]; then
    suppressed_uids="$(jq '[.suppressions[].finding_uid]' "$sup_file")"
  fi

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local fuid; fuid="$(printf '%s' "$line" | jq -r '.finding_uid // empty')"
    if [[ -z "$fuid" ]]; then
      printf '%s\n' "$line"
      continue
    fi
    local is_suppressed; is_suppressed="$(printf '%s' "$suppressed_uids" | jq \
      --arg k "$fuid" 'any(.[]; . == $k)')"
    if [[ "$is_suppressed" == "false" ]]; then
      printf '%s\n' "$line"
    fi
  done < "$findings_file"
}
