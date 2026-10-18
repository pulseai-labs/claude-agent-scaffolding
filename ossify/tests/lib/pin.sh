#!/usr/bin/env bash
# pin <file> <needle> <label> - the fixed-string needle must occur EXACTLY once.
#
# "At least once" (`grep -Fq`) cannot see the loss it guards when the same words
# occur elsewhere in the file: delete the guarded sentence and the other copy
# keeps the check green (pulse360 `verify-step-halt-swallowed-false-pass`).
# crew/tests/_helpers.sh has the same contract. Source after harness.sh.
pin() {
  local c
  if [ ! -r "$1" ] || [ -z "$2" ]; then
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $3 (unreadable file or empty needle: $1)"; return 0
  fi
  c="$(PIN_NEEDLE="$2" awk 'BEGIN { n = ENVIRON["PIN_NEEDLE"]; c = 0 }
    { s = $0; while ((i = index(s, n)) > 0) { c++; s = substr(s, i + length(n)) } }
    END { print c }' "$1")"
  if [ "$c" -eq 1 ]; then T_PASS=$((T_PASS+1))
  elif [ "$c" -eq 0 ]; then T_FAIL=$((T_FAIL+1)); echo "FAIL: $3 (not found in ${1##*/}: $2)"
  else T_FAIL=$((T_FAIL+1)); echo "FAIL: $3 (found $c times in ${1##*/}; a pin must be unique: $2)"
  fi
}
