#!/usr/bin/env bash
RULE_ID="PERM-005"
RULE_NAME="settings-schema-validation"
RULE_ASPECT="permissions"
RULE_SEVERITY="high"
RULE_DESCRIPTION="Unknown top-level key in settings file — likely a typo that silently disables the intended config."
RULE_AUTO_FIXABLE="true"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Correct the key name to one of the known Claude Code settings keys. Unknown keys are silently ignored by Claude Code."
RULE_REFERENCES=""

if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  _RULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  _KNOWN_KEYS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_known-keys.txt"
else
  _RULE_DIR="${CSA_LIB_DIR:-}"
  _KNOWN_KEYS_FILE="${CSA_RULES_DIR:-$_RULE_DIR/rules}/permissions/_known-keys.txt"
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
  local bn; bn="$(basename "$target_file")"
  case "$bn" in
    settings*.json) ;;
    *) return 0 ;;
  esac

  # Not JSON is rc 2 (SCANNER-002), not a clean read (#1089). Skill-first question 3: only adds a stop.
  jq empty "$target_file" 2>/dev/null || return 2

  # A top level that has no keys (a number, a string, a boolean) is rc 2 too, not a clean read (#1089).
  local keys; keys="$(jq -r 'keys[]' "$target_file" 2>/dev/null)" || return 2
  [[ -n "$keys" ]] || return 0
  printf '%s\n' "$keys" \
    | while read -r key; do
        # Check if key is in known-keys allowlist
        if ! grep -qxF "$key" "$_KNOWN_KEYS_FILE" 2>/dev/null; then
          local fuid; fuid="$(csa_finding_uid_raw "$RULE_ID" "$target_file" "$key")"
          jq -nc \
            --arg rule_id "$RULE_ID" \
            --arg file "$target_file" \
            --argjson line 1 \
            --argjson offset 0 \
            --arg preview "unknown top-level key: '$key'" \
            --arg severity "$RULE_SEVERITY" \
            --arg fuid "$fuid" \
            '{rule_id: $rule_id, file: $file, line: $line, offset: $offset, preview: $preview, severity: $severity, finding_uid: $fuid}'
        fi
      done
}
