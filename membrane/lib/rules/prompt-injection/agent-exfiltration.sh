#!/usr/bin/env bash
RULE_ID="PROMPT-INJ-001"
RULE_NAME="agent-exfiltration"
RULE_ASPECT="prompt-injection"
RULE_SEVERITY="critical"
RULE_DESCRIPTION="Agent or command prompt contains exfiltration phrasing — likely attacker-injected instruction to leak credentials or SSH keys."
RULE_AUTO_FIXABLE="false"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Remove the attacker-controlled phrasing. If the agent prompt came from an untrusted source (marketplace, user input), rotate any credentials accessible to the agent and audit its run history."
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

  # Only scan agent/command markdown files under .claude/agents/ or .claude/commands/
  if [[ "$target_file" != */.claude/agents/*.md && "$target_file" != */.claude/commands/*.md ]]; then
    return 0
  fi

  grep -niE \
    'read[[:space:]]+.*~/\.ssh|cat[[:space:]]+.*~/\.ssh|(POST|send|exfil).*attacker|curl[[:space:]]+.*(http|https)://.*~/\.' \
    "$target_file" 2>/dev/null \
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
