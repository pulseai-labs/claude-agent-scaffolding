#!/usr/bin/env bash
RULE_ID="HOOK-004"
RULE_NAME="network-exfiltration"
RULE_ASPECT="hooks"
RULE_SEVERITY="high"
RULE_DESCRIPTION="Hook script combines a network-call command with a sensitive credential/config path — potential data exfiltration."
RULE_AUTO_FIXABLE="false"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Review the hook for unintended data exfiltration. Ensure network calls do not reference SSH keys, AWS credentials, or system password files."
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
  # Only scan known hook handler and wrapper script surfaces.
  if [[ "$target_file" != */.claude/hooks* && "$target_file" != *.sh \
        && "$target_file" != */.opencode/bin/* ]]; then
    return 0
  fi
  # Fire only when BOTH a network command AND a sensitive path reference are present
  local content; content="$(cat "$target_file" 2>/dev/null)"
  local network_re='curl|wget|nc[[:space:]]|ssh[[:space:]]|scp[[:space:]]|rsync'
  local sensitive_re='~/.ssh|~/.gnupg|~/.aws|/etc/passwd'
  if [[ "$content" =~ $network_re ]] && [[ "$content" =~ $sensitive_re ]]; then
    # Emit a finding at line 1 (file-level rule)
    local fuid; fuid="$(csa_finding_uid "$RULE_ID" "$target_file" "$content")"
    jq -nc \
      --arg rule_id "$RULE_ID" \
      --arg file "$target_file" \
      --argjson line 1 \
      --argjson offset 0 \
      --arg preview "network command + sensitive path reference detected" \
      --arg severity "$RULE_SEVERITY" \
      --arg fuid "$fuid" \
      '{rule_id: $rule_id, file: $file, line: $line, offset: $offset, preview: $preview, severity: $severity, finding_uid: $fuid}'
  fi
}
