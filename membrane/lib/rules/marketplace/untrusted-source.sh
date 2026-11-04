#!/usr/bin/env bash
RULE_ID="MARKETPLACE-001"
RULE_NAME="untrusted-source"
RULE_ASPECT="marketplace"
RULE_SEVERITY="high"
RULE_DESCRIPTION="Marketplace entry URL uses non-HTTPS scheme — traffic unencrypted and plugins could be tampered in transit."
RULE_AUTO_FIXABLE="false"
RULE_MECHANICALLY_FIXABLE="false"
RULE_REMEDIATION="Change the marketplace URL to use https://. Remove any marketplace entries using http:// or non-standard URL schemes."
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

  # Use jq to extract each marketplace entry's url; flag any that is not https://
  jq -r '.marketplaces[]? | .url // empty' "$target_file" 2>/dev/null \
    | while IFS= read -r url; do
        # Flag if URL does not start with https://
        if [[ "$url" != https://* ]]; then
          local fuid; fuid="$(csa_finding_uid "$RULE_ID" "$target_file" "$url")"
          jq -nc \
            --arg rule_id "$RULE_ID" \
            --arg file "$target_file" \
            --argjson line 1 \
            --argjson offset 0 \
            --arg preview "non-HTTPS marketplace URL: $url" \
            --arg severity "$RULE_SEVERITY" \
            --arg fuid "$fuid" \
            '{rule_id: $rule_id, file: $file, line: $line, offset: $offset, preview: $preview, severity: $severity, finding_uid: $fuid}'
        fi
      done
}
