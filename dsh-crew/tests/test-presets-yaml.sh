#!/usr/bin/env bash
#
# dsh-crew — presets and profile rows
#
# The three shipped presets (presets/<name>/agent.cordis.yml + preset.yml) and every
# fenced yaml block in references/presets.md parse under Psych (the parser the house
# uses because it is what actually loads YAML elsewhere; it reads a `!!js` scalar as its
# source string). Then the facts a copied file must not drift from: the child personas
# equal dsh-brief §5, the headless profile's spine persona equals the crew-spine
# preset's, the skills root carries no machine path, and every allow-listed child route
# is a route settings.yaml defines (a profile boots NO_ADAPTER otherwise).
#
# Usage: bash dsh-crew/tests/test-presets-yaml.sh   Exit 0 when clean.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"
require_ruby_psych || { report; exit 1; }

DOC="$PLUGIN_ROOT/references/presets.md"
PRESETS="$PLUGIN_ROOT/presets"
BRIEF="$PLUGIN_ROOT/skills/dsh-brief/SKILL.md"
NAMES="crew-spine crew-implementer crew-verifier"
[ -f "$DOC" ] && pass "references/presets.md exists" || { fail "references/presets.md exists"; report; exit 1; }

parses() { "$RUBY_BIN" -ryaml -e 'YAML.safe_load(File.read(ARGV[0]), aliases: true)' "$1" 2>/dev/null; }

section "preset files exist and parse"
for n in $NAMES; do
  for f in agent.cordis.yml preset.yml; do
    p="$PRESETS/$n/$f"
    if [ -f "$p" ] && parses "$p"; then pass "$n/$f parses"; else fail "$n/$f exists and parses"; fi
  done
  out="$("$RUBY_BIN" -ryaml -e 'y = YAML.safe_load(File.read(ARGV[0])); puts((y.is_a?(Hash) && y["name"].is_a?(String) && y["description"].is_a?(String)) ? "ok" : "bad")' "$PRESETS/$n/preset.yml" 2>&1)"
  [ "$out" = "ok" ] && pass "$n/preset.yml has name and description" || fail "$n/preset.yml has name and description" "$out"
done

section "presets.md yaml blocks parse"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
awk -v dir="$tmp" '/^```yaml/{f=1; n++; next} /^```/{f=0; next} f{print > (dir "/block-" n ".yml")}' "$DOC"
count="$(find "$tmp" -name 'block-*.yml' | wc -l | tr -d ' ')"
[ "$count" -ge 4 ] && pass "at least four yaml blocks ($count)" || fail "at least four yaml blocks" "$count"
for b in "$tmp"/block-*.yml; do
  parses "$b" && pass "$(basename "$b") parses" || fail "$(basename "$b") parses"
done

section "the skills root carries no machine path"
# The presets resolve it from HOME, so a copied file works for any user. The expression
# was measured in a live preset: `!!js` is evaluated there and a plain string is not.
want_root='`${process.env.HOME}/.local/share/dsh-crew/skills`'
for f in "$PRESETS"/*/agent.cordis.yml "$tmp"/block-*.yml; do
  roots="$("$RUBY_BIN" -ryaml -e '
    r = []
    walk = ->(n) { case n when Array then n.each { |x| walk.(x) }
      when Hash then (c = n["config"]; r.concat(Array(c["customSkillDirs"])) if c.is_a?(Hash) && c.key?("customSkillDirs")); n.each_value { |x| walk.(x) } end }
    walk.(YAML.safe_load(File.read(ARGV[0]), aliases: true)); puts r' "$f")"
  [ -n "$roots" ] || continue
  label="${f#"$PLUGIN_ROOT"/}"; case "$f" in "$tmp"/*) label="presets.md $(basename "$f")";; esac
  [ "$roots" = "$want_root" ] && pass "$label: skills root is the HOME expression" || fail "$label: skills root is the HOME expression" "$roots"
  grep -qF '!!js "`${process.env.HOME}' "$f" && pass "$label: the root is a !!js tag" || fail "$label: the root is a !!js tag"
done

section "content"
for needle in "toolName: subagent_implementer" "toolName: subagent_verifier" \
  "@deepseek-ai/dsh-persona" "@deepseek-ai/dsh-tool-skill" "customSkillDirs"; do
  grep -qF -- "$needle" "$PRESETS/crew-spine/agent.cordis.yml" && pass "crew-spine: $needle" || fail "crew-spine: $needle"
done
for needle in "defaultPreset: danger-full-access" "api: anthropic-messages" "deepseek-v4.1-flash:cloud" \
  "subagent-model-selection:" "busyEnter: steer" "x-opencode-session" "--trusted-host"; do
  grep -qF -- "$needle" "$DOC" && pass "presets.md: $needle" || fail "presets.md: $needle"
done
for needle in "ossify-references" "resume.md" '`/close <spine-id>`' "chat message first"; do
  grep -qF -- "$needle" "$PRESETS/crew-spine/agent.cordis.yml" && pass "crew-spine persona: $needle" || fail "crew-spine persona: $needle"
done

section "child personas equal dsh-brief §5"
# Every `persona` configured on a subagent_implementer / subagent_verifier row, in the
# preset files and in presets.md's blocks, must be the §5 text for that tool in
# dsh-brief, whitespace-normalised. A drifted copy is a child running another brief.
awk '/^## 5\./{f=1} f && /^```text/{g=1; n++; next} g && /^```/{g=0; next} g{print > (dir "/persona-" n ".txt")}' dir="$tmp" "$BRIEF"
[ -f "$tmp/persona-1.txt" ] && [ -f "$tmp/persona-2.txt" ] && pass "dsh-brief §5 carries two persona blocks" || fail "dsh-brief §5 carries two persona blocks"
persona_out="$("$RUBY_BIN" -ryaml -e '
  norm = ->(s) { s.to_s.split.join(" ") }
  want = { "subagent_implementer" => norm.(File.read(ARGV[0])), "subagent_verifier" => norm.(File.read(ARGV[1])) }
  seen = Hash.new(0); bad = []
  walk = ->(n, f) {
    case n
    when Array then n.each { |x| walk.(x, f) }
    when Hash
      c = n["config"]
      if c.is_a?(Hash) && want.key?(c["toolName"]) && c.key?("persona")
        seen[c["toolName"]] += 1
        bad << "#{File.basename(File.dirname(f))}/#{File.basename(f)}:#{c["toolName"]}" unless norm.(c["persona"]) == want[c["toolName"]]
      end
      n.each_value { |x| walk.(x, f) }
    end
  }
  ARGV[2..].each { |f| walk.(YAML.safe_load(File.read(f), aliases: true), f) }
  puts(want.keys.all? { |k| seen[k] >= 2 } ? "seen ok" : "seen #{want.keys.map { |k| "#{k}=#{seen[k]}" }.join(" ")}")
  puts(bad.empty? ? "ok" : "drift #{bad.join(" ")}")
' "$tmp/persona-1.txt" "$tmp/persona-2.txt" "$PRESETS/crew-spine/agent.cordis.yml" "$tmp"/block-*.yml 2>&1)"
case "$persona_out" in
  "seen ok"$'\n'*) pass "each child persona appears in the preset and the headless profile" ;;
  *) fail "each child persona appears in the preset and the headless profile" "$persona_out" ;;
esac
case "$persona_out" in
  *$'\n'ok) pass "every child persona equals dsh-brief §5" ;;
  *) fail "every child persona equals dsh-brief §5" "$persona_out" ;;
esac

section "the headless profile's spine persona is crew-spine's"
spine_out="$("$RUBY_BIN" -ryaml -e '
  norm = ->(s) { s.to_s.split.join(" ") }
  preset = YAML.safe_load(File.read(ARGV[0]), aliases: true).find { |r| r["id"] == "persona" }
  want = norm.(preset && preset.dig("config", "prefix"))
  found = []
  ARGV[1..].each do |f|
    y = YAML.safe_load(File.read(f), aliases: true)
    next unless y.is_a?(Array)
    y.each { |r| found << norm.(r.dig("config", "personaPrefix")) if r.is_a?(Hash) && r["id"] == "system-prompt" && r.dig("config", "personaPrefix") }
  end
  if want.empty? then puts "no crew-spine prefix"
  elsif found.empty? then puts "no headless personaPrefix"
  elsif found.all? { |x| x == want } then puts "ok"
  else puts "drift" end
' "$PRESETS/crew-spine/agent.cordis.yml" "$tmp"/block-*.yml 2>&1)"
[ "$spine_out" = "ok" ] && pass "personaPrefix equals the crew-spine prefix" || fail "personaPrefix equals the crew-spine prefix" "$spine_out"

section "settings.yaml: every allow-listed route is defined"
routes_out="$("$RUBY_BIN" -ryaml -e '
  ARGV.each do |f|
    y = YAML.safe_load(File.read(f), aliases: true)
    next unless y.is_a?(Hash) && y["subagent-model-selection"]
    prov = y.dig("llm-pi-ai", "providers") || {}
    allowed = y.dig("subagent-model-selection", "allowedModels") || []
    puts "allowed=#{allowed.size}"
    allowed.each do |a|
      ids = Array(prov.dig(a["provider"], "models")).map { |m| m["id"] }
      puts "undefined #{a["provider"]}/#{a["model"]}" unless ids.include?(a["model"])
    end
    prov.each { |k, v| puts "no reasoning max: #{k}" unless v["reasoning"] == "max" }
    d = y["agent-default-model"] || {}
    puts "default undefined" unless Array(prov.dig(d["provider"], "models")).map { |m| m["id"] }.include?(d["model"])
  end' "$tmp"/block-*.yml 2>&1)"
case "$routes_out" in
  allowed=0|"") fail "a settings.yaml block with an allow-list" "$routes_out" ;;
  allowed=*[!0-9]*) fail "every allow-listed route, the default, and reasoning: max" "$routes_out" ;;
  allowed=*) pass "every allow-listed route and the default model are defined; every route sets reasoning: max" ;;
esac

report
