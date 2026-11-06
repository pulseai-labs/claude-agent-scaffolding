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

# The alternatives, one array entry each. The two regexes are these arrays joined, and the excerpt's names are
# derived from the same entries (the alternative without its trailing [[:space:]]), so a name cannot be dropped or
# shifted without the alternative it names (#1098).
_RULE_NETWORK_ALTS=('curl' 'wget' 'nc[[:space:]]' 'ssh[[:space:]]' 'scp[[:space:]]' 'rsync')
_RULE_SENSITIVE_ALTS=('~/.ssh' '~/.gnupg' '~/.aws' '/etc/passwd')
RULE_NETWORK_RE="$(IFS='|'; printf '%s' "${_RULE_NETWORK_ALTS[*]}")"
RULE_SENSITIVE_RE="$(IFS='|'; printf '%s' "${_RULE_SENSITIVE_ALTS[*]}")"

# _csa_hook004_excerpt <content> — what the uid hashes (#1098): the names of the alternatives that fire
# ("net=..;path=.."), then every line that holds both a network and a sensitive match, each after a US (0x1f),
# whitespace-squeezed, one pass, sort -u. One test per alternative and no loop over matches (that is quadratic on
# a file of many matches). The grep, sed, sort and awk stages run under LC_ALL=C so the uid does not depend on the
# ambient locale; the name tests do not, because they must agree with detect's own matching.
# Skill-first: the names part is question 2, membrane's own fixed alternatives. The line part reads open text, but
# it can only split a uid relative to the names part (a US byte inside a line is folded to a space first), so what
# it mishandles either reads NEW, an extra stop (a quote change), or adds no line and leaves the uid on the names
# floor (a command split across lines, a path in a variable, a newline in a regex slot). The caller hashes this
# with csa_finding_uid_raw: the plain form would cap it at 200 characters. The lines go only to sha256, never to
# output.
_csa_hook004_excerpt() {
  local c="$1" i a net="" path="" lines
  for i in "${!_RULE_NETWORK_ALTS[@]}"; do
    a="${_RULE_NETWORK_ALTS[$i]}"
    [[ "$c" =~ $a ]] && net+="${net:+,}${a%'[[:space:]]'}"
  done
  for i in "${!_RULE_SENSITIVE_ALTS[@]}"; do
    a="${_RULE_SENSITIVE_ALTS[$i]}"
    [[ "$c" =~ $a ]] && path+="${path:+,}$a"
  done
  lines="$(printf '%s\n' "$c" | { LC_ALL=C grep -aE "$RULE_NETWORK_RE" || true; } | { LC_ALL=C grep -aE "$RULE_SENSITIVE_RE" || true; } \
    | tr '\037' ' ' | LC_ALL=C sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' | LC_ALL=C sort -u | LC_ALL=C awk '{printf "\037%s", $0}')"
  printf 'net=%s;path=%s%s' "$net" "$path" "$lines"
}


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
    # File-level rule: one finding per file. The uid holds the rule, the file and the excerpt from
    # _csa_hook004_excerpt (the names that fire, plus the lines holding both matches), hashed raw so nothing past
    # character 200 is lost (#1098). Skill-first: the names are question 2; the line part reads open text but can
    # only split a uid, so what it mishandles reads NEW or leaves the uid on the names (see the excerpt function).
    local fuid; fuid="$(csa_finding_uid_raw "$RULE_ID" "$target_file" "$(_csa_hook004_excerpt "$content")")"
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
