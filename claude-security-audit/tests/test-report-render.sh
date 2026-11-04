#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"
source "$CSA_LIB_DIR/report-render.sh"

_csa_failed=0

_CSA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/csa-test.XXXXXX")"
trap 'rm -rf "$_CSA_TMP"' EXIT

# ---------------------------------------------------------------------------
# 1. zero findings → renders empty summary cleanly
# ---------------------------------------------------------------------------
test_zero_findings_renders_cleanly() {
  local out; out="$(csa_report_render_chat "")"

  # Must contain the table header.
  assert_contains "$out" "| Severity |" "chat must include table header" || return 1

  # All counts must be 0.
  assert_contains "$out" "| Critical | 0 | 0 | 0 | 0 |" "Critical row must be all-zeros" || return 1
  assert_contains "$out" "| High | 0 | 0 | 0 | 0 |" "High row must be all-zeros" || return 1
  assert_contains "$out" "| Medium | 0 | 0 | 0 | 0 |" "Medium row must be all-zeros" || return 1
  assert_contains "$out" "| Low | 0 | 0 | 0 | 0 |" "Low row must be all-zeros" || return 1

  # Must NOT contain any finding detail lines (no "### " sections with finding entries).
  local finding_sections; finding_sections="$(printf '%s' "$out" | grep -c '^- SA-' || true)"
  assert_eq "0" "$finding_sections" "zero findings: no finding bullet lines expected" || return 1
}

# ---------------------------------------------------------------------------
# 2. mixed severities → counts correctly
# ---------------------------------------------------------------------------
test_mixed_severities_counts_correctly() {
  local findings_jsonl
  findings_jsonl="$(cat <<'EOF'
{"rule_id":"RULE-H1","file":"a.json","line":1,"offset":0,"preview":"x","severity":"high","finding_uid":"FUID-h1","state":"NEW"}
{"rule_id":"RULE-M1","file":"b.json","line":2,"offset":0,"preview":"y","severity":"medium","finding_uid":"FUID-m1","state":"NEW"}
{"rule_id":"RULE-M2","file":"c.json","line":3,"offset":0,"preview":"z","severity":"medium","finding_uid":"FUID-m2","state":"NEW"}
{"rule_id":"RULE-L1","file":"d.json","line":4,"offset":0,"preview":"w","severity":"low","finding_uid":"FUID-l1","state":"NEW"}
EOF
)"
  # Assign display IDs.
  local dated_findings; dated_findings="$(csa_report_assign_display_ids "$findings_jsonl" "2026-05-25")"

  local out; out="$(csa_report_render_chat "$dated_findings")"

  assert_contains "$out" "| High | 1 |" "High count must be 1" || return 1
  assert_contains "$out" "| Medium | 2 |" "Medium count must be 2" || return 1
  assert_contains "$out" "| Low | 1 |" "Low count must be 1" || return 1
}

# ---------------------------------------------------------------------------
# 3. suppressed hidden by default
# ---------------------------------------------------------------------------
test_suppressed_hidden_by_default() {
  local findings_jsonl
  findings_jsonl="$(cat <<'EOF'
{"rule_id":"RULE-M1","file":"a.json","line":1,"offset":0,"preview":"x","severity":"medium","finding_uid":"FUID-m1","state":"NEW"}
{"rule_id":"RULE-M2","file":"b.json","line":2,"offset":0,"preview":"y","severity":"medium","finding_uid":"FUID-m2","state":"SUPPRESSED"}
EOF
)"
  local dated_findings; dated_findings="$(csa_report_assign_display_ids "$findings_jsonl" "2026-05-25")"

  # Default: no verbose.
  unset CSA_VERBOSE
  local out; out="$(csa_report_render_chat "$dated_findings")"

  # NEW count = 1, Suppressed count = 1.
  assert_contains "$out" "| Medium | 1 | 0 | 1 | 1 |" "Medium row: 1 new, 0 persisted, 1 suppressed, 1 visible" || return 1

  # The suppressed finding's display_id (SA-2026-05-25-002) must NOT appear in bullet lines.
  local suppressed_in_bullets; suppressed_in_bullets="$(printf '%s' "$out" | grep '^- SA-2026-05-25-002' | wc -l | tr -d ' ')"
  assert_eq "0" "$suppressed_in_bullets" "suppressed finding display_id must not appear in bullet lines by default" || return 1
}

# ---------------------------------------------------------------------------
# 4. suppressed shown with verbose flag
# ---------------------------------------------------------------------------
test_suppressed_shown_verbose() {
  local findings_jsonl
  findings_jsonl="$(cat <<'EOF'
{"rule_id":"RULE-M1","file":"a.json","line":1,"offset":0,"preview":"x","severity":"medium","finding_uid":"FUID-m1","state":"NEW"}
{"rule_id":"RULE-M2","file":"b.json","line":2,"offset":0,"preview":"y","severity":"medium","finding_uid":"FUID-m2","state":"SUPPRESSED"}
EOF
)"
  local dated_findings; dated_findings="$(csa_report_assign_display_ids "$findings_jsonl" "2026-05-25")"

  # Verbose via env var.
  local out; out="$(CSA_VERBOSE=1 csa_report_render_chat "$dated_findings")"

  # The suppressed finding's display_id (SA-2026-05-25-002) MUST appear in bullet lines.
  local suppressed_in_bullets; suppressed_in_bullets="$(printf '%s' "$out" | grep 'SA-2026-05-25-002' | wc -l | tr -d ' ')"
  [[ "$suppressed_in_bullets" -ge 1 ]] || {
    printf '    suppressed finding SA-2026-05-25-002 not found in verbose output\n' >&2
    return 1
  }
}

# ---------------------------------------------------------------------------
# 5. markdown report includes acknowledgements footer
# ---------------------------------------------------------------------------
test_markdown_report_includes_acknowledgements() {
  local out_file; out_file="$_CSA_TMP/test-report.md"

  local findings_jsonl
  findings_jsonl="$(cat <<'EOF'
{"rule_id":"PERM-001","file":".claude/settings.json","line":14,"offset":21,"preview":"\"allow\": [\"Bash(*)\"]","severity":"medium","finding_uid":"FUID-abcd1234","state":"NEW"}
EOF
)"
  local dated_findings; dated_findings="$(csa_report_assign_display_ids "$findings_jsonl" "2026-05-25")"

  local metadata_json
  metadata_json="$(jq -n '{
    project: "pulsestack",
    date: "2026-05-25",
    run_of_day: 1,
    duration_seconds: 4.2,
    scope_summary: "project .claude/ + 2 enabled plugins"
  }')"

  csa_report_render_markdown "$dated_findings" "$metadata_json" "$out_file"

  [[ -f "$out_file" ]] || { printf '    markdown report file not created\n' >&2; return 1; }

  local content; content="$(cat "$out_file")"
  assert_contains "$content" "Acknowledgements" "markdown must include ## Acknowledgements section" || return 1
  assert_contains "$content" "AgentShield" "markdown must mention AgentShield" || return 1
}

# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
csa_test_run test_zero_findings_renders_cleanly        || _csa_failed=$((_csa_failed + 1))
csa_test_run test_mixed_severities_counts_correctly    || _csa_failed=$((_csa_failed + 1))
csa_test_run test_suppressed_hidden_by_default         || _csa_failed=$((_csa_failed + 1))
csa_test_run test_suppressed_shown_verbose             || _csa_failed=$((_csa_failed + 1))
csa_test_run test_markdown_report_includes_acknowledgements || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
