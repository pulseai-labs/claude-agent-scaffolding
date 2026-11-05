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
# shellcheck source=/dev/null
source "$_RULE_DIR/hook-entries.sh" 2>/dev/null || true

RULE_NETWORK_RE='curl|wget|nc[[:space:]]|ssh[[:space:]]|scp[[:space:]]|rsync'
RULE_SENSITIVE_RE='~/.ssh|~/.gnupg|~/.aws|/etc/passwd'


detect() {
  local target_file="$1"
  [[ -r "$target_file" ]] || return 0
  # Only scan known hook handler and wrapper script surfaces.
  if [[ "$target_file" != */.claude/hooks* && "$target_file" != *.sh \
        && "$target_file" != */.opencode/bin/* && "$target_file" != */.opencode/*.js \
        && "$target_file" != */.opencode/*.ts && "$target_file" != */.opencode/*.mjs ]]; then
    return 0
  fi
  # Fire only when BOTH a network command AND a sensitive path reference are present
  # A read error is rc 2 (SCANNER-002), not an empty file or a clean prefix. Content read before the
  # error is matched, and a match is emitted, never traded for the stop; no match in what was read
  # says nothing about the rest, so that is rc 2 (#1089). Skill-first question 3: only adds a stop.
  local content crc=0; content="$(cat "$target_file" 2>/dev/null)" || crc=$?
  if [[ "$crc" -ne 0 ]] && ! { [[ "$content" =~ $RULE_NETWORK_RE ]] && [[ "$content" =~ $RULE_SENSITIVE_RE ]]; }; then
    return 2
  fi
  if [[ "$content" =~ $RULE_NETWORK_RE ]] && [[ "$content" =~ $RULE_SENSITIVE_RE ]]; then
    # Emit a finding at line 1 (file-level rule)
    # File-level rule: the excerpt is the whole file, and the uid holds the rule and the file, so there is one
    # finding per file. It keeps csa_finding_uid (an edit past character 200 keeps the uid, and so keeps a
    # suppression: C11's harm, as in 0.4.2; #1098); the raw form would hash the whole script and move it on every edit.
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

# detect_text <entry-json> <file> — one decoded hook command: both regexes must
# match the whole command. Skill-first question 3 (can only add a stop).
detect_text() {
  local entry="$1" target_file="$2" text
  text="$(csa_hook_entry_command "$entry")" || return $?
  [[ "$text" =~ $RULE_NETWORK_RE ]] && [[ "$text" =~ $RULE_SENSITIVE_RE ]] || return 1
  csa_hook_entry_emit "$RULE_ID" "$RULE_SEVERITY" "$entry" "$target_file"
}
