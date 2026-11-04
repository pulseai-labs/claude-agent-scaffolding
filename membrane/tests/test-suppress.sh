#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"
source "$CSA_LIB_DIR/state.sh"
source "$CSA_LIB_DIR/suppress.sh"

_csa_failed=0

_CSA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/csa-test.XXXXXX")"
trap 'rm -rf "$_CSA_TMP"' EXIT

# ---------------------------------------------------------------------------
# 1. add basic — init + add a medium-severity finding → list shows 1
# ---------------------------------------------------------------------------
test_add_basic() {
  local root="$_CSA_TMP/t01"
  mkdir -p "$root"
  csa_suppress_init "$root"
  csa_suppress_add "$root" "FUID-001" "medium" "known false positive"

  local count; count="$(csa_suppress_list "$root" | wc -l | tr -d ' ')"
  assert_eq "1" "$count" "list must show 1 suppression after add" || return 1

  local fuid; fuid="$(csa_suppress_list "$root" | jq -r '.finding_uid')"
  assert_eq "FUID-001" "$fuid" "suppressed finding_uid must match" || return 1
}

# ---------------------------------------------------------------------------
# 2. refuse Critical — add with severity=critical, expect non-zero + stderr; list still 0
# ---------------------------------------------------------------------------
test_refuse_critical() {
  local root="$_CSA_TMP/t02"
  mkdir -p "$root"
  csa_suppress_init "$root"

  local err_out; err_out="$(csa_suppress_add "$root" "FUID-crit" "critical" "trying to suppress" 2>&1)"
  local ec=$?

  [[ "$ec" -ne 0 ]] || { printf '    expected non-zero exit for critical suppression\n' >&2; return 1; }
  assert_contains "$err_out" "critical" "stderr must mention critical" || return 1

  local count; count="$(csa_suppress_list "$root" | wc -l | tr -d ' ')"
  assert_eq "0" "$count" "list must remain empty after refused critical suppression" || return 1
}

# ---------------------------------------------------------------------------
# 3. list emits JSONL — add 2, list returns 2 lines
# ---------------------------------------------------------------------------
test_list_emits_jsonl() {
  local root="$_CSA_TMP/t03"
  mkdir -p "$root"
  csa_suppress_init "$root"
  csa_suppress_add "$root" "FUID-aaa" "medium" "note-a"
  csa_suppress_add "$root" "FUID-bbb" "low" "note-b"

  local count; count="$(csa_suppress_list "$root" | wc -l | tr -d ' ')"
  assert_eq "2" "$count" "list must emit 2 lines for 2 suppressions" || return 1

  # Each line must be valid JSON.
  local line; while IFS= read -r line; do
    printf '%s' "$line" | jq '.' >/dev/null 2>&1 || {
      printf '    list line is not valid JSON: %s\n' "$line" >&2; return 1
    }
  done < <(csa_suppress_list "$root")
}

# ---------------------------------------------------------------------------
# 4. finding_uid match in filter — suppressed finding excluded from output
# ---------------------------------------------------------------------------
test_filter_excludes_suppressed() {
  local root="$_CSA_TMP/t04"
  mkdir -p "$root"
  csa_suppress_init "$root"
  csa_suppress_add "$root" "FUID-abc" "medium" "known"

  local findings_file="$_CSA_TMP/findings-t04.jsonl"
  printf '%s\n' \
    '{"finding_uid":"FUID-abc","rule_id":"PERM-001","severity":"medium","file":"f.json"}' \
    '{"finding_uid":"FUID-xyz","rule_id":"PERM-002","severity":"low","file":"g.json"}' \
    > "$findings_file"

  local out; out="$(csa_suppress_filter "$findings_file" "$root")"
  local line_count; line_count="$(printf '%s\n' "$out" | grep -c . || true)"
  assert_eq "1" "$line_count" "filter must output only 1 non-suppressed finding" || return 1

  local kept_uid; kept_uid="$(printf '%s\n' "$out" | jq -r '.finding_uid')"
  assert_eq "FUID-xyz" "$kept_uid" "only FUID-xyz must pass the filter" || return 1
}

# ---------------------------------------------------------------------------
# 5. dedup in suppressions — add same finding_uid twice; list shows only 1
# ---------------------------------------------------------------------------
test_dedup_same_uid() {
  local root="$_CSA_TMP/t05"
  mkdir -p "$root"
  csa_suppress_init "$root"
  csa_suppress_add "$root" "FUID-dup" "medium" "first add"
  csa_suppress_add "$root" "FUID-dup" "medium" "second add"  # should be skipped

  local count; count="$(csa_suppress_list "$root" | wc -l | tr -d ' ')"
  assert_eq "1" "$count" "duplicate add must not create second entry in suppressions" || return 1
}

# ---------------------------------------------------------------------------
# 6. race-window refusal (T1-F) — first_seen = NOW → refusal with "less than 60s"
# ---------------------------------------------------------------------------
test_race_window_refusal() {
  local root="$_CSA_TMP/t06"
  mkdir -p "$root/.claude/audits"
  csa_state_init "$root"

  local fuid="FUID-race"
  local now_iso; now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Write state.json with finding first_seen = now.
  local state_file; state_file="$(csa_state_path "$root")"
  jq \
    --arg fuid "$fuid" \
    --arg now "$now_iso" \
    '.findings[$fuid] = {rule_id:"PERM-001",severity:"medium",file:"x.json",first_seen:$now,last_seen:$now,seen_in_runs:1,last_run_index:1,last_display_id:"SA-R-001"}' \
    "$state_file" > "$state_file.tmp" && mv "$state_file.tmp" "$state_file"

  csa_suppress_init "$root"

  local err_out; err_out="$(csa_suppress_add "$root" "$fuid" "medium" "too soon" 2>&1)"
  local ec=$?

  [[ "$ec" -ne 0 ]] || { printf '    expected non-zero exit for race-window refusal\n' >&2; return 1; }
  assert_contains "$err_out" "less than 60s" "stderr must mention less than 60s" || return 1

  local count; count="$(csa_suppress_list "$root" | wc -l | tr -d ' ')"
  assert_eq "0" "$count" "list must be empty after race-window refusal" || return 1
}

# ---------------------------------------------------------------------------
# 7. display_id resolves to finding_uid
# ---------------------------------------------------------------------------
test_display_id_resolves_to_finding_uid() {
  local root="$_CSA_TMP/t07"
  mkdir -p "$root/.claude/audits"
  csa_state_init "$root"

  local fuid="FUID-display-resolved"
  local display_id="SA-X-001"
  # Use a first_seen far in the past to avoid race-window refusal.
  local old_iso="2026-01-01T00:00:00Z"

  local state_file; state_file="$(csa_state_path "$root")"
  jq \
    --arg fuid "$fuid" \
    --arg did "$display_id" \
    --arg old "$old_iso" \
    '.findings[$fuid] = {rule_id:"PERM-003",severity:"medium",file:"y.json",first_seen:$old,last_seen:$old,seen_in_runs:1,last_run_index:1,last_display_id:$did}' \
    "$state_file" > "$state_file.tmp" && mv "$state_file.tmp" "$state_file"

  csa_suppress_init "$root"

  # Call suppress_add with the display_id (not the FUID).
  csa_suppress_add "$root" "$display_id" "medium" "resolved via display_id"

  local stored_uid; stored_uid="$(csa_suppress_list "$root" | jq -r '.finding_uid')"
  assert_eq "$fuid" "$stored_uid" "finding_uid in suppressions must be the resolved FUID, not the display_id" || return 1
}

# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
csa_test_run test_add_basic                            || _csa_failed=$((_csa_failed + 1))
csa_test_run test_refuse_critical                      || _csa_failed=$((_csa_failed + 1))
csa_test_run test_list_emits_jsonl                     || _csa_failed=$((_csa_failed + 1))
csa_test_run test_filter_excludes_suppressed           || _csa_failed=$((_csa_failed + 1))
csa_test_run test_dedup_same_uid                       || _csa_failed=$((_csa_failed + 1))
csa_test_run test_race_window_refusal                  || _csa_failed=$((_csa_failed + 1))
csa_test_run test_display_id_resolves_to_finding_uid   || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
