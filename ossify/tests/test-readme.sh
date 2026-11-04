#!/usr/bin/env bash
# ossify README and CHANGELOG gate — the mechanical facts of the plugin page (README rewrite,
# 2026-11). Each fact prints its own finding:
#   h1               the README's first line is exactly "# ossify", with no version label;
#   history          no "Since x.y" line on the README: release notes go to CHANGELOG.md;
#   command-row      every skills/<name>/ has a README table row that names /ossify:<name>;
#   link             every relative link, src or srcset target on the README exists;
#   codex-worker     the README says "Codex has no worker path" (wayfinder's ticket-types.md
#                    cites ossify/README.md for that sentence);
#   changelog-order  CHANGELOG.md's "## x.y.z" headings are strictly newest first;
#   changelog-top    the newest heading is the version in .claude-plugin/plugin.json, so a
#                    version bump carries its CHANGELOG entry.
# What it leaves to review: whether each sentence is true, and how the page looks.
#
# Usage: bash ossify/tests/test-readme.sh
# Deps:  bash 3.2+, awk, grep, sed, jq.
set -u
export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"
OSSIFY="$(cd "$HERE/.." && pwd)"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

# README lines outside fenced code blocks, as "<line-number>:<text>".
prose_lines() {
  awk '/^[[:space:]]*(```|~~~)/ { fence = !fence; next } !fence { print NR ":" $0 }' "$1"
}

# Every defect in the plugin tree at $1, one line each, prefixed by its fact. Always returns 0.
check_plugin() (
  cd "$1" || { echo "setup: cannot enter $1"; exit 0; }
  r=README.md c=CHANGELOG.md

  [ "$(sed -n 1p "$r")" = "# ossify" ] || echo "h1: first line is '$(sed -n 1p "$r")', not '# ossify'"

  prose_lines "$r" | grep -E 'Since [0-9]+\.[0-9]+' | sed 's/^/history: line /'

  for d in skills/*/; do
    n="$(basename "$d")"
    grep -E '^\|' "$r" | grep -Fq "/ossify:$n" || echo "command-row: no table row names /ossify:$n"
  done

  prose_lines "$r" \
    | grep -oE '\]\([^)]*\)|(src|srcset)="[^"]*"' \
    | sed -E 's/^\]\(//; s/\)$//; s/^(src|srcset)="//; s/"$//; s/#.*//' \
    | grep -vE '^(https?:|mailto:|$)' \
    | sort -u \
    | while IFS= read -r t; do
        [ -e "$t" ] || echo "link: $t does not exist"
      done

  grep -Fq 'Codex has no worker path' "$r" || echo "codex-worker: the README no longer says 'Codex has no worker path'"

  if [ ! -f "$c" ]; then
    echo "changelog-order: $c is missing"
  else
    grep -E '^## ' "$c" | awk '
      function key(v,  a) { split(v, a, "."); return sprintf("%06d%06d%06d", a[1], a[2], a[3]) }
      {
        v = $2
        if (v !~ /^[0-9]+\.[0-9]+\.[0-9]+$/) { print "changelog-order: heading \"" $0 "\" is not ## x.y.z"; next }
        if (prev != "" && key(v) >= key(prev)) print "changelog-order: " v " is not older than " prev
        prev = v
      }'
    top="$(grep -E '^## ' "$c" | sed -n 1p | sed 's/^## //')"
    want="$(jq -r .version .claude-plugin/plugin.json 2>/dev/null)"
    [ -n "$want" ] && [ "$top" = "$want" ] \
      || echo "changelog-top: newest heading is '$top', plugin.json says '$want'"
  fi
)

printf 'ossify README gate\n'

findings="$(check_plugin "$OSSIFY")"
if [ -z "$findings" ]; then pass "the real tree has no findings"
else fail "the real tree has findings:"; printf '        %s\n' "$findings"; fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# A copy of the files the gate reads, laid out as in the repo: ossify/ beside the root README,
# LICENSE, omp-roles/ and docs/assets/readme/, which the README links to.
make_copy() {
  local d="$1/repo" root
  root="$(cd "$OSSIFY/.." && pwd)"
  mkdir -p "$d/ossify" "$d/docs/assets" "$d/omp-roles"
  cp "$root/README.md" "$root/LICENSE" "$d/"
  cp -R "$root/docs/assets/readme" "$d/docs/assets/"
  cp -R "$OSSIFY/README.md" "$OSSIFY/CHANGELOG.md" "$OSSIFY/skills" "$OSSIFY/tests" "$OSSIFY/.claude-plugin" "$d/ossify/"
  printf '%s\n' "$d/ossify"
}

# control <name> <expected finding prefix> <shell that plants the defect, run inside the copy>
control() {
  local name="$1" want="$2" plant="$3" d out
  d="$(make_copy "$WORK/$name")"
  (cd "$d" && eval "$plant") || { fail "control $name: the plant did not apply"; return; }
  out="$(check_plugin "$d")"
  if printf '%s\n' "$out" | grep -Fq "$want"; then pass "control $name: $want"
  else fail "control $name: expected '$want', got: ${out:-nothing}"; fi
}

clean="$(make_copy "$WORK/clean")"
out="$(check_plugin "$clean")"
if [ -z "$out" ]; then pass "control clean: an unchanged copy has no findings"
else fail "control clean: an unchanged copy has findings: $out"; fi

control h1-version    "h1: first line"                   "sed '1s/.*/# ossify (v1.0.0)/' README.md > t && mv t README.md"
control history       "history: line"                    "printf 'Since 1.2.0, a note.\n' >> README.md"
control history-fence "history: line"                    "printf '\x60\x60\x60\nx\n\x60\x60\x60\nSince 2.0.1 (#1), a note.\n' >> README.md"
control command-row   "command-row: no table row names /ossify:frobnicate" "mkdir skills/frobnicate"
control link          "link: ./no-such-file.md"          "printf 'See [x](./no-such-file.md#part).\n' >> README.md"
control link-src      "link: ../docs/assets/readme/missing.svg" "printf '<img src=\"../docs/assets/readme/missing.svg\">\n' >> README.md"
control codex-worker  "codex-worker:"                    "sed 's/Codex has no worker path/Codex has a worker path/' README.md > t && mv t README.md"
control order         "changelog-order: 1.36.6 is not older than 1.36.5" "awk '/^## 1.36.6\$/{print \"## 1.36.5\"; print \"\"; print \"x\"; print \"\"} {print}' CHANGELOG.md > t && mv t CHANGELOG.md"
control order-shape   "changelog-order: heading"         "printf '## Unreleased\n' >> CHANGELOG.md"
control top           "changelog-top: newest heading"    "jq '.version = \"9.9.9\"' .claude-plugin/plugin.json > t && mv t .claude-plugin/plugin.json"

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
