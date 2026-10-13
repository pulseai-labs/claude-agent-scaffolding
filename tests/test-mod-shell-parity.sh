#!/usr/bin/env bash
# The mods' shared shell reader is copied, never imported (plugins do not import each
# other). This holds every copy byte-identical to seat-mods/hooks/rules.ts, declaration
# by declaration. A copy that lacks a declaration fails: an empty extraction is never
# a match.
#
# A second pair holds autonomic's bell to molt's: `BELL_TIMEOUT_MS` and `ring` are molt's
# own, copied so a hung bell is bounded and not awaited on either side (#718). Same rule,
# same extractor: a copy that drifts fails CI.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/seat-mods/hooks/rules.ts"
COPIES="molt/hooks/shell.ts"
NAMES="COMMANDS HEREDOC QUOTED WRAPPERS blankHeredocs blank commandOf tokensOf gitOf"
BELL_SOURCE="$ROOT/molt/hooks/register.tsx"
BELL_COPIES="autonomic/hooks/register.tsx"
BELL_NAMES="BELL_TIMEOUT_MS ring"

# decl <file> <name>: the declaration's comment block, its first line, and for a
# function every line through its closing "}" at column 0.
decl() {
  awk -v name="$2" '
    function starts(line) {
      return line ~ ("^(export )?const " name " = ") || line ~ ("^(export )?(async )?function " name "\\(")
    }
    /^\/\// { buf = buf $0 "\n"; next }
    starts($0) {
      printf "%s%s\n", buf, $0
      if ($0 ~ /^(export )?(async )?function /) { infn = 1; next }
      exit
    }
    infn { print; if ($0 ~ /^}/) exit; next }
    { buf = "" }
  ' "$1"
}

fail=0
for copy in $COPIES; do
  for name in $NAMES; do
    want="$(decl "$SOURCE" "$name")"
    got="$(decl "$ROOT/$copy" "$name")"
    if [ -z "$want" ]; then echo "FAIL: $name not found in seat-mods/hooks/rules.ts"; fail=1; continue; fi
    if [ "$want" != "$got" ]; then echo "FAIL: $copy: $name differs from seat-mods"; fail=1
    else echo "ok: $copy: $name"; fi
  done
done
for copy in $BELL_COPIES; do
  for name in $BELL_NAMES; do
    want="$(decl "$BELL_SOURCE" "$name")"
    got="$(decl "$ROOT/$copy" "$name")"
    if [ -z "$want" ]; then echo "FAIL: $name not found in molt/hooks/register.tsx"; fail=1; continue; fi
    if [ "$want" != "$got" ]; then echo "FAIL: $copy: $name differs from molt/hooks/register.tsx"; fail=1
    else echo "ok: $copy: $name"; fi
  done
done
exit "$fail"
