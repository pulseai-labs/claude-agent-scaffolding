#!/usr/bin/env bash
# lib/report-render.sh — chat summary + markdown report file for claude-security-audit.
# Requires: lib/helpers.sh (csa_realpath)
# Bash 3.2+ compatible (macOS portability).

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# _csa_count_sev <findings_jsonl> <severity> <state_filter>
# Print count of findings matching severity and state ("NEW"|"PERSISTED"|"SUPPRESSED"|"*").
_csa_count_sev() {
  local findings_jsonl="$1"
  local severity="$2"
  local state_filter="$3"

  if [[ -z "$findings_jsonl" ]]; then
    printf '0'
    return
  fi

  local count=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local sev st
    sev="$(printf '%s' "$line" | jq -r '.severity // empty')"
    st="$(printf '%s' "$line" | jq -r '.state // "NEW"')"
    [[ "$sev" == "$severity" ]] || continue
    if [[ "$state_filter" == "*" ]] || [[ "$st" == "$state_filter" ]]; then
      count=$((count + 1))
    fi
  done <<< "$findings_jsonl"

  printf '%d' "$count"
}

# _csa_severity_label <severity> — title-case label for severity.
_csa_severity_label() {
  case "$1" in
    critical) printf 'Critical' ;;
    high)     printf 'High'     ;;
    medium)   printf 'Medium'   ;;
    low)      printf 'Low'      ;;
    info)     printf 'Info'     ;;
    *)        printf '%s' "$1"  ;;
  esac
}

# ---------------------------------------------------------------------------
# csa_report_next_run_of_day <project_root>
# Count today's report files in .claude/audits/ (YYYY-MM-DD-*.md), return N+1 as 2-digit padded.
# ---------------------------------------------------------------------------
csa_report_next_run_of_day() {
  local root="$1"
  local today; today="$(date +%Y-%m-%d)"
  local audits_dir; audits_dir="$root/.claude/audits"
  local count=0

  if [[ -d "$audits_dir" ]]; then
    local f
    for f in "$audits_dir/${today}"-*.md; do
      [[ -f "$f" ]] && count=$((count + 1))
    done
  fi

  printf '%02d' $((count + 1))
}

# ---------------------------------------------------------------------------
# csa_report_assign_display_ids <findings_jsonl> <date>
# Read JSONL, augment each line with "display_id": "SA-<date>-<NNN>".
# Prints augmented JSONL to stdout.
# ---------------------------------------------------------------------------
csa_report_assign_display_ids() {
  local findings_jsonl="$1"
  local date="$2"
  local ordinal=0

  if [[ -z "$findings_jsonl" ]]; then
    return
  fi

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    ordinal=$((ordinal + 1))
    local display_id
    display_id="$(printf 'SA-%s-%03d' "$date" "$ordinal")"
    printf '%s' "$line" | jq -c --arg did "$display_id" '. + {display_id: $did}'
  done <<< "$findings_jsonl"
}

# ---------------------------------------------------------------------------
# _csa_build_summary_table <findings_jsonl> [verbose]
# Print the markdown summary table.
# ---------------------------------------------------------------------------
_csa_build_summary_table() {
  local findings_jsonl="$1"
  local verbose="${2:-false}"

  local severities="critical high medium low info"
  local labels="Critical High Medium Low Info"

  printf '| Severity | NEW | Persisted | Suppressed | Total visible |\n'
  printf '|---|---|---|---|---|\n'

  local sev label
  local i=0
  for sev in $severities; do
    i=$((i + 1))
    # Extract label by position
    label="$(_csa_severity_label "$sev")"

    if [[ "$sev" == "info" && "$verbose" != "true" ]]; then
      printf '| %s | (suppressed; pass --verbose) | | | |\n' "$label"
      continue
    fi

    local n_new n_pers n_supp n_visible
    n_new="$(_csa_count_sev "$findings_jsonl" "$sev" "NEW")"
    n_pers="$(_csa_count_sev "$findings_jsonl" "$sev" "PERSISTED")"
    n_supp="$(_csa_count_sev "$findings_jsonl" "$sev" "SUPPRESSED")"
    n_visible=$((n_new + n_pers))

    printf '| %s | %d | %d | %d | %d |\n' "$label" "$n_new" "$n_pers" "$n_supp" "$n_visible"
  done
}

# ---------------------------------------------------------------------------
# csa_report_render_chat <findings_jsonl> [<report_path>] [verbose]
# Emit chat-summary markdown to stdout.
# ---------------------------------------------------------------------------
csa_report_render_chat() {
  local findings_jsonl="$1"
  local report_path="${2:-}"
  local verbose="${3:-false}"

  # Also check environment variable.
  if [[ "${CSA_VERBOSE:-}" == "1" ]]; then
    verbose="true"
  fi

  # Count total visible findings (non-suppressed).
  local total_visible=0
  if [[ -n "$findings_jsonl" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      local st
      st="$(printf '%s' "$line" | jq -r '.state // "NEW"')"
      if [[ "$st" != "SUPPRESSED" ]]; then
        total_visible=$((total_visible + 1))
      fi
    done <<< "$findings_jsonl"
  fi

  # Extract date + run from first finding's display_id, or fallback.
  local date run_of_day
  date="$(date +%Y-%m-%d)"
  run_of_day="01"

  if [[ -n "$findings_jsonl" ]]; then
    local first_did
    first_did="$(printf '%s' "$findings_jsonl" | head -1 | jq -r '.display_id // empty')"
    if [[ -n "$first_did" ]]; then
      # SA-YYYY-MM-DD-NNN or SA-YYYY-MM-DD-NN-NNN
      # Extract date from SA-<date>-... (positions 3-12)
      local stripped="${first_did#SA-}"
      date="${stripped:0:10}"
    fi
  fi

  printf '## Security audit — %s (run #%s) — %d findings\n\n' "$date" "$run_of_day" "$total_visible"

  _csa_build_summary_table "$findings_jsonl" "$verbose"

  printf '\n'

  # HOOK-006 is Info, so the table hides it; say that hooks went unchecked (#1059).
  if [[ "$verbose" != "true" && -n "$findings_jsonl" ]]; then
    local n_unchecked
    n_unchecked="$(printf '%s\n' "$findings_jsonl" | jq -s '[.[] | select(.rule_id == "HOOK-006" and (.state // "NEW") != "SUPPRESSED")] | length' 2>/dev/null || echo 0)"
    if [[ "${n_unchecked:-0}" -gt 0 ]]; then
      printf '%d %s hooks the audit does not inspect (HOOK-006, Info; pass --verbose).\n\n' "$n_unchecked" \
        "$([[ "$n_unchecked" -eq 1 ]] && printf 'file declares' || printf 'files declare')"
    fi
  fi

  # List critical + high findings explicitly (non-suppressed only, unless verbose).
  local show_severities="critical high"
  if [[ "$verbose" == "true" ]]; then
    show_severities="critical high medium low info"
  fi

  for sev in $show_severities; do
    local label; label="$(_csa_severity_label "$sev")"
    # Collect non-suppressed findings of this severity.
    local sev_findings=()
    if [[ -n "$findings_jsonl" ]]; then
      while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local fsev fst
        fsev="$(printf '%s' "$line" | jq -r '.severity // empty')"
        fst="$(printf '%s' "$line" | jq -r '.state // "NEW"')"
        [[ "$fsev" == "$sev" ]] || continue
        if [[ "$verbose" == "true" ]] || [[ "$fst" != "SUPPRESSED" ]]; then
          sev_findings+=("$line")
        fi
      done <<< "$findings_jsonl"
    fi

    local count="${#sev_findings[@]}"
    if [[ "$count" -gt 0 ]]; then
      printf '### %s (%d)\n' "$label" "$count"
      local f
      for f in "${sev_findings[@]}"; do
        local did rule_id file line_no jpath
        did="$(printf '%s' "$f" | jq -r '.display_id // "SA-unknown"')"
        rule_id="$(printf '%s' "$f" | jq -r '.rule_id // ""')"
        file="$(printf '%s' "$f" | jq -r '.file // ""')"
        line_no="$(printf '%s' "$f" | jq -r '.line // ""')"
        jpath="$(printf '%s' "$f" | jq -r '(.context | objects | .json_path) // ""')"
        if [[ -n "$jpath" ]]; then
          printf -- '- %s \xe2\x80\x94 %s at %s#%s\n' "$did" "$rule_id" "$file" "$jpath"
        elif [[ -n "$line_no" ]]; then
          printf -- '- %s \xe2\x80\x94 %s at %s:%s\n' "$did" "$rule_id" "$file" "$line_no"
        else
          printf -- '- %s \xe2\x80\x94 %s at %s\n' "$did" "$rule_id" "$file"
        fi
      done
      printf '\n'
    fi
  done

  if [[ -n "$report_path" ]]; then
    printf 'Full report: %s\n' "$report_path"
  fi
}

# ---------------------------------------------------------------------------
# csa_report_render_markdown <findings_jsonl> <metadata_json> <output_path>
# Write full markdown report to output_path.
# ---------------------------------------------------------------------------
csa_report_render_markdown() {
  local findings_jsonl="$1"
  local metadata_json="$2"
  local output_path="$3"

  # Parse metadata.
  local project date run_of_day duration scope_summary
  if [[ -n "$metadata_json" ]]; then
    project="$(printf '%s' "$metadata_json" | jq -r '.project // "unknown"')"
    date="$(printf '%s' "$metadata_json" | jq -r '.date // ""')"
    run_of_day="$(printf '%s' "$metadata_json" | jq -r '.run_of_day // 1')"
    duration="$(printf '%s' "$metadata_json" | jq -r '.duration_seconds // 0')"
    scope_summary="$(printf '%s' "$metadata_json" | jq -r '.scope_summary // ""')"
  else
    project="unknown"
    date="$(date +%Y-%m-%d)"
    run_of_day="1"
    duration="0"
    scope_summary=""
  fi

  [[ -z "$date" ]] && date="$(date +%Y-%m-%d)"
  local run_padded; run_padded="$(printf '%02d' "$run_of_day")"

  # Build output.
  {
    printf '# Security audit — %s (run #%s)\n\n' "$date" "$run_padded"
    printf '**Project:** %s\n' "$project"
    printf '**Audit scope:** %s\n' "$scope_summary"
    printf '**Duration:** %ss\n\n' "$duration"

    printf '## Summary\n\n'
    _csa_build_summary_table "$findings_jsonl" "true"
    printf '\n'

    printf '## Findings\n\n'

    # Emit each finding as a section.
    if [[ -n "$findings_jsonl" ]]; then
      while IFS= read -r finding; do
        [[ -z "$finding" ]] && continue
        local did rule_id file line_no offset preview fuid state sev jpath
        did="$(printf '%s' "$finding" | jq -r '.display_id // "SA-unknown"')"
        rule_id="$(printf '%s' "$finding" | jq -r '.rule_id // ""')"
        file="$(printf '%s' "$finding" | jq -r '.file // ""')"
        line_no="$(printf '%s' "$finding" | jq -r '.line // ""')"
        offset="$(printf '%s' "$finding" | jq -r '.offset // ""')"
        preview="$(printf '%s' "$finding" | jq -r '.preview // ""')"
        fuid="$(printf '%s' "$finding" | jq -r '.finding_uid // ""')"
        state="$(printf '%s' "$finding" | jq -r '.state // "NEW"')"
        sev="$(_csa_severity_label "$(printf '%s' "$finding" | jq -r '.severity // ""')")"

        printf -- '### [%s] %s (%s) \xe2\x80\x94 %s\n\n' "$state" "$did" "$sev" "$rule_id"
        printf '**Rule:** %s\n' "$rule_id"
        jpath="$(printf '%s' "$finding" | jq -r '(.context | objects | .json_path) // ""')"
        if [[ -n "$jpath" ]]; then
          printf '**File:** %s#%s\n' "$file" "$jpath"
        else
          printf '**File:** %s:%s:%s\n' "$file" "$line_no" "$offset"
        fi
        printf '**Preview:** `%s`\n' "$preview"
        printf '**finding_uid:** `%s`\n\n' "$fuid"
        printf -- '---\n\n'
      done <<< "$findings_jsonl"
    else
      printf '_No findings._\n\n'
    fi

    printf '## Acknowledgements\n\n'
    printf 'This report was generated by claude-security-audit v0.1.0, an independent MIT-licensed audit tool inspired by AgentShield in Everything Claude Code (Mustafa, 2026).\n'
  } > "$output_path"
}
