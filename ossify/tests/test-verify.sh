#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
for lib in id state manifest commands entities registries ledger demo doctor verify; do . "$HERE/../lib/$lib.sh"; done
TMP="$(mktemp -d)"; SPEC="$TMP/spec.md"

cat > "$SPEC" <<'EOF'
## 5. Acceptance criteria
- [ ] AC-1 auto: `true` → expected: exit 0
- [ ] AC-2 auto: `false` → expected: exit 1
- [ ] AC-3 auto: `echo 42 passed` → expected: output contains 42 passed
- [X] AC-10 auto: `true` → expected: exit 0
- [ ] AC-4 user: open the dashboard and see the new card
EOF

t_capture oss_verify_parse_acs "$SPEC"
t_assert_eq "4" "$(printf '%s\n' "$T_OUT" | grep -c .)" "parses 4 auto ACs and skips the user: row"
t_assert_contains "$T_OUT" "AC-1" "labels captured"
# A checked, UPPERCASE-X checkbox must still yield a bare label. Anchoring the
# extraction on a case class instead of the checkbox silently emits the whole
# line as the label, which report_cross_check then fails to find.
t_assert_contains "$T_OUT" "AC-10	true	exit 0" "an uppercase [X] checkbox still yields a bare label"
# Backticks MUST be stripped: an unstripped command is run as a command
# substitution by the caller's eval, executing something entirely different.
case "$T_OUT" in *'`'*) T_FAIL=$((T_FAIL+1)); echo "FAIL: backticks survived the parse";; *) T_PASS=$((T_PASS+1));; esac

# Codex P2 finding #4: an AC line without backticks around the command must NOT
# produce a row — the whole line tail would become the command, pass the RED
# gate as garbage (fails = RED = proceed), and waste the entire TDD loop.
MAL="$TMP/malformed.md"
cat > "$MAL" <<'EOF'
- [ ] AC-1 auto: `true` → expected: exit 0
- [ ] AC-2 auto: pytest tests/ → expected: exit 0
- [ ] AC-3 auto: `echo hi` → expected: output contains hi
EOF
t_capture oss_verify_parse_acs "$MAL"
# Only 2 TSV rows: AC-1 and AC-3 have backticks; AC-2 is skipped (no backtick
# pair). The stderr warning merges into T_OUT via 2>&1, so count TSV rows only
# (lines starting with AC-, not warning lines).
t_assert_eq "2" "$(printf '%s\n' "$T_OUT" | grep -c '^AC-')" "missing-backtick AC produces zero TSV rows (not garbage)"
t_assert_contains "$T_OUT" "AC-2" "the skipped line is named in the warning"

t_capture oss_verify_auto_step "$TMP" "true" "exit 0";           t_assert_rc 0 "exit 0 expectation passes"
t_capture oss_verify_auto_step "$TMP" "false" "exit 0";          t_assert_rc 1 "exit 0 expectation fails on rc 1"
t_capture oss_verify_auto_step "$TMP" "false" "exit 1";          t_assert_rc 0 "exit 1 expectation passes on rc 1"
t_capture oss_verify_auto_step "$TMP" "echo 42 passed" "output contains 42 passed"; t_assert_rc 0 "contains expectation passes"
t_capture oss_verify_auto_step "$TMP" "echo nope" "output contains 42 passed";      t_assert_rc 1 "contains expectation fails"
t_assert_contains "$T_OUT" "output missing '42 passed'" "a failing contains expectation names what was missing, not a silent dump"
# An embedded U+2192 arrow inside the command/expectation text itself (not
# just the grammar's separator arrow) must not confuse the greedy `.*→` split
# (named risk #3).
ARROW_SPEC="$TMP/arrow-spec.md"
printf -- '- [ ] AC-5 auto: `printf '"'"'a \xe2\x86\x92 b'"'"'` \xe2\x86\x92 expected: output contains a \xe2\x86\x92 b\n' > "$ARROW_SPEC"
t_capture oss_verify_parse_acs "$ARROW_SPEC"
t_assert_eq "$(printf 'AC-5\tprintf \x27a \xe2\x86\x92 b\x27\toutput contains a \xe2\x86\x92 b')" "$T_OUT" "an embedded arrow inside the command/expectation text does not confuse the separator split"

t_capture oss_verify_auto_step "$TMP" "true" "exit banana";      t_assert_rc 2 "a malformed expectation is rc 2, never a silent pass"
t_capture oss_verify_auto_step "$TMP" "true" "whatever";         t_assert_rc 2 "an unrecognized expectation form is rc 2"

# Vacuous-green scoping (named risk #4): the guard is scoped to `exit 0` only.
# A command whose text names a recognized runner and whose output happens to
# ALSO contain a zero-tests phrase, but which legitimately expects exit 1,
# must still pass — an unscoped guard would flag it vacuous regardless of
# what was actually expected.
t_capture oss_verify_auto_step "$TMP" "printf 'collected 0 items'; false # pytest" "exit 1"
t_assert_rc 0 "a legitimate exit 1 from a recognized runner is not flagged vacuous"
# ...and the OTHER direction: a recognized runner reporting zero tests fails
# exit 0 even though the rc genuinely matched. Not just the standalone guard
# function (tested above) — the wiring into auto_step itself.
t_capture oss_verify_auto_step "$TMP" "printf 'collected 0 items'; true # pytest" "exit 0"
t_assert_rc 1 "a vacuous exit 0 from a recognized runner fails through auto_step, not just the standalone guard"

# zero-tests guard: BOTH conditions required (recognized runner AND zero-tests output).
printf 'collected 0 items\n' | oss_verify_zero_tests_guard "pytest tests/"; t_assert_eq "0" "$?" "vacuous green detected"
printf 'collected 9 items\n' | oss_verify_zero_tests_guard "pytest tests/"; t_assert_eq "1" "$?" "a real run is not vacuous"
printf 'collected 0 items\n' | oss_verify_zero_tests_guard "echo hi";       t_assert_eq "1" "$?" "a non-runner merely MENTIONING a zero-tests phrase is not vacuous"

# RED gate: rc 1 (already GREEN) is the ONLY hard block; rc 2 (errored) is advisory.
t_capture oss_verify_redgate "$TMP" "false" "exit 0";            t_assert_rc 0 "a failing command is RED"
t_capture oss_verify_redgate "$TMP" "true" "exit 0";             t_assert_rc 1 "an already-passing command is already-GREEN"
t_capture oss_verify_redgate "$TMP" "nosuchcommand_xyz" "exit 0";t_assert_rc 2 "an uninvocable command is errored, not already-GREEN"

# A MALFORMED expectation is not a RED. oss_verify_auto_step returns 2 for a
# grammar it cannot parse and 1 for a legitimately-failing command; folding both
# into "not satisfied" makes redgate answer rc 0 = "proceed" for an AC whose
# command can never pass, and the worker then spends the whole TDD loop on it.
# The command is deliberately `false` — genuinely failing — so a redgate that
# ignores the expectation returns 0 and this assertion is what catches it.
t_capture oss_verify_redgate "$TMP" "false" "whatever"
t_assert_rc 2 "a malformed expectation is rc 2 (malformed), never rc 0 (RED = proceed)"
t_assert_contains "$T_OUT" "malformed" "...and the diagnostic says malformed rather than reporting a RED"
# The realistic shape: verify_acs lands the whole tail in the expectation field
# when the AC uses an ASCII '->' or omits 'expected:'. Same class, real text.
t_capture oss_verify_redgate "$TMP" "false" '`pytest c` -> expected: exit 0'
t_assert_rc 2 "the ASCII-arrow malformation reaching redgate is rc 2, not a RED"

# report cross-check: every auto AC in the spec must appear in the report.
cat > "$TMP/report.md" <<'EOF'
## 3. ACs — verification status
| AC | Status |
|---|---|
| AC-1 | pass |
| AC-2 | pass |
EOF
t_capture oss_verify_report_cross_check "$TMP/report.md" "$SPEC"
t_assert_rc 1 "cross-check fails when the report omits an AC"
t_assert_contains "$T_OUT" "AC-3" "...and names the missing one"
# The spec fixture's 4th auto AC is AC-10 (used above to test the checkbox-
# anchored label extraction) — a report accounting for "every auto AC" must
# include it too, not just AC-1..AC-3.
printf '| AC-3 | fail |\n| AC-10 | pass |\n' >> "$TMP/report.md"
t_capture oss_verify_report_cross_check "$TMP/report.md" "$SPEC"
t_assert_rc 0 "cross-check passes when every auto AC is accounted for"

# Word-boundary regression: AC-10 legitimately present in the report must NOT
# satisfy a search for AC-1 via substring match ("AC-10" contains "AC-1" as a
# literal prefix). A report naming AC-10 but omitting AC-1 must still fail,
# and must name AC-1 (not AC-10) as the missing one.
cat > "$TMP/report-boundary.md" <<'EOF'
| AC-10 | pass |
| AC-2 | pass |
| AC-3 | pass |
EOF
t_capture oss_verify_report_cross_check "$TMP/report-boundary.md" "$SPEC"
t_assert_rc 1 "AC-10's presence in the report does not satisfy a search for AC-1"
t_assert_contains "$T_OUT" "does not account for: AC-1" "...and AC-1 (not AC-10) is named missing"

OSSB="$HERE/../bin/oss"
t_capture bash "$OSSB" verify_step "$TMP" "false" "exit 1"
t_assert_rc 0 "dispatcher: a command that exits 1 against 'exit 1' PASSES (does not abort under set -e)"
t_capture bash "$OSSB" verify_step "$TMP" "false" "exit 0"
t_assert_rc 1 "dispatcher: a failing AC returns 1 with a diagnostic, not a strict-mode abort"
t_assert_contains "$T_OUT" "wanted" "dispatcher: the failing arm emitted its rc diagnostic rather than dying silently"
t_capture bash "$OSSB" verify_step "$TMP" "true" "whatever"
t_assert_rc 2 "dispatcher: malformed expectation is rc 2"
t_capture bash "$OSSB" redgate "$TMP" "false" "exit 0"
t_assert_rc 0 "dispatcher: a genuinely failing command is RED (rc 0), not an abort"
t_capture bash "$OSSB" redgate "$TMP" "true" "exit 0"
t_assert_rc 1 "dispatcher: already-GREEN is the hard block"
t_capture bash "$OSSB" redgate "$TMP" "nosuchcommand_xyz" "exit 0"
t_assert_rc 2 "dispatcher: an uninvocable command is advisory rc 2, not 127"
# The dispatcher path specifically: bin/oss runs `set -euo pipefail` while this
# harness sources the libs non-strict, so a capture idiom that aborts under
# errexit passes here and dies there. This is the assertion that sees it.
t_capture bash "$OSSB" redgate "$TMP" "false" "whatever"
t_assert_rc 2 "dispatcher: a malformed expectation is rc 2, not rc 0 = proceed, and not a strict-mode abort"
t_assert_contains "$T_OUT" "malformed" "dispatcher: the malformed arm emitted its diagnostic rather than dying silently"

# ---------------------------------------------------------------------------
# X1: report_cross_check must NOT report clean when it is BLIND.
#
# The AC rows are fed in by `done < <(oss_verify_parse_acs "$2")`, whose rc is
# discarded. A missing spec, or one whose AC lines drifted from the grammar,
# yields zero rows: the loop body never runs, the `missing` accumulator keeps its
# clean initial value, and the gate returns 0 = CLEAN over a spec it never read.
# The orchestrator-side gate then passes a work item nobody verified.
# ---------------------------------------------------------------------------
XR="$TMP/x-report.md"; printf '## 3. ACs\n| AC-1 | pass |\n' > "$XR"

t_capture oss_verify_report_cross_check "$XR" "$TMP/does-not-exist-at-all.md"
[ "$T_RC" -ne 0 ] && T_PASS=$((T_PASS+1)) \
  || { T_FAIL=$((T_FAIL+1)); echo "FAIL: X1: cross-check returned CLEAN against a spec that does not exist"; }
t_assert_contains "$T_OUT" "spec" "X1: the refusal names the spec as the problem"

# A readable file with no `auto:` AC lines at all yields zero rows. This is the
# realistic mis-derived-path case: the resolver lands on the handoff, the README,
# or last round's spec, and the gate reads a file that simply has nothing to say.
# (An ASCII '->' in place of the U+2192 does NOT belong here - that line still
# parses, into a row whose expectation field is garbage. Different defect,
# separately tracked; using it here would not reach the zero-row branch.)
XS="$TMP/x-spec-drifted.md"
printf '# Handoff\nSome prose. No acceptance criteria live in this file.\n' > "$XS"
t_capture oss_verify_parse_acs "$XS"
t_assert_eq "" "$T_OUT" "X1 setup: the drifted AC line really is invisible to the parser"
t_capture oss_verify_report_cross_check "$XR" "$XS"
t_assert_contains "$T_OUT" "zero" "X1: a spec yielding zero auto ACs is surfaced, not silently clean"

# The honest-clean control: a spec with real auto ACs, all accounted for, still
# passes. Without this the guard above could be satisfied by failing everything.
XS2="$TMP/x-spec-ok.md"
printf '# Spec\n- [ ] AC-1 auto: `pytest tests/one` → expected: exit 0\n' > "$XS2"
t_capture oss_verify_parse_acs "$XS2"
t_assert_contains "$T_OUT" "AC-1" "X1 control setup: the well-formed AC line parses"
t_capture oss_verify_report_cross_check "$XR" "$XS2"
t_assert_rc 0 "X1 control: a spec whose every auto AC is accounted for is still CLEAN"

# ===========================================================================
# #460 - `producer | grep -q` under `set -o pipefail` inverts a TRUE match.
# `grep -q` exits 0 at the first match; if the producer still has bytes to
# write it takes SIGPIPE and the pipeline reports 141, so `|| return 1` fires
# and a genuine match reads as NO match. Position-dependent, not size-dependent
# - a match at the END of the same bytes detects fine - and the transition is a
# race band around the 64 KiB pipe buffer, not a threshold. A single green run
# is a race draw, so both fixtures pin >=200 KiB with the match at OFFSET 0 and
# run 20x. Driven through bin/oss because pipefail only exists there - this
# file sources the libs non-strict.
# ===========================================================================
BIGVAC="$TMP/vacuous-big.out"
{ printf 'running 0 tests\n'; head -c 200000 /dev/zero | tr '\0' 'x'; printf '\n'; } > "$BIGVAC"
inv=0
for _i in $(seq 20); do
  bash "$OSSB" zero_tests_guard "cargo test" < "$BIGVAC" >/dev/null 2>&1 || inv=$((inv+1))
done
t_assert_eq "0" "$inv" "#460: a 200KB vacuous run with the zero-marker at offset 0 is flagged on all 20 runs"

# Same size, needle at offset 0, through the `output contains` arm (:77) - the
# same idiom with the opposite polarity: the inverted match fails a line that
# should pass.
BIGCT="$TMP/contains-big.out"
{ printf 'NEEDLE-at-start\n'; head -c 200000 /dev/zero | tr '\0' 'x'; printf '\n'; } > "$BIGCT"
cinv=0
for _i in $(seq 20); do
  bash "$OSSB" verify_step "$TMP" "cat $BIGCT" "output contains NEEDLE" >/dev/null 2>&1 || cinv=$((cinv+1))
done
t_assert_eq "0" "$cinv" "#460: 'output contains' on a 200KB needle-at-offset-0 output passes on all 20 runs"

# The runner check carries the same idiom on $1. Exposure needs the command
# string past 64 KiB AND a newline right after the runner name (grep -q exits
# early only once the match sits inside a complete line) - and under the argv
# ceiling, since exec refuses a single argument past ~128 KiB. 70 KiB threads
# both constraints.
BIGCMD="$(printf 'cargo test\n'; head -c 70000 /dev/zero | tr '\0' ' ')"
rinv=0
for _i in $(seq 20); do
  printf 'running 0 tests\n' | bash "$OSSB" zero_tests_guard "$BIGCMD" >/dev/null 2>&1 || rinv=$((rinv+1))
done
t_assert_eq "0" "$rinv" "#460: a 200KB command string still resolves its runner on all 20 runs"

# Negative controls. A guard that detects nothing passes the two loops above
# vacuously, so pin the failure side at the same size, plus the existing
# small-output detection.
{ printf 'test result: ok. 3 passed; 0 failed\n'; head -c 200000 /dev/zero | tr '\0' 'x'; printf '\n'; } > "$TMP/real-big.out"
bash "$OSSB" zero_tests_guard "cargo test" < "$TMP/real-big.out" >/dev/null 2>&1
t_assert_eq "1" "$?" "#460 control: a 200KB output with a real result is NOT flagged"
bash "$OSSB" verify_step "$TMP" "cat $BIGCT" "output contains ABSENT-STRING" >/dev/null 2>&1
t_assert_eq "1" "$?" "#460 control: a genuinely-absent string at 200KB still fails 'output contains'"

# ===========================================================================
# #402 - a zero-marker means vacuous only when the output carries NO
# positive-execution marker. Aggregate multi-suite output mixes both: cargo's
# empty Doc-tests target prints `running 0 tests` beside real passes, a
# `go test ./...` filter miss prints `no tests to run` beside `--- PASS:`,
# one empty pytest package prints `collected 0 items` beside another's run.
# ===========================================================================
cat > "$TMP/cargo-multi.out" <<'EOF'
running 1 test
test unit_works ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

running 1 test
test it_integrates ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests probe402

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
EOF
t_capture bash "$OSSB" zero_tests_guard "cargo test" < "$TMP/cargo-multi.out"
t_assert_rc 1 "#402: cargo multi-target (2 passed + empty Doc-tests) is NOT vacuous"

# The ONLY positive marker in this fixture is the `--- PASS:` line - the `ok`
# package lines must NOT count (a filter-missed go package prints `ok` too).
# That keeps this fixture sensitive to the `---`-led alternative itself.
printf 'testing: warning: no tests to run\nPASS\nok\texample.com/empty\t0.002s\n--- PASS: TestReal (0.00s)\nPASS\nok\texample.com/real\t0.003s\n' > "$TMP/go-multi.out"
t_capture bash "$OSSB" zero_tests_guard "go test" < "$TMP/go-multi.out"
t_assert_rc 1 "#402: go ./... filter-miss beside a real PASS is NOT vacuous"

printf 'collected 0 items\n\ncollected 4 items\n\n============ 4 passed in 0.02s ============\n' > "$TMP/pytest-multi.out"
t_capture bash "$OSSB" zero_tests_guard "pytest a/ b/" < "$TMP/pytest-multi.out"
t_assert_rc 1 "#402: pytest two-package run (0 collected + 4 passed) is NOT vacuous"

# Negative controls: the suppression must not become a no-op. A single-target
# all-zero cargo run flags; collection is not execution, so a second package
# that collected-but-skipped everything still flags; and a FILE count is not
# a TEST count - `Test Files  2 passed` must not mask the zero-marker.
printf 'running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n' > "$TMP/cargo-zero.out"
t_capture bash "$OSSB" zero_tests_guard "cargo test" < "$TMP/cargo-zero.out"
t_assert_rc 0 "#402 control: a single-target all-zero cargo run still flags"

printf 'collected 0 items\n\ncollected 4 items\n\n============ 4 skipped in 0.01s ============\n' > "$TMP/pytest-skip.out"
t_capture bash "$OSSB" zero_tests_guard "pytest a/ b/" < "$TMP/pytest-skip.out"
t_assert_rc 0 "#402 control: collected-but-all-skipped still flags"

printf 'Test Files  2 passed (2)\ncollected 0 items\n' > "$TMP/filecount.out"
t_capture bash "$OSSB" zero_tests_guard "pytest a/ b/" < "$TMP/filecount.out"
t_assert_rc 0 "#402 control: a file-count line is not test-execution evidence"

# ===========================================================================
# #347 - runner list and zero-marker phrasings: `cargo nextest` is a
# recognized runner, and vitest's two zero shapes are markers.
# ===========================================================================
printf '    Starting 0 tests across 1 binary (1 test skipped)\n     Summary [   0.000s] 0 tests run: 0 passed, 1 skipped\nerror: no tests to run\n' > "$TMP/nextest-zero.out"
t_capture bash "$OSSB" zero_tests_guard "cargo nextest run" < "$TMP/nextest-zero.out"
t_assert_rc 0 "#347: a nextest zero-run is flagged under 'cargo nextest run'"

printf 'No test files found, exiting with code 1\n' | oss_verify_zero_tests_guard "npx vitest run"
t_assert_eq "0" "$?" "#347: vitest 'No test files found' is a zero-marker"

# `Test Files  1 passed` beside `Tests  0 passed` MUST still flag - the file
# count is carved out of the positive scan, so it cannot mask the zero-marker.
printf 'Test Files  1 passed (1)\n      Tests  0 passed (0)\n' > "$TMP/vitest-files.out"
t_capture bash "$OSSB" zero_tests_guard "npx vitest run" < "$TMP/vitest-files.out"
t_assert_rc 0 "#347: 'Tests  0 passed' flags even beside a passed FILE count"

# Negative controls.
printf '     Summary [   0.412s] 5 tests run: 5 passed, 0 skipped\n' > "$TMP/nextest-real.out"
t_capture bash "$OSSB" zero_tests_guard "cargo nextest run" < "$TMP/nextest-real.out"
t_assert_rc 1 "#347 control: a real nextest run is NOT flagged"
printf 'Tests  12 passed (12)\n' | oss_verify_zero_tests_guard "npx vitest run"
t_assert_eq "1" "$?" "#347 control: 'Tests  12 passed' is not the zero-marker"
printf 'No test files found\n' | oss_verify_zero_tests_guard "echo hi"
t_assert_eq "1" "$?" "#347 control: a non-runner emitting the phrase does not flag (BOTH-conditions)"

# The usage line names stdin - the guard's signature is `command as $1,
# runner output on stdin`.
t_capture bash "$OSSB" zero_tests_guard
t_assert_rc 2 "#347: bare zero_tests_guard is a usage error"
t_assert_contains "$T_OUT" "stdin" "#347: the usage line names stdin as the output source"

rm -rf "$TMP"; t_summary
