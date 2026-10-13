#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
. "$HERE/lib/pin.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
printf 'alpha beta\ngamma\nbeta again\nback\\slash\n' > "$TMP/f"

_pin_outcome() { # run pin in a subshell with fresh counters; print "pass" or "fail"
  ( T_PASS=0; T_FAIL=0; pin "$@" >/dev/null; [ "$T_FAIL" -eq 0 ] && [ "$T_PASS" -eq 1 ] && echo pass || echo fail )
}
t_assert_eq pass "$(_pin_outcome "$TMP/f" 'gamma' l1)"        "pin: exactly once -> pass"
t_assert_eq fail "$(_pin_outcome "$TMP/f" 'delta' l2)"        "pin: zero -> fail"
t_assert_eq fail "$(_pin_outcome "$TMP/f" 'beta' l3)"         "pin: twice on two lines -> fail"
printf 'x x\n' > "$TMP/g"
t_assert_eq fail "$(_pin_outcome "$TMP/g" 'x' l4)"            "pin: twice on one line -> fail"
t_assert_eq pass "$(_pin_outcome "$TMP/f" 'back\slash' l5)"   "pin: a backslash needle is matched literally"
t_assert_eq fail "$(_pin_outcome "$TMP/missing" 'x' l6)"      "pin: unreadable file -> fail"
t_assert_eq fail "$(_pin_outcome "$TMP/f" '' l7)"             "pin: empty needle -> fail"
t_summary
