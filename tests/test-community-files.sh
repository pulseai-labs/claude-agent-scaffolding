#!/usr/bin/env bash
# Community files gate (repo polish, 2026-11) — the mechanical facts of .github/'s community files.
# Each fact prints its own finding:
#   missing         CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md and both issue forms exist;
#   plugin-options  each issue form's Plugin dropdown lists exactly the plugins in the Claude Code
#                   and OMP catalogs (.claude-plugin/ and .omp-plugin/marketplace.json), so a new
#                   or retired plugin cannot leave the forms behind;
#   link            every relative link in the three community files resolves from .github/.
# The PR template's parity with merge-bar's body is tests/test-merge-bar-template-parity.sh's.
# What it leaves to review: whether each sentence is true.
#
# Usage: bash tests/test-community-files.sh
# Deps:  bash 3.2+, awk, grep, sed, sort, jq.
set -u
export LC_ALL=C
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

FORMS=".github/ISSUE_TEMPLATE/bug_report.yml .github/ISSUE_TEMPLATE/feature_request.yml"
DOCS=".github/CONTRIBUTING.md .github/SECURITY.md .github/CODE_OF_CONDUCT.md"

# The options of the dropdown whose id is "plugin", one per line, sorted.
plugin_options() {
  awk '
    /^  - type:/        { inplugin = 0; inopts = 0 }
    /^    id: plugin$/  { inplugin = 1 }
    inplugin && /^      options:$/ { inopts = 1; next }
    inopts && /^          - / { sub(/^          - /, ""); print; next }
    inopts && !/^          - / { inopts = 0 }
  ' "$1" | sort
}

# Every defect in the tree at $1, one line each, prefixed by its fact. Always returns 0.
check_tree() (
  cd "$1" || { echo "setup: cannot enter $1"; exit 0; }
  for f in $DOCS $FORMS; do [ -s "$f" ] || echo "missing: $f"; done

  want="$(jq -r '.plugins[].name' .claude-plugin/marketplace.json .omp-plugin/marketplace.json 2>/dev/null | sort -u)"
  [ -n "$want" ] || echo "plugin-options: no plugin read from the catalogs"
  for f in $FORMS; do
    [ -s "$f" ] || continue
    got="$(plugin_options "$f")"
    [ "$got" = "$want" ] || echo "plugin-options: $f lists [$(echo $got)], the catalogs list [$(echo $want)]"
  done

  for f in $DOCS; do
    [ -s "$f" ] || continue
    awk '/^[[:space:]]*(```|~~~)/ { fence = !fence; next } !fence' "$f" \
      | grep -oE '\]\([^)]*\)' | sed -E 's/^\]\(//; s/\)$//; s/#.*//' \
      | grep -vE '^(https?:|mailto:|$)' | sort -u \
      | while IFS= read -r t; do
          [ -e ".github/$t" ] || echo "link: $f -> $t does not exist"
        done
  done
)

printf 'community files gate\n'

findings="$(check_tree "$ROOT")"
if [ -z "$findings" ]; then pass "the real tree has no findings"
else fail "the real tree has findings:"; printf '        %s\n' "$findings"; fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# A copy of what the gate reads and what the community files link to.
make_copy() {
  local d="$1/repo"
  mkdir -p "$d/.github" "$d/.claude-plugin" "$d/.omp-plugin" "$d/docs/conventions" "$d/merge-bar"
  cp -R "$ROOT/.github/." "$d/.github/"
  cp "$ROOT/.claude-plugin/marketplace.json" "$d/.claude-plugin/"
  cp "$ROOT/.omp-plugin/marketplace.json" "$d/.omp-plugin/"
  cp "$ROOT/CLAUDE.md" "$ROOT/README.md" "$d/"
  cp "$ROOT/docs/conventions/skill-first.md" "$d/docs/conventions/"
  printf '%s\n' "$d"
}

# control <name> <expected finding prefix> <shell that plants the defect, run inside the copy>
control() {
  local name="$1" want="$2" plant="$3" d out
  d="$(make_copy "$WORK/$name")"
  (cd "$d" && eval "$plant") || { fail "control $name: the plant did not apply"; return; }
  out="$(check_tree "$d")"
  if printf '%s\n' "$out" | grep -Fq "$want"; then pass "control $name: $want"
  else fail "control $name: expected '$want', got: ${out:-nothing}"; fi
}

clean="$(make_copy "$WORK/clean")"
out="$(check_tree "$clean")"
if [ -z "$out" ]; then pass "control clean: an unchanged copy has no findings"
else fail "control clean: an unchanged copy has findings: $out"; fi

control missing      "missing: .github/SECURITY.md"   "rm .github/SECURITY.md"
control new-plugin   "plugin-options: .github/ISSUE_TEMPLATE/bug_report.yml" "jq '.plugins += [{\"name\": \"zz-new\"}]' .claude-plugin/marketplace.json > t && mv t .claude-plugin/marketplace.json"
control omp-only     "plugin-options: .github/ISSUE_TEMPLATE/feature_request.yml" "jq '.plugins += [{\"name\": \"zz-omp\"}]' .omp-plugin/marketplace.json > t && mv t .omp-plugin/marketplace.json"
control dropped      "plugin-options: .github/ISSUE_TEMPLATE/bug_report.yml" "grep -v '^          - sage\$' .github/ISSUE_TEMPLATE/bug_report.yml > t && mv t .github/ISSUE_TEMPLATE/bug_report.yml"
control link         "link: .github/CONTRIBUTING.md -> ../no-such.md" "printf 'See [x](../no-such.md#y).\n' >> .github/CONTRIBUTING.md"

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
