#!/usr/bin/env bash
# tests/lib/mutate.sh - one mutation test, done safely. Repo tooling; it never ships.
#
#   tests/lib/mutate.sh <file> <from> <to> -- <suite command...>
#
# Replaces the ONE literal occurrence of <from> in <file> by <to>, proves the
# file changed (and prints the mutated line), runs the suite from the caller's
# cwd, then restores <file> from a copy saved first - never from git, which
# would also drop uncommitted work in the file (a `git checkout --` restore
# once destroyed an uncommitted fix).
#
#   rc 0  KILLED    the suite failed on the mutant - the test can fail
#   rc 1  SURVIVED  the suite passed on the mutant - the test did not notice
#   rc 2  refused or no verdict - bad arguments, <from> not exactly once, or no
#         change (file untouched); or the suite could not run at all (rc 126/127,
#         file restored)
#   rc 3  restore failed - the original is at the printed backup path
#
# It cannot check the third mutation condition: that the mutated line RUNS on
# the path the suite exercises. A SURVIVED on a line the fixtures never reach
# says nothing about the test. That judgment stays with the caller.
set -uo pipefail

die() { echo "mutate: $1" >&2; exit "${2:-2}"; }

[ "$#" -ge 5 ] || die "usage: mutate.sh <file> <from> <to> -- <suite command...>"
file="$1"; from="$2"; to="$3"; shift 3
[ "$1" = "--" ] || die "usage: the suite command follows '--'"
shift
[ -f "$file" ] && [ ! -L "$file" ] || die "not a regular file: $file"
[ -n "$from" ] || die "<from> is empty"
case "$from$to" in *$'\n'*) die "<from> and <to> must be single-line";; esac
[ "$from" != "$to" ] || die "<from> and <to> are the same"

count="$(MUT_FROM="$from" awk 'BEGIN { n = ENVIRON["MUT_FROM"]; c = 0 }
  { s = $0; while ((i = index(s, n)) > 0) { c++; s = substr(s, i + length(n)) } }
  END { print c }' "$file")"
[ "$count" -eq 1 ] || die "<from> occurs $count times in $file; it must occur exactly once"

bak_dir="$(mktemp -d "${TMPDIR:-/tmp}/mutate.XXXXXX")" || die "mktemp failed"
bak="$bak_dir/$(basename "$file")"
cp -p "$file" "$bak" || die "could not save a copy of $file"

restored=0; child=""
restore() { cat "$bak" > "$file" && cmp -s "$bak" "$file"; }
on_exit() {
  [ "$restored" -eq 1 ] && return
  if restore; then rm -rf "$bak_dir"
  else echo "mutate: RESTORE FAILED - the original is at $bak" >&2; fi
}
on_signal() {
  if [ -n "$child" ]; then
    kill -TERM -- "-$child" 2>/dev/null
    wait "$child" 2>/dev/null
    kill -KILL -- "-$child" 2>/dev/null
  fi
  exit "$1"
}
trap on_exit EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

mut="$bak_dir/mutant"
MUT_FROM="$from" MUT_TO="$to" awk 'BEGIN { n = ENVIRON["MUT_FROM"]; r = ENVIRON["MUT_TO"] }
  { i = index($0, n)
    if (i > 0) { print substr($0, 1, i - 1) r substr($0, i + length(n)); print NR > "/dev/stderr" }
    else print }' "$file" > "$mut" 2> "$bak_dir/line" || die "the mutation could not be written"
cat "$mut" > "$file" || die "the mutation could not be written"
cmp -s "$bak" "$file" && die "the file did not change"
ln="$(cat "$bak_dir/line")"
echo "mutate: $file:$ln: $(sed -n "${ln}p" "$file")"

# `set -m` gives the suite its OWN process group (a job-control background job,
# pgid == $child), so the signal path and the normal path can kill everything the
# suite started. Without it a descendant survives the direct child: `(sleep 1;
# echo late >> "$F") &` still holds the file and appends to it AFTER the restore,
# into a file the caller believes is restored (PR #772 round 1).
set -m
"$@" & child=$!
set +m
wait "$child"; suite_rc=$?
# Nothing the suite started may write after the restore.
kill -KILL -- "-$child" 2>/dev/null
child=""

if restore; then restored=1; rm -rf "$bak_dir"
else restored=1; echo "mutate: RESTORE FAILED - the original is at $bak" >&2; exit 3; fi

# A suite that could not run is NO VERDICT. Left on the normal path, a missing
# suite command reports 127 - nonzero, so the run would be reported as KILLED,
# "the test can fail", from a suite that never started.
case "$suite_rc" in 126|127)
  echo "mutate: the suite could not run (rc $suite_rc) - no verdict" >&2; exit 2 ;; esac

if [ "$suite_rc" -ne 0 ]; then echo "KILLED (suite rc $suite_rc): $file:$ln"; exit 0; fi
echo "SURVIVED: $file:$ln - the suite passed with the mutation in place"; exit 1
