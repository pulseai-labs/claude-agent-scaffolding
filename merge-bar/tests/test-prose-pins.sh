#!/usr/bin/env bash
#
# merge-bar — prose pins beyond the fidelity file's cap of ten (#1061 C8).
#
# Same rule as test-fidelity-pins.sh: a literal sentence occurs EXACTLY ONCE in its file.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

occurrences() {
  awk -v needle="$2" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }
  ' "$1"
}

pin() {
  path="$PLUGIN_ROOT/$1"
  if [ ! -f "$path" ]; then fail "$3" "no such file: $1"; return 0; fi
  count="$(occurrences "$path" "$2")"
  if [ "$count" -eq 1 ]; then pass "$3"; else fail "$3" "found $count times in $1, want 1. pin: $2"; fi
}

section "working-a-pr round stop"
pin "skills/working-a-pr/SKILL.md" \
  "or **change the design**. Recommend the last when a stop's" \
  "the stop offers change the design as a third option, recommended on an Extends: chain"

section "reviewing-a-pr run"
pin "skills/reviewing-a-pr/SKILL.md" \
  "boundary and any network limit; the skill cannot." \
  "the network limit, with the write boundary, is the launcher's"
pin "skills/reviewing-a-pr/SKILL.md" \
  "(not a fork or unknown author)" \
  "naming run vouches only for code that is not a fork or an unknown author's"
pin "skills/reviewing-a-pr/SKILL.md" \
  "the PR's code and Evidence command are trusted" \
  "naming run states the PR's code and Evidence command are trusted"
pin "skills/reviewing-a-pr/SKILL.md" \
  "(a directory outside any git repository" \
  "the run directory is outside any git repository"
pin "skills/reviewing-a-pr/SKILL.md" \
  'd=$(mktemp -d "<run>/axis.XXXXXX") && git -C <checkout> archive HEAD | tar -x -C "$d"' \
  "each axis extracts into a fresh mktemp directory with git -C <checkout> archive"
pin "skills/reviewing-a-pr/SKILL.md" \
  "so the launcher must enforce the write" \
  "the launcher, not the skill, enforces the write boundary of the trusted code"
pin "skills/reviewing-a-pr/SKILL.md" \
  "Each except \`run\` can come as a slash-command flag" \
  "run is not a slash-command flag"

section "review-pr command"
pin "commands/review-pr.md" \
  "a \`--run\` in the arguments is ignored, never run, and the report's \`Run:\` header says so" \
  "the command ignores a --run argument and says so in the Run: header"

section "working-a-pr operator chooses"
pin "skills/working-a-pr/SKILL.md" \
  "The operator chooses at every stop that no standing order settles (next sentence), and no count" \
  "the operator chooses at every stop; merge-bar has no redesign-once cap"

report
