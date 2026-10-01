#!/usr/bin/env bash
# ossify's copy of merge-bar's PR-body template (ossify 1.13.0).
#
# /ossify:patch opens a PR from ossify/references/work-pr/pr-body.md where the
# merge-bar plugin is not installed, and spine close composes a spine PR's six
# fields from the same file. The copy exists because merge-bar's own file is
# absent exactly when the fallback runs. A drifted copy ships a different merge
# bar than the one merge-bar's working-a-pr judges against - merge-bar's bar has
# already grown from three conditions to four since 0.1.0.
#
# Only the fenced ```markdown template block is compared: the prose around it is
# per-copy by design (ossify's header says whose copy it is). Repo-root, because
# a plugin suite cannot see its sibling tree.
#
# Usage: bash tests/test-merge-bar-template-parity.sh
# Deps:  bash 3.2+, awk, cmp.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THEIRS="$ROOT/merge-bar/skills/opening-a-pr/references/pr-body.md"
OURS="$ROOT/ossify/references/work-pr/pr-body.md"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

block() { awk '/^```markdown$/{f=1; next} f && /^```$/{exit} f' "$1"; }

printf 'merge-bar template parity\n'

for f in "$THEIRS" "$OURS"; do
  rel="${f#"$ROOT"/}"
  if [[ ! -s "$f" ]]; then fail "$rel exists and is non-empty"; else pass "$rel exists and is non-empty"; fi
done

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
block "$THEIRS" > "$T/theirs"
block "$OURS"   > "$T/ours" 2>/dev/null || : > "$T/ours"

# Non-empty and shaped FIRST: two empty extractions are byte-identical, and the
# comparison below would certify two gutted copies as in sync.
if grep -qx '## Merge bar' "$T/theirs"; then
  pass "merge-bar's template block extracts and carries '## Merge bar'"
else
  fail "merge-bar's template block extracts and carries '## Merge bar'"
fi
if cmp -s "$T/theirs" "$T/ours"; then
  pass "ossify's template block is byte-identical to merge-bar's"
else
  fail "ossify's template block is byte-identical to merge-bar's - copy merge-bar's block into ossify/references/work-pr/pr-body.md"
fi

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
