#!/usr/bin/env bash
#
# orca-crew — invocation and frontmatter lint
#
# Every skill declares its invocation posture on three surfaces, and this
# asserts they agree. Posture is DERIVED from the description users read; the
# other two are restatements of it, and each is checked in BOTH directions,
# because a one-directional check passes just as happily when everything is
# human-only as when the split is right.
#
#   skills/<n>/SKILL.md            name, description, disable-model-invocation
#   commands/<n>.md                the surface a user types; same flag
#   skills/<n>/agents/openai.yaml  Codex, which never reads the flag above
#
# WHY THIS PARSES YAML INSTEAD OF SCANNING IT. Earlier versions extracted
# frontmatter with awk and read values by splitting on the first colon. That
# hand-rolled parser produced findings in three consecutive review rounds —
# indentation-blindness, folded scalars measured as empty, continuation lines,
# unanchored extraction, a missing exists-guard — and each fix revealed the
# next hole, which is what a partial reimplementation of a real grammar does.
# It is replaced by Ruby + Psych: the parser tests/test-codex-dual-publish.sh
# already uses, and the parser Codex's own loader uses. A check that reads YAML
# some other way is not checking what will actually load the file. The whole
# class — anchoring, folding, nesting, colon-splitting — is gone by
# construction rather than patched one hole at a time.
#
# THE FILE SET IS DERIVED, NOT LISTED. Skills and commands are globbed
# independently and the union is walked, so a skill with no command, or a
# command with no skill, surfaces as a missing counterpart instead of as a file
# nobody thought to look at.
#
# Usage:   bash orca-crew/tests/test-frontmatter-lint.sh
# Exit:    0 if every surface agrees; 1 otherwise.
# Deps:    bash 3.2+, ruby with psych.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$PLUGIN_ROOT/skills"
COMMANDS_DIR="$PLUGIN_ROOT/commands"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

DESC_LIMIT=1024              # Claude Code's cap, counted in bytes
HUMAN_ONLY_MARKER="Human-invoked only."

require_ruby_psych || { report; exit 1; }

# Facts about a markdown file's frontmatter, one per line, TAB-separated:
#   err <message>            parsing refused, with the reason
#   key <name>               one line per top-level key, in document order
#   val <name> <type> <val>  type is string|bool|number, or the YAML class for
#                            anything non-scalar; callers requiring text check it
#   rawbytes <name> <n>      byte length of a String value BEFORE collapsing
fm_facts() {
  _facts="$("$RUBY_BIN" -ryaml -e '
    lines = File.read(ARGV[0]).lines
    unless lines[0] && lines[0].rstrip == "---"
      puts "err\tno frontmatter: the file must open with --- on line 1"
      exit
    end
    close = lines[1..-1].index { |l| l.rstrip == "---" }
    if close.nil?
      puts "err\tunterminated frontmatter: no closing --- after line 1"
      exit
    end
    src = lines[1, close].join
    begin
      doc = Psych.safe_load(src, permitted_classes: [], aliases: false)
      ast = Psych.parse(src)
    rescue => e
      puts "err\tfrontmatter does not parse: #{e.class}"
      exit
    end
    unless doc.is_a?(Hash)
      puts "err\tfrontmatter is #{doc.class}, expected a mapping"
      exit
    end
    # Keys come from the AST, never from the Hash. safe_load resolves a duplicate
    # key last-wins and silently drops the first, so a Hash cannot show that a file
    # declared the same key twice — which is the whole point of counting them.
    ast.children[0].children.each_slice(2) do |k, _|
      puts "key\t#{k.respond_to?(:value) ? k.value : k}"
    end
    # Values stay Hash-derived, and each one carries its parsed type. Flattening a
    # sequence or a mapping into a printable string made it indistinguishable from
    # real text: a description of [a, b] read as the seven-character "<Array>",
    # which is non-empty and under the cap, so every scalar check passed on it.
    # The raw byte length ships as its own fact. The val line below is the
    # COLLAPSED value — whitespace runs squeezed to one space — so measuring
    # the cap on it lets a padded or folded description over the cap pass as
    # under it. bytesize is taken before any collapsing.
    doc.each do |k, v|
      if v.is_a?(String)
        puts "rawbytes\t#{k}\t#{v.bytesize}"
      end
      case v
      when String then puts "val\t#{k}\tstring\t#{v.gsub(/\s+/, " ").strip}"
      when true, false then puts "val\t#{k}\tbool\t#{v}"
      when Numeric then puts "val\t#{k}\tnumber\t#{v}"
      else puts "val\t#{k}\t#{v.class.to_s.downcase}\t"
      end
    end
  ' "$1" 2>/dev/null)"; _facts_rc=$?
  # A Ruby that dies OUTSIDE the script's own rescue — ArgumentError from
  # rstrip on an invalid-UTF-8 byte, a kill, an OOM — prints nothing and exits
  # non-zero, and empty facts read as clean below: every count is zero, so the
  # posture checks pass and a command file clears both its checks without ever
  # being parsed. Route any non-zero exit into the err channel before that.
  if [ "$_facts_rc" -ne 0 ]; then
    printf 'err\tfrontmatter read failed: facts script exited %s\n' "$_facts_rc"
    return 0
  fi
  printf '%s\n' "$_facts"
}

facts_error() { printf '%s\n' "$1" | awk -F'\t' '$1=="err"{print $2; exit}'; }
facts_keys()  { printf '%s\n' "$1" | awk -F'\t' '$1=="key"{print $2}'; }
facts_type()  { printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1=="val" && $2==k{print $3; exit}'; }
facts_value() { printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1=="val" && $2==k{print $4; exit}'; }
facts_count() { printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1=="key" && $2==k{n++} END{print n+0}'; }
facts_rawbytes() { printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1=="rawbytes" && $2==k{print $3; exit}'; }

# Byte test, not character test: the name grammar is ASCII, so the locale is
# pinned. The subshell parens keep LC_ALL from leaking into the rest of the
# suite, where it would change every later glob's collation.
is_kebab_case() (
  LC_ALL=C
  case "$1" in
    "" ) return 1 ;;
    -*|*-) return 1 ;;
    *[!a-z0-9-]* ) return 1 ;;
    *) return 0 ;;
  esac
)

describes_human_only() {
  case "$1" in *"$HUMAN_ONLY_MARKER"*) return 0 ;; *) return 1 ;; esac
}

# ONE validator for the flag, used by both surfaces it appears on.
#
# `disable-model-invocation` means the same thing in a SKILL.md and in a command
# file, and it was previously validated by two parallel branches. They drifted
# exactly as parallel branches do: the parsed-type requirement was added to the
# skill branch only, so a command carrying the STRING "true" passed while the
# equivalent skill failed. One function, both callers.
#
#   $1 facts   $2 want: yes (human-only) | no (model-invocable)
# Echoes nothing when the posture is correct, or the reason when it is not.
posture_problem() {
  _n="$(facts_count "$1" disable-model-invocation)"
  _v="$(facts_value "$1" disable-model-invocation)"
  _t="$(facts_type  "$1" disable-model-invocation)"
  if [ "$2" = "yes" ]; then
    if [ "$_n" -ne 1 ]; then
      printf 'expected exactly one disable-model-invocation, found %s' "$_n"; return
    fi
    if [ "$_t" != "bool" ]; then
      printf 'disable-model-invocation must be a YAML boolean; parsed as %s' "${_t:-absent}"; return
    fi
    if [ "$_v" != "true" ]; then
      printf 'disable-model-invocation is %s, expected true' "$_v"; return
    fi
  else
    if [ "$_n" -ne 0 ]; then
      printf 'carries disable-model-invocation (type %s, value %s) but is model-invocable' \
        "${_t:-absent}" "$_v"; return
    fi
  fi
}

# The description cap is measured on the RAW bytes (the rawbytes fact, from the
# same single parse), never on the collapsed value: Psych folds a folded scalar
# and the val line squeezes whitespace further, so a padded or folded
# description over the cap would pass as under it.

check_skill() {
  name="$1"; md="$SKILLS_DIR/$name/SKILL.md"; rel="skills/$name/SKILL.md"
  facts="$(fm_facts "$md")"

  err="$(facts_error "$facts")"
  if [ -n "$err" ]; then
    fail "$rel: frontmatter parses" "$err"
    return 1
  fi
  pass "$rel: frontmatter parses"

  for required in name description; do
    n="$(facts_count "$facts" "$required")"
    if [ "$n" -eq 1 ]; then pass "$rel: exactly one '$required'"
    else fail "$rel: exactly one '$required'" "found $n"; fi

    t="$(facts_type "$facts" "$required")"
    if [ "$t" = "string" ]; then pass "$rel: '$required' is a scalar string"
    else fail "$rel: '$required' is a scalar string" "parsed as ${t:-absent}"; fi
  done

  unknown="$(facts_keys "$facts" | awk '
    $0 != "name" && $0 != "description" && $0 != "disable-model-invocation"
  ' | awk '{ printf "%s%s", sep, $0; sep = ", " }')"
  if [ -z "$unknown" ]; then pass "$rel: no unknown frontmatter keys"
  else fail "$rel: no unknown frontmatter keys" "found: [$unknown]"; fi

  name_val="$(facts_value "$facts" name)"
  if is_kebab_case "$name_val"; then pass "$rel: 'name' is kebab-case ('$name_val')"
  else fail "$rel: 'name' is kebab-case" "name='$name_val'"; fi
  if [ "$name_val" = "$name" ]; then pass "$rel: 'name' matches directory"
  else fail "$rel: 'name' matches directory" "directory='$name' but name='$name_val'"; fi

  desc_val="$(facts_value "$facts" description)"
  len="$(facts_rawbytes "$facts" description)"
  if [ -z "$desc_val" ]; then fail "$rel: 'description' is non-empty" "empty"
  elif [ "$len" -le "$DESC_LIMIT" ]; then pass "$rel: 'description' length ${len}/${DESC_LIMIT} bytes"
  else fail "$rel: 'description' length ≤${DESC_LIMIT} bytes" "actual=${len}"; fi

  if describes_human_only "$desc_val"; then want=yes; else want=no; fi
  problem="$(posture_problem "$facts" "$want")"
  if [ "$want" = yes ]; then
    label="$rel: description says human-invoked only, and the flag agrees"
  else
    label="$rel: description makes no human-only claim, and no flag is set"
  fi
  if [ -z "$problem" ]; then pass "$label"; else fail "$label" "$problem"; fi

  # Publish the posture from THIS parse. The caller used to re-run fm_facts on the
  # same file to re-derive it, which spawned a second Ruby per skill and — worse —
  # let the posture driving the command and Codex checks come from a different
  # parse than the verdicts just printed above. One parse, one posture.
  if describes_human_only "$desc_val"; then SKILL_POSTURE=yes; else SKILL_POSTURE=no; fi
  return 0
}

check_command() {
  name="$1"; human_only="$2"; md="$COMMANDS_DIR/$name.md"; rel="commands/$name.md"
  facts="$(fm_facts "$md")"

  err="$(facts_error "$facts")"
  if [ -n "$err" ]; then fail "$rel: frontmatter parses" "$err"; return 0; fi
  pass "$rel: frontmatter parses"

  problem="$(posture_problem "$facts" "$human_only")"
  if [ "$human_only" = "yes" ]; then
    if [ -z "$problem" ]; then
      pass "$rel: human-invoked only, matching its skill"
    else
      fail "$rel: human-invoked only, matching its skill" \
        "$problem — the skill cannot be model-triggered but this command can"
    fi
  elif [ -z "$problem" ]; then
    pass "$rel: model-invocable, matching its skill"
  else
    fail "$rel: model-invocable, matching its skill" "$problem"
  fi
}

# Codex's contract, parsed rather than shape-matched: the mapping is what
# matters, not the byte layout, and a key at the wrong nesting is simply not
# the key.
check_codex_policy() {
  name="$1"; human_only="$2"
  yaml="$SKILLS_DIR/$name/agents/openai.yaml"; rel="skills/$name/agents/openai.yaml"

  if [ ! -f "$yaml" ]; then
    fail "$rel: exists" "every skill declares its Codex interface here"
    return 0
  fi

  verdict="$("$RUBY_BIN" -ryaml -e '
    want_denied = ARGV[1] == "yes"
    begin
      doc = Psych.safe_load(File.read(ARGV[0]), permitted_classes: [], aliases: false)
    rescue => e
      puts "bad\tdoes not parse: #{e.class}"; exit
    end
    unless doc.is_a?(Hash)
      puts "bad\ttop level is #{doc.class}, expected a mapping"; exit
    end
    extra = doc.keys - ["interface", "policy"]
    unless extra.empty?
      puts "bad\tunexpected top-level keys: #{extra.join(", ")}"; exit
    end
    iface = doc["interface"]
    unless iface.is_a?(Hash) && iface["display_name"].is_a?(String) && iface["short_description"].is_a?(String)
      puts "bad\tinterface must carry display_name and short_description as strings"; exit
    end
    denied = doc["policy"].is_a?(Hash) && doc["policy"]["allow_implicit_invocation"] == false
    if want_denied && !denied
      puts "bad\tpolicy.allow_implicit_invocation is not false — Codex can invoke this implicitly"; exit
    end
    if !want_denied && doc.key?("policy")
      puts "bad\tcarries a policy block, but this skill is meant to be reachable by trigger"; exit
    end
    puts "good\t"
  ' "$yaml" "$human_only" 2>/dev/null)"

  case "$verdict" in
    good*) pass "$rel: Codex posture matches the description and the flag" ;;
    *)     fail "$rel: Codex posture matches the description and the flag" "$(printf '%s' "$verdict" | cut -f2-)" ;;
  esac
}

printf '%sorca-crew invocation and frontmatter lint%s\n' "$DIM" "$RST"

# The union of both globs. An orphan on either side becomes a missing
# counterpart rather than a file nobody looked at.
names="$(
  { ls -1 "$SKILLS_DIR" 2>/dev/null
    ls -1 "$COMMANDS_DIR" 2>/dev/null | sed 's/\.md$//'
  } | sort -u
)"

if [ -z "$names" ]; then
  fail "at least one skill or command exists" "found neither skills/*/ nor commands/*.md"
  report; exit 1
fi

for name in $names; do
  section "$name"
  skill_md="$SKILLS_DIR/$name/SKILL.md"

  if [ ! -f "$skill_md" ]; then
    fail "skills/$name/SKILL.md: exists" "commands/$name.md has no skill of that name"
    continue
  fi
  if [ ! -f "$COMMANDS_DIR/$name.md" ]; then
    fail "commands/$name.md: exists" "skills/$name/ has no command of that name"
    continue
  fi

  SKILL_POSTURE=
  check_skill "$name" || continue
  check_command "$name" "$SKILL_POSTURE"
  check_codex_policy "$name" "$SKILL_POSTURE"
done

report
