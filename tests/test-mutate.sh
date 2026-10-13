#!/usr/bin/env bash
# tests/lib/mutate.sh contract (D8). Repo tooling; never ships.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="${MUTATE_SH:-$ROOT/tests/lib/mutate.sh}"
pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); echo "FAIL: $1"; }
eq()  { if [ "$1" = "$2" ]; then ok; else bad "$3 (expected '$1' got '$2')"; fi; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

printf 'a=1\nb=2\n' > "$T/f"; cp "$T/f" "$T/orig"
# KILLED: the suite fails on the mutant.
out="$(bash "$M" "$T/f" 'a=1' 'a=9' -- grep -q 'a=1' "$T/f" 2>&1)"; rc=$?
eq 0 "$rc" "KILLED is rc 0"; case "$out" in *KILLED*) ok;; *) bad "KILLED is reported";; esac
cmp -s "$T/f" "$T/orig" && ok || bad "file restored after KILLED"
case "$out" in *'a=9'*) ok;; *) bad "the mutated line is echoed back";; esac
# SURVIVED: the suite passes on the mutant.
out="$(bash "$M" "$T/f" 'a=1' 'a=9' -- true 2>&1)"; rc=$?
eq 1 "$rc" "SURVIVED is rc 1"; case "$out" in *SURVIVED*) ok;; *) bad "SURVIVED is reported";; esac
cmp -s "$T/f" "$T/orig" && ok || bad "file restored after SURVIVED"
# Refusals leave the file unchanged.
bash "$M" "$T/f" 'zzz' 'y' -- true >/dev/null 2>&1; eq 2 "$?" "<from> absent -> rc 2"
printf 'x\nx\n' > "$T/two"; cp "$T/two" "$T/two.orig"
bash "$M" "$T/two" 'x' 'y' -- true >/dev/null 2>&1; eq 2 "$?" "<from> twice -> rc 2"
cmp -s "$T/two" "$T/two.orig" && ok || bad "file unchanged after a refusal"
bash "$M" "$T/f" '' 'y' -- true >/dev/null 2>&1; eq 2 "$?" "empty <from> -> rc 2"
bash "$M" "$T/f" 'a=1' 'a=1' -- true >/dev/null 2>&1; eq 2 "$?" "<from> = <to> -> rc 2"
bash "$M" "$T/f" 'a=1' 'a=9' true >/dev/null 2>&1; eq 2 "$?" "missing '--' -> rc 2"
bash "$M" "$T/nope" 'a' 'b' -- true >/dev/null 2>&1; eq 2 "$?" "missing file -> rc 2"
# A backslash in <from> is literal.
printf 'p\\q\n' > "$T/bs"
bash "$M" "$T/bs" 'p\q' 'pq' -- grep -qF 'p\q' "$T/bs" >/dev/null 2>&1; eq 0 "$?" "backslash <from> matched literally (KILLED)"
# Uncommitted edits survive byte-identical (the git-checkout incident).
G="$T/repo"; mkdir "$G"; git -C "$G" init -q; printf 'v=1\n' > "$G/x"
git -C "$G" -c user.email=t@t -c user.name=t add x; git -C "$G" -c user.email=t@t -c user.name=t commit -qm init
printf 'v=1\nuncommitted=1\n' > "$G/x"; cp "$G/x" "$T/x.before"
bash "$M" "$G/x" 'v=1' 'v=2' -- true >/dev/null 2>&1
cmp -s "$G/x" "$T/x.before" && ok || bad "uncommitted edits restored byte-identical"
# A TERM during the suite still restores.
printf 'k=1\n' > "$T/s"; cp "$T/s" "$T/s.orig"
bash "$M" "$T/s" 'k=1' 'k=2' -- sleep 30 >/dev/null 2>&1 & mp=$!
for _ in $(seq 1 50); do grep -q 'k=2' "$T/s" 2>/dev/null && break; sleep 0.1; done
kill -TERM "$mp"; wait "$mp" 2>/dev/null
cmp -s "$T/s" "$T/s.orig" && ok || bad "TERM during the suite still restores"
# A DESCENDANT that outlives the suite must not write the target after the
# restore: killing only the direct child leaves the background `sleep 1; echo
# late >> "$F"` alive, and it appends a line to a file the caller believes is
# restored.
printf 'd=1\n' > "$T/d"; cp "$T/d" "$T/d.orig"
F="$T/d" bash "$M" "$T/d" 'd=1' 'd=2' -- bash -c '(sleep 1; echo late >> "$F") & sleep 30' >/dev/null 2>&1 & mp=$!
for _ in $(seq 1 50); do grep -q 'd=2' "$T/d" 2>/dev/null && break; sleep 0.1; done
kill -TERM "$mp"; wait "$mp" 2>/dev/null
sleep 2
cmp -s "$T/d" "$T/d.orig" && ok || bad "a descendant that outlives the suite still leaves the target restored"
# An unlaunchable suite is NO VERDICT - never SURVIVED (rc 1), which reads as
# "the test did not notice the mutation" when in fact nothing ran at all.
printf 'u=1\n' > "$T/u"; cp "$T/u" "$T/u.orig"
out="$(bash "$M" "$T/u" 'u=1' 'u=2' -- no-such-command-zz 2>&1)"; rc=$?
eq 2 "$rc" "an unlaunchable suite -> rc 2, no verdict"
case "$out" in *'could not run'*) ok;; *) bad "the unlaunchable suite is reported";; esac
cmp -s "$T/u" "$T/u.orig" && ok || bad "file restored after an unlaunchable suite"
echo "pass=$pass fail=$fail"; [ "$fail" -eq 0 ]
