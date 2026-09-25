#!/usr/bin/env bash
#
# dsh-crew — presets and profile rows
#
# The one shipped preset (presets/crew-spine/agent.cordis.yml + preset.yml) and every
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
NAMES="crew-spine"
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
shopt -s nullglob; shipped=("$PRESETS"/*/); shopt -u nullglob
[ "${#shipped[@]}" -eq 1 ] && [ -d "$PRESETS/crew-spine" ] && pass "crew-spine is the only shipped preset" || fail "crew-spine is the only shipped preset" "${shipped[*]}"

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
  "subagent-model-selection:" "busyEnter: steer" "x-opencode-session" "--trusted-host" \
  "toolName: subagent_reviewer"; do
  grep -qF -- "$needle" "$DOC" && pass "presets.md: $needle" || fail "presets.md: $needle"
done
for needle in "ossify-references" "resume.md" '`/close <spine-id>`' "chat message first" \
  "before any mutation, run the \`dsh-executor\` skill's §2 step 0 checks"; do
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

section "exactly one selectable child row: the implementer"
# Spike 5: with modelSelectionSettings on, the tool stops being a global tool, so any
# toolFilter naming it fails at child start; maxDepth: 1 is the guard dsh enforces instead.
# Spike 7: dsh 0.1.5-rc.3 registers at most one selectable child tool per composition; a
# second selectable row is silently absent from the session. The verifier runs the driver's route.
sel_out="$("$RUBY_BIN" -ryaml -e '
  # Per file: each composition (the preset, the headless profile) must hold the invariant on
  # its own, so one copy cannot satisfy it for the other.
  bad = []
  ARGV.each do |f|
    rows = []
    walk = ->(n) { case n when Array then n.each { |x| walk.(x) }
      when Hash then (c = n["config"]; rows << c if c.is_a?(Hash) && c["toolName"]); n.each_value { |x| walk.(x) } end }
    walk.(YAML.safe_load(File.read(f), aliases: true))
    kids = rows.select { |c| %w[subagent_implementer subagent_verifier].include?(c["toolName"]) }
    label = File.basename(f)
    # Count instances, not names: dsh collides per selectable instance, so two rows with one
    # toolName are two registrations of list_subagent_models.
    sel_all = rows.select { |c| c["modelSelectionSettings"] == true }.map { |c| c["toolName"] }
    sel = sel_all.uniq
    # A profile-level child (the reviewer rows in §8) reaches crew-spine sessions too, so no row
    # but the implementer row may be selectable in any block, crew-spine rows or not.
    (sel - ["subagent_implementer"]).each { |t| bad << "#{label} #{t}: only subagent_implementer may be selectable" }
    next if kids.empty?
    kids.each { |c| bad << "#{label} #{c["toolName"]}: child row without maxDepth 1" if c["maxDepth"] != 1 }
    rows.each do |c|
      named = Array(c.dig("toolFilter", "deny")) + Array(c.dig("toolFilter", "allow"))
      (named & sel).each { |t| bad << "#{label} #{c["toolName"]}: toolFilter names selectable #{t}" }
    end
    bad << "#{label}: selectable rows #{sel_all}, expected exactly [\"subagent_implementer\"]" unless sel_all == ["subagent_implementer"]
  end
  puts(bad.empty? ? "ok" : bad.uniq.join("; "))
' "$PRESETS/crew-spine/agent.cordis.yml" "$tmp"/block-*.yml 2>&1)"
[ "$sel_out" = "ok" ] && pass "only subagent_implementer is selectable; both child rows maxDepth 1; no toolFilter names a selectable tool" || fail "only subagent_implementer is selectable; both child rows maxDepth 1; no toolFilter names a selectable tool" "$sel_out"

section "the headless profile's child rows are crew-spine's"
rows_out="$("$RUBY_BIN" -ryaml -e '
  pick = ->(f) { r = {}; walk = ->(n) { case n when Array then n.each { |x| walk.(x) }
    when Hash then (c = n["config"]; r[c["toolName"]] = c.reject { |k, _| k == "persona" } if c.is_a?(Hash) && %w[subagent_implementer subagent_verifier].include?(c["toolName"])); n.each_value { |x| walk.(x) } end }
    walk.(YAML.safe_load(File.read(f), aliases: true)); r }
  want = pick.(ARGV[0]); got = {}
  ARGV[1..].each { |f| got.merge!(pick.(f)) }
  puts(want == got && want.size == 2 ? "ok" : "drift preset=#{want} headless=#{got}")
' "$PRESETS/crew-spine/agent.cordis.yml" "$tmp"/block-*.yml 2>&1)"
[ "$rows_out" = "ok" ] && pass "headless child rows equal crew-spine's (persona compared above)" || fail "headless child rows equal crew-spine's" "$rows_out"

section "the example roles.md: implementer allow-listed with an offered effort; verifier is driver"
# The example project file (a ```markdown fence opening '## Roles') has one row per role. The
# implementer's route must be allow-listed in the example settings.yaml, and its effort must be
# among that model's reasoningEfforts. The verifier must be `driver (driver)`, because its tool
# is not selectable. The reviewer names a tool kind.
awk '/^```markdown$/{f=1; buf=""; next} f && /^```$/{f=0; if (buf ~ /^## Roles/) print buf; next} f{buf = buf $0 "\n"}' "$DOC" > "$tmp/roles.md"
roles_out="$("$RUBY_BIN" -ryaml -e '
  rows = File.read(ARGV[0]).lines.map(&:strip).select { |l| l.start_with?("|") && !l.start_with?("|---") }.drop(1)
    .map { |l| l.split("|").map(&:strip).reject(&:empty?) }
  allowed = []; efforts = {}
  ARGV[1..].each do |f|
    y = YAML.safe_load(File.read(f), aliases: true)
    next unless y.is_a?(Hash)
    allowed.concat(Array(y.dig("subagent-model-selection", "allowedModels")))
    (y.dig("llm-pi-ai", "providers") || {}).each do |p, v|
      Array(v["models"]).each { |m| efforts["#{p}/#{m["id"]}"] = m["reasoningEfforts"].keys if m["reasoningEfforts"].is_a?(Hash) }
    end
  end
  allowed = allowed.map { |a| "#{a["provider"]}/#{a["model"]}" }
  bad = []
  roles = rows.map(&:first)
  bad << "roles #{roles}" unless roles.sort == %w[implementer reviewer verifier]
  rows.each do |role, route, effort|
    case role
    when "reviewer" then bad << "reviewer #{route}" unless %w[claude-code codex driver].include?(route)
    when "verifier" then bad << "verifier #{route} #{effort}: must be driver (driver)" unless route == "driver" && effort == "(driver)"
    else
      bad << "#{role} #{route} not allow-listed" unless allowed.include?(route)
      bad << "#{role} effort #{effort} not among #{route} reasoningEfforts #{efforts[route].inspect}" unless Array(efforts[route]).include?(effort)
    end
  end
  puts(bad.empty? ? "ok" : bad.join("; "))
' "$tmp/roles.md" "$tmp"/block-*.yml 2>&1)"
[ "$roles_out" = "ok" ] && pass "example roles.md: one row per role; implementer allow-listed with an offered effort; verifier is driver" || fail "example roles.md: one row per role; implementer allow-listed with an offered effort; verifier is driver" "$roles_out"

report
