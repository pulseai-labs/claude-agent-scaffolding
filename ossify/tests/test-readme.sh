#!/usr/bin/env bash
# ossify README and CHANGELOG gate — the mechanical facts of the plugin page (README rewrite,
# 2026-11). Each fact prints its own finding:
#   h1               the README's first line is exactly "# ossify", with no version label;
#   history          no "Since x.y" line on the README: release notes go to CHANGELOG.md;
#   command-row      every skills/<name>/ has a README table row whose Command cell (the second)
#                    starts with /ossify:<name>; a mention in another row does not count;
#   link             every relative link, src or srcset target on the README exists;
#   anchor           every in-page link (#x) names a heading on the README, by GitHub's slug;
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
    awk -F'|' -v want="/ossify:$n" '
      /^[[:space:]]*(```|~~~)/ { fence = !fence; next }
      !fence && /^\|/ { c = $3; sub(/^[[:space:]]*`?/, "", c); if (c ~ ("^" want "[ `]")) found = 1 }
      END { exit !found }' "$r" || echo "command-row: no table row has /ossify:$n as its command"
  done

  prose_lines "$r" \
    | grep -oE '\]\([^)]*\)|(src|srcset|href)="[^"]*"' \
    | sed -E 's/^\]\(//; s/\)$//; s/^(src|srcset|href)="//; s/"$//; s/#.*//' \
    | grep -vE '^(https?:|mailto:|$)' \
    | sort -u \
    | while IFS= read -r t; do
        [ -e "$t" ] || echo "link: $t does not exist"
      done

  slugs="$(prose_lines "$r" | sed 's/^[0-9]*://' | grep -E '^#{1,6} ' \
    | sed -E 's/^#+ //' | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9 _-]//g; s/ /-/g')"
  prose_lines "$r" | grep -oE '\]\(#[^)]*\)' | sed -E 's/^\]\(#//; s/\)$//' | sort -u \
    | while IFS= read -r a; do
        printf '%s\n' "$slugs" | grep -Fxq "$a" || echo "anchor: #$a names no heading"
      done

  prose_lines "$r" | sed 's/<!--.*-->//g' | grep -Fq 'Codex has no worker path' || echo "codex-worker: the README no longer says 'Codex has no worker path'"

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
# LICENSE, omp-roles/ and docs/assets/readme/, which the README links to. Only what the README
# links to is copied (about 1 MB per control), not the whole tests/ tree.
make_copy() {
  local d="$1/repo" root
  root="$(cd "$OSSIFY/.." && pwd)"
  mkdir -p "$d/ossify" "$d/docs/assets" "$d/omp-roles"
  cp "$root/README.md" "$root/LICENSE" "$d/"
  cp -R "$root/docs/assets/readme" "$d/docs/assets/"
  cp -R "$OSSIFY/README.md" "$OSSIFY/CHANGELOG.md" "$OSSIFY/skills" "$OSSIFY/.claude-plugin" "$d/ossify/"
  mkdir -p "$d/ossify/tests/eval" && cp "$OSSIFY/tests/eval/RUNBOOK.md" "$d/ossify/tests/eval/"
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

# quiet <name> <finding prefix that must NOT appear> <plant>: a must-still-pass control.
quiet() {
  local name="$1" absent="$2" plant="$3" d out
  d="$(make_copy "$WORK/$name")"
  (cd "$d" && eval "$plant") || { fail "control $name: the plant did not apply"; return; }
  out="$(check_plugin "$d")"
  if printf '%s\n' "$out" | grep -Fq "$absent"; then fail "control $name: '$absent' must not appear, got: $out"
  else pass "control $name: no '$absent'"; fi
}

clean="$(make_copy "$WORK/clean")"
out="$(check_plugin "$clean")"
if [ -z "$out" ]; then pass "control clean: an unchanged copy has no findings"
else fail "control clean: an unchanged copy has findings: $out"; fi

control h1-version    "h1: first line"                   "sed '1s/.*/# ossify (v1.0.0)/' README.md > t && mv t README.md"
control history       "history: line"                    "printf 'Since 1.2.0, a note.\n' >> README.md"
control history-fence "history: line"                    "printf '\x60\x60\x60\nx\n\x60\x60\x60\nSince 2.0.1 (#1), a note.\n' >> README.md"
control command-row   "command-row: no table row has /ossify:frobnicate as its command" "mkdir skills/frobnicate"
control row-mentioned "command-row: no table row has /ossify:adopt as its command" "grep -v '^| Bring in a codebase' README.md > t && mv t README.md"
control row-prefix    "command-row: no table row has /ossify:handoff as its command" "grep -v '^| Hand the work' README.md > t && mv t README.md"
control anchor        "anchor: #no-such-heading names no heading" "printf 'See [x](#no-such-heading).\n' >> README.md"
control link          "link: ./no-such-file.md"          "printf 'See [x](./no-such-file.md#part).\n' >> README.md"
control link-src      "link: ../docs/assets/readme/missing.svg" "printf '<img src=\"../docs/assets/readme/missing.svg\">\n' >> README.md"
control codex-worker  "codex-worker:"                    "sed 's/Codex has no worker path/Codex has a worker path/' README.md > t && mv t README.md"
control order         "changelog-order: 1.36.6 is not older than 1.36.5" "awk '/^## 1.36.6\$/{print \"## 1.36.5\"; print \"\"; print \"x\"; print \"\"} {print}' CHANGELOG.md > t && mv t CHANGELOG.md"
control order-shape   "changelog-order: heading"         "printf '## Unreleased\n' >> CHANGELOG.md"
control top           "changelog-top: newest heading"    "jq '.version = \"9.9.9\"' .claude-plugin/plugin.json > t && mv t .claude-plugin/plugin.json"
control history-2part "history: line"                    "printf 'Since 1.14, a note.\n' >> README.md"
control row-not-first "command-row: no table row has /ossify:adopt as its command" "awk -v b=\"\$(printf '\\140')\" '{ x = \"| \" b \"/ossify:adopt\" b \" |\"; i = index(\$0, x); if (i) \$0 = substr(\$0, 1, i + 1) \"see \" substr(\$0, i + 2); print }' README.md > t && mv t README.md && grep -q 'see ./ossify:adopt' README.md"
control row-in-fence  "command-row: no table row has /ossify:adopt as its command" "grep -v '^| Bring in a codebase' README.md > t && printf '\x60\x60\x60\n| x | \x60/ossify:adopt\x60 | y |\n\x60\x60\x60\n' >> t && mv t README.md"
control anchor-near   "anchor: #command names no heading" "printf 'See [x](#command).\n' >> README.md"
control link-href     "link: ./nope.md"                  "printf '<a href=\"./nope.md\">x</a>\n' >> README.md"
control codex-comment "codex-worker:"                    "sed 's/Codex has no worker path/Codex has a worker path/' README.md > t && printf '<!-- Codex has no worker path -->\n' >> t && mv t README.md"
control order-dup     "changelog-order: 1.36.6 is not older than 1.36.6" "awk '/^## 1.36.5\$/{print \"## 1.36.6\"; print \"\"; print \"x\"; print \"\"} {print}' CHANGELOG.md > t && mv t CHANGELOG.md"
control no-changelog  "changelog-order: CHANGELOG.md is missing" "rm CHANGELOG.md"
quiet   fence-exempt  "history:"                         "printf '\x60\x60\x60\nSince 1.2.0, quoted in a fence.\n\x60\x60\x60\n' >> README.md"

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
