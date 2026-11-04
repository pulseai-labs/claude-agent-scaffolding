#!/usr/bin/env bash
# Root README gate — the mechanical facts of the pulsestack front page (front-page redesign,
# 2026-11). Each fact prints its own finding:
#   heading-order  the H1/H2 headings are exactly the front page's seven, in order;
#   install-link   the pitch links to Install before "## How ossify works";
#   entry-points   /ossify:start and /ossify:adopt both appear before the plugin hub;
#   asset-missing  every docs/assets/readme/ file the README names exists;
#   asset-twin     every -light.svg the README names has its -dark.svg, and the reverse;
#   asset-theme    a -dark.svg only under a prefers-color-scheme: dark <source>; <img> takes -light;
#   svg-size       every docs/assets/readme/*.svg is at most 51200 bytes (every install clones it);
#   svg-unsafe     no <script, <foreignObject, @import, @font-face, or http(s) href in an SVG;
#   svg-font       no font-size below 11 in an SVG (unreadable at phone width);
#   history        no release history or version label on the front page;
#   link           every relative link, src or srcset target exists;
#   summary-blank  a blank line follows every </summary> (GitHub renders the block as Markdown
#                  only after one).
# What it leaves to review: whether each sentence and diagram edge is true, and how the page looks.
#
# Usage: bash tests/test-root-readme.sh
# Deps:  bash 3.2+, git, awk, grep, sed, wc.
set -u
export LC_ALL=C
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

HEADINGS='# pulsestack
## How ossify works
## How the plugins fit together
## One AI workspace, clean product repos
## Install
## All plugins
## License'

# README lines outside fenced code blocks, as "<line-number>:<text>".
prose_lines() {
  awk '/^[[:space:]]*(```|~~~)/ { fence = !fence; next } !fence { print NR ":" $0 }' "$1"
}

# First line number of a fixed string in prose, or 0.
line_of() {
  prose_lines "$1" | awk -v s="$2" 'index(substr($0, index($0, ":") + 1), s) { sub(/:.*/, ""); print; found = 1; exit } END { if (!found) print 0 }'
}

# Every defect in the tree at $1, one line each, prefixed by its fact. Always returns 0.
check_readme() (
  cd "$1" || exit 0
  local r=README.md got n_install n_ossify n_hub ref f twin size bad fs target path
  [ -f "$r" ] || { echo "heading-order: no README.md"; exit 0; }

  got="$(prose_lines "$r" | sed 's/^[0-9]*://' | grep -E '^##? ' || true)"
  [ "$got" = "$HEADINGS" ] || echo "heading-order: headings are [$(printf '%s' "$got" | tr '\n' '|')]"

  n_install="$(line_of "$r" '[Install](#install)')"
  n_ossify="$(line_of "$r" '## How ossify works')"
  n_hub="$(line_of "$r" '## How the plugins fit together')"
  if [ "$n_install" -eq 0 ] || [ "$n_ossify" -eq 0 ] || [ "$n_install" -gt "$n_ossify" ]; then
    echo "install-link: [Install](#install) is not before ## How ossify works"
  fi
  for ref in /ossify:start /ossify:adopt; do
    n="$(line_of "$r" "$ref")"
    if [ "$n" -eq 0 ] || [ "$n_hub" -eq 0 ] || [ "$n" -gt "$n_hub" ]; then
      echo "entry-points: $ref is not before ## How the plugins fit together"
    fi
  done

  for ref in $(grep -oE 'docs/assets/readme/[A-Za-z0-9._-]+' "$r" | sort -u); do
    [ -f "$ref" ] || echo "asset-missing: $ref"
    case "$ref" in
      *-light.svg) twin="${ref%-light.svg}-dark.svg" ;;
      *-dark.svg) twin="${ref%-dark.svg}-light.svg" ;;
      *) continue ;;
    esac
    grep -qF "$twin" "$r" || echo "asset-twin: $ref has no $twin in README.md"
  done

  # The dark variant only ever under a dark <source>; the <img> fallback is the light one.
  grep -nE 'docs/assets/readme/[A-Za-z0-9._-]+-(dark|light)\.svg' "$r" | while IFS= read -r hit; do
    ref="$(printf '%s' "$hit" | grep -oE 'docs/assets/readme/[A-Za-z0-9._-]+-(dark|light)\.svg' | head -1)"
    case "$ref:$hit" in
      *-dark.svg:*'<img'*) echo "asset-theme: $ref is the <img> fallback" ;;
      *-dark.svg:*'prefers-color-scheme: dark'*) ;;
      *-dark.svg:*) echo "asset-theme: $ref is not under a prefers-color-scheme: dark source" ;;
      *-light.svg:*'prefers-color-scheme: dark'*) echo "asset-theme: $ref is under the dark source" ;;
    esac
  done

  for f in docs/assets/readme/*.svg; do
    [ -f "$f" ] || continue
    size="$(wc -c < "$f" | tr -d ' ')"
    [ "$size" -le 51200 ] || echo "svg-size: $f is $size bytes"
    for bad in '<script' '<foreignObject' '@import' '@font-face'; do
      grep -qiF "$bad" "$f" && echo "svg-unsafe: $f: $bad"
    done
    grep -qiE 'href="https?:' "$f" && echo "svg-unsafe: $f: external href"
    for fs in $(grep -oE 'font-size[=:][[:space:]]*"?[0-9.]+' "$f" | grep -oE '[0-9.]+$'); do
      awk -v v="$fs" 'BEGIN { exit !(v < 11) }' && echo "svg-font: $f: $fs"
    done
  done

  # Every line, fenced or not: the old Layout tree carried its version labels inside a fence.
  grep -nE 'Since [0-9]+\.[0-9]+|\(v[0-9]+\.[0-9]+\.[0-9]+\)|\| v[0-9]+\.[0-9]+' "$r" \
    | sed 's/^\([0-9]*\):.*/history: line \1/'

  for target in $(prose_lines "$r" | sed 's/^[0-9]*://' \
      | grep -oE '\]\([^)]+\)|(src|srcset|href)="[^"]+"' \
      | sed -E 's/^\]\(//; s/\)$//; s/^(src|srcset|href)="//; s/"$//'); do
    case "$target" in http://*|https://*|mailto:*|\#*) continue ;; esac
    path="${target%%#*}"; path="${path#./}"
    [ -n "$path" ] || continue
    [ -e "$path" ] || echo "link: $target"
  done

  awk '/<\/summary>/ { want = NR; next } want { if ($0 != "") print "summary-blank: line " want; want = 0 }' "$r"
  exit 0
)

printf 'root README gate\n'

out="$(check_readme "$ROOT")"
if [ -z "$out" ]; then pass "shipped README has no findings"
else
  fail "shipped README has $(printf '%s\n' "$out" | grep -c .) finding(s):"
  printf '%s\n' "$out" | sed 's/^/        /'
fi

# Controls: build a scratch tree (see make_fixture), plant one defect, and require that fact's
# finding. A check whose control stays green is broken.
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
make_fixture() { # README.md and docs/assets/readme/ are real copies (controls edit them); every
  # other top-level entry, and every other docs/ entry, is a symlink, so the link check still
  # resolves and a control writes kilobytes, not a copy of the tree.
  local e
  mkdir -p "$1/docs/assets/readme"
  cp "$ROOT/README.md" "$1/README.md"
  cp "$ROOT"/docs/assets/readme/* "$1/docs/assets/readme/" 2>/dev/null
  for e in "$ROOT"/* "$ROOT"/.[!.]*; do
    case "${e##*/}" in README.md|docs|.git|'.[!.]*') continue ;; esac
    ln -s "$e" "$1/${e##*/}"
  done
  for e in "$ROOT"/docs/*; do
    case "${e##*/}" in assets) continue ;; esac
    ln -s "$e" "$1/docs/${e##*/}"
  done
  for e in "$ROOT"/docs/assets/*; do
    case "${e##*/}" in readme) continue ;; esac
    ln -s "$e" "$1/docs/assets/${e##*/}"
  done
}
control() { # $1=label $2=expected finding text $3=planting command (run in the fixture dir)
  local d="$WORK/$1" o
  make_fixture "$d"; (cd "$d" && eval "$3")
  o="$(check_readme "$d")"
  if printf '%s' "$o" | grep -Fq -- "$2"; then pass "control $1 turns red"
  else fail "control $1: want a finding containing '$2'"; fi
}
SVG_OK='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text font-size="12">x</text></svg>'
control history     "history: line"                      "printf 'Since 1.2.0, it does more.\n' >> README.md"
control version     "history: line"                      "printf '\x60\x60\x60\nossify/ (v1.0.0)\n\x60\x60\x60\n' >> README.md"
control twin        "asset-twin: docs/assets/readme/zz-light.svg" "printf '%s' '$SVG_OK' > docs/assets/readme/zz-light.svg && printf '<img src=\"docs/assets/readme/zz-light.svg\">\n' >> README.md"
control missing     "asset-missing: docs/assets/readme/nope.svg" "printf '<img src=\"docs/assets/readme/nope.svg\">\n' >> README.md"
control script      "svg-unsafe: docs/assets/readme/zz.svg: <script" "printf '%s' '<svg><script>x</script></svg>' > docs/assets/readme/zz.svg"
control href        "svg-unsafe: docs/assets/readme/zz.svg: external href" "printf '%s' '<svg><image href=\"https://x.test/a.png\"/></svg>' > docs/assets/readme/zz.svg"
control font        "svg-font: docs/assets/readme/zz.svg: 9" "printf '%s' '<svg><text font-size=\"9\">x</text></svg>' > docs/assets/readme/zz.svg"
control size        "svg-size: docs/assets/readme/zz.svg" "head -c 51201 /dev/zero | tr '\\\\0' ' ' > docs/assets/readme/zz.svg"
control summary     "summary-blank: line"                "printf '<details><summary>x</summary>\nraw\n</details>\n' >> README.md"
control link        "link: ./no-such-dir/"               "printf 'See [x](./no-such-dir/).\n' >> README.md"
control swap        "asset-theme: docs/assets/readme/ossify-skeleton-dark.svg" "sed -i 's/ossify-skeleton-dark.svg/TMPX/; s/ossify-skeleton-light.svg/ossify-skeleton-dark.svg/; s/TMPX/ossify-skeleton-light.svg/' README.md"
control order       "heading-order:"                     "awk '{ if (\$0 == \"## Install\") print \"## All plugins\"; else if (\$0 == \"## All plugins\") print \"## Install\"; else print }' README.md > t && mv t README.md"
# Adjacent control: the copied tree itself is clean, so the gate is not just matching everything.
d="$WORK/clean"; make_fixture "$d"
o="$(check_readme "$d")"
if [ -z "$o" ]; then pass "control clean copy stays green"
else fail "control clean copy: want no findings, got $(printf '%s\n' "$o" | grep -c .)"; fi

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
