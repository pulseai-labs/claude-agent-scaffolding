#!/usr/bin/env bash
# retirement gate — the removal of plugins from the marketplace (issue #948, then one per ruling).
#
# Three facts per retired plugin, each owned here and nowhere else:
#   1. no tracked path lives under the retired plugin's directory;
#   2. no marketplace catalog (Claude, OMP, Codex) lists an entry under its name;
#   3. no copy of the name survives in a tracked file outside that plugin's sanctioned survivors.
#
# Fact 3 matches case-insensitively and on an extended pattern per plugin: the name shows up
# capitalised in prose, in capitals as an environment-variable prefix (separator an underscore),
# and, for a plugin that ships skills other files name, under those skill names.
#
# Comment lines here say "the retired plugin" rather than writing its name: this file is
# scanned by its own check 3, so a literal mention in prose is a hit that can never be cleared.
# The names and patterns are assembled below for the same reason, and this file is not listed
# as a survivor.
#
# Retiring another plugin: add its name to RETIRED, its pattern to pattern_for, and its
# survivors (each with a one-line reason) to is_survivor. A survivor is added only with its
# reason written beside it.
#
# A checkout is the premise of all three facts, and the guard before them fails loudly on a
# tree that is not one — see its own comment.
#
# Usage: bash tests/test-retired-plugins.sh
# Deps:  bash 3.2+, git, jq, awk, sed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
export LC_ALL=C

# Assembled rather than written, so this file does not contain the strings it searches for:
# a gate that matches its own source can never go green.
AUTO_NAME="auto"'nomic'
CRITIC_NAME="architect"'-critic'
RETIRED="$AUTO_NAME $CRITIC_NAME"

# The tree-wide pattern for one name (git grep -E, case-insensitive). The name itself is also
# the directory and the catalog entry's name; the pattern is what the content sweep looks for.
pattern_for() {
  case "$1" in
    "$AUTO_NAME") printf '%s' "$AUTO_NAME" ;;
    "$CRITIC_NAME") printf '%s' "architect"'[-_ ]?critic|critiquing'"-spec" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Sanctioned survivors for fact 3: `case` glob patterns matched against the tracked path, per
# retired name. One entry per line: pattern, then the reason. Extend here and nowhere else.
is_survivor() {
  local name="$1" path="$2"
  case "$path" in
    */CHANGELOG.md) return 0 ;;                  # released history: a changelog records what shipped
    CHANGELOG.md) return 0 ;;                    # root-level changelog, same reason
  esac
  case "$name" in
    "$AUTO_NAME")
      case "$path" in
        docs/conventions/skill-first.md) return 0 ;; # cites the retired plugin's 0.5.0 as evidence: history
        crew/README.md) return 0 ;;                  # its released "Since 0.2.9 / 0.2.10 / 0.2.18" paragraphs name the retired plugin: release history, never edited
      esac ;;
    "$CRITIC_NAME")
      case "$path" in
        ossify/lib/commands.sh) return 0 ;;                   # oss critic_detect is kept unchanged: its own comment says removing it is a major release, and it answers absent once the plugin is gone
        ossify/tests/test-dispatcher-ops.sh) return 0 ;;      # critic_detect's tests, kept with the verb
        ossify/README.md) return 0 ;;                         # released "Since 1.14.4" paragraph names the wrapper's override variable; the 1.33.1 note records the retirement and the kept critic_detect verb
        ossify/skills/challenge/references/adversaries.md) return 0 ;; # lineage line: its recipes are the retired plugin's proven invocations (being changed on another branch)
        ossify/skills/challenge/references/audit.md) return 0 ;;       # lineage line: the audit was absorbed from the retired plugin's skill (being changed on another branch)
        ossify/tests/eval/evidence/*) return 0 ;;             # recorded eval evidence: a run's output is history and is never edited
        workspace-init/lib/_helpers.sh) return 0 ;;           # ported-from lineage comments: the helpers mirror the retired plugin's
        claude-security-audit/tests/_helpers.sh) return 0 ;;  # ported-from lineage comments: the harness mirrors the retired plugin's
      esac ;;
  esac
  return 1
}

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }

printf 'retirement gate\n'

# The premise every fact below rests on: `git ls-files` and `git grep` print NOTHING outside
# a checkout, with the failure on stderr only — so an exported tarball reads exactly like a
# clean tree and all three checks would pass vacuously.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "run inside a git checkout"
  printf '        %s is not a git checkout: `git ls-files` and `git grep` would print nothing and every check below would pass vacuously.\n' "$ROOT"
  printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
  exit 1
fi

# 1. The directory itself.
check_dir() {
  local old="$1" old_paths
  old_paths="$(git ls-files | awk -v o="$old/" 'index($0, o) == 1')"
  if [ -z "$old_paths" ]; then
    pass "no tracked file lives under $old/"
  else
    fail "tracked files still live under $old/ ($(printf '%s\n' "$old_paths" | wc -l | tr -d ' ') of them)"
    printf '%s\n' "$old_paths" | sed 's/^/        /'
  fi
}

# 2. The three catalogs. A missing catalog is a FAIL, never a skip.
check_catalog() {
  local old="$1" f="$2"
  if [ ! -f "$f" ]; then fail "$f exists"; return; fi
  if ! jq -e '(.plugins | type) == "array" and (.plugins | length) > 0' "$f" >/dev/null 2>&1; then
    fail "$f: has no non-empty .plugins array (empty, null or unreadable catalog)"
    return
  fi
  if jq -e --arg n "$old" '[.. | objects | select((.name? | type) == "string" and (.name | ascii_downcase) == $n)] | length == 0' "$f" >/dev/null 2>&1; then
    pass "$f: no $old entry"
  else
    fail "$f: still lists an entry named $old (or is not valid JSON)"
  fi
}

# 3. The tree-wide sweep, by content and by file name. Every hit is printed — a truncated
#    list reads as a shorter job than the one actually left.
check_tree() {
  local old="$1" pat hits="" grep_out grep_rc hit file path
  pat="$(pattern_for "$old")"
  # git grep exits 1 for "no matches" (fine) and >1 for a real error: that must FAIL, not read as clean.
  grep_out="$(git grep -n -i -I -E -- "$pat" -- . 2>&1)"
  grep_rc=$?
  if [ "$grep_rc" -gt 1 ]; then
    fail "git grep errored (exit $grep_rc), so the content sweep for $old did not run:"
    printf '%s\n' "$grep_out" | sed 's/^/        /'
    return
  fi
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    file="${hit%%:*}"
    is_survivor "$old" "$file" && continue
    hits="$hits$hit
"
  done <<EOT
$grep_out
EOT
  # File names: tracked paths that carry the name, minus the same survivors.
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    is_survivor "$old" "$path" && continue
    hits="$hits$path (file name)
"
  done < <(git ls-files | awk -v re="$pat" 'tolower($0) ~ re')

  if [ -z "$hits" ]; then
    pass "no $old in the tree (content or file names) outside the sanctioned survivors"
  else
    fail "$old still appears ($(printf '%s' "$hits" | grep -c .) hit(s)):"
    printf '%s' "$hits" | sed 's/^/        /'
  fi
}

for name in $RETIRED; do
  printf '%s\n' "-- $name"
  check_dir "$name"
  check_catalog "$name" ".claude-plugin/marketplace.json"
  check_catalog "$name" ".omp-plugin/marketplace.json"
  check_catalog "$name" ".agents/plugins/marketplace.json"
  check_tree "$name"
done

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
