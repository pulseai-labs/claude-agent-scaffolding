#!/usr/bin/env bash
RULE_ID="HOOK-006"
RULE_NAME="hook-type-not-inspected"
RULE_ASPECT="hooks"
RULE_SEVERITY="info"
RULE_DESCRIPTION="A JSON file declares hooks of a type the audit counts but does not inspect (http, prompt, agent, mcp_tool or a type added later)."
RULE_AUTO_FIXABLE="false"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Read these hooks by hand. Only command hooks are checked against the HOOK patterns."
RULE_REFERENCES=""
# detect_text receives ALL of a file's entries at once (one JSON line each):
# one finding per file, not one per entry.
RULE_TEXT_SCOPE="file"

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

# detect never matches: this rule reads hook entries only, through detect_text.
detect() { return 1; }

# detect_text <entries-jsonl> <file> — one Info finding per file with per-type
# counts. Skill-first question 3: a mechanical report that can only add a stop.
detect_text() {
  local entries="$1" target_file="$2" counts preview fuid
  counts="$(printf '%s\n' "$entries" | jq -rs '
    [.[] | select(has("inconclusive") | not) | select(.type != "command") | .type]
    | group_by(.) | map("\(.[0])=\(length)") | join(", ")' 2>/dev/null)"
  [[ -n "$counts" ]] || return 1
  preview="$(csa_redact "hook entries not inspected: $counts")"
  fuid="$(csa_finding_uid "$RULE_ID" "$target_file" "$counts")"
  jq -nc --arg rule_id "$RULE_ID" --arg file "$target_file" --arg preview "$preview" \
    --arg severity "$RULE_SEVERITY" --arg fuid "$fuid" --arg counts "$counts" \
    '{rule_id: $rule_id, file: $file, line: 0, offset: 0, preview: $preview, severity: $severity, finding_uid: $fuid, context: {types: $counts}}'
}
