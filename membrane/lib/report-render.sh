#!/usr/bin/env bash
# lib/report-render.sh — chat summary + markdown report file for membrane.
# Requires: lib/helpers.sh (csa_realpath); lib/fingerprint.sh (csa_normalize_path), used only to group findings.
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
# Finding groups (#1034). Two kinds of finding are folded into one count line in chat; the markdown
# report still lists them at full severity, tagged with the group. Nothing here changes a count, a
# severity, a state or a uid.
#
# _csa_finding_group <file> — prints the group tag of a finding's file, or nothing. THE one definition:
#   "plugin fixtures/tests"  an enabled plugin's file with a `fixtures` or `tests` directory segment
#                            anywhere in its path inside the plugin tree (csa_normalize_path's
#                            @plugin:<plugin>[@<marketplace>]:<rest>; a file merely NAMED tests is not
#                            in it). A plugin whose layout does not normalize (a local plugin, an
#                            installPath outside the cache) is not grouped, so it stays listed.
#   "agent scratch"          a file under the project's own `.dagr/scratch/` (project root:
#                            CSA_PROJECT_ROOT, else the working directory).
# A project's own `tests/` or `fixtures/` is NOT in a group. Anything that does not match is listed in
# chat as before, and if csa_normalize_path is not loaded no plugin file is grouped (listed, never hidden).
# Skill-first question 2: our own path shapes, a closed set.
# ---------------------------------------------------------------------------
_csa_finding_group() {
  local f="$1" norm rest root="${CSA_PROJECT_ROOT:-$PWD}"
  if declare -F csa_normalize_path >/dev/null 2>&1; then
    norm="$(csa_normalize_path "$f")"
    if [[ "$norm" == @plugin:* ]]; then
      rest="${norm#@plugin:}"; rest="${rest#*:}"
      if [[ "/$rest" == */fixtures/* || "/$rest" == */tests/* ]]; then
        printf 'plugin fixtures/tests'
        return 0
      fi
      return 0
    fi
  fi
  while [[ "$root" == ?*/ ]]; do root="${root%/}"; done
  if [[ "$f" == .dagr/scratch/* || "$f" == "$root"/.dagr/scratch/* ]]; then
    printf 'agent scratch'
  fi
  return 0
}

# _csa_group_count_line <findings_jsonl> — one line, or nothing when no non-suppressed finding is in a group.
_csa_group_count_line() {
  local findings_jsonl="$1" line file sev st n=0 c=0 h=0 m=0 l=0 i=0 o=0 g
  [[ -n "$findings_jsonl" ]] || return 0
  # Same extraction as the chat list (jq -r .file per line), so a finding is counted here exactly when it is not listed there.
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    st="$(printf '%s' "$line" | jq -r '.state // "NEW"')"
    [[ "$st" != "SUPPRESSED" ]] || continue
    file="$(printf '%s' "$line" | jq -r '.file // ""')"
    g="$(_csa_finding_group "$file")"
    [[ -n "$g" ]] || continue
    sev="$(printf '%s' "$line" | jq -r '.severity // empty')"
    n=$((n + 1))
    case "$sev" in
      critical) c=$((c + 1)) ;; high) h=$((h + 1)) ;; medium) m=$((m + 1)) ;;
      low) l=$((l + 1)) ;; info) i=$((i + 1)) ;;
      *) o=$((o + 1)) ;;   # a missing or unknown severity: the total stays the sum of what is printed
    esac
  done <<< "$findings_jsonl"
  [[ "$n" -gt 0 ]] || return 0
  local extra=""
  [[ "$l" -eq 0 ]] || extra="$extra, $l low"
  [[ "$i" -eq 0 ]] || extra="$extra, $i info"
  [[ "$o" -eq 0 ]] || extra="$extra, $o other"
  printf '%d %s in plugin fixtures/tests and agent scratch copies (%d critical, %d high, %d medium%s); listed in the report\n\n' \
    "$n" "$([[ "$n" -eq 1 ]] && printf finding || printf findings)" "$c" "$h" "$m" "$extra"
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
    if n_unchecked="$(printf '%s\n' "$findings_jsonl" | jq -s '[.[] | select(.rule_id == "HOOK-006" and (.state // "NEW") != "SUPPRESSED")] | length' 2>/dev/null)"; then
      if [[ "${n_unchecked:-0}" -gt 0 ]]; then
        printf '%d %s hooks the audit does not inspect (HOOK-006, Info; pass --verbose).\n\n' "$n_unchecked" \
          "$([[ "$n_unchecked" -eq 1 ]] && printf 'file declares' || printf 'files declare')"
      fi
    else
      # A failed count is not zero (#1072 C7): say so, so an unchecked hook is not hidden.
      printf 'HOOK-006 count unavailable (the findings could not be counted; pass --verbose to list them).\n\n'
    fi
  fi

  # The group's findings are one count line, not listed one by one; --verbose lists them in full.
  if [[ "$verbose" != "true" ]]; then
    _csa_group_count_line "$findings_jsonl"
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
          if [[ "$verbose" != "true" && -n "$(_csa_finding_group "$(printf '%s' "$line" | jq -r '.file // ""')")" ]]; then
            continue
          fi
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
        elif [[ -n "$line_no" && "$line_no" != "0" ]]; then
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
        elif [[ "$line_no" == "0" ]]; then
          # Line 0 means the finding has no line (#1072 r2 C12): the bare file, not file:0:0.
          printf '**File:** %s\n' "$file"
        else
          printf '**File:** %s:%s:%s\n' "$file" "$line_no" "$offset"
        fi
        local grp; grp="$(_csa_finding_group "$file")"
        [[ -z "$grp" ]] || printf '**Group:** %s\n' "$grp"
        printf '**Preview:** `%s`\n' "$preview"
        printf '**finding_uid:** `%s`\n\n' "$fuid"
        printf -- '---\n\n'
      done <<< "$findings_jsonl"
    else
      printf '_No findings._\n\n'
    fi

    printf '## Acknowledgements\n\n'
    printf 'This report was generated by membrane v0.1.0, an independent MIT-licensed audit tool inspired by AgentShield in Everything Claude Code (Mustafa, 2026).\n'
  } > "$output_path"
}
