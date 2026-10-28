#!/usr/bin/env bash
# The mods' shared readers are copied, never imported (plugins do not import each other).
# This holds every copy byte-identical to its source, declaration by declaration, except a
# renamed copy, whose definition line alone is compared (see renamed below). A copy
# that lacks a declaration fails: an empty extraction is never a match.
#
# One pair, and one renamed copy. The pair is seat-mods' shell reader and its copy in molt's
# shell.ts; the renamed copy is molt's stage path in seat-mods. Same rule, same extractor: a
# copy that drifts fails CI.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# decl <file> <name>: the declaration's comment block, its first line, and for a
# function every line through its closing "}" at column 0. A const may carry a type
# annotation before its `=`, so the annotation is allowed.
decl() {
  awk -v name="$2" '
    function starts(line) {
      return line ~ ("^(export )?const " name "(: [^=]+)? = ") || line ~ ("^(export )?(async )?function " name "\\(")
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

# pair <source> <copies> <names>: every name, declaration by declaration, must be equal
# in the source and in each copy.
pair() {
  local source="$1" copies="$2" names="$3" copy name want got
  for copy in $copies; do
    for name in $names; do
      want="$(decl "$ROOT/$source" "$name")"
      got="$(decl "$ROOT/$copy" "$name")"
      if [ -z "$want" ]; then echo "FAIL: $name not found in $source"; fail=1; continue; fi
      if [ "$want" != "$got" ]; then echo "FAIL: $copy: $name differs from $source"; fail=1
      else echo "ok: $copy: $name"; fi
    done
  done
}

pair "seat-mods/hooks/rules.ts" "molt/hooks/shell.ts" "COMMANDS HEREDOC QUOTED WRAPPERS blankHeredocs substitutionSpans blank commandOf tokensOf gitOf substitutionsOf SUBSTITUTION_TOO_DEEP"

# renamed <source> <name> <copy> <copy name>: a one-line const copied under another name. Only
# the definition line is compared, with the copy's name put back; the comments may differ.
renamed() {
  local want got
  want="$(decl "$ROOT/$1" "$2" | tail -n 1)"
  got="$(decl "$ROOT/$3" "$4" | tail -n 1)"
  if [ -z "$want" ]; then echo "FAIL: $2 not found in $1"; fail=1; return; fi
  if [ -z "$got" ]; then echo "FAIL: $4 not found in $3"; fail=1; return; fi
  if [ "$want" != "${got/const $4/const $2}" ]; then echo "FAIL: $3: $4 differs from $1's $2"; fail=1
  else echo "ok: $3: $4 (molt's $2)"; fi
}

# seat-mods reads molt's stage file to drop its redo while molt acts (#929, #933): a path that
# drifts silently stops the drop.
renamed "molt/hooks/records.ts" stagePath "seat-mods/hooks/records.ts" moltStagePath
exit "$fail"
