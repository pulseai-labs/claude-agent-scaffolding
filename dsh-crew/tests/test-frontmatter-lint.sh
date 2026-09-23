#!/usr/bin/env bash
#
# dsh-crew — frontmatter lint
#
# Every skill: SKILL.md starts with `---`, carries `name:` equal to its
# directory, a SINGLE-LINE `description:` of at most 1024 bytes (Claude Code's
# cap), a body of at most 500 lines (ossify budget check 6), and an
# agents/openai.yaml with interface.display_name and short_description (Codex).
#
# The description is required to be one line so this lint needs no YAML
# parser: orca-crew's Psych-based lint exists because folded scalars and
# nested keys defeated hand parsers; this plugin forbids those shapes instead.
#
# Usage: bash dsh-crew/tests/test-frontmatter-lint.sh   Exit 0 when clean.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

DESC_LIMIT=1024
BODY_LIMIT=500

section "skills"
shopt -s nullglob
skills=("$PLUGIN_ROOT"/skills/*/SKILL.md)
shopt -u nullglob
if [ "${#skills[@]}" -eq 0 ]; then fail "at least one skills/*/SKILL.md exists"; report; exit 1; fi

for f in "${skills[@]}"; do
  dir="$(basename "$(dirname "$f")")"
  [ "$(sed -n '1p' "$f")" = "---" ] && pass "$dir: starts with ---" || fail "$dir: starts with ---"
  close="$(awk 'NR>1 && $0=="---"{print NR; exit}' "$f")"
  [ -n "$close" ] && pass "$dir: frontmatter closes" || { fail "$dir: frontmatter closes"; continue; }
  name="$(awk -v c="$close" 'NR>1 && NR<c && $1=="name:"{print $2}' "$f")"
  [ "$name" = "$dir" ] && pass "$dir: name matches directory" || fail "$dir: name matches directory" "name=$name"
  desc_lines="$(awk -v c="$close" 'NR>1 && NR<c && $1=="description:"{n++} END{print n+0}' "$f")"
  [ "$desc_lines" -eq 1 ] && pass "$dir: exactly one description line" || fail "$dir: exactly one description line" "found $desc_lines"
  desc="$(awk -v c="$close" 'NR>1 && NR<c && $1=="description:"{sub(/^description:[ ]*/,""); print; exit}' "$f")"
  bytes="$(printf '%s' "$desc" | wc -c)"
  [ "$bytes" -le "$DESC_LIMIT" ] && pass "$dir: description ≤ $DESC_LIMIT bytes ($bytes)" || fail "$dir: description ≤ $DESC_LIMIT bytes" "$bytes"
  case "$desc" in '>'*|'|'*) fail "$dir: description is not a folded/literal scalar";; *) pass "$dir: description is a plain scalar";; esac
  body="$(($(wc -l < "$f") - close))"
  [ "$body" -le "$BODY_LIMIT" ] && pass "$dir: body ≤ $BODY_LIMIT lines ($body)" || fail "$dir: body ≤ $BODY_LIMIT lines" "$body"
  y="$(dirname "$f")/agents/openai.yaml"
  if [ -f "$y" ] && grep -q '^  display_name:' "$y" && grep -q '^  short_description:' "$y"; then
    pass "$dir: agents/openai.yaml has display_name and short_description"
  else
    fail "$dir: agents/openai.yaml has display_name and short_description"
  fi
done

report
