#!/usr/bin/env bash
# herdr-crew test helpers — sourced by every suite in this directory.
#
# Four plugins in this marketplace — code-judo, dsh-crew, orca-crew and this one —
# keep the colour setup, pass/fail and the report line in a `_helpers.sh` rather
# than one copy per suite; the other five carry a different set of primitives
# (`assert_*` and temp helpers). This follows the first shape rather than inventing
# a third one.
#
# The literal counters and the pin/present wrappers live here for a different
# reason (#514, L1): this plugin had grown four definitions of one awk loop across
# the suites plus three more inline in test-config-contract.sh, and one of the four
# had already lost the `[ -f ]` guard the other three carry — which is what a copy
# does when nothing asserts the shape. Measured when this was written: no sibling
# `_helpers.sh` in this marketplace defines them, so this is the first hoist of its
# kind here rather than a house shape. test-fidelity-pins.sh is the one exception,
# named where it is exempted at the bottom of this file.

PASS=0
FAIL=0

if [ -t 1 ]; then
  GREEN=$(printf '\033[32m'); RED=$(printf '\033[31m'); DIM=$(printf '\033[2m'); RST=$(printf '\033[0m')
else
  GREEN=""; RED=""; DIM=""; RST=""
fi

pass() { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$GREEN" "$RST" "$1"; }

fail() {
  FAIL=$((FAIL+1))
  printf '  %s✗%s %s\n' "$RED" "$RST" "$1"
  [ -n "${2:-}" ] && printf '      %s%s%s\n' "$DIM" "$2" "$RST"
  return 0
}

section() { printf '\n%s%s%s\n' "$DIM" "── $1 ──" "$RST"; }

report() {
  printf '\n%s──%s %d passed, %d failed\n' "$DIM" "$RST" "$PASS" "$FAIL"
  [ "$FAIL" -eq 0 ] || return 1
  return 0
}

# ── literal counting ────────────────────────────────────────────────────────
#
# One loop, one definition, four joins. index() is a LITERAL substring test, so
# it is NOT equivalent to grep -E, grep -w or grep -x; every counter below is
# literal on purpose. `grep -c` counts matching LINES rather than occurrences, so
# it cannot see a duplicate on one line, and `… | grep -q` in a pipeline can fail
# on a true match under pipefail.
#
# An empty needle is REFUSED, not counted: index(line, "") always returns 1 and
# substr(line, 1) returns the whole line, so the loop never advances — the count
# climbs forever and the suite hangs instead of failing.
count_literal() { # <needle> — the text to search arrives on stdin
  if [ -z "${1:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  awk -v needle="$1" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }'
}

# Occurrences of a literal substring, counted PER LINE: a needle that spans a
# markdown line wrap reads as absent rather than as present, so a passing pin is
# provably on one line. A file that cannot be opened is REFUSED rather than
# counted — a count is what a clean file returns, so returning 0 for a file
# nobody opened would certify it.
occurrences() { # <file> <needle>
  if [ -z "${2:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  [ -f "${1:-}" ] || { printf 'no such file: %s\n' "${1:-}" >&2; return 1; }
  count_literal "$2" < "$1"
}

# Occurrences in the file read as ONE logical line: every whitespace run is
# squeezed to a single space first, which reassembles the space a markdown wrap
# broke at. `pin` counts per line, which is right for its pins; this counter is
# for a pin whose SUBJECT is a phrase a restatement may break anywhere, where a
# per-line count would report "defined once" for a file that defines the phrase
# twice, wrapped differently. Note the join is by SQUEEZING, not by deleting the
# newline: the phrase's words are separated by the very space the wrap consumed.
# (A name is space-less, so the config suite's personal-name sweep deletes
# newlines instead — it funnels through count_literal for the loop, not this.)
#
# Two bounds come with that join, both accepted: an ABSENCE pin over a squeezed
# line also catches a reintroduction that wraps differently, which a per-line pin
# would miss; and a false POSITIVE needs the surrounding prose to spell the needle
# across a line boundary, which a restatement does and arbitrary text does not.
#
# The join is CAPTURED, not piped. A pipeline's status is its LAST command's, and
# count_literal succeeds on empty input — so an awk that could not open the file
# (an existing but unreadable one, which the `[ -f ]` guard above lets through)
# came back as `0` with rc=0, and a flat ABSENCE check certified a file nobody
# read. Capturing makes awk's failure this function's failure.
occurrences_flat() { # <file> <needle>
  if [ -z "${2:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  [ -f "${1:-}" ] || { printf 'no such file: %s\n' "${1:-}" >&2; return 1; }
  _flat="$(awk '{ buf = buf " " $0 }
    END { gsub(/[[:space:]]+/, " ", buf); print buf }' "$1")" || {
    printf 'cannot read: %s\n' "${1:-}" >&2; return 1; }
  printf '%s\n' "$_flat" | count_literal "$2"
}

count_of() { # <file> <needle> [line|flat]
  if [ "${3:-line}" = flat ]; then occurrences_flat "$1" "$2"; else occurrences "$1" "$2"; fi
}

# pin <file> <needle> <label> [line|flat] — the needle must occur EXACTLY once.
# The zero-count message is MODE-AWARE. Per line, a wrap is the common way a pin
# that is still true stops being counted, so it names that. In flat mode the join
# squeezes every whitespace run, so a wrap cannot be the cause of a zero — naming
# one there would send the investigator after a phantom.
pin() {
  c="$(count_of "$1" "$2" "${4:-line}")" || { fail "$3" "unreadable file or empty needle: $1"; return 0; }
  if [ "$c" -eq 1 ]; then pass "$3"
  elif [ "$c" -eq 0 ]; then
    if [ "${4:-line}" = flat ]; then
      fail "$3" "not found in ${1##*/}, however it wraps — the flat count squeezes every whitespace run, so this is a reworded-away clause, not a wrap. pin: $2"
    else
      fail "$3" "not found in ${1##*/} — reworded away, or the pin now spans a line wrap. pin: $2"
    fi
  else fail "$3" "found $c times in ${1##*/}; a pin must be unique. pin: $2"
  fi
}

# present <file> <needle> <label> [line|flat] — at least once.
present() {
  c="$(count_of "$1" "$2" "${4:-line}")" || { fail "$3" "unreadable file or empty needle: $1"; return 0; }
  if [ "$c" -ge 1 ]; then pass "$3"; else fail "$3" "not found in ${1##*/}: $2"; fi
}

# ── the hoisted definitions cannot be re-copied silently ────────────────────
#
# A suite-local definition SHADOWS the one above: every assertion that calls it
# keeps passing, so a re-copied loop is invisible until the day it drifts — which
# is how the fourth copy lost its guard. Two halves assert the shape, split by
# whose answer can differ:
#
#   assert_hoisted_counters  THIS suite's own file, so it stays with the caller —
#                            one awk pass over one file
#   assert_hoist_shape       the whole directory, whose answer cannot differ
#                            between callers, so it is called ONCE per full run
#                            rather than repeating the same violation three times
#
# test-fidelity-pins.sh is the one exemption, NAMED rather than implied by its
# absence. It keeps its own copies because it is orca-crew's apart from the plugin
# name — the two files differ first at byte 25, in that name — and
# tests/test-herdr-crew-parity.sh pins them by comparing `cmp` over the two streams
# AFTER substituting the plugin name, not the files themselves. An edit here —
# including adding the missing guard — lands in one copy only and fails that CI
# step. The exemption is asserted in both directions, so it cannot outlive its
# reason: when orca-crew is retired, hoist that copy too and delete both this
# paragraph and the exemption. A suite that legitimately wants one of these names
# for something else must extend the list deliberately.
HOISTED_FNS="count_literal occurrences occurrences_flat count_of pin present"
HOISTED_EXEMPT="test-fidelity-pins.sh"

# Definitions of any of <fn>... that OPEN a function in <file>, as
# "<total> [<fn> <count>]..." on one line — never empty on a successful read, so an
# empty result is a FAILED READ and not a clean file. That distinction is the whole
# point: an unreadable file used to yield an empty count whose arithmetic error read
# as "no copies here", skipping the file in silence.
#
# One awk pass decides it by this rule: at the START of a logical line — indentation
# aside — a NAME followed by `()`, every whitespace run around and inside the parens
# allowed to be a run of any length (`pin ( ) {` and `pin<TAB>()<TAB>{` are the same
# rule as `pin() {`), and a `{` group opening on that line or on the first line of code
# after it — blank and comment-only lines in between change nothing; or the `function`
# keyword followed by the name, with or without a body after it, a direction that
# over-counts and is the fail-closed one for a gate. Every spelling below is one that
# rule counts. A shadow does not have to look like the copy it shadows, so each was
# measured TWICE: `bash -n` accepts the fixture, and a bash that sources it defines the
# function — `declare -F` finds it. The second half is not ceremony: `bash -n` alone does
# not establish the first, and `function "pin" {` is the proof — accepted by `bash -n`,
# defines nothing.
#
# A line inside a HEREDOC BODY is data, not code, and is not scanned at all (#599). The
# body is opened by the first `<<` on a line that is not inside a quoted string, and `<<<`
# — a herestring, not an operator — opens none; it ends at the delimiter line, compared
# UNQUOTED, so `<<'X'` ends at a line reading X, with leading tabs stripped for `<<-`. The
# operator is looked for in the same code projection `see()` uses — the trailing comment
# removed — so a `<<` in a comment opens nothing either. Three bounds come with the skip,
# named rather than implied: a quote opened on an EARLIER line is not modelled; a `<<`
# inside arithmetic (`$(( 1 << 2 ))`) is not distinguished from an operator; and a SECOND
# operator on the same line is not tracked, so its body is scanned as code — an over-count,
# which is the fail-closed direction for a gate.
#
# Measured, every `<<` in the files this scan reads is one of three shapes, and each shape
# after the first is pinned by a control in test-config-contract.sh's block:
#
#   the three real operators — `done <<LIST` (test-config-contract.sh), `<<'CTL_EOF'` twice
#   (test-frontmatter-lint.sh); a `<<` inside a quoted string, which is how those controls
#   write their fixtures (`printf "cat <<'X'\n…"`); or a `<<` inside a comment.
#
#   pin() {     pin () {     pin<TAB>()<TAB>{     function pin {     function pin() {
#   function pin () {        <indented>           (any of the above)
#   pin()       + `{` on the next line, with any run of blank and comment-only lines
#               between the two
#   pin () # copied locally   + `{` on the next line
#   pin ( ) {                a whitespace RUN inside the parens, not one space exactly:
#                            `pin<TAB>(<TAB>)<TAB>{` is the same spelling
#   pin () \                 a signature split with a backslash-newline — bash removes the
#     {                      pair before it parses, so where the split falls changes
#                            nothing: between the signature and the brace, between the
#                            name and the parens (`pin \` + `() {`), inside the name
#                            (`pi\` + `n() {`) are one rule, one fixture each
#
# Each spelling here has its own fixture among test-config-contract.sh's spelling
# controls; a spelling listed without one is the same defect as a control that stops
# matching. The reverse is NOT claimed: this is a list of what the rule above counts,
# not a list of every spelling bash accepts. bash accepts more, and two axes outside
# the rule are measured, unfixed and named here rather than left to be implied:
#
#   * bash also takes ANY compound command as a body, so `pin() ( : )` and
#     `pin() if true; then :; fi` define real functions this matcher does not count.
#     Reported as a P2 in this round's seat report (#598), deferred.
#   * both signature tests are anchored to the line START, so a definition sharing its
#     line with another statement is not counted either — measured, `x=1; pin() { :; }`
#     defines `pin` and counts 0. Measured, named here, reported, and unfixed like #598.
#
# The join is the one bash performs on an UNQUOTED backslash-newline. This scan reads
# text, not a parse tree, so it also joins one inside a single-quoted string, where bash
# keeps it. The counting rule above stays quote-blind and this pass changed nothing about
# that: measured, a `pin() {` starting a line inside a multi-line quoted string still
# counts 1, exactly as it did before #599. Only heredoc BODIES are now unread.
#
# A CALL (`pin "$REF" ...`), a COMMENT (`# pin() { ...`) and a bare `name()` with no
# body after it (`pin()` + `foo=1`, which bash rejects) are not definitions: that is why
# the parens, the brace or the `function` keyword are required, and why a bare `name()`
# only counts when the first line of code after it opens a BRACE GROUP — the one body
# form this matcher recognizes, per the body-form bullet above.
count_shadows() { # <file> <fn>...
  awk -v names="$*" '
    BEGIN { n = split(names, a, " "); for (i = 1; i <= n; i++) want[a[i]] = 1 }
    function see(code) {
      sub(/^[[:space:]]+/, "", code)          # an indented definition is a definition
      sub(/[[:space:]]*#.*$/, "", code)       # a trailing comment is not code
      sub(/[[:space:]]+$/, "", code)

      if (waiting != "") {
        if (code == "") return                # a blank or comment-only line: bash still waits for the brace
        if (code ~ /^\{/) { if (waiting in want) hits[waiting]++ }
        waiting = ""
        if (code ~ /^\{/) return
      }
      if (code == "") return

      if (code ~ /^function[[:space:]]+[A-Za-z_][A-Za-z0-9_]*/) {
        name = code; sub(/^function[[:space:]]+/, "", name); sub(/[^A-Za-z0-9_].*$/, "", name)
        if (name in want) hits[name]++
        return
      }
      if (code ~ /^[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\([[:space:]]*\)[[:space:]]*\{/) {
        name = code; sub(/[[:space:]]*\(.*$/, "", name)
        if (name in want) hits[name]++
        return
      }
      if (code ~ /^[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\([[:space:]]*\)[[:space:]]*$/) {
        name = code; sub(/[[:space:]]*\([[:space:]]*\)[[:space:]]*$/, "", name)
        waiting = name
        return
      }
    }
    # Is the character at position `upto` inside a quoted string ON THIS LINE? The
    # test exists for one purpose — placing a `<<` operator (below) — and the rest of
    # this matcher stays the quote-blind text scan it is: a `pin() {` at the start of
    # a line inside a quoted string is still counted, exactly as before.
    function inside_quote(s, upto,   i, c, st) {
      st = ""
      for (i = 1; i < upto; i++) {
        c = substr(s, i, 1)
        if (st == "") {
          if (c == "\\") { i++; continue }
          if (c == "\047" || c == "\042") st = c
          continue
        }
        if (st == "\047") { if (c == "\047") st = ""; continue }
        if (c == "\\") { i++; continue }
        if (c == "\042") st = ""
      }
      return st != ""
    }
    # The index of the first heredoc operator on this line, or 0. `<<<` is a
    # herestring and not an operator; a `<<` inside a quoted string is text.
    function heredoc_op(line,   i, n) {
      n = length(line)
      for (i = 1; i < n; i++) {
        if (substr(line, i, 2) != "<<") continue
        if (substr(line, i + 2, 1) == "<") { i += 2; continue }
        if (inside_quote(line, i)) continue
        return i
      }
      return 0
    }
    # The delimiter word after the operator, with its quoting removed: bash compares
    # the terminator line to the UNQUOTED word, so a quoted delimiter ends at a line
    # reading its own text.
    # A leading `-` sets hd_tabs: `<<-` is terminated by the delimiter with leading
    # TABS stripped. An empty delimiter is not an operator at all (nothing to match),
    # and hd stays empty, so no body is skipped.
    function heredoc_delim(line, op,   i, c, n, out, q) {
      hd_tabs = 0
      n = length(line); i = op + 2
      if (substr(line, i, 1) == "-") { hd_tabs = 1; i++ }
      while (i <= n) { c = substr(line, i, 1); if (c == " " || c == "\t") i++; else break }
      out = ""
      while (i <= n) {
        c = substr(line, i, 1)
        if (c == " " || c == "\t" || c == ";" || c == "|" || c == "&" || c == "(" || c == ")" || c == "<" || c == ">") break
        if (c == "\047" || c == "\042") {
          q = c; i++
          while (i <= n && substr(line, i, 1) != q) { out = out substr(line, i, 1); i++ }
          i++; continue
        }
        if (c == "\\") { i++; if (i <= n) { out = out substr(line, i, 1); i++ }; continue }
        out = out c; i++
      }
      return out
    }
    { line = $0
      if (hd != "") {                                    # a heredoc BODY: data, never code
        body = line
        if (hd_tabs) sub(/^\t+/, "", body)               # `<<-` strips leading tabs from the terminator
        if (body == hd) hd = ""
        next
      }
      if (cont != "") { line = cont $0; cont = "" }      # the join bash performs on an unquoted backslash-newline
      if (line ~ /\\$/) { sub(/\\$/, "", line); cont = line; next }
      code = line
      sub(/[[:space:]]*#.*$/, "", code)                  # the same comment rule see() uses, so an operator in a comment opens nothing
      op = heredoc_op(code)
      if (op > 0) hd = heredoc_delim(code, op)           # the operator line itself is code; the body starts at the next one
      see(line) }
    END {
      if (cont != "") see(cont)                # a file ending in a continuation: no next line to join, and nothing to lose
      total = 0; tail = ""
      for (i = 1; i <= n; i++) if (a[i] in hits) { total += hits[a[i]]; tail = tail " " a[i] " " hits[a[i]] }
      print total tail
    }' "$1"
}

# This suite's own file, from the caller that is running it. Cheap by design.
assert_hoisted_counters() {
  _self="${BASH_SOURCE[1]:-}"
  _shadows="$(count_shadows "$_self" $HOISTED_FNS)"
  if [ -z "$_shadows" ]; then
    fail "the shape scan ran over ${_self##*/}" \
      "it returned nothing — a read that failed would certify the file in silence"
  elif [ "$_shadows" = 0 ]; then
    pass "no copy of a hoisted counter in ${_self##*/}"
  else
    fail "no copy of a hoisted counter in ${_self##*/}" \
      "$_shadows — a local definition shadows the one in _helpers.sh, and every assertion that calls it keeps passing"
  fi
}

# The whole directory, plus the exemption in both directions. Called once per full
# run; the optional directory exists for the controls, which plant a fixture tree.
assert_hoist_shape() { # [directory]
  _dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  _copies=0
  for _suite in "$_dir"/test-*.sh; do
    _rel="${_suite##*/}"
    [ "$_rel" = "$HOISTED_EXEMPT" ] && continue
    if [ ! -r "$_suite" ]; then
      _copies=$((_copies + 1))
      fail "every suite is readable" \
        "$_rel cannot be read — its definitions cannot be checked, and skipping it would certify nothing about it"
      continue
    fi
    _shadows="$(count_shadows "$_suite" $HOISTED_FNS)"
    if [ -z "$_shadows" ]; then
      _copies=$((_copies + 1))
      fail "the shape scan ran over $_rel" \
        "it returned nothing — a read that failed would be skipped in silence"
    elif [ "$_shadows" != 0 ]; then
      _copies=$((_copies + 1))
      fail "no copy of a hoisted counter in $_rel" \
        "$_shadows — the shared definition in _helpers.sh is the only one (exemption: $HOISTED_EXEMPT)"
    fi
  done
  [ "$_copies" -ne 0 ] || pass "no suite outside the exemption re-defines a hoisted counter"

  # The exemption in BOTH directions: the copies it was granted for are still there
  # — exactly once each — so the exemption is still needed; and no OTHER hoisted
  # name has appeared in that file, which would otherwise be exempted without
  # anyone deciding to exempt it.
  if [ ! -r "$_dir/$HOISTED_EXEMPT" ]; then
    fail "the exemption is present to be checked" \
      "$HOISTED_EXEMPT is not readable in $_dir — an exemption for a file that is not there is not an exemption"
    return 0
  fi
  _own="$(count_shadows "$_dir/$HOISTED_EXEMPT" occurrences pin)"
  _extra="$(count_shadows "$_dir/$HOISTED_EXEMPT" count_literal occurrences_flat count_of present)"
  if [ "$_own" = "2 occurrences 1 pin 1" ]; then
    pass "the exemption still defines its own occurrences and pin, exactly once each"
  else
    fail "the exemption still defines its own occurrences and pin, exactly once each" \
      "expected [2 occurrences 1 pin 1], got [$_own] — hoist the copy and delete the exemption"
  fi
  if [ "$_extra" = 0 ]; then
    pass "the exemption defines none of the other four hoisted names"
  else
    fail "the exemption defines none of the other four hoisted names" \
      "found [$_extra] — widen the exemption deliberately, or hoist the copy"
  fi
}

# Ruby + Psych is how this repo parses YAML — tests/test-codex-dual-publish.sh
# established it, because Codex's own loader is Psych and a check that parses
# YAML some other way is not checking what will actually load the file.
# Preflight it so a missing toolchain fails loudly instead of looking like a
# parse error in the file under test.
require_ruby_psych() {
  RUBY_BIN="$(command -v ruby || true)"
  if [ -z "$RUBY_BIN" ] || ! "$RUBY_BIN" -e 'require "psych"' >/dev/null 2>&1; then
    fail "ruby + Psych available on PATH" "cannot validate YAML without the parser the loader uses"
    return 1
  fi
  return 0
}
