#!/usr/bin/env bash
RULE_ID="MCP-003"
RULE_NAME="env-var-leak"
RULE_ASPECT="mcp"
RULE_SEVERITY="medium"
RULE_DESCRIPTION="Literal secret-shaped string detected in MCP server args or env block."
RULE_AUTO_FIXABLE="false"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Replace the literal secret with an environment variable reference (e.g. \${MY_TOKEN}). Store actual secrets in a secret manager or .env file excluded from version control."
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
  local basename; basename="$(basename "$target_file")"
  if [[ "$basename" != ".mcp.json" && "$basename" != "mcp.json" ]]; then
    return 0
  fi

  # Extract all string values from args[] and env{} blocks across all mcpServers
  local values; values="$(jq -r '
    .mcpServers // {} | to_entries[] |
    .value |
    ((.args // [])[], (.env // {} | to_entries[] | .value))
  ' "$target_file" 2>/dev/null)"

  [[ -n "$values" ]] || return 0

  local secret_re='sk-[A-Za-z0-9_-]{20,}|gh[psorau]_[A-Za-z0-9]{36,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/=]{40,}'
  while IFS= read -r val; do
    [[ -n "$val" ]] || continue
    # Match secret-shaped patterns: sk- prefix, ghp_, eyJ (JWT), AKIA, or 40+ char alnum/+/= blob
    if [[ "$val" =~ $secret_re ]]; then
      local preview; preview="$(csa_redact "$val")"
      local fuid; fuid="$(csa_finding_uid "$RULE_ID" "$target_file" "$val")"
      jq -nc \
        --arg rule_id "$RULE_ID" \
        --arg file "$target_file" \
        --argjson line 1 \
        --argjson offset 0 \
        --arg preview "$preview" \
        --arg severity "$RULE_SEVERITY" \
        --arg fuid "$fuid" \
        '{rule_id: $rule_id, file: $file, line: $line, offset: $offset, preview: $preview, severity: $severity, finding_uid: $fuid}'
    fi
  done <<< "$values"
}
