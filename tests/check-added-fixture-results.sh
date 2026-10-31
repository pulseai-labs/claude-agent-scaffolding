#!/usr/bin/env bash
# Stops when a PR adds an eval fixture with no same-named result (#1013). The aggregator
# exits 1 on an unscored fixture, but CI does not run it, so the gap reached review unseen.
#
# Usage: check-added-fixture-results.sh <base-rev> <head-rev>
# rc 0 = every added fixture has a result, 1 = one or more do not, 2 = could not check.
#
# Added fixtures only: older ones on main have no result yet. ossify and merge-bar only:
# crew's fixtures have no result at this path. A result that predates its fixture, or holds
# wrong scores, stays with the reviewer.

set -u
[ "$#" -eq 2 ] || { echo "usage: $0 <base-rev> <head-rev>" >&2; exit 2; }
base="$1" head="$2"

# --no-renames: a moved fixture needs a result at its new path too.
if ! added="$(git diff --name-only --no-renames --diff-filter=A "$base" "$head")"; then
  echo "cannot diff $base..$head; added fixtures are NOT checked" >&2
  exit 2
fi

missing=0
while IFS= read -r path; do
  case "$path" in
    ossify/tests/eval/fixtures/*/*.md|merge-bar/tests/eval/fixtures/*/*.md) ;;
    *) continue ;;
  esac
  plugin="${path%%/*}"
  rest="${path#"$plugin"/tests/eval/fixtures/}"
  case "$rest" in */*/*) continue ;; esac
  result="$plugin/tests/eval/results/${rest%.md}.json"
  if ! git cat-file -e "$head:$result" 2>/dev/null; then
    echo "added fixture has no result: $path (wanted $result)"
    missing=1
  fi
done <<<"$added"
exit "$missing"
