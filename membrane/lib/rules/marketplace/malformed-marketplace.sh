#!/usr/bin/env bash
RULE_ID="MARKETPLACE-002"
RULE_NAME="malformed-marketplace"
RULE_ASPECT="marketplace"
RULE_SEVERITY="medium"
RULE_DESCRIPTION="marketplace.json failed to parse or is missing required fields (.marketplaces array, or entry name/url)."
RULE_AUTO_FIXABLE="false"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Fix the marketplace.json structure. Required: a top-level .marketplaces array where each entry has a 'name' and 'url' field."
RULE_REFERENCES=""

# Resolve lib dir robustly: BASH_SOURCE works for normal invocations;
# fall back to CSA_LIB_DIR (set by harness) when sourced inside a subshell.
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  _RULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
else
  _RULE_DIR="${CSA_LIB_DIR:-}"
fi
# shellcheck source=/dev/null
source "$_RULE_DIR/redact.sh" 2>/dev/null || true
# shellcheck source=/dev/null
source "$_RULE_DIR/fingerprint.sh" 2>/dev/null || true
# shellcheck source=/dev/null
source "$_RULE_DIR/helpers.sh" 2>/dev/null || true

detect() {
  local target_file="$1"
  [[ -r "$target_file" ]] || return 0

  # Only scan marketplace.json files (any depth)
  local basename; basename="$(basename "$target_file")"
  if [[ "$basename" != "marketplace.json" ]]; then
    return 0
  fi

  _emit_finding() {
    local preview="$1"
    local fuid; fuid="$(csa_finding_uid "$RULE_ID" "$target_file" "$preview")"
    jq -nc \
      --arg rule_id "$RULE_ID" \
      --arg file "$target_file" \
      --argjson line 1 \
      --argjson offset 0 \
      --arg preview "$preview" \
      --arg severity "$RULE_SEVERITY" \
      --arg fuid "$fuid" \
      '{rule_id: $rule_id, file: $file, line: $line, offset: $offset, preview: $preview, severity: $severity, finding_uid: $fuid}'
  }

  # Check: JSON parse
  if ! jq empty "$target_file" 2>/dev/null; then
    _emit_finding "marketplace.json: JSON parse failed"
    return 0
  fi

  # Check: .marketplaces array must exist
  local has_marketplaces
  has_marketplaces="$(jq 'has("marketplaces") and (.marketplaces | type == "array")' "$target_file" 2>/dev/null)"
  if [[ "$has_marketplaces" != "true" ]]; then
    _emit_finding "marketplace.json: missing required .marketplaces array"
    return 0
  fi

  # Check: each entry must have name and url
  local bad_entries
  bad_entries="$(jq '[.marketplaces[] | select((has("name") | not) or (has("url") | not))] | length' "$target_file" 2>/dev/null)"
  if [[ -n "$bad_entries" && "$bad_entries" -gt 0 ]]; then
    _emit_finding "marketplace.json: $bad_entries entry/entries missing required 'name' or 'url' field"
    return 0
  fi
}
