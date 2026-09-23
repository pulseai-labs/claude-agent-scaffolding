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

section "child personas equal dsh-brief §5"
# Every `persona` configured on a subagent_implementer / subagent_verifier row in these
# blocks must be, whitespace-normalised, the §5 text for that tool in dsh-brief — the
# presets are copied onto machines, so a drifted copy is a child running another brief.
BRIEF="$PLUGIN_ROOT/skills/dsh-brief/SKILL.md"
awk '/^## 5\./{f=1} f && /^```text/{g=1; n++; next} g && /^```/{g=0; next} g{print > (dir "/persona-" n ".txt")}' dir="$tmp" "$BRIEF"
[ -f "$tmp/persona-1.txt" ] && [ -f "$tmp/persona-2.txt" ] && pass "dsh-brief §5 carries two persona blocks" || fail "dsh-brief §5 carries two persona blocks"
persona_out="$("$RUBY_BIN" -ryaml -e '
  norm = ->(s) { s.to_s.split.join(" ") }
  want = { "subagent_implementer" => norm.(File.read(ARGV[0])), "subagent_verifier" => norm.(File.read(ARGV[1])) }
  seen = Hash.new(0); bad = []
  walk = ->(n) {
    case n
    when Array then n.each { |x| walk.(x) }
    when Hash
      c = n["config"]
      if c.is_a?(Hash) && want.key?(c["toolName"]) && c.key?("persona")
        seen[c["toolName"]] += 1
        bad << c["toolName"] unless norm.(c["persona"]) == want[c["toolName"]]
      end
      n.each_value { |x| walk.(x) }
    end
  }
  ARGV[2..].each { |f| walk.(YAML.safe_load(File.read(f), aliases: true)) }
  puts "seen #{want.keys.map { |k| "#{k}=#{seen[k]}" }.join(" ")}"
  puts(bad.empty? ? "ok" : "drift #{bad.uniq.join(" ")}")
' "$tmp/persona-1.txt" "$tmp/persona-2.txt" "$tmp"/block-*.yml 2>&1)"
case "$persona_out" in
  *"subagent_implementer=0"*|*"subagent_verifier=0"*) fail "each child tool's persona appears in the blocks" "$persona_out" ;;
  *) pass "each child tool's persona appears in the blocks" ;;
esac
case "$persona_out" in
  *$'\n'ok) pass "every child persona equals dsh-brief §5" ;;
  *) fail "every child persona equals dsh-brief §5" "$persona_out" ;;
esac

report
