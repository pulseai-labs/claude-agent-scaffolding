#!/usr/bin/env bash
RULE_ID="CLAUDE-MD-002"
RULE_NAME="internal-markers"
RULE_ASPECT="claude-md"
RULE_SEVERITY="medium"
RULE_DESCRIPTION="INTERNAL, CONFIDENTIAL, or PII marker detected in CLAUDE.md — may expose sensitive internal context to the model."
RULE_AUTO_FIXABLE="false"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Remove or redact the internal/confidential content from CLAUDE.md. Move sensitive context to a separate file excluded from version control, or use environment variables."
RULE_REFERENCES=""

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
  # Only scan CLAUDE.md files (any depth)
  local basename; basename="$(basename "$target_file")"
  if [[ "$basename" != "CLAUDE.md" ]]; then
    return 0
  fi
  grep -nE 'INTERNAL[: ]|CONFIDENTIAL[: ]|// PII|/\* PII|PII:' "$target_file" 2>/dev/null \
    | while IFS=: read -r line_no match; do
        local preview; preview="$(csa_redact "$match")"
        local fuid; fuid="$(csa_finding_uid "$RULE_ID" "$target_file" "$match")"
        jq -nc \
          --arg rule_id "$RULE_ID" \
          --arg file "$target_file" \
          --argjson line "$line_no" \
          --argjson offset 0 \
          --arg preview "$preview" \
          --arg severity "$RULE_SEVERITY" \
          --arg fuid "$fuid" \
          '{rule_id: $rule_id, file: $file, line: $line, offset: $offset, preview: $preview, severity: $severity, finding_uid: $fuid}'
      done
}
