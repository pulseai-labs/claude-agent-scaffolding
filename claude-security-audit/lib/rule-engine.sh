#!/usr/bin/env bash
# lib/rule-engine.sh — runs rule files against target files.
# Per SPEC §8.1 (rule contract) and §12 (T2-G rule-load failure visibility).

# csa_rule_run_one <rule_file> <target_file>
# Sources rule in a subshell, calls detect, emits findings JSONL on stdout.
# On source failure: emits SCANNER-001 (High).
# Empty output with exit 1 means no match (grep-compatible detector contract).
# Any other non-zero result emits SCANNER-002 (High), including exit 1 with
# output because a detector must not mix findings with a no-match status.
csa_rule_run_one() {
  local rule_file="$1"; local target_file="$2"
  local rule_id; rule_id="$(basename "$rule_file" .sh)"
  (
    set -u
    if ! source "$rule_file" 2>/dev/null; then
      jq -nc --arg rid "SCANNER-001" --arg f "$rule_file" \
        '{rule_id: $rid, file: $f, line: 0, offset: 0, preview: "rule failed to load", severity: "high", context: {failed_rule: $f}}'
      return 0
    fi
    if ! declare -f detect >/dev/null; then
      jq -nc --arg rid "SCANNER-001" --arg f "$rule_file" \
        '{rule_id: $rid, file: $f, line: 0, offset: 0, preview: "rule has no detect() function", severity: "high"}'
      return 0
    fi
    local out ec=0
    out="$(detect "$target_file" 2>/dev/null)" || ec=$?
    if [[ "$ec" -eq 1 && -z "$out" ]]; then
      return 0
    fi
    if [[ "$ec" -ne 0 ]]; then
      jq -nc --arg rid "SCANNER-002" --arg f "$target_file" --arg r "$rule_file" \
        '{rule_id: $rid, file: $f, line: 0, offset: 0, preview: "detect() failed", severity: "high", context: {failed_rule: $r, exit_code: '"$ec"'}}'
      return 0
    fi
    printf '%s\n' "$out"
  )
}

# csa_rule_run_many <rule_file> <targets_file>
# Source rule ONCE in a subshell, iterate targets_file, call detect per target.
# More efficient than calling csa_rule_run_one per target (amortizes source cost).
csa_rule_run_many() {
  local rule_file="$1"; local targets_file="$2"
  (
    set -u
    if ! source "$rule_file" 2>/dev/null; then
      jq -nc --arg rid "SCANNER-001" --arg f "$rule_file" \
        '{rule_id: $rid, file: $f, line: 0, offset: 0, preview: "rule failed to load", severity: "high", context: {failed_rule: $f}}'
      return 0
    fi
    if ! declare -f detect >/dev/null; then
      jq -nc --arg rid "SCANNER-001" --arg f "$rule_file" \
        '{rule_id: $rid, file: $f, line: 0, offset: 0, preview: "rule has no detect() function", severity: "high"}'
      return 0
    fi
    while IFS= read -r target_line; do
      [[ -z "$target_line" ]] && continue
      local target="${target_line##*$'\t'}"
      local out ec=0
      out="$(detect "$target" 2>/dev/null)" || ec=$?
      if [[ "$ec" -eq 1 && -z "$out" ]]; then
        continue
      elif [[ "$ec" -ne 0 ]]; then
        jq -nc --arg rid "SCANNER-002" --arg f "$target" --arg r "$rule_file" \
          '{rule_id: $rid, file: $f, line: 0, offset: 0, preview: "detect() failed", severity: "high", context: {failed_rule: $r, exit_code: '"$ec"'}}'
      else
        printf '%s\n' "$out"
      fi
    done < "$targets_file"
  )
}

# csa_rule_engine_scan_files <rule_file> <target_file_1> [<target_file_2> ...]
csa_rule_engine_scan_files() {
  local rule_file="$1"; shift
  for t in "$@"; do
    csa_rule_run_one "$rule_file" "$t"
  done
}

# _csa_rule_aspect_from_file <rule_file>
# Extract RULE_ASPECT via grep (no subshell source — fast metadata read).
_csa_rule_aspect_from_file() {
  grep -m1 '^RULE_ASPECT=' "$1" 2>/dev/null | sed 's/^RULE_ASPECT=//' | tr -d '"'\'
}

# _csa_target_matches_aspect <target_path> <aspect>
# Returns 0 (match) or 1 (skip) based on aspect-to-file-extension heuristic.
# Secrets rules run on any text file; aspect-specific rules filter tightly.
_csa_target_matches_aspect() {
  local target="$1"
  local aspect="$2"
  local base; base="$(basename "$target")"
  case "$aspect" in
    permissions)
      [[ "$base" == "settings.json" || "$base" == "settings.local.json" ]] && return 0
      return 1
      ;;
    hooks)
      if [[ "$target" == *.sh || "$target" == */.opencode/bin/* ]]; then
        return 0
      fi
      [[ "$target" == */.claude/hooks/* && -x "$target" ]] && return 0
      return 1
      ;;
    marketplace)
      [[ "$base" == "marketplace.json" ]] && return 0
      return 1
      ;;
    mcp)
      [[ "$target" == *.json ]] && return 0
      return 1
      ;;
    claude-md)
      [[ "$base" == "CLAUDE.md" ]] && return 0
      return 1
      ;;
    prompt-injection)
      [[ "$target" == *.md ]] && return 0
      return 1
      ;;
    secrets)
      # Secrets rules scan text-like files and executable Claude hook handlers.
      [[ "$target" == *.md || "$target" == *.json || "$target" == *.sh \
         || "$target" == *.py || "$target" == *.js || "$target" == *.ts \
         || "$target" == */.opencode/bin/* ]] && return 0
      [[ "$target" == */.claude/hooks/* && -x "$target" ]] && return 0
      return 1
      ;;
    test)
      # Synthetic test rules: run on everything (used by e2e tests).
      return 0
      ;;
    *)
      # Unknown aspect: run on everything (conservative fallback).
      return 0
      ;;
  esac
}

# _csa_rule_engine_validate_focus <focus>
# Accept all or an aspect directory shipped in CSA_RULES_DIR.
_csa_rule_engine_validate_focus() {
  local focus="$1" aspect_dir
  [[ "$focus" == "all" ]] && return 0
  for aspect_dir in "$CSA_RULES_DIR"/*; do
    [[ -d "$aspect_dir" ]] || continue
    [[ "$(basename "$aspect_dir")" == "$focus" ]] && return 0
  done
  printf 'Unknown rule aspect: %s\n' "$focus" >&2
  return 2
}

# csa_rule_engine_scan_all <project_root> [<focus>]
# Discovers all rule files (filtered by focus aspect), runs the matrix.
# Uses aspect-based pre-filtering to reduce rule×target cross-product.
# Emits SCANNER-002 banner on stderr if 3+ SCANNER-002 findings emerge.
csa_rule_engine_scan_all() {
  local root="$1"; local focus="${2:-all}"
  if ! _csa_rule_engine_validate_focus "$focus"; then
    return 2
  fi
  local rules_glob="$CSA_RULES_DIR"
  if [[ "$focus" != "all" ]]; then
    rules_glob="$CSA_RULES_DIR/$focus"
  fi
  local scanner_002_count=0
  local findings_out; findings_out="$(mktemp)"
  # Pre-collect targets once (avoids re-running enumeration per rule).
  local targets_file; targets_file="$(mktemp)"
  local enum_error
  if ! enum_error="$(csa_enum_targets_all "$root" 2>&1 > "$targets_file")"; then
    printf '%s\n' "$enum_error" >&2
    rm -f "$findings_out" "$targets_file"
    return 2
  fi
  while read -r rule_file; do
    [[ -z "$rule_file" ]] && continue
    local aspect; aspect="$(_csa_rule_aspect_from_file "$rule_file")"
    # Build a filtered targets file for this rule's aspect.
    local rule_targets_file; rule_targets_file="$(mktemp)"
    if [[ -n "$aspect" ]]; then
      while IFS= read -r target_line; do
        [[ -z "$target_line" ]] && continue
        local target="${target_line##*$'\t'}"
        if _csa_target_matches_aspect "$target" "$aspect"; then
          printf '%s\n' "$target_line"
        fi
      done < "$targets_file" > "$rule_targets_file"
    else
      cp "$targets_file" "$rule_targets_file"
    fi
    # Source rule once and iterate all matching targets.
    csa_rule_run_many "$rule_file" "$rule_targets_file" >> "$findings_out"
    rm -f "$rule_targets_file"
  done < <(find "$rules_glob" -name '*.sh' -type f 2>/dev/null)
  cat "$findings_out"
  scanner_002_count="$(grep -c 'SCANNER-002' "$findings_out" 2>/dev/null || true)"
  if [[ "$scanner_002_count" -ge 3 ]]; then
    printf '⚠ %d rule(s) failed during scan; results incomplete. See SCANNER-002 findings.\n' "$scanner_002_count" >&2
  fi
  rm -f "$findings_out" "$targets_file"
}
