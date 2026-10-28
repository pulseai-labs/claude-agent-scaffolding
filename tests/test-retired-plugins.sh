#!/usr/bin/env bash
# retirement gate — the removal of one plugin from the marketplace (issue #948).
#
# Three facts, each owned here and nowhere else:
#   1. no tracked path lives under the retired plugin's directory;
#   2. no marketplace catalog (Claude, OMP, Codex) lists an entry under its name;
#   3. no copy of the name survives in a tracked file outside the sanctioned survivors.
#
# Fact 3 matches case-insensitively: the name shows up capitalised in prose and in capitals
# as an environment-variable prefix.
#
# Comment lines here say "the retired plugin" rather than writing its name: this file is
# scanned by its own check 3, so a literal mention in prose is a hit that can never be cleared.
# The name is assembled below for the same reason, and this file is not listed as a survivor.
#
# Sanctioned survivors are the SURVIVORS list below. Each entry is a path glob or an exact
# path plus a one-line reason. A later task adds an entry only with its reason written beside it.
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

# Assembled rather than written, so this file does not contain the string it searches for:
# a gate that matches its own source can never go green.
OLD="auto"'nomic'

# Sanctioned survivors for fact 3: `case` glob patterns matched against the tracked path.
# One entry per line: pattern, then the reason. Extend here and nowhere else.
is_survivor() {
  case "$1" in
    */CHANGELOG.md) return 0 ;;                  # released history: a changelog records what shipped
    CHANGELOG.md) return 0 ;;                    # root-level changelog, same reason
    docs/conventions/skill-first.md) return 0 ;; # cites the retired plugin's 0.5.0 as evidence: history
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
old_paths="$(git ls-files | awk -v o="$OLD/" 'index($0, o) == 1')"
if [ -z "$old_paths" ]; then
  pass "no tracked file lives under $OLD/"
else
  fail "tracked files still live under $OLD/ ($(printf '%s\n' "$old_paths" | wc -l | tr -d ' ') of them)"
  printf '%s\n' "$old_paths" | sed 's/^/        /'
fi

# 2. The three catalogs. A missing catalog is a FAIL, never a skip.
check_catalog() {
  local f="$1"
  if [ ! -f "$f" ]; then fail "$f exists"; return; fi
  if jq -e --arg n "$OLD" '[.. | objects | select((.name? | type) == "string" and (.name | ascii_downcase) == $n)] | length == 0' "$f" >/dev/null 2>&1; then
    pass "$f: no $OLD entry"
  else
    fail "$f: still lists an entry named $OLD (or is not valid JSON)"
  fi
}
check_catalog ".claude-plugin/marketplace.json"
check_catalog ".omp-plugin/marketplace.json"
check_catalog ".agents/plugins/marketplace.json"

# 3. The tree-wide sweep. Every hit is printed — a truncated list reads as a shorter job
#    than the one actually left.
hits=""
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file="${hit%%:*}"
  is_survivor "$file" && continue
  hits="$hits$hit
"
done < <(git grep -n -i -I -- "$OLD" -- . || true)

if [ -z "$hits" ]; then
  pass "no $OLD in the tree outside the sanctioned survivors"
else
  fail "$OLD still appears ($(printf '%s' "$hits" | grep -c .) hit(s)):"
  printf '%s' "$hits" | sed 's/^/        /'
fi

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
