#!/usr/bin/env bash
# The mods' shared readers are copied, never imported (plugins do not import each other).
# This holds every copy byte-identical to its source, declaration by declaration. A copy
# that lacks a declaration fails: an empty extraction is never a match.
#
# Three pairs. seat-mods' shell reader in molt's shell.ts. autonomic's bell to molt's
# (#718). seat-mods' redactor to autonomic's (#873). Same rule, same extractor: a copy
# that drifts fails CI.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# decl <file> <name>: the declaration's comment block, its first line, and for a
# function every line through its closing "}" at column 0. A const may carry a type
# annotation before its `=` (SECRETS does), so the annotation is allowed.
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

pair "seat-mods/hooks/rules.ts" "molt/hooks/shell.ts" "COMMANDS HEREDOC QUOTED WRAPPERS blankHeredocs blank commandOf tokensOf gitOf"
pair "molt/hooks/register.tsx" "autonomic/hooks/register.tsx" "BELL_TIMEOUT_MS ring"
pair "autonomic/hooks/ledger.ts" "seat-mods/hooks/redact.ts" "SECRETS redact"
exit "$fail"
