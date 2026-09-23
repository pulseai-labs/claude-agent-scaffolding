#!/usr/bin/env bash
#
# dsh-crew — presets reference YAML
#
# Every fenced yaml block in references/presets.md parses under Psych (the parser
# the house uses because it is what actually loads YAML elsewhere), and the
# blocks name the three presets and the two configured child tools.
#
# Usage: bash dsh-crew/tests/test-presets-yaml.sh   Exit 0 when clean.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"
require_ruby_psych || { report; exit 1; }

DOC="$PLUGIN_ROOT/references/presets.md"
[ -f "$DOC" ] && pass "references/presets.md exists" || { fail "references/presets.md exists"; report; exit 1; }

section "yaml blocks parse"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
awk -v dir="$tmp" '/^```yaml/{f=1; n++; next} /^```/{f=0; next} f{print > (dir "/block-" n ".yml")}' "$DOC"
count="$(ls "$tmp" | wc -l)"
[ "$count" -ge 4 ] && pass "at least four yaml blocks ($count)" || fail "at least four yaml blocks" "$count"
for b in "$tmp"/block-*.yml; do
  if "$RUBY_BIN" -ryaml -e 'YAML.safe_load(File.read(ARGV[0]), aliases: true)' "$b" 2>/dev/null; then
    pass "$(basename "$b") parses"
  else
    # !!js tags are Cordis-only; strip them and retry so the check is about shape
    if sed 's/!!js .*/false/' "$b" | "$RUBY_BIN" -ryaml -e 'YAML.safe_load(STDIN.read, aliases: true)' 2>/dev/null; then
      pass "$(basename "$b") parses (js tags stripped)"
    else
      fail "$(basename "$b") parses"
    fi
  fi
done

section "content"
for needle in "crew-spine" "crew-implementer" "crew-verifier" \
  "toolName: subagent_implementer" "toolName: subagent_verifier" \
  "@deepseek-ai/dsh-persona" "@deepseek-ai/dsh-tool-skill" "customSkillDirs" \
  "defaultPreset: danger-full-access" "api: anthropic-messages" "deepseek-v4.1-flash:cloud"; do
  grep -qF -- "$needle" "$DOC" && pass "$needle" || fail "$needle"
done

report
