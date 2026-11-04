#!/usr/bin/env bash
RULE_ID="MCP-001"
RULE_NAME="untrusted-endpoint"
RULE_ASPECT="mcp"
RULE_SEVERITY="high"
RULE_DESCRIPTION="MCP server configured with a non-HTTPS (http://) endpoint — traffic unencrypted and vulnerable to MITM."
RULE_AUTO_FIXABLE="false"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Change the MCP server URL to use https://. Contact the server operator if an HTTPS endpoint is unavailable."
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
  # Only scan .mcp.json or mcp.json under .claude/
  local basename; basename="$(basename "$target_file")"
  if [[ "$basename" != ".mcp.json" && "$basename" != "mcp.json" ]]; then
    return 0
  fi
  # Flag any "url" value that starts with http:// (not https://)
  grep -nE '"url"[[:space:]]*:[[:space:]]*"http://' "$target_file" 2>/dev/null \
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
