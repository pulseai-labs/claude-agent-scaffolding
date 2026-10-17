#!/usr/bin/env bash
# crew rename gate — the clean cut from the old plugin name to `crew` (crew 0.3.0, spec §4.6).
#
# Three facts, each owned here and nowhere else:
#   1. no tracked path lives under the old directory;
#   2. every marketplace catalog publishes `crew` at `./crew` and publishes no entry
#      under the old name (no alias plugin, per spec §4.6);
#   3. no copy of the old name survives in the tree.
#
# Fact 3's two sanctioned survivors: CHANGELOG history (a changelog records what the plugin
# was called when it shipped — quotes of the past are the changelog's job) and config.md's
# old-path stop, whose whole point is to print the old path in the `mv` it tells the
# operator to run.
#
# Comment lines here say "the old name" rather than writing it: this file is scanned by its
# own check 3, so a literal mention in prose is a hit that can never be cleared.
#
# What the gate holds now: all three facts pass on the shipped tree, and a reintroduction of
# any of them — the directory back under the old name, a catalog entry for it, or one
# reference in a tracked file outside the two sanctioned survivors above — fails here. No
# part of it is left to a later task. CI runs this file beside the crew parity pins.
#
# A checkout is the premise of all three facts, and the guard before them fails loudly on a
# tree that is not one — see its own comment.
#
# Usage: bash tests/test-crew-rename.sh
# Deps:  bash 3.2+, git, jq, awk, sed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
export LC_ALL=C

# Assembled rather than written, so this file does not contain the string it searches for:
# a gate that matches its own source can never go green. tests/test-omp-surface.sh keeps
# its own reference regex from matching itself the same way, with an (a|b) alternation.
OLD="herdr"'-'"crew"
NEW="crew"
_CONFIG_MD="crew/skills/orchestrate/references/config.md"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

printf 'crew rename gate\n'

# The premise every fact below rests on: `git ls-files` and `git grep` print NOTHING outside
# a checkout, with the failure on stderr only — so an exported tarball or a copied directory
# reads exactly like a clean one and all three checks would pass vacuously. A gate that cannot
# distinguish "clean" from "unread" is not a gate. tests/test-omp-surface.sh asks the same
# question to choose between its git and non-git greps; here the answer has to stop the run.
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

# 2. The three catalogs. $2 is the jq path to that catalog's source field: Claude and OMP
#    use a bare string, Codex nests it under .source.path.
check_catalog() {
  local f="$1" src="$2" s
  if [ ! -f "$f" ]; then fail "$f exists"; return; fi
  s="$(jq -r --arg n "$NEW" "$src" "$f" 2>/dev/null)"
  if [ "$s" = "./$NEW" ]; then pass "$f: $NEW points at ./$NEW"
  else fail "$f: $NEW points at '${s:-<no such entry>}', want ./$NEW"; fi
  if jq -e --arg n "$OLD" '[.. | objects | select(.name? == $n)] | length == 0' "$f" >/dev/null 2>&1; then
    pass "$f: no $OLD entry"
  else
    fail "$f: still lists an entry named $OLD"
  fi
}
check_catalog ".claude-plugin/marketplace.json" '.plugins[] | select(.name == "crew") | .source'
check_catalog ".agents/plugins/marketplace.json" '.plugins[] | select(.name == "crew") | .source.path'
check_catalog ".omp-plugin/marketplace.json" '.plugins[] | select(.name == "crew") | .source'

# 3. The tree-wide sweep. Every hit is printed — a truncated list reads as a shorter job
#    than the one actually left.
hits=""
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  text="${rest#*:}"
  case "$file" in */CHANGELOG.md) continue ;; esac
  if [ "$file" = "$_CONFIG_MD" ]; then
    # The one line allowed to name it: the old-path stop, which prints both moves. A move has to
    # name both ends of itself, so that line — and only that line — carries the old name. Any
    # other line of config.md that names it still fails this check.
    case "$text" in *"mv"*"$OLD"*) continue ;; esac
  fi
  hits="$hits$hit
"
done < <(git grep -n -- "$OLD" -- . || true)

if [ -z "$hits" ]; then
  pass "no $OLD in the tree outside CHANGELOG history and config.md's old-path stop"
else
  fail "$OLD still appears ($(printf '%s' "$hits" | grep -c .) hit(s)):"
  printf '%s' "$hits" | sed 's/^/        /'
fi

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
