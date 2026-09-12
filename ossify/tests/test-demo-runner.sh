#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
# manifest+verify+worktree added for Task 6: the runner now resolves its
# workdir via _oss_repo_root (worktree.sh, which itself calls oss_manifest_get
# from manifest.sh) and checks vacuous-green via oss_verify_zero_tests_guard
# (verify.sh). ANY new test file that CALLS the demo runner (not merely
# sources demo.sh) needs this same trio - see the criterion note below.
. "$HERE/../lib/id.sh"; . "$HERE/../lib/state.sh"; . "$HERE/../lib/manifest.sh"
. "$HERE/../lib/entities.sh"; . "$HERE/../lib/ledger.sh"; . "$HERE/../lib/verify.sh"; . "$HERE/../lib/worktree.sh"; . "$HERE/../lib/demo.sh"
TMP="$(mktemp -d)"; S="$TMP/state.json"
# Task 6: `oss_demo_run_auto` now resolves its working directory via a
# pairing manifest (composition root when set, the sole declared repo's root
# otherwise - #272/#310 Task 4 routed this through the sole-repo default rule,
# never a literal `canonical`) -
# a BEHAVIORAL CHANGE from "runs in the caller's cwd". Every call below that
# omits the explicit workdir argument needs one on the walk-up path, so the
# fixture goes in BEFORE the first such call (all eight pre-existing calls
# in this file included). ai_workspace.root is $TMP itself (not $TMP/ws) so
# the manifest is discoverable once we `cd "$TMP"` - oss_manifest_discover
# walks UP from $PWD, never down.
mkdir -p "$TMP/.workspace" "$TMP/canon"
cat > "$TMP/.workspace/pairing.json" <<EOF
{"schema_version":"1.0","ai_workspace":{"root":"$TMP"},"canonical":{"root":"$TMP/canon"},"well_known_paths":{}}
EOF
cd "$TMP"
oss_state_init "$S" demo-run >/dev/null
# Mint the spines demo lines are keyed to (ledger validates source_spine exists).
oss_entity_add_release "$S" "demo" "goal" >/dev/null
oss_entity_add_spine "$S" r0 "demo spine" bone canonical >/dev/null
oss_entity_add_spine "$S" r0 "second spine" flesh canonical >/dev/null

oss_ledger_add_auto "$S" r0.s1 "always true" "true" "exit:0" >/dev/null
oss_ledger_add_auto "$S" r0.s1 "greets" "echo hello-world" "contains:hello" >/dev/null
t_capture oss_demo_run_auto "$S"
t_assert_rc 0 "all green"; t_assert_contains "$T_OUT" "PASS 2" "pass count"

oss_ledger_add_auto "$S" r0.s1 "always false" "false" "exit:0" >/dev/null
t_capture oss_demo_run_auto "$S"
t_assert_rc 1 "halt on first fail"; t_assert_contains "$T_OUT" "FAIL d3" "failing line named"

oss_ledger_quarantine "$S" d3 "flaky env, fix by r1 close" >/dev/null
t_capture oss_demo_run_auto "$S"
t_assert_rc 0 "quarantined line skipped"; t_assert_contains "$T_OUT" "SKIP" "skip reported"

oss_ledger_add_auto "$S" r0.s1 "vacuous suite" "echo 'collected 0 items' # pytest" "exit:0" >/dev/null
t_capture oss_demo_run_auto "$S"
t_assert_rc 1 "vacuous green caught"; t_assert_contains "$T_OUT" "vacuous-green" "guard named"

# Take the vacuous line (d4) out of the active run so the halt-on-first-fail run
# can reach the next assertion. D1 (Plan C1 Task 2) made retire a PLANNING verb
# that only records a pending amendment - applied by a spine's close, and now
# validated against a real spine id - so it no longer clears d4 out of the
# active set on the spot, and this fixture defines no spine to amend against.
# Quarantine is the immediate verb (a close/doctor-time action on a line that
# actually fails, requiring only that the line exist - see d3 above) and is
# what this fixture actually needs: d4 out of the run immediately, no spine.
oss_ledger_quarantine "$S" d4 "test cleanup" >/dev/null

# A legitimate demo line that merely mentions a zero-tests phrase in its output —
# but is NOT a test runner — must NOT be flagged vacuous-green (AND-gate precision).
oss_ledger_add_auto "$S" r0.s1 "legit zero-passing mention" "echo '0 passing warnings remain'" "contains:0 passing" >/dev/null
t_capture oss_demo_run_auto "$S"
t_assert_rc 0 "non-runner output mentioning a zero-tests phrase is NOT vacuous-green"

# Fix 3: a missing/unreadable state file must be a guarded rc-1 error, not an
# unguarded jq exit-2 abort under the dispatcher's `set -e` (which collides
# with the rc-2 "usage error" convention). Exercised through the real
# dispatcher (bin/oss), not the bare lib function, so `set -e` is actually in
# effect the way it is in production use.
t_capture "$HERE/../bin/oss" demo_run /nonexistent/state.json
t_assert_rc 1 "missing state file is rc 1, not rc 2, via dispatcher"
t_assert_contains "$T_OUT" "cannot read state" "error message names the problem"

# --- Final review finding 1 (runner half). The ledger is APPEND-ONLY, so a line
# whose `expected` slipped past an older, looser validator is re-run and
# re-reported at every future close. The runner must therefore FAIL CLOSED on an
# operand it cannot compare, not fall out of the `case` (or let `[` exit 2, which
# the `if` reads as false) and count the line as passed. Injected straight into
# state because the validator now correctly refuses to create such a line.
T2="$(mktemp -d)"; S2="$T2/state.json"
oss_state_init "$S2" demo-malformed >/dev/null
oss_entity_add_release "$S2" "demo" "goal" >/dev/null
oss_entity_add_spine "$S2" r0 "demo spine" bone canonical >/dev/null
oss_ledger_add_auto "$S2" r0.s1 "legacy line, malformed operand" "exit 1" "exit:0" >/dev/null
jq '.demo_ledger[0].expected = "exit:0 (tests green)"' "$S2" > "$S2.x" && mv "$S2.x" "$S2"
t_capture oss_demo_run_auto "$S2"
t_assert_rc 1 "malformed exit: operand FAILS the line (was: silently counted as PASS)"
t_assert_contains "$T_OUT" "FAIL d1" "the malformed line is named"

# An `expected` the runner recognizes not at all must also fail closed. The
# command here exits 0, so a rc 0 can only come from the fall-through — this is
# the assertion that distinguishes "fails closed" from "the command happened to
# fail" above.
jq '.demo_ledger[0].expected = "under 40ms" | .demo_ledger[0].command = "true"' "$S2" > "$S2.x" && mv "$S2.x" "$S2"
t_capture oss_demo_run_auto "$S2"
t_assert_rc 1 "unrecognized expected grammar FAILS the line (fail closed, not fall through)"
t_assert_contains "$T_OUT" "FAIL d1" "the unrecognized-grammar line is named"
rm -rf "$T2"

# --- Task 6: composition-root workdir, scoped vacuous-green guard, user-line
# surfacing, durable close records. ---

# The runner executes in the COMPOSITION ROOT (canonical when unset), not the
# caller's cwd. A relative-path demo command is the whole point of the ledger.
mkdir -p "$TMP/canon"; echo marker > "$TMP/canon/marker.txt"
t_capture oss_ledger_add_auto "$S" r0.s1 "marker present" "test -f marker.txt" "exit:0"
cd "$TMP"   # deliberately NOT the demo working dir
# Explicit workdir: this suite has no pairing manifest, so the manifest leg
# cannot resolve. That is the whole reason oss_demo_workdir takes an explicit
# argument — see the note on its precedence.
t_capture oss_demo_run_auto "$S" "$TMP/canon"
t_assert_rc 0 "a relative-path demo command resolves against the given workdir, not \$PWD"
# NOT `t_capture` for this check: t_capture wraps the call in `$(...)`, which
# bash ALWAYS forks a subshell for - so it absorbs an insufficiently-contained
# internal `cd` regardless of whether demo.sh's own subshell containment is
# correct, making a t_capture'd assertion here a tautology. Verified: mutating
# the runner's `cd "$wd" && bash -c ...` (inside its OWN "$(...)") to a bare
# `cd "$wd"` ahead of it does NOT red a t_capture'd version of this assertion.
# Calling the function as a plain statement (output redirected, not
# substituted) runs it directly in THIS shell, so a leaked `cd` shows up here.
oss_demo_run_auto "$S" "$TMP/canon" >/dev/null 2>&1
t_assert_eq "$TMP" "$PWD" "the runner's subshell cd did NOT mutate the process cwd"

# oss_demo_workdir's composition_root leg (precedence tier 2, between explicit
# and bare-canonical), for BOTH a relative and an absolute value - neither had
# any test coverage anywhere in the suite before this task (the one existing
# composition_root test, test-dispatcher-ops.sh, only proves the value is
# STORED, never that the demo runner resolves against it).
mkdir -p "$TMP/canon/sub"; echo sub-marker > "$TMP/canon/sub/sub-marker.txt"
oss_state_mutate "$S" set_composition "$(jq -n --arg c sub '{composition_root:$c}')" >/dev/null
t_capture oss_demo_workdir "$S"
t_assert_eq "$TMP/canon/sub" "$T_OUT" "a relative composition_root resolves against the canonical root"

mkdir -p "$TMP/elsewhere"
oss_state_mutate "$S" set_composition "$(jq -n --arg c "$TMP/elsewhere" '{composition_root:$c}')" >/dev/null
t_capture oss_demo_workdir "$S"
t_assert_eq "$TMP/elsewhere" "$T_OUT" "an absolute composition_root is used verbatim, not joined onto the canonical root"

# --- #272/#310 Task 4: oss_demo_workdir routes through the sole-repo default
# rule, not a literal `canonical`. Precedence: explicit > composition_root >
# sole-declared-repo > refuse listing repos. Two fresh topology fixtures,
# deliberately NOT $TMP (single-repo "canonical" pairing manifest, which every
# other assertion in this file depends on) - this block must not perturb it.

# (1) N=1, but the sole repo is NOT named canonical - exactly the case the OLD
# literal default could never resolve (it always looked up "canonical" by
# name, so a workspace whose only repo was named something else refused even
# though exactly one candidate existed). This is the direct fix this task
# ships, and a fixture the old code would have refused (RED against the old
# body: `_oss_repo_root canonical` fails because "core", not "canonical", is
# declared).
TMP3="$(mktemp -d)"
mkdir -p "$TMP3/.ossify"
cat > "$TMP3/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP3/core"}},"well_known_paths":{}}
JSON
S3="$TMP3/state.json"; echo '{}' > "$S3"
cd "$TMP3"
t_capture oss_demo_workdir "$S3"
t_assert_rc 0 "sole repo resolves even when it is not literally named canonical"
t_assert_eq "$TMP3/core" "$T_OUT" "workdir is the sole declared repo's root"

t_capture oss_demo_workdir "$S3" "$TMP3/explicit-wd"
t_assert_rc 0 "explicit workdir still wins ahead of the default-repo tier"
t_assert_eq "$TMP3/explicit-wd" "$T_OUT" "explicit workdir echoed verbatim, no repo resolution attempted"
cd "$TMP"
rm -rf "$TMP3"

# (2) N>1, and one of the declared repos IS literally named canonical - the
# fail-safe case this task exists for. The OLD literal default resolved this
# SILENTLY (canonical happened to be declared, so it "worked" while ignoring
# the sibling repo entirely - precisely the wrong-repo risk #272/#310 names).
# The new rule must refuse rather than pick WHEN THE DEFAULT-REPO TIER IS
# ACTUALLY NEEDED. Spec section 3's precedence is EXPLICIT > composition_root >
# sole-declared-repo > refuse: an ABSOLUTE composition_root is a complete
# answer on its own and outranks the sole-declared-repo tier entirely, so it
# resolves even under N>1 (lib/demo.sh short-circuits on it before ever
# consulting the default-repo key). A RELATIVE composition_root still joins
# onto the DEFAULT repo's root (recorded deviation 2), so it still needs the
# lookup and still refuses under N>1, same as no composition_root at all.
TMP4="$(mktemp -d)"
mkdir -p "$TMP4/.ossify"
cat > "$TMP4/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP4/canon"},"ui":{"root":"$TMP4/ui"}},"well_known_paths":{}}
JSON
S4="$TMP4/state.json"; echo '{}' > "$S4"
cd "$TMP4"
t_capture oss_demo_workdir "$S4"
t_assert_rc 2 "N>1 refuses (no composition_root) even though one declared repo is literally named canonical (no silent pick)"
t_assert_contains "$T_OUT" "canonical, ui" "refusal lists both declared repos"

jq -n --arg c "$TMP4/abs-comp" '{project:{composition_root:$c}}' > "$S4"
t_capture oss_demo_workdir "$S4"
t_assert_rc 0 "an ABSOLUTE composition_root outranks the sole-declared-repo tier - resolves even under N>1 (spec section 3)"
t_assert_eq "$TMP4/abs-comp" "$T_OUT" "the absolute composition_root is returned verbatim, no repo root ever consulted"

jq -n --arg c "rel-comp" '{project:{composition_root:$c}}' > "$S4"
t_capture oss_demo_workdir "$S4"
t_assert_rc 2 "a RELATIVE composition_root still needs the default repo's root, so N>1 still refuses"
t_assert_contains "$T_OUT" "canonical, ui" "same refusal, same listing"
cd "$TMP"
rm -rf "$TMP4"

# Clear it back to unset so the rest of this file's explicit-workdir calls
# keep resolving against $TMP/canon as they did before this sub-block.
oss_state_mutate "$S" set_composition "$(jq -n '{composition_root:null}')" >/dev/null

# The unscoped vacuous-green guard used to fail this: a recognized runner that
# legitimately exits 1 is NOT vacuous green. `# pytest` is NOT a no-op comment
# here for the purpose of this test: oss_verify_zero_tests_guard greps the RAW
# COMMAND STRING (not what actually executes) for a runner name, so without it
# this command is never recognized as a runner at all and the guard would stay
# silent regardless of scoping - proving nothing. Verified: mutating the guard
# back to unscoped does NOT red this assertion unless the command string
# itself matches a runner pattern AND the output shows a zero-tests phrase.
t_capture oss_ledger_add_auto "$S" r0.s1 "suite fails as expected" "bash -c 'echo 0 passing; exit 1' # pytest" "exit:1"
t_capture oss_demo_run_auto "$S" "$TMP/canon"
t_assert_rc 0 "a recognized runner legitimately expecting exit:1 is not flagged vacuous"

# user: lines are surfaceable, and scopeable to one spine.
t_capture oss_ledger_add_user "$S" r0.s1 "reschedule a delivery and see the new window" "the slot moves"
t_capture oss_ledger_add_user "$S" r0.s2 "cancel an order from the ticket" "the order clears"
t_capture oss_demo_user_lines "$S" r0.s1
t_assert_eq "1" "$(printf '%s' "$T_OUT" | jq 'length')" "user lines scope to one spine (the §6.1 spine-close set)"
t_capture oss_demo_user_lines "$S"
t_assert_eq "2" "$(printf '%s' "$T_OUT" | jq 'length')" "unscoped returns every accumulated user line (the §6.2 walkthrough set)"

# a close leaves a durable record.
t_capture oss_demo_record_close "$S" spine r0.s1 true 2 "clean"
t_assert_rc 0 "close record written"
t_capture oss_state_read "$S" '.close_records[-1].scope'; t_assert_eq "spine" "$T_OUT" "scope recorded"
t_capture oss_state_read "$S" '.close_records[-1].demo_passed'; t_assert_eq "true" "$T_OUT" "demo outcome recorded"

# add_close_record round-trips through replay like every other op in
# _oss_apply_op: rebuilt-from-base+journal must equal live, not merely
# "the write succeeded". The id/timestamp are baked into the payload BEFORE
# journaling (see oss_demo_record_close), so a replay that reapplies the same
# journaled payload reproduces the record verbatim.
t_capture oss_state_replay "$S"
t_assert_rc 0 "replay stays clean across add_close_record (and this file's other demo-ledger ops)"

cd /
rm -rf "$TMP"

# ===========================================================================
# TOPOLOGY TWIN (#272/#310 Task 11, spec decision O1): the opening fixture's
# implicit-workdir demo-run sequence (all green / halt on first fail /
# quarantine skip / vacuous-green catch), run again from a SOLE-repo
# .ossify/topology.json named "core" - never "canonical". Every call below
# OMITS the workdir argument, so each one re-resolves
# `_oss_default_repo_key -> _oss_repo_root` through the topology shape
# exactly as the opening fixture resolves it through the translated pairing
# shape. TMP3/TMP4 further up already pin oss_demo_workdir's sole-repo/N>1
# rule directly (added by #272/#310 Task 4); this proves the FULL RUNNER -
# ledger read, halt, quarantine, vacuous-green - threads that resolution end
# to end, which is what the opening fixture actually demonstrates and TMP3/
# TMP4 do not (they call oss_demo_workdir alone, never oss_demo_run_auto).
#
# A fresh mktemp tree: none of this reuses $TMP (already rm -rf'd above) or
# TMP3/TMP4 (already rm -rf'd earlier in this file).
# ===========================================================================
TMPD="$(mktemp -d)"
mkdir -p "$TMPD/ws/.ossify" "$TMPD/core"
cat > "$TMPD/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMPD/core"}},"well_known_paths":{}}
JSON
cd "$TMPD/ws"
SD="$TMPD/ws/.ossify/project-state.json"
oss_state_init "$SD" demo-run-twin >/dev/null
oss_entity_add_release "$SD" "demo" "goal" >/dev/null
oss_entity_add_spine "$SD" r0 "demo spine" bone core >/dev/null

oss_ledger_add_auto "$SD" r0.s1 "always true" "true" "exit:0" >/dev/null
oss_ledger_add_auto "$SD" r0.s1 "greets" "echo hello-world" "contains:hello" >/dev/null
t_capture oss_demo_run_auto "$SD"
t_assert_rc 0 "topology twin: all green"
t_assert_contains "$T_OUT" "PASS 2" "topology twin: pass count"

oss_ledger_add_auto "$SD" r0.s1 "always false" "false" "exit:0" >/dev/null
t_capture oss_demo_run_auto "$SD"
t_assert_rc 1 "topology twin: halt on first fail"
t_assert_contains "$T_OUT" "FAIL d3" "topology twin: failing line named"

oss_ledger_quarantine "$SD" d3 "flaky env, fix by r1 close" >/dev/null
t_capture oss_demo_run_auto "$SD"
t_assert_rc 0 "topology twin: quarantined line skipped"
t_assert_contains "$T_OUT" "SKIP" "topology twin: skip reported"

oss_ledger_add_auto "$SD" r0.s1 "vacuous suite" "echo 'collected 0 items' # pytest" "exit:0" >/dev/null
t_capture oss_demo_run_auto "$SD"
t_assert_rc 1 "topology twin: vacuous green caught"
t_assert_contains "$T_OUT" "vacuous-green" "topology twin: guard named"

# Take the vacuous line (d4) out of the active run so the AND-gate-precision
# check below can reach it - same reason the opening fixture quarantines its
# own d4 before this exact assertion (review round 1, finding 3: the twin
# had stopped one assertion short of the legacy sequence at :60-64).
oss_ledger_quarantine "$SD" d4 "test cleanup" >/dev/null
oss_ledger_add_auto "$SD" r0.s1 "legit zero-passing mention" "echo '0 passing warnings remain'" "contains:0 passing" >/dev/null
t_capture oss_demo_run_auto "$SD"
t_assert_rc 0 "topology twin: non-runner output mentioning a zero-tests phrase is NOT vacuous-green (AND-gate precision)"

cd "$HERE"
rm -rf "$TMPD"

t_summary
