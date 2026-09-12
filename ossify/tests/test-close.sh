#!/usr/bin/env bash
# close (Task 9) — the router + the work-item close layer.
#
# SCOPE, stated plainly so nobody infers coverage that does not exist.
#
# COVERED here: the mechanical verbs the router's and the gate's prose name,
# driven through `bin/oss` (which runs `set -euo pipefail`, so a strict-mode-only
# fault is visible), plus the two producer/consumer seams this layer sits on —
# the standalone path reconstruction, and the state-recorded merge target.
#
# NOT COVERED, and not coverable by a bash test: **the router itself, the
# four-layer gate's ordering, the halt semantics and the recovery menu are
# prose contracts with no executable surface** (Layer 4's *workflow script* is
# the one exception — its static purity and its lens-id parity with
# impl-check.md §4b are covered separately, `test-workflows.sh`). Task 13's bash-block harness
# checks that every `oss` verb they name resolves; beyond that they have no
# automated coverage in this release. An assertion that "each id shape routes to
# its own scope" would be testing `oss id_parse` (already covered in
# test-id.sh), not the router — the router is prose, and a test whose subject is
# a fixture written to satisfy it proves nothing.
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"

# Sourced HERE, not beside the first spine-close extraction further down: the
# impl-check halt-loop extraction at §Task-13 runs earlier in the file, and a
# function defined after its first call site is a definition-after-use bug —
# the same ordering class as a guard placed after the mutation it protects.
. "$HERE/lib/blocks.sh"
_extract_block() { # $1=source-md $2=anchor identifying the block $3=out-path
  oss_block_extract "$1" "$2" "$3"
}
for lib in id state manifest commands entities registries ledger demo doctor verify worktree; do . "$HERE/../lib/$lib.sh"; done
OSS="$HERE/../bin/oss"
SKILLS="$HERE/../skills"
TMP="$(mktemp -d)"

# ---------------------------------------------------------------------------
# A. Routing mechanics, through the dispatcher.
# ---------------------------------------------------------------------------
t_capture bash "$OSS" id_parse r2.s1.w3
t_assert_rc 0 "dispatcher: a work-item id parses under set -euo pipefail"
t_assert_eq "work_item 2 1 3" "$T_OUT" "id_parse echoes the scope AND the numeric components on ONE line"
t_assert_eq "work_item" "$(printf '%s\n' "$T_OUT" | awk '{print $1}')" "the routing key is the FIRST FIELD of that line"
# The trap the routing prose exists to prevent: a router that equality-tests the
# whole line against the bare scope word falls through every arm and closes
# nothing while reporting success. Assert the whole line is NOT the bare word.
if [ "$T_OUT" = "work_item" ]; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: id_parse returned a bare scope word - the first-field rule would be untestable"
else
  T_PASS=$((T_PASS+1))
fi

t_capture bash "$OSS" id_parse r2.s1
t_assert_eq "spine 2 1" "$T_OUT" "a spine id parses to scope + components"
t_assert_eq "spine" "$(printf '%s\n' "$T_OUT" | awk '{print $1}')" "spine routes on the first field"
t_capture bash "$OSS" id_parse r2
t_assert_eq "release 2" "$T_OUT" "a release id parses to scope + components"
t_assert_eq "release" "$(printf '%s\n' "$T_OUT" | awk '{print $1}')" "release routes on the first field"

# An unparseable id is rc 1 with EMPTY stdout AND EMPTY stderr - which is why the
# one-line error is the skill's to emit. t_capture merges the two streams, so
# capture them separately here or the stderr half cannot fail.
_UP_OUT="$(bash "$OSS" id_parse "VS-1.1.1" 2>/dev/null)"; _UP_RC=$?
_UP_ERR="$(bash "$OSS" id_parse "VS-1.1.1" 2>&1 >/dev/null)"
t_assert_eq "1" "$_UP_RC" "an unparseable id exits rc 1 through the dispatcher (no strict-mode abort)"
t_assert_eq "" "$_UP_OUT" "...with empty stdout"
t_assert_eq "" "$_UP_ERR" "...and empty stderr - the lib says nothing, so the skill must"

# ---------------------------------------------------------------------------
# B. The fixture, and the standalone path reconstruction the work-item layer
#    performs when it is invoked with an id and nothing else.
# ---------------------------------------------------------------------------
mkdir -p "$TMP/ws/.workspace" "$TMP/canon"
CANON="$TMP/canon"
git -C "$CANON" init -q
git -C "$CANON" config user.email t@t; git -C "$CANON" config user.name t
echo seed > "$CANON/f.txt"; git -C "$CANON" add .; git -C "$CANON" commit -qm seed
cat > "$TMP/ws/.workspace/pairing.json" <<EOF
{"schema_version":"1.0","ai_workspace":{"root":"$TMP/ws"},"canonical":{"root":"$CANON"},"well_known_paths":{}}
EOF
cd "$TMP/ws"

bash "$OSS" init "close-fixture" >/dev/null
REL="$(bash "$OSS" release_add "first" "a goal")"
SP="$(bash "$OSS" spine_add "$REL" "ledger export" flesh)"
WI="$(bash "$OSS" work_item_add "$SP" "emit the export file")"
SPINE_SLUG="ledger-export"
WI_SLUG="emit-export-file"

AI_ROOT="$(bash "$OSS" repo_root ai_workspace)"
t_assert_eq "$TMP/ws" "$AI_ROOT" "repo_root ai_workspace resolves to the manifest's ai workspace"

# Build the docs tree from the ID GRAMMAR's own layout function, not from a path
# this test invents - so the reconstruction recipe below is cross-checked against
# an independent producer rather than against itself.
SPINE_DIR_REL="$(bash "$OSS" spine_dir "$REL" "$SP" "$SPINE_SLUG")"
case "$SPINE_DIR_REL" in
  /*) T_FAIL=$((T_FAIL+1)); echo "FAIL: spine_dir returned an ABSOLUTE path - the recipe prefixes it with the ai root";;
  *)  T_PASS=$((T_PASS+1));;
esac
mkdir -p "$AI_ROOT/$SPINE_DIR_REL/work-$WI"

# The recipe: id components -> release id + spine id -> glob for the slug.
PARTS="$(bash "$OSS" id_parse "$WI")"
REL_ID="r$(printf '%s\n' "$PARTS" | awk '{print $2}')"
SPINE_ID="$REL_ID.s$(printf '%s\n' "$PARTS" | awk '{print $3}')"
t_assert_eq "$REL" "$REL_ID" "the release id recomposed from id_parse's components matches the minted release id"
t_assert_eq "$SP" "$SPINE_ID" "the spine id recomposed from id_parse's components matches the minted spine id"

MATCHES="$(find "$AI_ROOT/docs/specs/$REL_ID" -maxdepth 1 -type d -name "$SPINE_ID-*" 2>/dev/null)"
NMATCH="$(printf '%s\n' "$MATCHES" | grep -c . || true)"
t_assert_eq "1" "$NMATCH" "the glob finds exactly one spine directory (zero or two is a halt, never head -1)"
RESOLVED_WI_DIR="$MATCHES/work-$WI"
if [ -d "$RESOLVED_WI_DIR" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the standalone reconstruction ($RESOLVED_WI_DIR) does not point at the directory the id grammar names"
fi
# The slug recovery the spine-branch name depends on.
RECOVERED_SLUG="$(basename "$MATCHES")"; RECOVERED_SLUG="${RECOVERED_SLUG#"$SPINE_ID-"}"
t_assert_eq "$SPINE_SLUG" "$RECOVERED_SLUG" "the spine slug is recoverable from the directory name (nothing persists it)"

SPEC="$RESOLVED_WI_DIR/spec.md"
REPORT="$RESOLVED_WI_DIR/report.md"
# The arrow is U+2192; the AC grammar splits on it and an ASCII '->' does not parse.
printf '%s\n' \
  '## 5. Acceptance criteria' \
  '- [ ] AC-1 auto: `true` → expected: exit 0' \
  '- [ ] AC-2 auto: `false` → expected: exit 0' \
  '- [X] AC-3 auto: `echo ready` → expected: output contains ready' \
  '- [ ] AC-4 user: run the export and see the file appear' > "$SPEC"

t_capture bash "$OSS" verify_acs "$SPEC"
t_assert_rc 0 "the resolved spec feeds verify_acs - rc 0, not rc 2 'spec not found'"
# Negative control: drop the slug (the one segment nothing persists) and the same
# call is rc 2. This is what makes the glob load-bearing rather than decorative.
t_capture bash "$OSS" verify_acs "$AI_ROOT/docs/specs/$REL_ID/$SPINE_ID/work-$WI/spec.md"
t_assert_rc 2 "dropping the spine slug yields 'spec not found' rc 2 - the glob is load-bearing"

# Cross-file prose contract: the work-item docs path shape is declared in two
# skills - the lane that WRITES the handoff there and the layer that READS the
# spec back. A drift between them has no runtime signal at all; the close layer
# just resolves to a directory that has never existed.
_PATH_SHAPE='docs/specs/<release-id>/<spine-id>-<spine-slug>/work-<wi-id>'
for f in "$SKILLS/close/references/work-item-close.md" "$SKILLS/work-item/references/round-orchestration.md"; do
  if grep -Fq "$_PATH_SHAPE" "$f"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $(basename "$f") does not declare the work-item docs path shape '$_PATH_SHAPE'"
  fi
done

# The orphan rule - every references/*.md under a skill must be pointed at from
# that skill's own SKILL.md - is enforced in test-skill-bash-blocks.sh (check 5),
# across all five skills rather than close/ alone. The loop that lived here
# covered 10 of the 43 reference files; two enforcers of one rule is one too
# many, so this one was removed when the harness landed.

# ---------------------------------------------------------------------------
# C. The spine branch, the worktree, and the gate's two mechanical layers.
# ---------------------------------------------------------------------------
BASE_BRANCH="$(git -C "$CANON" rev-parse --abbrev-ref HEAD)"
SPINE_BRANCH="$(bash "$OSS" branch_name "$SP" "$SPINE_SLUG")"
git -C "$CANON" checkout -q -b "$SPINE_BRANCH"
# A commit only the spine branch has, made BEFORE the worktree is spawned -
# otherwise every reachability assertion below is vacuously true.
echo spine-only > "$CANON/spine.txt"
git -C "$CANON" add spine.txt; git -C "$CANON" commit -qm "spine-only commit"

WT="$(bash "$OSS" worktree_add canonical "$WI" "$WI_SLUG" "$SPINE_BRANCH")"
bash "$OSS" work_item_exec "$WI" "$(git -C "$WT" rev-parse --abbrev-ref HEAD)" "$WT" "$(git -C "$WT" rev-parse HEAD)" >/dev/null

# Layer 1 composes: EVERY row verify_acs emits must be grammar-valid to
# verify_step. If the expectation extraction ever drifts (leaving the raw
# '→ expected:' text in the field), every row comes back rc 2 "unrecognized
# expectation" and the whole gate fails closed on every AC - green rows and
# broken rows alike. Neither half's own unit test can see that: they are each
# driven with hand-written arguments.
_ROWS=0; _MALFORMED=0
while IFS="$(printf '\t')" read -r _label _cmd _exp; do
  [ -n "$_label" ] || continue
  _ROWS=$((_ROWS+1))
  bash "$OSS" verify_step "$WT" "$_cmd" "$_exp" >/dev/null 2>&1
  [ $? -eq 2 ] && _MALFORMED=$((_MALFORMED+1))
done < <(bash "$OSS" verify_acs "$SPEC")
t_assert_eq "3" "$_ROWS" "verify_acs emits one row per auto: AC and skips the user: row"
t_assert_eq "0" "$_MALFORMED" "every row verify_acs emits is grammar-valid to verify_step (never rc 2)"

AC2_CMD="$(bash "$OSS" verify_acs "$SPEC" | awk -F'\t' '$1=="AC-2"{print $2}')"
AC2_EXP="$(bash "$OSS" verify_acs "$SPEC" | awk -F'\t' '$1=="AC-2"{print $3}')"
t_assert_eq "false" "$AC2_CMD" "the command field arrives backtick-stripped and directly runnable"
t_assert_eq "exit 0" "$AC2_EXP" "the expectation field is the bare grammar, not the raw '→ expected:' text"
t_capture bash "$OSS" verify_step "$WT" "$AC2_CMD" "$AC2_EXP"
t_assert_rc 1 "a failing row driven with verify_acs's OWN output is rc 1 - distinguishable from a malformed rc 2, which is what lets halt-on-first-fail route to the right recovery option"

# The halt itself, executed FROM THE SHIPPED PROSE rather than from a copy of it
# retyped here. The loop is extracted out of impl-check.md and run under real
# strict mode against a spec whose second row fails and whose third row would
# leave a file behind - so "no later row ran" is a concrete observable, and the
# subject of the assertion is the file the ceremony actually ships.
#
# Both idioms in that block are silently wrong when written the obvious way:
# `oss verify_acs … | while …` puts the loop in a subshell (the halt is lost),
# and `if ! oss verify_step …; then rc=$?` captures the negation's zero (the
# halt never fires). Either mistake sails past a failing AC into layer 2 at rc 0.
SHIM="$TMP/shim"; mkdir -p "$SHIM"
printf '#!/usr/bin/env bash\nexec bash "%s" "$@"\n' "$OSS" > "$SHIM/oss"; chmod +x "$SHIM/oss"
HALT_SPEC="$TMP/halt-spec.md"
printf '%s\n' \
  '- [ ] AC-1 auto: `true` → expected: exit 0' \
  '- [ ] AC-2 auto: `false` → expected: exit 0' \
  '- [ ] AC-3 auto: `touch third-row-ran` → expected: exit 0' > "$HALT_SPEC"
HALT_DIR="$TMP/halt-run"; mkdir -p "$HALT_DIR"
BLOCK="$TMP/halt-block.sh"
# Was a hand-rolled awk; now the shared harness like the other ten, so every
# extraction in this file is one `_extract_block <source-var> <anchor> <out>`
# line. test-block-ledger.sh check 4 resolves that source variable back to the
# ledger's file, which it cannot do when the path sits on a different line from
# the anchor.
IMPL_CHECK="$SKILLS/close/references/impl-check.md"
_extract_block "$IMPL_CHECK" 'while IFS=' "$BLOCK"
if grep -q 'verify_step' "$BLOCK" && grep -q 'while IFS=' "$BLOCK"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract the halt loop from impl-check.md - the assertions below are vacuous"
fi
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; wt='$HALT_DIR'; spec='$HALT_SPEC'; . '$BLOCK'"
t_assert_rc 1 "the shipped halt loop exits nonzero when a row fails - the halt reaches the caller"
t_assert_contains "$T_OUT" "[AC] AC-2" "...tagged [AC] and naming the failing row"
if [ -e "$HALT_DIR/third-row-ran" ]; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the row AFTER the failure still ran - halt-on-first-fail is not halting"
else
  T_PASS=$((T_PASS+1))
fi

# Layer 2 - report cross-check. Assert the LIB's real message; the
# `[report cross-check]` prefix is the skill's surfacing convention and appears
# in no lib, so a ceremony grepping for it would find nothing forever.
printf '%s\n' '| AC | Status |' '| AC-1 | pass |' '| AC-3 | pass |' > "$REPORT"
t_capture bash "$OSS" report_cross_check "$REPORT" "$SPEC"
t_assert_rc 1 "report_cross_check fails when the report omits an auto: AC"
t_assert_contains "$T_OUT" "oss: report does not account for:" "...with the lib's real message"
t_assert_contains "$T_OUT" "AC-2" "...naming the missing AC"
case "$T_OUT" in
  *'[report cross-check]'*) T_FAIL=$((T_FAIL+1)); echo "FAIL: the lib emitted the skill's surfacing tag - prose may now legitimately grep for it";;
  *) T_PASS=$((T_PASS+1));;
esac
printf '%s\n' '| AC-2 | fail |' >> "$REPORT"
t_capture bash "$OSS" report_cross_check "$REPORT" "$SPEC"
t_assert_rc 0 "...and passes once every auto: AC is accounted for (so the failing case above failed for the stated reason)"

# ---------------------------------------------------------------------------
# D. The merge seam: the target this layer hands `git merge` comes from STATE,
#    written by the execution lane. A merge onto the wrong branch is rc 0.
# ---------------------------------------------------------------------------
# `oss get` is `jq -r`: an absent field prints the four characters `null`, which
# is non-empty. A bare `[ -n "$b" ]` guard passes it straight through to
# `git merge null`, so the guard has to reject the literal too.
STATE_BRANCH="$(bash "$OSS" get ".work_items[] | select(.id==\"$WI\") | .branch")"
if [ -n "$STATE_BRANCH" ] && [ "$STATE_BRANCH" != "null" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work_items[].branch is '$STATE_BRANCH' - close has no merge target and cannot recover one"
fi
t_assert_eq "$(bash "$OSS" work_item_branch "$WI" "$WI_SLUG")" "$STATE_BRANCH" "the recorded merge target matches the id grammar's own branch name"
if git -C "$CANON" rev-parse --verify --quiet "refs/heads/$STATE_BRANCH" >/dev/null; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the recorded merge target '$STATE_BRANCH' does not name a real ref"
fi

echo item > "$WT/item.txt"
git -C "$WT" add item.txt
t_assert_contains "$(git -C "$WT" diff --cached --name-only)" "item.txt" "the staging proof sees a non-empty index before the commit"
git -C "$WT" commit -qm "work item"
WI_SHA="$(git -C "$WT" rev-parse HEAD)"

t_assert_eq "$SPINE_BRANCH" "$(git -C "$CANON" rev-parse --abbrev-ref HEAD)" "canonical is parked on the spine branch when the merge runs (the guard's precondition)"
if git -C "$CANON" merge-base --is-ancestor "$WI_SHA" "$SPINE_BRANCH"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: fixture is vacuous - the work-item commit is already on the spine branch before the merge"
else
  T_PASS=$((T_PASS+1))
fi
t_capture git -C "$CANON" merge --no-ff -m "merge $WI" "$STATE_BRANCH"
t_assert_rc 0 "merging the STATE-recorded branch onto the parked spine branch succeeds"
if git -C "$CANON" merge-base --is-ancestor "$WI_SHA" "$SPINE_BRANCH"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the work-item commit is NOT reachable from the spine branch after the merge"
fi
if git -C "$CANON" merge-base --is-ancestor "$WI_SHA" "$BASE_BRANCH"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: negative control is vacuous - the commit reached $BASE_BRANCH without a merge there"
else
  T_PASS=$((T_PASS+1))
fi

# The cleanup-ordering claim work-item-close.md §6 makes, as a contrast rather
# than a single rc: a MERGED work-item branch removes cleanly, an unmerged one
# refuses rc 8. (The standalone rc-8 case is also asserted in test-worktree.sh;
# here it is the pairing that carries the meaning - cleanup can only succeed
# AFTER this layer's merge has landed.)
t_capture bash "$OSS" worktree_remove canonical "$WI"
t_assert_rc 0 "after the merge, worktree_remove succeeds and takes the branch with it"
if git -C "$CANON" show-ref --verify --quiet "refs/heads/$STATE_BRANCH"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the merged work-item branch survived cleanup"
else
  T_PASS=$((T_PASS+1))
fi
WI2="$(bash "$OSS" work_item_add "$SP" "second item")"
WT2="$(bash "$OSS" worktree_add canonical "$WI2" "second-item" "$SPINE_BRANCH")"
echo two > "$WT2/two.txt"; git -C "$WT2" add two.txt; git -C "$WT2" commit -qm "unmerged work"
t_capture bash "$OSS" worktree_remove canonical "$WI2"
t_assert_rc 8 "an UNMERGED work-item branch refuses cleanup rc 8 - which is why cleanup runs after the merge, not before"

# ---------------------------------------------------------------------------
# E. Spine close (Task 10). Every block below is EXTRACTED FROM THE SHIPPED
#    PROSE and executed under real strict mode, so the subject of each assertion
#    is the file the ceremony ships rather than a copy retyped here.
#
#    NOT COVERED, and not coverable: "apply-pending runs before the demo" and "a
#    failing demo halts before the critic, the harvest and cleanup" are orderings
#    of prose steps with no executable surface. A script that calls apply-pending
#    then demo_run asserts nothing about the ceremony - it tests a fixture
#    written to pass. Task 13's harness checks that every `oss` verb the prose
#    names resolves; beyond that those orderings have no coverage in this release.
# ---------------------------------------------------------------------------
SPINE_CLOSE="$SKILLS/close/references/spine-close.md"
# `_extract_block` is defined at the TOP of this file (see the note there).
# It delegates to the shared harness (#138), which REFUSES an anchor matching
# more than one block: the old inline awk stopped at the first match, so a
# duplicated anchor bound silently to whichever came first and would have
# silently REBOUND if a block were inserted above it. Every anchor used below
# is asserted unique, and bound to its source file, by test-block-ledger.sh.
OPEN_BLOCK="$TMP/spine-open.sh";  _extract_block "$SPINE_CLOSE" 'work items that are not complete' "$OPEN_BLOCK"
# The merge pass anchors on 'merge --no-ff', not 'is-ancestor' (#339): the PR
# record pass added its own --is-ancestor lineage guard, and the harness refuses
# an anchor matching two blocks — a duplicated 'is-ancestor' would bind to
# whichever block came first and silently REBIND when the other is edited.
MERGE_BLOCK="$TMP/spine-merge.sh"; _extract_block "$SPINE_CLOSE" 'merge --no-ff' "$MERGE_BLOCK"
PRRECORD_BLOCK="$TMP/spine-prrecord.sh"; _extract_block "$SPINE_CLOSE" 'mergeCommit' "$PRRECORD_BLOCK"
TOUCH_BLOCK="$TMP/spine-touch.sh"; _extract_block "$SPINE_CLOSE" 'touch_check' "$TOUCH_BLOCK"
for _pair in "$OPEN_BLOCK:work_items" "$MERGE_BLOCK:merge --no-ff" "$PRRECORD_BLOCK:mergeCommit" "$TOUCH_BLOCK:touch_check"; do
  _bf="${_pair%%:*}"; _bn="${_pair#*:}"
  if [ -s "$_bf" ] && grep -Fq "$_bn" "$_bf"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract '$_bn' from spine-close.md - the assertions below are vacuous"
  fi
done

# E1. Step 1 refuses and NAMES the offenders. `oss get` is jq -r without -e: a
# select matching nothing exits 0, so a block testing the rc instead of the
# output would close a spine with two unfinished items. Both ids must appear.
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; spine_id='$SP'; . '$OPEN_BLOCK'"
t_assert_rc 1 "step 1 halts when a work item is not complete"
t_assert_contains "$T_OUT" "$WI" "...naming the first offender by id"
t_assert_contains "$T_OUT" "$WI2" "...and the second - join(\", \") lists every one, not just the first"
bash "$OSS" work_item_status "$WI" complete >/dev/null
bash "$OSS" work_item_status "$WI2" complete >/dev/null
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; spine_id='$SP'; . '$OPEN_BLOCK'"
t_assert_rc 0 "...and passes once every item is complete (so the refusal above fired for the stated reason)"
t_assert_eq "" "$T_OUT" "...silently - a passing gate says nothing"

# Move the BASE branch forward, the way a sibling spine closing first would.
# This is what makes the changed-path assertions in E5 non-vacuous: with the base
# still at the fork point every candidate computation agrees.
git -C "$CANON" checkout -q "$BASE_BRANCH"
echo sibling > "$CANON/sibling.txt"
git -C "$CANON" add sibling.txt; git -C "$CANON" commit -qm "a sibling spine landed on base"
git -C "$CANON" checkout -q "$SPINE_BRANCH"
SPINE_TIP="$(git -C "$CANON" rev-parse "$SPINE_BRANCH")"
if git -C "$CANON" merge-base --is-ancestor "$SPINE_TIP" "$BASE_BRANCH"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: fixture is vacuous - the spine tip is already on $BASE_BRANCH before any spine-close merge"
else
  T_PASS=$((T_PASS+1))
fi

_spine_unreached() { # $1=label ; the spine must NOT have landed on base
  if git -C "$CANON" merge-base --is-ancestor "$SPINE_TIP" "$BASE_BRANCH"; then
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $1 - the spine reached $BASE_BRANCH anyway"
  else
    T_PASS=$((T_PASS+1))
  fi
}

# E2-E5 inject `repo_base_branches`, one "<repo>:<base_branch>" line per hosting
# repo, instead of a bare `base_branch` - Task 9 (#272/#310) turned the once-per-
# spine merge into a loop over every repo hosting the spine's items, keyed off
# `oss get .work_items[].target_repo`. This fixture declares one repo
# ("canonical"), and both $WI and $WI2 default to it, so the block's own loop
# resolves the very same single iteration the old single-repo form ran - the
# assertions below exercise the loop body's guards against that one hosting
# repo, not the multi-repo iteration itself (the same scope note
# round-orchestration.md's `checkout -q -b` row carries in block-ledger.tsv).
# The messages are BYTE-IDENTICAL to the old single-`canonical` wording,
# because the block interpolates the resolved repo NAME ("canonical") in
# exactly the position the old block hardcoded the literal word.

# E2. Canonical parked somewhere other than the spine branch. This is the guard
# the whole step turns on: reading the branch off HEAD instead of deriving it
# makes the switch-back a no-op, the merge "Already up to date" at rc 0, and
# every later step green against a tree the spine never reached. The reachability
# check CANNOT catch it - on a self-merge the tip is trivially its own ancestor.
git -C "$CANON" checkout -q "$BASE_BRANCH"
t_assert_eq "$BASE_BRANCH" "$(git -C "$CANON" rev-parse --abbrev-ref HEAD)" "the wrong-branch fixture really is parked off the spine branch (the guard's precondition)"
t_capture env "PATH=$SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='$SP'; spine_slug='$SPINE_SLUG'; repo_base_branches='canonical:$BASE_BRANCH'; . '$MERGE_BLOCK'"
t_assert_rc 1 "a spine close with canonical parked elsewhere halts BEFORE the merge"
t_assert_contains "$T_OUT" "canonical is on '$BASE_BRANCH', not '$SPINE_BRANCH'" "...naming both the branch it found and the branch it derived"
_spine_unreached "wrong-branch halt"

# E3. base_branch unresolvable for the hosting repo. The plan doc's
# spine-context section is the only record of it, so an empty read is
# reachable. Unguarded, `git checkout -q ""` fails at rc 128 and the ceremony
# merges the spine branch into ITSELF at rc 0.
git -C "$CANON" checkout -q "$SPINE_BRANCH"
t_capture env "PATH=$SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='$SP'; spine_slug='$SPINE_SLUG'; repo_base_branches=''; . '$MERGE_BLOCK'"
t_assert_rc 1 "an unresolvable base_branch halts"
t_assert_contains "$T_OUT" "no base_branch recorded for $SP" "...naming the spine whose base branch is missing"
t_assert_eq "$SPINE_BRANCH" "$(git -C "$CANON" rev-parse --abbrev-ref HEAD)" "...leaving canonical where it was"
_spine_unreached "empty base_branch halt"

# E3b. base_branch naming a branch that does not exist (a typo in the plan doc's
# spine-context line). The checkout fails, and its rc must be read.
t_capture env "PATH=$SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='$SP'; spine_slug='$SPINE_SLUG'; repo_base_branches='canonical:no-such-base'; . '$MERGE_BLOCK'"
t_assert_rc 1 "a base_branch naming no ref halts"
t_assert_contains "$T_OUT" "cannot check out base branch 'no-such-base'" "...from the checkout's own rc, naming the branch it could not reach"
_spine_unreached "missing base_branch halt"

# E4. base_branch resolving to a TRACKED FILE rather than a branch. `git checkout
# -q <tracked-file>` restores that file and exits 0 WITHOUT moving HEAD, so the
# checkout's rc says nothing - only asserting HEAD actually moved catches it.
git -C "$CANON" rev-parse --verify --quiet "refs/heads/f.txt" >/dev/null \
  && { T_FAIL=$((T_FAIL+1)); echo "FAIL: 'f.txt' names a branch here - the tracked-file case is not what this exercises"; }
t_capture env "PATH=$SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='$SP'; spine_slug='$SPINE_SLUG'; repo_base_branches='canonical:f.txt'; . '$MERGE_BLOCK'"
t_assert_rc 1 "a base_branch naming a tracked file halts even though the checkout exits 0"
t_assert_contains "$T_OUT" "switch-back left canonical on '$SPINE_BRANCH', not 'f.txt'" "...from the post-checkout HEAD assertion, not from the checkout's rc"
_spine_unreached "tracked-file base_branch halt"

# E5. The happy path, and the changed-path list the touch check reads. Both
# blocks run in ONE shell so $merge_shas really crosses the seam from step 2 to
# step 5 (repo:sha pairs, one per hosting repo - never a bash associative array)
# rather than being handed over by this test.
#
# Two bones make the path computation observable:
#   ADR-0101 covers the file only the SPINE changed  -> must HIT
#   ADR-0102 covers the file only the BASE changed   -> must NOT hit
# `git diff --name-only $base..$spine` after the merge names sibling.txt and NOT
# spine.txt - exactly inverted - so this pair fails loudly on that computation.
bash "$OSS" bone_add ADR-0101 "the surface the spine moved" "spine.txt" >/dev/null
bash "$OSS" bone_add ADR-0102 "a surface the spine never touched" "sibling.txt" >/dev/null
git -C "$CANON" checkout -q "$SPINE_BRANCH"
t_capture env "PATH=$SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='$SP'; spine_slug='$SPINE_SLUG'; repo_base_branches='canonical:$BASE_BRANCH'; . '$MERGE_BLOCK'; . '$TOUCH_BLOCK'"
t_assert_rc 0 "the merge block plus the touch block run clean end to end"
t_assert_eq "$BASE_BRANCH" "$(git -C "$CANON" rev-parse --abbrev-ref HEAD)" "the switch-back left canonical on the base branch"
if git -C "$CANON" merge-base --is-ancestor "$SPINE_TIP" "$BASE_BRANCH"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the spine tip is NOT reachable from $BASE_BRANCH after the merge"
fi
if git -C "$CANON" cat-file -e "$BASE_BRANCH:spine.txt" 2>/dev/null; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the spine's own file is absent from $BASE_BRANCH - the merge moved a ref but landed no content"
fi
t_assert_contains "$T_OUT" "bone ADR-0101" "the changed-path list contains the file the SPINE changed (the merge's own first-parent diff)"
case "$T_OUT" in
  *"ADR-0102"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: the changed-path list named a file only the BASE branch changed - this is 'git diff \$base..\$spine', which is inverted after the merge";;
  *) T_PASS=$((T_PASS+1));;
esac

# E5b. RESUME. E5 left canonical merged and parked on its base branch - exactly
# the state a close halted at step 5 leaves behind. Re-entering the merge block
# used to be impossible: it asserted HEAD == $spine_branch and halted on a repo
# it had itself finished, and $merge_shas (a shell variable) was gone, so §6's
# touch check had nothing to compute a first-parent diff from. The resume arm
# now lives inside the loop, so this is the same block run twice.
FIRST_MERGE="$(git -C "$CANON" rev-parse "$BASE_BRANCH")"
MERGES_BEFORE="$(git -C "$CANON" rev-list --merges --count "$BASE_BRANCH")"
t_capture env "PATH=$SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='$SP'; spine_slug='$SPINE_SLUG'; repo_base_branches='canonical:$BASE_BRANCH'; . '$MERGE_BLOCK'; printf 'PAIRS%s\n' \"\$merge_shas\""
t_assert_rc 0 "resume: the merge block re-runs clean against an already-landed repo"
t_assert_contains "$T_OUT" "already landed at $FIRST_MERGE" "resume: the landed repo is recognised and its merge sha reconstructed from history"
t_assert_contains "$T_OUT" "canonical:$FIRST_MERGE" "resume: \$merge_shas is repopulated for the landed repo - the touch check reads it"
t_assert_eq "$MERGES_BEFORE" "$(git -C "$CANON" rev-list --merges --count "$BASE_BRANCH")" "resume: no second, spurious merge commit was created"
t_assert_eq "$BASE_BRANCH" "$(git -C "$CANON" rev-parse --abbrev-ref HEAD)" "resume: the repo is left on its base branch"

# E5c. A PARTIAL changed-path list must halt, not read as clean. The per-repo
# diff loop used to sit inside a process substitution, so the outer loop saw its
# stdout and never its exit status: a repo failing AFTER an earlier one emitted
# paths contributed nothing silently, `$#` stayed non-zero, and touch_check ran
# over a list missing that repo's changes. The good pair comes FIRST here on
# purpose - that is the ordering the old form could not detect.
t_capture env "PATH=$SHIM:$PATH" bash -c \
  "set -euo pipefail; merge_shas='canonical:$FIRST_MERGE
nosuchrepo:$FIRST_MERGE'; . '$TOUCH_BLOCK'"
t_assert_rc 1 "a repo failing after another already emitted paths halts the touch check"
t_assert_contains "$T_OUT" "INCOMPLETE" "...and says the changed-path list would be incomplete"
case "$T_OUT" in
  *"touch check: clean"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: touch_check reported CLEAN over a partial path list - the exact false negative this guard exists to prevent";;
  *) T_PASS=$((T_PASS+1));;
esac

# E6. touch_check's three exit codes across four cases (zero paths, hit,
# clean, unreadable registry), read straight off the dispatcher.
t_capture bash "$OSS" touch_check
t_assert_rc 2 "touch_check with ZERO paths is rc 2 (could-not-check), NOT rc 1 (clean)"
t_assert_contains "$T_OUT" "needs at least one path" "...saying why"
t_capture bash "$OSS" touch_check spine.txt
t_assert_rc 0 "a path on a registered surface is rc 0 - a HIT, not a failure"
t_assert_eq "bone ADR-0101" "$T_OUT" "...printing the kind and the ref, which is what the reclassification reason quotes"
t_capture bash "$OSS" touch_check docs/unrelated.md
t_assert_rc 1 "a path on no registered surface is rc 1 - clean"
t_assert_eq "" "$T_OUT" "...with nothing on stdout"
BROKEN="$TMP/broken-state.json"; printf '%s\n' '{"schema_version":2}' > "$BROKEN"
t_capture env "OSS_STATE_FILE=$BROKEN" bash "$OSS" touch_check spine.txt
t_assert_rc 2 "a state whose bones registry is unreadable is rc 2 - INCONCLUSIVE, never clean"
t_assert_contains "$T_OUT" "INCONCLUSIVE, not clean" "...saying so in the lib's own words"

# E7. The shipped block's rc-2 arm: inconclusive must HALT, not fall through to
# the clean branch. Driven by pointing the block's touch_check at that same
# unreadable state. `merge_shas` is one "<repo>:<sha>" pair - the aggregation
# form §6 now reads, never a bare `merge_sha`/`canonical` pair (Task 9).
MERGE_SHA="$(git -C "$CANON" rev-parse "$BASE_BRANCH")"
t_capture env "PATH=$SHIM:$PATH" "OSS_STATE_FILE=$BROKEN" bash -c \
  "set -euo pipefail; merge_shas='canonical:$MERGE_SHA'; . '$TOUCH_BLOCK'"
t_assert_rc 1 "the shipped block HALTS on touch_check rc 2 rather than treating it as clean"
t_assert_contains "$T_OUT" "INCONCLUSIVE, not clean - halt" "...with the halt naming the reason"

# E8. A merge that changed no paths in the one hosting repo. touch_check would
# answer rc 2 for it, so the block halts BEFORE the call and says which of the
# two rc-2 causes this is.
git -C "$CANON" checkout -q -b empty-spine "$BASE_BRANCH"
echo transient > "$CANON/transient.txt"; git -C "$CANON" add transient.txt
git -C "$CANON" commit -qm "add a file"
git -C "$CANON" rm -q transient.txt; git -C "$CANON" commit -qm "and take it away again"
git -C "$CANON" checkout -q "$BASE_BRANCH"
git -C "$CANON" merge --no-ff empty-spine -m "a spine that netted no change" >/dev/null
EMPTY_MERGE="$(git -C "$CANON" rev-parse HEAD)"
t_assert_eq "" "$(git -C "$CANON" diff --name-only "$EMPTY_MERGE^1" "$EMPTY_MERGE")" "the empty-merge fixture really does change no path (the guard's precondition)"
t_capture env "PATH=$SHIM:$PATH" bash -c \
  "set -euo pipefail; merge_shas='canonical:$EMPTY_MERGE'; . '$TOUCH_BLOCK'"
t_assert_rc 1 "a merge that changed no paths halts"
t_assert_contains "$T_OUT" "the merge changed no paths" "...distinguishing the empty-input cause from an unreadable registry"

# ---------------------------------------------------------------------------
# F. Release close (Task 11). The two blocking gates, and THE FIXTURE SET IS THE
#    POINT.
#
#    The gates are read-only selectors, so unlike §E there is a real executable
#    subject here — but a selector test is worthless unless its fixtures
#    DISCRIMINATE. Three defective selectors are each individually green over the
#    obvious fixture pair:
#      * `status == "active"` alone      - green unless a RENEWED fake sits AT its
#                                          expiry (fixture b)
#      * `expiry == release` (identity)  - green unless an outstanding fake sits
#                                          BEFORE the closing release (fixture c)
#      * a STRING comparison of ids      - green until r10, because "r1" <= "r10"
#                                          is true and only "r2" <= "r10" is false
#                                          (fixture f)
#    Every assertion below names a concrete row, not a substring or a bare rc.
# ---------------------------------------------------------------------------
REL2="$(bash "$OSS" release_add "second" "a second goal")"
REL3="$(bash "$OSS" release_add "third" "a third goal")"
REL4="$(bash "$OSS" release_add "fourth" "a fourth goal")"
# Releases mint from r0 - the skeleton IS Release 0 - while spines and work
# items start at 1. The expiry fixtures below are keyed to these real ids, so
# pin the convention rather than assuming the r1-first shape the other two
# levels use.
t_assert_eq "r0" "$REL"  "the first release mints r0 - the skeleton is Release 0"
t_assert_eq "r1" "$REL2" "...and the second r1 (the expiry fixtures below name real releases)"
t_assert_eq "r2" "$REL3" "...and the third r2 - the closing release for the fixture set"
t_assert_eq "r3" "$REL4" "...and the fourth r3 - the at-or-before arm's second vantage point"

# The seven fixtures, built through the real verbs so the STORED shape is the
# subject - not a hand-written state blob that could disagree with what
# fake_add/fake_status actually write.
bash "$OSS" fake_add "f-active-at-r2"  fake "no sandbox yet"  "the vendor ships a sandbox" r2 >/dev/null
bash "$OSS" fake_add "f-renewed-at-r2" fake "no sandbox yet"  "the first live order"       r1 >/dev/null
bash "$OSS" fake_status "f-renewed-at-r2" renewed "still needed, one more release" r2 >/dev/null
bash "$OSS" fake_add "f-active-at-r1"  fake "deferred wiring" "the first second account"   r1 >/dev/null
bash "$OSS" fake_add "f-renewed-to-r5" fake "still too early" "the first paying user"      r1 >/dev/null
bash "$OSS" fake_status "f-renewed-to-r5" renewed "pushed out with a reason" r5 >/dev/null
bash "$OSS" fake_add "f-replaced-at-r2" fake "shell for now"  "the real adapter lands"     r2 >/dev/null
bash "$OSS" fake_status "f-replaced-at-r2" replaced "the real adapter landed in r1.s1" >/dev/null
bash "$OSS" fake_add "f-no-expiry"     fake "never dated"     "nobody wrote a condition"   "" >/dev/null

# PRECONDITIONS. A fixture that does not carry the property under test makes
# every assertion below vacuous - which is exactly how the old plan's fixture
# pair stayed green under the broken selector.
_fk() { bash "$OSS" get ".fakes[] | select(.boundary==\"$1\") | .$2"; }
t_assert_eq "renewed" "$(_fk f-renewed-at-r2 status)"          "fixture (b) really carries status=renewed"
t_assert_eq "r2"      "$(_fk f-renewed-at-r2 expiry_release)"  "...AND its expiry really moved to r2 - both halves, or (b) discriminates nothing"
t_assert_eq "active"  "$(_fk f-active-at-r1 status)"           "fixture (c) is outstanding"
t_assert_eq "r1"      "$(_fk f-active-at-r1 expiry_release)"   "...and expired BEFORE the closing release"
t_assert_eq "renewed" "$(_fk f-renewed-to-r5 status)"          "fixture (d) is renewed"
t_assert_eq "r5"      "$(_fk f-renewed-to-r5 expiry_release)"  "...to a LATER expiry - the renewal that legitimately does not block"
t_assert_eq "replaced" "$(_fk f-replaced-at-r2 status)"        "fixture (e) is the resolving status"
t_assert_eq "r2"      "$(_fk f-replaced-at-r2 expiry_release)" "...AT the closing release - so only .status can be excluding it"

# The r2 close. Assert the EXACT rows, tab-separated, not that output "contains"
# a boundary name.
TAB="$(printf '\t')"
t_capture bash "$OSS" expired_fakes r2
t_assert_rc 1 "expired_fakes returns rc 1 when the blocking set is NON-EMPTY (0=clean is the opposite polarity to touch_check)"
t_assert_eq "4" "$(printf '%s\n' "$T_OUT" | grep -c . || true)" "exactly four fakes block at r2 - a broader or narrower selector moves this number"
t_assert_contains "$T_OUT" "f-active-at-r2${TAB}active${TAB}r2${TAB}the vendor ships a sandbox" "(a) an ACTIVE fake at its expiry blocks, and the row carries boundary/status/expiry/trigger"
t_assert_contains "$T_OUT" "f-renewed-at-r2${TAB}renewed${TAB}r2${TAB}the first live order" "(b) THE DISCRIMINATING FIXTURE: a RENEWED fake at its expiry also blocks - an active-only selector drops exactly this row"
t_assert_contains "$T_OUT" "f-active-at-r1${TAB}active${TAB}r1${TAB}the first second account" "(c) an outstanding fake that expired EARLIER still blocks - an identity comparison drops exactly this row"
t_assert_contains "$T_OUT" "f-no-expiry${TAB}active${TAB}unparseable-expiry" "an expiry that cannot be parsed BLOCKS, marked - it can never fire, so skipping it makes the fake permanent"
case "$T_OUT" in
  *f-renewed-to-r5*) T_FAIL=$((T_FAIL+1)); echo "FAIL: (d) a fake renewed to a LATER expiry blocked - the gate is not reading expiry_release";;
  *) T_PASS=$((T_PASS+1));;
esac
case "$T_OUT" in
  *f-replaced-at-r2*) T_FAIL=$((T_FAIL+1)); echo "FAIL: (e) a REPLACED fake at its expiry blocked - replaced is the only resolving status";;
  *) T_PASS=$((T_PASS+1));;
esac

# (c) again at r3, the framing the at-or-before arm is named for: an r1 expiry
# two releases later.
t_capture bash "$OSS" expired_fakes r3
t_assert_rc 1 "...and at r3's close the gate still blocks"
t_assert_contains "$T_OUT" "f-active-at-r1${TAB}active${TAB}r1" "(c) an r1 expiry still blocks at r3 - at-or-before, not identity"

# (f) THE NUMERIC GUARD. jq evaluates "r2" <= "r10" as FALSE, so a string
# comparison silently stops blocking r2 expiries from the tenth release on.
# "r1" <= "r10" is TRUE, so fixture (c) canNOT catch this - only an r2-at-r10 row
# discriminates, which is why this assertion names f-active-at-r2 specifically.
t_assert_eq "false" "$(jq -n '"r2" <= "r10"')" "the lexicographic trap this fixture exists for is real (the guard's precondition)"
t_capture bash "$OSS" expired_fakes r10
t_assert_rc 1 "the gate blocks at r10"
t_assert_contains "$T_OUT" "f-active-at-r2${TAB}active${TAB}r2" "(f) an r2 expiry blocks at r10 - a STRING comparison drops exactly this row"
t_assert_contains "$T_OUT" "f-renewed-to-r5${TAB}renewed${TAB}r5" "...and the r5 renewal is due by r10 too, so the r10 set is genuinely wider than the r2 set"

# rc 0 = CLEAN, on a state with no outstanding fakes. Captured with stderr
# dropped: OSS_STATE_FILE emits an override notice that t_capture would merge in.
CLEANST="$TMP/clean-state.json"; printf '%s\n' '{"schema_version":2,"fakes":[],"demo_ledger":[]}' > "$CLEANST"
_CL_OUT="$(env "OSS_STATE_FILE=$CLEANST" bash "$OSS" expired_fakes r2 2>/dev/null)"; _CL_RC=$?
t_assert_eq "0" "$_CL_RC" "an empty blocking set is rc 0 - CLEAN (so every rc 1 above fired for the stated reason)"
t_assert_eq "" "$_CL_OUT" "...with nothing on stdout"

# rc 2, both causes, kept distinguishable from rc 1.
t_capture bash "$OSS" expired_fakes "rX"
t_assert_rc 2 "a release argument that is not r<N> is rc 2 - could-not-check, never clean"
t_assert_contains "$T_OUT" "needs a release id of the form r<N>" "...saying why"
t_capture env "OSS_STATE_FILE=$BROKEN" bash "$OSS" expired_fakes r2
t_assert_rc 2 "a state whose fakes registry is unreadable is rc 2 - INCONCLUSIVE, never clean"
t_assert_contains "$T_OUT" "INCONCLUSIVE, not clean" "...in the lib's own words"

# (g) The quarantine twin.
bash "$OSS" ledger_add_auto "$SP" "the export still runs"  "true" "exit:0" >/dev/null
bash "$OSS" ledger_add_auto "$SP" "the report still opens" "true" "exit:0" >/dev/null
bash "$OSS" ledger_add_auto "$SP" "the archive still lists" "true" "exit:0" >/dev/null
bash "$OSS" ledger_quarantine d1 "flaky upstream, unrelated to any open spine" r1 >/dev/null
bash "$OSS" ledger_quarantine d2 "raised during this very release" r2 >/dev/null
bash "$OSS" ledger_quarantine d3 "nobody passed a release" "" >/dev/null

# THE FIELD-NAME TRAP, pinned so nobody "fixes" the selector back to `.release`.
# oss_ledger_quarantine builds a payload keyed `release`, but _oss_apply_op
# writes it onto the LINE as `.quarantined_in_release`. A selector written from
# the payload shape reads a key that exists on no line and every quarantine
# escapes at rc 0, forever.
t_assert_eq "r1" "$(bash "$OSS" get '.demo_ledger[] | select(.id=="d1") | .quarantined_in_release')" "the quarantine release is stored as .quarantined_in_release"
t_assert_eq "null" "$(bash "$OSS" get '.demo_ledger[] | select(.id=="d1") | .release')" "...and NOT as .release - the payload key is not the record key"
t_assert_eq "null" "$(bash "$OSS" get '.demo_ledger[] | select(.id=="d3") | .quarantined_in_release')" "an anchorless quarantine records no release key at all (the guard's precondition)"

t_capture bash "$OSS" expired_quarantines r2
t_assert_rc 1 "expired_quarantines is rc 1 when a ticket is owed - same polarity as the fake gate"
t_assert_eq "2" "$(printf '%s\n' "$T_OUT" | grep -c . || true)" "exactly two quarantines block at r2"
t_assert_contains "$T_OUT" "d1${TAB}r1${TAB}flaky upstream, unrelated to any open spine" "(g) a quarantine from an EARLIER release blocks, with its release and reason"
t_assert_contains "$T_OUT" "d3${TAB}no-release-anchor" "an anchorless quarantine blocks - a ticket with no release can never come due"
case "$T_OUT" in
  *d2*) T_FAIL=$((T_FAIL+1)); echo "FAIL: a quarantine raised in THIS release blocked - the comparison must be strictly earlier, or a close can never quarantine anything";;
  *) T_PASS=$((T_PASS+1));;
esac
_QC_OUT="$(env "OSS_STATE_FILE=$CLEANST" bash "$OSS" expired_quarantines r2 2>/dev/null)"; _QC_RC=$?
t_assert_eq "0" "$_QC_RC" "an empty quarantine set is rc 0 - CLEAN"
t_assert_eq "" "$_QC_OUT" "...with nothing on stdout"
t_capture bash "$OSS" expired_quarantines "r"
t_assert_rc 2 "a malformed release argument is rc 2 on the quarantine gate too"

# ---------------------------------------------------------------------------
# F2. The shipped branch blocks, EXTRACTED FROM THE PROSE and run under real
#     strict mode. The polarity is inverted relative to touch_check, so the arm
#     the ceremony actually branches on is the thing worth executing.
# ---------------------------------------------------------------------------
RELEASE_CLOSE="$SKILLS/close/references/release-close.md"
PATCH_LANE="$SKILLS/close/references/patch-lane.md"
SPINEGATE_BLOCK="$TMP/rel-spinegate.sh"; _extract_block "$RELEASE_CLOSE" 'spines that are not closed' "$SPINEGATE_BLOCK"
FAKEGATE_BLOCK="$TMP/rel-fakegate.sh";   _extract_block "$RELEASE_CLOSE" 'expired_fakes' "$FAKEGATE_BLOCK"
QUARGATE_BLOCK="$TMP/rel-quargate.sh";   _extract_block "$RELEASE_CLOSE" 'expired_quarantines' "$QUARGATE_BLOCK"
PATCH_BLOCK="$TMP/patch-touch.sh";       _extract_block "$PATCH_LANE"    'touch_check'         "$PATCH_BLOCK"
for _pair in "$SPINEGATE_BLOCK:open_spines" "$FAKEGATE_BLOCK:expired_fakes" "$QUARGATE_BLOCK:expired_quarantines" "$PATCH_BLOCK:touch_check"; do
  _bf="${_pair%%:*}"; _bn="${_pair#*:}"
  if [ -s "$_bf" ] && grep -Fq "$_bn" "$_bf"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract '$_bn' - the assertions below are vacuous"
  fi
done

# Step 1's gate. `oss get` is jq -r without -e, so a select matching nothing
# exits 0 - a block testing the rc closes a release with every spine still open.
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; rel='$REL'; . '$SPINEGATE_BLOCK'"
t_assert_rc 1 "step 1 halts when a spine is not closed"
t_assert_contains "$T_OUT" "$SP (planned)" "...naming the offender AND its status - planned and active are different problems"
bash "$OSS" spine_status "$SP" closed >/dev/null
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; rel='$REL'; . '$SPINEGATE_BLOCK'"
t_assert_rc 0 "...and passes once every spine is closed (so the refusal above fired for the stated reason)"
t_assert_eq "" "$T_OUT" "...silently. This is also the strict-mode trap: the block's LAST command is the abandoned test, and an '[ -n ] && echo' form would return 1 here and abort a clean close"

# The abandoned arm: not closed, but neither a silent pass nor a hard halt.
SP_AB="$(bash "$OSS" spine_add "$REL" "a spine we gave up on" flesh)"
bash "$OSS" spine_status "$SP_AB" abandoned >/dev/null
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; rel='$REL'; . '$SPINEGATE_BLOCK'"
t_assert_rc 0 "an abandoned spine does NOT hard-halt the release (it never reaches a close, so a refusal would be permanent)"
t_assert_contains "$T_OUT" "contains abandoned spines: $SP_AB" "...but it IS surfaced by name for an explicit confirmation - abandoned is not closed"

# Both blocking gates' branch arms, through the shipped case statements.
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; rel='r2'; . '$FAKEGATE_BLOCK'"
t_assert_rc 1 "the shipped fake-gate block HALTS on rc 1 - it does not read rc 1 as 'clean' the way a touch_check-shaped copy would"
t_assert_contains "$T_OUT" "f-renewed-at-r2" "...printing the blocking rows, including the renewed one"
t_assert_contains "$T_OUT" "replace or explicitly renew each" "...and naming the only two unblocks"
t_capture env "PATH=$SHIM:$PATH" "OSS_STATE_FILE=$CLEANST" bash -c "set -euo pipefail; rel='r2'; . '$FAKEGATE_BLOCK'"
t_assert_rc 0 "...and proceeds on rc 0"
t_assert_contains "$T_OUT" "fake expiry: clean" "...saying so"
t_capture env "PATH=$SHIM:$PATH" "OSS_STATE_FILE=$BROKEN" bash -c "set -euo pipefail; rel='r2'; . '$FAKEGATE_BLOCK'"
t_assert_rc 1 "the shipped block HALTS on rc 2 rather than degrading to clean"
t_assert_contains "$T_OUT" "INCONCLUSIVE, not clean - halt" "...with the halt naming the reason"

t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; rel='r2'; . '$QUARGATE_BLOCK'"
t_assert_rc 1 "the shipped quarantine block halts on an owed ticket"
t_assert_contains "$T_OUT" "quarantines owed from an earlier release" "...naming the finding"
t_capture env "PATH=$SHIM:$PATH" "OSS_STATE_FILE=$BROKEN" bash -c "set -euo pipefail; rel='r2'; . '$QUARGATE_BLOCK'"
t_assert_rc 1 "...and halts on rc 2 too"
t_assert_contains "$T_OUT" "INCONCLUSIVE, not clean - halt" "...distinguishing could-not-check from a real finding"

# The patch lane's mechanical two thirds. rc 0 is a HIT here - the opposite of
# the two gates above - so running the block proves the arms are not copied.
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; . '$PATCH_BLOCK' spine.txt"
t_assert_rc 0 "the patch-lane block runs clean over a path on a declared surface"
t_assert_contains "$T_OUT" "it is a spine, not a patch" "...and routes a bone-touching path AWAY from the lane (touch_check rc 0 is a HIT)"
t_capture env "PATH=$SHIM:$PATH" bash -c "set -euo pipefail; . '$PATCH_BLOCK' docs/unrelated.md"
t_assert_contains "$T_OUT" "the mechanical two thirds pass" "...and lets a path on no declared surface through (rc 1 is clean)"
t_capture env "PATH=$SHIM:$PATH" "OSS_STATE_FILE=$BROKEN" bash -c "set -euo pipefail; . '$PATCH_BLOCK' spine.txt"
t_assert_contains "$T_OUT" "route it as a spine" "...and resolves an INCONCLUSIVE check AGAINST the permissive lane"

# ---------------------------------------------------------------------------
# W1/W2: the two WRONG-BRANCH guards, which had zero executable coverage.
#
# A merge onto the wrong branch succeeds at rc 0. That shape caused three
# separate P0s in this series, and the guards written to stop it were themselves
# untested: deleting either left all 24 test files green. Both blocks are
# EXTRACTED from the shipped prose (never retyped) and run under real
# `set -euo pipefail`, so the subject is the artifact an agent will execute.
# ---------------------------------------------------------------------------
WIC="$SKILLS/close/references/work-item-close.md"
ROUND="$SKILLS/work-item/references/round-orchestration.md"

W_GUARD="$TMP/wi-guard.sh"; _extract_block "$WIC" 'abbrev-ref' "$W_GUARD"
W_CUT="$TMP/spine-cut.sh";  _extract_block "$ROUND" 'checkout -q -b' "$W_CUT"
for _pair in "$W_GUARD:rev-parse --abbrev-ref" "$W_CUT:checkout -q -b"; do
  _bf="${_pair%%:*}"; _bn="${_pair#*:}"
  if [ -s "$_bf" ] && grep -Fq "$_bn" "$_bf"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract '$_bn' - the W1/W2 assertions below are vacuous"
  fi
done

# Both blocks resolve `canonical` via `oss repo_root`, so a caller-injected
# value is overwritten. Shim the resolver verbs to point at the scratch repo
# and delegate everything else to the real dispatcher. $3 doubles as the `oss
# get` return for whichever call site is under test: W1's guard now makes TWO
# `oss get` calls (Task 9, #272/#310 - `.target_repo` first, to resolve the
# item's own repo, then `.branch`), and only the second is $3's job - the
# first must answer "canonical" regardless of $3 so the guard's own
# `oss repo_root "$target_repo"` call lands on the first case arm below,
# exactly as W2's per-repo loop (round-orchestration.md §2) already needs for
# its one `target_repo` value to iterate. A case arm matching on the literal
# substring "target_repo" wins over the generic `"get "*` arm (case tries arms
# in order), so it answers BOTH calls the same way without knowing which test
# is running - and it does not disturb W2, whose own $3 was already
# "canonical" for the exact query this arm now intercepts.
_wshim() { # $1=dir-to-return $2=spine-branch $3=wi-branch-or-repo $4=shim-dir
  mkdir -p "$4"
  { printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "%s/args.log"\ncase "$1 $2" in\n' "$4"
    printf '  "repo_root canonical") echo %s ;;\n' "$1"
    printf '  "branch_name "*)       echo %s ;;\n' "$2"
    printf '  *"target_repo"*)       echo canonical ;;\n'
    printf '  "get "*)               echo %s ;;\n' "$3"
    printf '  *) exec bash "%s" "$@" ;;\nesac\n' "$OSS"
  } > "$4/oss"; chmod +x "$4/oss"
}

# W1 — the work-item merge guard fires when canonical is parked elsewhere.
W1="$TMP/w1"; mkdir -p "$W1"; git -C "$W1" init -q
git -C "$W1" config user.email t@t; git -C "$W1" config user.name t
echo seed > "$W1/f"; git -C "$W1" add .; git -C "$W1" commit -qm seed
W1_BASE="$(git -C "$W1" rev-parse --abbrev-ref HEAD)"
git -C "$W1" branch "spine/r0.s1-ledger-export"
# A REAL work-item worktree with a REAL staged change, so the block can proceed
# past `git commit` and actually reach the merge. Without this the block dies on
# the placeholder commit and the rc assertion below passes for the wrong reason —
# the merge never runs, so removing the guard changes nothing observable.
W1_WT="$TMP/w1-wt"
git -C "$W1" worktree add -q -b "work/r0.s1.w1-emit" "$W1_WT" "spine/r0.s1-ledger-export"
echo emitted > "$W1_WT/export.txt"; git -C "$W1_WT" add export.txt
t_assert_eq "$W1_BASE" "$(git -C "$W1" rev-parse --abbrev-ref HEAD)" \
  "W1 setup: canonical is parked on the base branch, not the spine branch (the guard's precondition)"
t_assert_contains "$(git -C "$W1_WT" diff --cached --name-only)" "export.txt" \
  "W1 setup: the worktree has a staged change, so the block reaches the merge rather than dying at commit"
_wshim "$W1" "spine/r0.s1-ledger-export" "work/r0.s1.w1-emit" "$TMP/shim-w1"

t_capture env "PATH=$TMP/shim-w1:$PATH" bash -c \
  "set -euo pipefail; wi='r0.s1.w1'; wt='$W1_WT'; spine_id='r0.s1'; spine_slug='ledger-export'; . '$W_GUARD'"
t_assert_rc 1 "W1: the merge block HALTS when canonical is not on the spine branch"
t_assert_contains "$T_OUT" "not 'spine/r0.s1-ledger-export'" "W1: ...naming the branch it expected"
# THE LOAD-BEARING ASSERTION. A merge onto the wrong branch succeeds at rc 0, so
# an rc-only check cannot see it. Assert the base branch tip did not move: with
# the guard deleted the merge lands here and this is what goes red.
t_assert_eq "seed" "$(git -C "$W1" show -s --format=%s "$W1_BASE")" \
  "W1: the base branch tip is UNCHANGED - nothing was merged onto the wrong branch"
t_assert_eq "" "$(git -C "$W1" log --oneline "$W1_BASE" --grep='merge r0.s1.w1' 2>/dev/null)" \
  "W1: ...and no work-item merge commit exists on it"

# W2 — the spine cut must (a) CHECK OUT the branch rather than merely
# creating it, and (b) cut from wherever the repo is CURRENTLY parked
# (HEAD) - NOT from a planned base recorded in the spine plan. `git branch`
# leaves the repo on its previous branch and every downstream step still
# returns rc 0, which is precisely how the spine silently never receives the
# work. Reading the PLANNED base out of SPINE.md instead of HEAD is a known,
# disclosed limitation deferred to #133 - 07a0bd8 reverted an attempt at
# doing that here - and this block deliberately does NOT have that coverage
# (see this file's block-ledger.tsv row for the same disclaimer).
W2="$TMP/w2"; mkdir -p "$W2"; git -C "$W2" init -q
git -C "$W2" config user.email t@t; git -C "$W2" config user.name t
echo seed > "$W2/f"; git -C "$W2" add .; git -C "$W2" commit -qm seed
W2_BASE="$(git -C "$W2" rev-parse --abbrev-ref HEAD)"
# Park canonical on a branch carrying a commit the default branch does not, so
# "cut from HEAD" is observably distinct from "cut from the default branch" and
# the sha assertion below cannot pass by coincidence.
git -C "$W2" checkout -q -b w2-parked
echo parked > "$W2/parked.txt"; git -C "$W2" add parked.txt
git -C "$W2" commit -qm parked
W2_PARKED_SHA="$(git -C "$W2" rev-parse w2-parked)"
# "canonical" is the value the per-repo loop's `oss get ... | .target_repo`
# must yield here - the loop calls `oss repo_root "$repo"` on whatever comes
# back, and only "canonical" resolves through this shim's first case arm.
_wshim "$W2" "spine/r0.s9-demo" "canonical" "$TMP/shim-w2"
# RUN IT WITH NOTHING INJECTED. An earlier revision of this test passed
# `base_branch=...` into the block, which made it blind to the block not
# assigning the variable at all - the lane then halted on every fresh run and
# every assertion here still passed. Under `set -u` a self-sufficient block is
# the thing under test, so supply it nothing.
t_capture env "PATH=$TMP/shim-w2:$PATH" bash -c "set -euo pipefail; . '$W_CUT'"
t_assert_rc 0 "W2: the shipped spine cut runs clean on a clean canonical with NOTHING injected"
t_assert_eq "spine/r0.s9-demo" "$(git -C "$W2" rev-parse --abbrev-ref HEAD)" \
  "W2: ...and leaves canonical CHECKED OUT on the spine branch - 'git branch' alone would leave it on w2-parked"
t_assert_eq "$W2_PARKED_SHA" "$(git -C "$W2" rev-parse spine/r0.s9-demo)" \
  "W2: ...cut from the branch canonical was parked on (v0.2 limitation; issue 133 moves this to SPINE.md)"

# W2b — resuming is NOT supported in this release. An existing spine branch halts
# rather than being re-cut or half-reused: branch reuse alone gets one step
# further and then dies at `worktree_add` rc 8 for every already-spawned item.
t_capture env "PATH=$TMP/shim-w2:$PATH" bash -c "set -euo pipefail; . '$W_CUT'"
t_assert_rc 1 "W2b: a second run HALTS because the spine branch already exists"
t_assert_contains "$T_OUT" "already exists" "W2b: ...naming the collision"
t_assert_contains "$T_OUT" "133" "W2b: ...and pointing at the resume issue"

# W2c — a DETACHED HEAD has no branch name to record, so the lane must halt
# rather than cut a spine whose base_branch would be the literal string "HEAD".
W2C="$TMP/w2c"; mkdir -p "$W2C"; git -C "$W2C" init -q
git -C "$W2C" config user.email t@t; git -C "$W2C" config user.name t
echo seed > "$W2C/f"; git -C "$W2C" add .; git -C "$W2C" commit -qm seed
git -C "$W2C" checkout -q --detach HEAD
_wshim "$W2C" "spine/r0.s9-demo" "canonical" "$TMP/shim-w2c"
t_capture env "PATH=$TMP/shim-w2c:$PATH" bash -c "set -euo pipefail; . '$W_CUT'"
t_assert_rc 1 "W2c: a DETACHED HEAD halts - there is no branch name to record as base_branch"
t_assert_contains "$T_OUT" "DETACHED HEAD" "W2c: ...naming the condition"
t_assert_eq "" "$(git -C "$W2C" branch --list 'spine/*')" \
  "W2c: ...and cut no spine branch on the way out"

# ---------------------------------------------------------------------------
# W3: the Layer 4 input-fingerprint guard (round 9, PR #380; redesigned round
# 10 for the tool-call boundary; extended round 12 to cover report/spec/
# handoff/patterns; NARROWED round 16, ratified policy #3, down to write-tree
# + HEAD + report.md, on the rationale that report.md was the only file whose
# content decides the halt; CORRECTED round 17 (policy #3 rev 2, a knowing
# amendment, not a policy violation) - that rationale was wrong about
# spec.md specifically: impl-check.md §4b's own `fidelity` lens reads
# spec.md to decide whether a deviation exists AT ALL, so the halt is
# decided by TWO documents (spec.md: is there a deviation; report.md: is it
# declared), and spec.md rejoins the fingerprint. handoff.md/
# 03-code-patterns.md remain the documented, deliberately unfingerprinted
# residual - G1's own analysis confirmed their advisory-only classification
# was correct, only spec.md's was wrong. The six delegated reader/refuter
# agents get ordinary worktree and filesystem tool access, and the read-only
# instruction in their prompts is prose, not enforcement (spec residual R4)
# - an injected instruction in the staged diff, report.md, or spec.md could
# get one of them to mutate the index, move HEAD without touching it, edit
# report.md mid-review (report.md drives declared_in_report_s7), or edit
# spec.md mid-review (erasing or manufacturing a fidelity deviation
# outright), and nothing else in the gate re-inspects what actually gets
# committed or what report.md/spec.md say by the time the verdict rule
# reads them.
#
# THE BUG ROUND 10 CAUGHT: the two guard blocks are separated by the Workflow
# tool call, which is NOT a bash block - it is a separate tool invocation, and
# this environment's own Bash tool does not carry shell state across separate
# invocations (only cwd persists). The fix: block 1 only PRINTS the
# fingerprint; the prose has the agent carry it forward as a literal and
# substitute it into block 2's `pre_fp="<placeholder>"` line, exactly like
# `$report`'s own `<report_path from the complete return>` convention (§1).
# `patterns` is still carried the same way in BOTH blocks (it remains an
# input to the Workflow call's args, just no longer fingerprinted), since -
# like `$report` - nothing derives it from an already-carried variable. This
# test proves that shape survives TWO GENUINELY SEPARATE bash processes with
# every placeholder substituted exactly as an agent would, never sourcing the
# two blocks into a shared shell.
#
# THE ROUND-12 GAP, PARTIALLY SUPERSEDED: `git write-tree` fingerprints only
# $wt's index; report.md/spec.md/handoff.md/patterns live outside $wt
# entirely (the AI workspace, a different repo). Round 12 covered all four
# with a shasum composite; round 16 narrowed that to `report.md` alone via
# `git hash-object` (dropping the `shasum` dependency - round-16 finding F1:
# not guaranteed present on a minimal Linux install - and the round-14
# `patterns:absent` sentinel it made necessary); round 17 (G1) put `spec.md`
# back, via the same `git hash-object`, after confirming the round-16
# rationale was wrong about it specifically. W3c below still proves
# report.md coverage; W3f below is new - spec.md's twin of W3c, proving
# coverage extends to it too. W3d is round-16 finding F4's repro (HEAD
# moves, index does not). handoff.md/patterns stay out for real: the
# patterns-absent-throughout case is gone, and the patterns-appears case
# (formerly a halt) is INVERTED below (still lettered W3e) to assert the
# now-ratified non-halt.
# ---------------------------------------------------------------------------
W3_PRE="$TMP/w3-pre.sh";   _extract_block "$WIC" 'before the delegated call' "$W3_PRE"
W3_POST="$TMP/w3-post.sh"; _extract_block "$WIC" 'post_fp=' "$W3_POST"
if [ -s "$W3_PRE" ] && grep -Fq 'write-tree' "$W3_PRE" && [ -s "$W3_POST" ] && grep -Fq 'write-tree' "$W3_POST"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract the W3 fingerprint-guard blocks - the assertions below are vacuous"
fi
# THE VACUOUSNESS GUARD ITSELF. If block 2 stopped taking pre_fp as a
# placeholder (the round-10 bug's exact shape) or dropped write-tree/HEAD/
# report.md/spec.md from the fingerprint (a silent regression), this fixture
# would still happen to run - so assert all four survive, and that the
# superseded shasum/patterns-sentinel shape did not come back.
if grep -Fq '<the fingerprint the capture above printed>' "$W3_POST"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: W3_POST no longer takes pre_fp as a placeholder - the cross-tool-call bug may be back"
fi
if grep -Fq 'rev-parse HEAD' "$W3_POST" && grep -Fq 'hash-object "$report"' "$W3_POST" && grep -Fq 'hash-object "$spec"' "$W3_POST"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: W3_POST no longer fingerprints HEAD, report.md and spec.md - the round-16/17 narrowing may have regressed"
fi
if grep -Fq 'shasum' "$W3_POST" || grep -Fq 'patterns:absent' "$W3_POST"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: W3_POST still fingerprints via shasum or carries the round-14 patterns:absent sentinel - the round-16 narrowing may not have landed"
else
  T_PASS=$((T_PASS+1))
fi

# Every fixture needs report/spec/patterns as REAL files outside $wt entirely -
# a separate directory, mirroring the AI workspace being a different repo from
# the code worktree the write-tree half of the guard already covers.
_w3_setup_docs() { # $1=docs-dir ; writes report.md/spec.md/handoff.md/patterns.md
  mkdir -p "$1"
  printf 'report v1\n' > "$1/report.md"
  printf 'spec v1\n' > "$1/spec.md"
  printf 'handoff v1\n' > "$1/handoff.md"
  printf 'patterns v1\n' > "$1/patterns.md"
}

# Run block 1 in its OWN bash process, nothing else in scope, exactly as the
# real close would after the Workflow call has not yet happened. Block 1 ALSO
# carries its own `patterns="<placeholder>"` line - an injected `patterns='...'`
# prefix would be silently clobbered by it, so substitute in place first,
# exactly as _w3_run_post already does for block 2.
_w3_capture_pre() { # $1=worktree $2=report $3=spec $4=patterns
  _extract_block "$WIC" 'before the delegated call' "$W3_PRE"
  sed "s#<the absolute 03-code-patterns.md path Layer 3 resolved>#$4#" \
    "$W3_PRE" > "$TMP/w3-pre-sub.sh" && mv "$TMP/w3-pre-sub.sh" "$W3_PRE"
  t_capture bash -c "set -euo pipefail; wt='$1'; report='$2'; spec='$3'; . '$W3_PRE'"
}
# Re-extract fresh (never accumulate a prior call's substitution) and
# substitute BOTH placeholders (pre_fp AND patterns - block 2 carries patterns
# forward too, since nothing derives it from an already-carried variable) IN
# PLACE on $W3_POST itself, then source $W3_POST directly - not a copy under a
# different name - in a SECOND, independent bash process. Never the same
# process as block 1, and never with `pre_fp`/`patterns` pre-seeded in the
# environment.
_w3_run_post() { # $1=worktree $2=report $3=spec $4=patterns $5=captured-pre-fp
  _extract_block "$WIC" 'post_fp=' "$W3_POST"
  sed -e "s#<the fingerprint the capture above printed>#$5#" \
      -e "s#<the absolute 03-code-patterns.md path Layer 3 resolved>#$4#" \
      "$W3_POST" > "$TMP/w3-post-sub.sh" && mv "$TMP/w3-post-sub.sh" "$W3_POST"
  t_capture bash -c "set -euo pipefail; wt='$1'; report='$2'; spec='$3'; . '$W3_POST'; echo reached"
}

W3="$TMP/w3"; mkdir -p "$W3"; git -C "$W3" init -q
git -C "$W3" config user.email t@t; git -C "$W3" config user.name t
echo seed > "$W3/f"; git -C "$W3" add .; git -C "$W3" commit -qm seed
echo implementer > "$W3/change.txt"; git -C "$W3" add change.txt
W3DOCS="$TMP/w3-docs"; _w3_setup_docs "$W3DOCS"
W3_REPORT="$W3DOCS/report.md"; W3_SPEC="$W3DOCS/spec.md"; W3_PATTERNS="$W3DOCS/patterns.md"

# W3a - nothing touches the index OR the documents between the two (separate!)
# invocations, the ordinary case: the guard is silent and execution reaches
# past it.
_w3_capture_pre "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS"
t_assert_rc 0 "W3a: capturing the pre-call fingerprint succeeds"
W3A_PRE="$T_OUT"
_w3_run_post "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS" "$W3A_PRE"
t_assert_rc 0 "W3a: the fingerprint guard is silent when nothing mutates mid-review"
t_assert_contains "$T_OUT" "reached" "W3a: ...and execution reaches past the guard"

# W3b - the index-mutation case rounds 9-10 already covered: something stages
# a file BETWEEN the two independent processes, exactly as an injected agent
# would during the real Workflow call.
_w3_setup_docs "$W3DOCS"
_w3_capture_pre "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS"
W3B_PRE="$T_OUT"
echo injected > "$W3/injected.txt"; git -C "$W3" add injected.txt
_w3_run_post "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS" "$W3B_PRE"
t_assert_rc 1 "W3b: the fingerprint guard HALTS when the staged index changed mid-review"
t_assert_contains "$T_OUT" "possible injection" "W3b: ...naming the risk"
t_assert_contains "$T_OUT" "revert or unstage whatever the review added" "W3b: ...and the remedy"

# W3c - THE LOAD-BEARING ROUND-12 ASSERTION, preserved under the round-16
# narrowing (ratified policy #3: report.md is one of the two kept
# components). report.md changes, the index does NOT - proving coverage
# extends past write-tree's blind spot. This is exactly the round-12
# finding's scenario: an injected reader edits report §7 between the two
# reads.
git -C "$W3" reset -q --hard HEAD
_w3_setup_docs "$W3DOCS"
_w3_capture_pre "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS"
W3C_PRE="$T_OUT"
printf 'report v1\nsection 7: declared\n' > "$W3_REPORT"
_w3_run_post "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS" "$W3C_PRE"
t_assert_rc 1 "W3c: the fingerprint guard HALTS when report.md changed mid-review, even though the staged index did not"
t_assert_contains "$T_OUT" "possible injection" "W3c: ...naming the risk"

# W3d - THE LOAD-BEARING ROUND-16 ASSERTION, finding F4's actual repro:
# `git reset --soft` moves HEAD without touching the index at all, so
# write-tree alone (the original round-9/10 guard) would see no change and
# pass silently - exactly the gap the narrowed guard's added HEAD
# fingerprint exists to close. Needs a second real commit to reset off of.
git -C "$W3" reset -q --hard HEAD
_w3_setup_docs "$W3DOCS"
echo second > "$W3/second.txt"; git -C "$W3" add second.txt; git -C "$W3" commit -qm second
_w3_capture_pre "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS"
W3D_PRE="$T_OUT"
git -C "$W3" reset -q --soft HEAD~1
_w3_run_post "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS" "$W3D_PRE"
t_assert_rc 1 "W3d: the fingerprint guard HALTS when HEAD moves mid-review (git reset --soft) even though the staged index (write-tree) does not change"
t_assert_contains "$T_OUT" "possible injection" "W3d: ...naming the risk"

# W3e - INVERTED under the round-16 narrowing (ratified policy #3): a
# patterns file appearing mid-review is no longer a guard-relevant mutation
# at all - handoff.md/03-code-patterns.md (NOT spec.md, corrected round 17 -
# see W3f) are the documented, deliberately unfingerprinted residual (they
# feed only advisory findings; damage ceiling is wasted reviewer attention,
# never a wrong or missed halt). This now asserts the RATIFIED non-halt,
# inverted from the pre-round-16 halt this same case used to assert.
git -C "$W3" reset -q --hard HEAD
_w3_setup_docs "$W3DOCS"
rm -f "$W3_PATTERNS"
_w3_capture_pre "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS"
W3E_PRE="$T_OUT"
printf 'a pattern that was not there before\n' > "$W3_PATTERNS"
_w3_run_post "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS" "$W3E_PRE"
t_assert_rc 0 "W3e: the fingerprint guard does NOT halt when a patterns file appears mid-review - patterns is documented residual, not covered by the narrowed guard"
t_assert_contains "$T_OUT" "reached" "W3e: ...and execution reaches past the guard"

# W3f - THE LOAD-BEARING ROUND-17 ASSERTION (finding G1's repro), spec.md's
# twin of W3c: spec.md changes, the index does NOT - proving coverage
# extends to spec.md too. impl-check.md §4b's `fidelity` lens reads spec.md
# to decide whether a deviation exists at all, so an injected agent
# rewriting spec.md mid-review could erase or manufacture a real
# undeclared-fidelity halt exactly as an injected report.md edit could
# (W3c) - the round-16 narrowing's rationale ("report.md is the only file
# whose content decides the halt") was wrong about this, corrected here.
git -C "$W3" reset -q --hard HEAD
_w3_setup_docs "$W3DOCS"
_w3_capture_pre "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS"
W3F_PRE="$T_OUT"
printf 'spec v1\nspec v2 - injected requirement change\n' > "$W3_SPEC"
_w3_run_post "$W3" "$W3_REPORT" "$W3_SPEC" "$W3_PATTERNS" "$W3F_PRE"
t_assert_rc 1 "W3f: the fingerprint guard HALTS when spec.md changed mid-review, even though the staged index did not"
t_assert_contains "$T_OUT" "possible injection" "W3f: ...naming the risk"

# ---------------------------------------------------------------------------
# D1-D4: the cumulative-demo MEASUREMENT block. Timing is advisory; the demo
# result is the gate. Written as a bare `oss demo_run` with the budget report
# after it, the block's status becomes the trailing echo's — so a FAILING demo
# returns 0 and the close walks past the one gate it must not. Same shape as the
# W1/W2 wrong-branch class: the failure is invisible to an rc-only reading, so
# these assert the re-raised status, not just that the block ran.
# ---------------------------------------------------------------------------
CUMDEMO="$SKILLS/close/references/cumulative-demo.md"
# Anchor on `elapsed=`, not on `demo_rc`: the anchor has to survive the very
# regression these tests exist to catch, or removing the status capture would
# make the block unfindable and the failure would read as "vacuous" instead of
# as the wrong behaviour it is.
DEMO_BLOCK="$TMP/cum-demo.sh"; _extract_block "$CUMDEMO" 'elapsed=' "$DEMO_BLOCK"
if [ -s "$DEMO_BLOCK" ] && grep -Fq 'oss demo_run' "$DEMO_BLOCK"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract the demo measurement block - D1-D4 are vacuous"
fi

_dshim() { # $1=budget-to-echo $2=demo_run-rc $3=shim-dir
  mkdir -p "$3"
  { printf '#!/usr/bin/env bash\ncase "$1" in\n'
    printf '  get)      echo %s ;;\n' "$1"
    printf '  demo_run) exit %s ;;\n' "$2"
    printf '  *) exec bash "%s" "$@" ;;\nesac\n' "$OSS"
  } > "$3/oss"; chmod +x "$3/oss"
}

_dshim '60s' 0 "$TMP/shim-d0"
t_capture env "PATH=$TMP/shim-d0:$PATH" bash -c ". '$DEMO_BLOCK'"
t_assert_rc 0 "D1: a PASSING cumulative demo leaves the measurement block green"
t_assert_contains "$T_OUT" "within the 60s budget" "D1: ...and reports the timing"

# THE LOAD-BEARING ASSERTION. Drop the `|| demo_rc=$?` capture and the re-raise
# and this is the one that goes red - D1 stays green either way.
_dshim '60s' 1 "$TMP/shim-d1"
t_capture env "PATH=$TMP/shim-d1:$PATH" bash -c ". '$DEMO_BLOCK'"
t_assert_rc 1 "D2: a FAILING cumulative demo RE-RAISES its status - the close gate does not pass"
t_assert_contains "$T_OUT" "within the 60s budget" "D2: ...after the timing was still reported"
t_assert_contains "$T_OUT" "FAILED rc 1" "D2: ...naming the failure"

# D3 - the runner's exact status survives rather than being flattened to 1, and
# the no-budget branch does not mask it.
_dshim 'null' 3 "$TMP/shim-d3"
t_capture env "PATH=$TMP/shim-d3:$PATH" bash -c ". '$DEMO_BLOCK'"
t_assert_rc 3 "D3: the runner's exact status survives an absent budget"
t_assert_contains "$T_OUT" "no budget recorded" "D3: ...with the no-budget branch still taken"

# D4 - the capture must also survive `errexit`, where an unprotected `oss
# demo_run` would abort the block before the timing is ever reported.
_dshim '60s' 1 "$TMP/shim-d4"
t_capture env "PATH=$TMP/shim-d4:$PATH" bash -c "set -euo pipefail; . '$DEMO_BLOCK'"
t_assert_rc 1 "D4: the same failing demo re-raises under errexit"
t_assert_contains "$T_OUT" "within the 60s budget" "D4: ...and the timing is still reported first"

# ---------------------------------------------------------------------------
# P-series — the PR tier at spine close (#339). A repo WITH a remote merges
# spine -> base by PR through /ossify:work-pr; the local --no-ff merge survives
# only where no remote exists (the E-series above already drives that arm on a
# repo with no origin). Every fixture here is a standalone repo with a BARE
# origin standing in for GitHub, plus a gh stub whose behavior is staged
# entirely from $GH_STATE files — the stub never touches a network, and each
# scenario stages its own remote reality.
# ---------------------------------------------------------------------------
PR_BRANCH="spine/r0.s5-tier"
GHSTUB="$TMP/ghbin"; mkdir -p "$GHSTUB"
# A quoted heredoc, NOT a printf format string: the stub's own printfs carry %s
# directives, and generating it through printf lets the OUTER format consume
# them - the stub lands with empty holes and every arm emits invalid JSON.
cat > "$GHSTUB/gh" <<'GHSTUB_EOF'
#!/usr/bin/env bash
# gh stub for the P-series: staged from $GH_STATE, no network.
set -u
st="${GH_STATE:?GH_STATE not set}"
# The blocks pin every call with a leading --repo <owner/repo> (T17): consume
# it the way the real gh does, and record it so a test can prove the pin.
while [ "${1:-}" = "--repo" ]; do
  printf '%s\n' "$2" > "$st/gh_repo"
  shift 2
done
case "$1" in
  pr)
    case "$2" in
      list)
        [ -f "$st/nongithub" ] && { echo "gh: HTTP 404 - not a GitHub repository" >&2; exit 1; }
        # Honor --base the way the real gh does, so a probe filtered to the
        # recovered base cannot see a PR that targets another branch.
        want_base=""; while [ $# -gt 0 ]; do case "$1" in --base) want_base="$2"; shift 2 ;; *) shift ;; esac; done
        if [ -f "$st/pr" ]; then
          pb="$(cat "$st/pr_base" 2>/dev/null || printf 'main')"
          if [ -n "$want_base" ] && [ "$pb" != "$want_base" ]; then
            printf '[]\n'
          else
            n="$(awk '{print $1}' "$st/pr")"; s="$(awk '{print $2}' "$st/pr")"
            printf '[{"number": %s, "state": "%s"}]\n' "$n" "$s"
          fi
        else
          printf '[]\n'
        fi ;;
      create)
        [ -f "$st/nongithub" ] && { echo "gh: HTTP 404 - not a GitHub repository" >&2; exit 1; }
        printf '%s\n' "$*" > "$st/create_args"
        body=""; while [ $# -gt 0 ]; do case "$1" in --body) body="$2"; shift 2 ;; *) shift ;; esac; done
        printf '%s\n' "$body" | awk '/^pushed-tip: /{print $2}' > "$st/pushed_tip"
        printf '7 OPEN\n' > "$st/pr"
        echo 7 ;;
      view)
        s="$(awk '{print $2}' "$st/pr")"
        m="$(cat "$st/merge_commit" 2>/dev/null || true)"
        h="$(cat "$st/head_oid" 2>/dev/null || true)"
        pt="$(cat "$st/pushed_tip" 2>/dev/null || true)"
        pb="$(cat "$st/pr_base" 2>/dev/null || printf 'main')"
        printf '{"state": "%s", "baseRefName": "%s", "mergeCommit": {"oid": "%s"}, "headRefOid": "%s", "body": "spine close\\npushed-tip: %s\\n"}\n' "$s" "$pb" "$m" "$h" "$pt" ;;
      *) echo "stub: unhandled gh pr $2" >&2; exit 64 ;;
    esac ;;
  *) echo "stub: unhandled gh $1" >&2; exit 64 ;;
esac
GHSTUB_EOF
chmod +x "$GHSTUB/gh"

_pr_fixture() { # $1=name — sets PR_REPO/PR_ORIGIN/PR_STATE/PR_SHIM; repo parked on the spine branch
  PR_REPO="$TMP/$1"; PR_ORIGIN="$TMP/$1-origin.git"; PR_STATE="$TMP/$1-gh"; PR_SHIM="$TMP/$1-shim"
  mkdir -p "$PR_REPO" "$PR_STATE"
  git -C "$PR_REPO" init -q
  git -C "$PR_REPO" config user.email t@t; git -C "$PR_REPO" config user.name t
  echo seed > "$PR_REPO/seed.txt"; git -C "$PR_REPO" add seed.txt; git -C "$PR_REPO" commit -qm seed
  git -C "$PR_REPO" branch -m main
  git -C "$PR_REPO" branch "$PR_BRANCH"
  git -C "$PR_REPO" checkout -q "$PR_BRANCH"
  echo spine > "$PR_REPO/spine.txt"; git -C "$PR_REPO" add spine.txt; git -C "$PR_REPO" commit -qm spine
  git init -q --bare "$PR_ORIGIN"
  git -C "$PR_REPO" remote add origin "$PR_ORIGIN"
  # The RAW configured URL carries the host the selector derivation reads
  # (hostless local paths are refused, T35); insteadOf keeps every push and
  # fetch on the local bare - no fixture touches a network.
  git -C "$PR_REPO" remote set-url origin git@github.com:owner/repo.git
  git -C "$PR_REPO" config "url.$PR_ORIGIN.insteadOf" "git@github.com:owner/repo.git"
  git -C "$PR_REPO" push -q origin main
  git --git-dir="$PR_ORIGIN" symbolic-ref HEAD refs/heads/main
  _wshim "$PR_REPO" "$PR_BRANCH" "canonical" "$PR_SHIM"
}

# The remote "GitHub" merges the PR: the merge is made in a SEPARATE clone and
# pushed to the bare origin, so the ceremony repo stays BEHIND its base and the
# record pass's fast-forward is real work, not a no-op. Also stages the gh
# state a merged PR reports.
_pr_simulate_merge() { # $1=spine-tip-the-PR-merged (the headRefOid)
  local clone="$TMP/sim-clone"; rm -rf "$clone"
  git clone -q "$PR_ORIGIN" "$clone"
  git -C "$clone" config user.email t@t; git -C "$clone" config user.name t
  git -C "$clone" checkout -q main
  git -C "$clone" merge --no-ff "$1" -m "merge r0.s5" >/dev/null
  git -C "$clone" push -q origin main
  git -C "$clone" rev-parse main > "$PR_STATE/merge_commit"
  printf "%s\n" "$1" > "$PR_STATE/head_oid"
  printf "7 MERGED\n" > "$PR_STATE/pr"
  rm -rf "$clone"
}

_pr_main_unreached() { # $1=label — the spine must NOT be on the LOCAL main
  if git -C "$PR_REPO" merge-base --is-ancestor "$PR_BRANCH" main 2>/dev/null; then
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $1 - the spine reached local main anyway"
  else
    T_PASS=$((T_PASS+1))
  fi
}

# P1. ARM CHOICE: a remote exists, so the merge pass PUSHES and OPENS a PR — it
# must not merge locally. Against the old block this is RED in the intended
# direction: the old ceremony merges local main at rc 0 and never calls gh.
_pr_fixture p1
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'; printf 'PRLINES%s\n' \"\$pr_lines\""
t_assert_rc 0 "P1: the PR-arm pass runs clean on a repo with a remote"
t_assert_contains "$T_OUT" "PR #7 opened against main" "P1: ...announcing the PR it opened for /ossify:work-pr"
t_assert_contains "$T_OUT" "canonical:7" "P1: ...and recording repo:pr pairs for the record pass"
_pr_main_unreached "P1: no local merge"
if git --git-dir="$PR_ORIGIN" rev-parse --verify -q "refs/heads/$PR_BRANCH" >/dev/null; then
  t_assert_eq "$(git --git-dir="$PR_ORIGIN" rev-parse "refs/heads/$PR_BRANCH")" "$(git -C "$PR_REPO" rev-parse "$PR_BRANCH")" \
    "P1: the pushed branch on origin is the spine tip"
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: P1 - the spine branch was never pushed to origin"
fi
t_assert_eq "$(git -C "$PR_REPO" rev-parse "$PR_BRANCH")" "$(cat "$PR_STATE/pushed_tip")" \
  "P1: the PR body records the pushed tip (the lineage guard's durable input)"

# P2. THE THIRD LEG (A1): gh cannot operate on the remote — fail closed. The
# probe runs before any push, and the halt never falls through to a local merge.
_pr_fixture p2; touch "$PR_STATE/nongithub"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 1 "P2: a gh-inoperable remote halts the close"
t_assert_contains "$T_OUT" "silent local fall-through" "P2: ...naming that a local merge was NOT silently taken"
_pr_main_unreached "P2: no local fall-through merge"
if git --git-dir="$PR_ORIGIN" rev-parse --verify -q "refs/heads/$PR_BRANCH" >/dev/null; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: P2 - the branch was pushed although gh could not operate"
else
  T_PASS=$((T_PASS+1))
fi

# P3. THE A2 FLOW, end to end: a PR that carried ONE FIX ROUND before merging.
# work-pr lands fix commits ON the spine branch, so the merged head descends
# from — but is not equal to — the tip this close pushed. Both guards must bind
# to the merged headRefOid; an equality-shaped guard fails exactly here.
_pr_fixture p3
MAIN_BEFORE="$(git -C "$PR_REPO" rev-parse main)"
PUSHED_TIP="$(git -C "$PR_REPO" rev-parse "$PR_BRANCH")"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'" >/dev/null
# The loop, as work-pr drives it: a fix commit lands on the spine branch and is
# pushed to the PR head.
echo fix > "$PR_REPO/fix.txt"; git -C "$PR_REPO" add fix.txt; git -C "$PR_REPO" commit -qm "review fix"
MERGED_HEAD="$(git -C "$PR_REPO" rev-parse "$PR_BRANCH")"
git -C "$PR_REPO" push -q origin "$PR_BRANCH"
if [ "$PUSHED_TIP" = "$MERGED_HEAD" ]; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: P3 fixture is vacuous - no fix commit beyond the pushed tip"
else
  T_PASS=$((T_PASS+1))
fi
if git -C "$PR_REPO" merge-base --is-ancestor "$PUSHED_TIP" "$MERGED_HEAD"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: P3 fixture is wrong - the merged head does not descend from the pushed tip"
fi
_pr_simulate_merge "$MERGED_HEAD"
SIM_MERGE="$(cat "$PR_STATE/merge_commit")"
# RESUME FLOW, as a re-invoked close runs it: pass one re-probes (PR exists —
# not re-opened), pass two records against freshly fetched refs.
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'; . '$PRRECORD_BLOCK'; printf 'PAIRS%s\n' \"\$merge_shas\""
t_assert_rc 0 "P3: a merged PR with a fix round records clean (ancestry, not equality)"
t_assert_contains "$T_OUT" "already has PR #7" "P3: ...the resume probe recognises the existing PR"
t_assert_contains "$T_OUT" "landed PR #7 at $SIM_MERGE" "P3: ...and records the REMOTE merge sha"
t_assert_contains "$T_OUT" "canonical:$SIM_MERGE" "P3: ...into \$merge_shas for the touch check"
t_assert_eq "$(git -C "$PR_REPO" rev-parse origin/main)" "$(git -C "$PR_REPO" rev-parse main)" \
  "P3: local main was fast-forwarded to the fetched origin"
t_assert_eq "main" "$(git -C "$PR_REPO" rev-parse --abbrev-ref HEAD)" "P3: the repo is left on its base branch"
# The seam the touch check consumes: the merge's first-parent diff carries BOTH
# the spine's own change AND the fix round's — fix-commit paths join the union.
DIFF_LIST="$(git -C "$PR_REPO" diff --name-only "$SIM_MERGE^1" "$SIM_MERGE")"
case "$DIFF_LIST" in *spine.txt*) T_PASS=$((T_PASS+1));; *) T_FAIL=$((T_FAIL+1)); echo "FAIL: P3 - the spine's own file missing from the merge diff";; esac
case "$DIFF_LIST" in *fix.txt*) T_PASS=$((T_PASS+1));; *) T_FAIL=$((T_FAIL+1)); echo "FAIL: P3 - the fix round's file missing from the merge diff (fix paths must join the union)";; esac

# P4. THE PR-OPEN HALT (D9): the operator has not merged; the ceremony halts
# recording nothing, and local main stays untouched.
_pr_fixture p4
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'; . '$PRRECORD_BLOCK'"
t_assert_rc 1 "P4: an OPEN PR halts the record pass"
t_assert_contains "$T_OUT" "still open" "P4: ...saying the merge is the operator's, via work-pr"
_pr_main_unreached "P4: no local merge while the PR is open"

# P5. HEAD IDENTITY: a PR that landed without a two-parent merge commit (a
# rebase or squash merge) halts at RECORD time — not obscurely in the touch
# check. Stage gh reporting a non-merge commit as the mergeCommit. P5-P7 reuse
# the P3 fixture — re-point the globals P4's fixture call moved.
PR_REPO="$TMP/p3"; PR_ORIGIN="$TMP/p3-origin.git"; PR_STATE="$TMP/p3-gh"; PR_SHIM="$TMP/p3-shim"
printf "%s\n" "$MAIN_BEFORE" > "$PR_STATE/merge_commit"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'; . '$PRRECORD_BLOCK'"
t_assert_rc 1 "P5: a non-merge landing halts the record pass"
t_assert_contains "$T_OUT" "two-parent merge commit" "P5: ...naming the shape the touch check needs"
case "$T_OUT" in *"landed PR"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: P5 - a non-merge landing was recorded anyway";; *) T_PASS=$((T_PASS+1));; esac

# P6. LINEAGE: the merged head must DESCEND from the tip this close pushed. A
# rewritten or diverged head fails even though every other fact is real. The
# forged pushed-tip must be a commit that EXISTS but is NOT an ancestor of the
# merged head — the root commit would quietly pass, and the assertion with it.
git --git-dir="$PR_ORIGIN" rev-parse main > "$PR_STATE/merge_commit"
UNRELATED="$(git -C "$PR_REPO" commit-tree 'HEAD^{tree}' -m forged)"
printf "%s\n" "$UNRELATED" > "$PR_STATE/pushed_tip"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'; . '$PRRECORD_BLOCK'"
t_assert_rc 1 "P6: a head that does not descend from the pushed tip halts"
t_assert_contains "$T_OUT" "rewritten or diverged" "P6: ...naming the lineage failure"
# Restore honest state for P7.
printf "%s\n" "$PUSHED_TIP" > "$PR_STATE/pushed_tip"

# P7. THE STRANDED-MERGE GUARD (D5): a local base with commits origin lacks is
# the pre-PR ceremony's signature. The halt names the repair and NEVER runs it.
echo stranded > "$PR_REPO/stranded.txt"; git -C "$PR_REPO" add stranded.txt; git -C "$PR_REPO" commit -qm stranded
STRANDED_SHA="$(git -C "$PR_REPO" rev-parse main)"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'; . '$PRRECORD_BLOCK'"
t_assert_rc 1 "P7: a local base ahead of origin halts the record pass"
t_assert_contains "$T_OUT" "reset --hard origin/main" "P7: ...naming the repair command, not running it"
t_assert_eq "$STRANDED_SHA" "$(git -C "$PR_REPO" rev-parse main)" "P7: ...and local main was left exactly as it was (never auto-reset)"

# P8. A NON-ORIGIN REMOTE (round 2, T3/T10): the arm test selects the PR arm on
# any non-empty remote, so a repo whose only remote is named something else
# must have that remote RESOLVED and used for the push - and the PR creation
# must pin the head branch explicitly (T6): gh defaults --head to the CURRENT
# branch, which is not necessarily the spine branch this pass just pushed.
_pr_fixture p8
git -C "$PR_REPO" remote rename origin upstream
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 0 "P8: an upstream-named remote runs the PR arm, not a push failure"
t_assert_contains "$T_OUT" "PR #7 opened against main" "P8: ...opening the PR"
if git --git-dir="$PR_ORIGIN" rev-parse --verify -q "refs/heads/$PR_BRANCH" >/dev/null; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: P8 - the spine branch never reached the upstream-named remote"
fi
t_assert_contains "$(cat "$PR_STATE/create_args")" "--head $PR_BRANCH" "P8: PR creation pins the head to the spine branch (never the ambient branch)"
t_assert_contains "$(cat "$PR_STATE/create_args")" "--base main" "P8: ...and the base to the recovered base branch"
t_assert_eq "owner/repo" "$(cat "$PR_STATE/gh_repo")" "P8: every gh call is pinned to the resolved remote's repo (--repo), not gh's default"

# P9. BASE VALIDATION (round 2, T5/T9): a PR that merged into some OTHER branch
# is not this repo's landing, whatever its merge commit reaches later. Rejected
# TWICE: at discovery (the probe filters by base, so a wrong-base PR is never
# handed to the loop) and at record time (baseRefName re-proved, because a PR's
# base can be retargeted between the two).
_pr_fixture p9
printf "7 MERGED\n" > "$PR_STATE/pr"
git -C "$PR_REPO" rev-parse "$PR_BRANCH" > "$PR_STATE/head_oid"
git -C "$PR_REPO" rev-parse "$PR_BRANCH" > "$PR_STATE/merge_commit"
printf "other\n" > "$PR_STATE/pr_base"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 0 "P9: the landing pass runs clean when the only PR targets another base"
case "$T_OUT" in
  *"already has PR #7"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: P9 - the probe accepted a PR targeting another base branch";;
  *) T_PASS=$((T_PASS+1));;
esac
t_assert_contains "$(cat "$PR_STATE/create_args")" "--base main" "P9: the probe's rejection led to a NEW, correctly-based PR instead"
# Re-stage the retargeted-MERGED state the record pass must catch: same PR
# number, now reported MERGED with baseRefName 'other' (the retarget-between-
# discovery-and-record case the probe cannot see).
printf "7 MERGED\n" > "$PR_STATE/pr"
printf "other\n" > "$PR_STATE/pr_base"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; pr_lines='canonical:7'; . '$PRRECORD_BLOCK'"
t_assert_rc 1 "P9: a PR merged into another base halts the record pass"
t_assert_contains "$T_OUT" "targets 'other', not 'main'" "P9: ...naming both branches"
_pr_main_unreached "P9: nothing landed locally"

# ---------------------------------------------------------------------------
# R-series — the release tag (round 2, T1/T2/T8): per hosting repo, resumable,
# and every git command scoped to that repo. The tag block's fixtures give it a
# bare origin, the same stand-in the P-series uses for GitHub.
# ---------------------------------------------------------------------------
REL_CLOSE="$SKILLS/close/references/release-close.md"
TAG_BLOCK="$TMP/rel-tag.sh"; _extract_block "$REL_CLOSE" 'git tag' "$TAG_BLOCK"
if [ -s "$TAG_BLOCK" ] && grep -Fq 'git tag' "$TAG_BLOCK"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract the release-tag block from release-close.md - R1-R3 are vacuous"
fi

_pr_fixture r1
# R1. Fresh tag: created on the repo's base, pushed, ANNOTATED, per repo.
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 0 "R1: the tag pass tags a fresh release"
t_assert_contains "$T_OUT" "tagged r9" "R1: ...saying so per repo"
if [ -n "$(git --git-dir="$PR_ORIGIN" rev-parse -q --verify 'refs/tags/r9' 2>/dev/null)" ] \
  && [ "$(git --git-dir="$PR_ORIGIN" rev-parse -q --verify 'refs/tags/r9' 2>/dev/null)" != "$(git --git-dir="$PR_ORIGIN" rev-parse -q --verify 'refs/tags/r9^{}' 2>/dev/null)" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: R1 - the pushed tag is missing or lightweight (not annotated)"
fi
t_assert_eq "$(git -C "$PR_REPO" rev-parse main)" "$(git --git-dir="$PR_ORIGIN" rev-parse -q --verify 'refs/tags/r9^{}' 2>/dev/null)" \
  "R1: the tag on the remote points at the repo's base branch tip"
TAG_BEFORE="$(git --git-dir="$PR_ORIGIN" rev-parse 'refs/tags/r9')"

# R2. RESUME (T2): an existing tag pointing at base, present on the remote, is
# continuable - the state writes failed last time, not the tag. No re-tag.
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 0 "R2: a matching existing tag resumes instead of halting"
t_assert_contains "$T_OUT" "already tagged" "R2: ...and says so"
t_assert_eq "$TAG_BEFORE" "$(git --git-dir="$PR_ORIGIN" rev-parse 'refs/tags/r9')" "R2: the tag object was not replaced"

# R3. A MISMATCHED existing tag halts (T2's other arm): the tag points
# somewhere else - that is a human decision, never a clobber.
git -C "$PR_REPO" tag -d r9 >/dev/null
git -C "$PR_REPO" tag -a r9 -m moved "$PR_BRANCH"
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 1 "R3: a tag pointing away from base halts"
t_assert_contains "$T_OUT" "points at" "R3: ...naming where it points and where it should"

# R4. THE NO-REMOTE TAG ARM (round 3, T12): a repo that landed its spines
# locally all release long - the same no-remote world the landing arm serves -
# must still be release-taggable. The tag is local; no push, no remote leg.
mkdir -p "$TMP/r4" "$TMP/r4-gh"
git -C "$TMP/r4" init -q
git -C "$TMP/r4" config user.email t@t; git -C "$TMP/r4" config user.name t
echo seed > "$TMP/r4/seed.txt"; git -C "$TMP/r4" add seed.txt; git -C "$TMP/r4" commit -qm seed
git -C "$TMP/r4" branch -m main
PR_REPO="$TMP/r4"; PR_ORIGIN=""; PR_STATE="$TMP/r4-gh"; PR_SHIM="$TMP/r4-shim"
_wshim "$PR_REPO" "$PR_BRANCH" "canonical" "$PR_SHIM"
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 0 "R4: a no-remote repo tags its release locally"
t_assert_contains "$T_OUT" "tagged r9" "R4: ...saying so, same as a remote repo"
if [ -n "$(git -C "$PR_REPO" rev-parse -q --verify 'refs/tags/r9' 2>/dev/null)" ] \
  && [ "$(git -C "$PR_REPO" rev-parse -q --verify 'refs/tags/r9' 2>/dev/null)" != "$(git -C "$PR_REPO" rev-parse -q --verify 'refs/tags/r9^{}' 2>/dev/null)" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: R4 - the local tag is missing or lightweight"
fi
t_assert_eq "$(git -C "$PR_REPO" rev-parse main)" "$(git -C "$PR_REPO" rev-parse -q --verify 'refs/tags/r9^{}')" \
  "R4: the local tag points at the base branch tip"
R4_TAG_OBJ="$(git -C "$PR_REPO" rev-parse 'refs/tags/r9')"
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 0 "R4: the no-remote resume arm continues on a matching local tag"
t_assert_contains "$T_OUT" "already tagged" "R4: ...without re-tagging"
t_assert_eq "$R4_TAG_OBJ" "$(git -C "$PR_REPO" rev-parse 'refs/tags/r9')" "R4: the tag object is unchanged by the resume"
PR_REPO="$TMP/r1"; PR_ORIGIN="$TMP/r1-origin.git"; PR_STATE="$TMP/r1-gh"; PR_SHIM="$TMP/r1-shim"

# P10. DIVERGENT RESUMED PR, pre-handoff (round 4, T15): the probe finds a
# same-head/same-base PR whose remote head was force-pushed past the pushed
# tip. Catching it in the record pass is AFTER the operator merged an
# unrelated head - the landing pass must verify lineage BEFORE the handoff.
_pr_fixture p10
printf "7 OPEN\n" > "$PR_STATE/pr"
git -C "$PR_REPO" rev-parse "$PR_BRANCH" > "$PR_STATE/head_oid"
UNRELATED10="$(git -C "$PR_REPO" commit-tree 'HEAD^{tree}' -m forged10)"
printf "%s\n" "$UNRELATED10" > "$PR_STATE/pushed_tip"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 1 "P10: a resumed PR whose head does not descend from the pushed tip halts at discovery"
t_assert_contains "$T_OUT" "rewritten or diverged" "P10: ...naming the lineage failure before work-pr touches it"
case "$T_OUT" in *"hand it to"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: P10 - the divergent PR was handed to work-pr anyway";; *) T_PASS=$((T_PASS+1));; esac

# R5. A LIGHTWEIGHT existing tag is not resumable (round 4, T18/T19,
# convergent from both gates): refs/tags/x and refs/tags/x^{} both resolve to
# the commit, so the target check alone accepts it - and the release closes
# over a tag with no annotation, against the ANNOTATED-always contract.
_pr_fixture r5
git -C "$PR_REPO" tag r9 main
git -C "$PR_REPO" push -q origin r9
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 1 "R5: a lightweight existing tag halts the resume arm"
t_assert_contains "$T_OUT" "annotated" "R5: ...naming the ANNOTATED-always contract it violates"

# R6. ABANDONED SPINES ARE NOT IN THE TAG SET (round 4, T14): the selector
# filters by spine-id prefix only, so an abandoned spine's work items drag
# their repos into the tag pass. The block's selector must filter to spines
# whose landing actually completed - asserted on the query the block actually
# runs, via the shim's argument log.
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'" >/dev/null 2>&1 || true
_last_get="$(grep 'get ' "$PR_SHIM/args.log" | tail -1)"
case "$_last_get" in
  *closed*target_repo*|*target_repo*closed*) T_PASS=$((T_PASS+1));;
  *) T_FAIL=$((T_FAIL+1)); echo "FAIL: R6 - the tag-set query does not filter to closed spines: $_last_get";;
esac

# R7. CONFLICTING BASE BRANCHES IN ONE REPO (round 4, T16): two closed spines
# recording different bases in the same repo must halt - first-wins silently
# tags one of the two landed lines.
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main
canonical:release-line'; . '$TAG_BLOCK'"
t_assert_rc 1 "R7: two recorded bases for one repo halt the tag pass"
t_assert_contains "$T_OUT" "conflicting base" "R7: ...naming the conflict, not silently picking a line"

# P11. A CLOSED-UNMERGED PR is not a resumable landing (round 5, T20):
# --state all selects it, creation is suppressed, work-pr refuses it and the
# record pass rejects CLOSED - a wedge. Only OPEN and MERGED resume.
_pr_fixture p11
printf "7 CLOSED\n" > "$PR_STATE/pr"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 0 "P11: a closed-unmerged PR does not wedge the landing pass"
case "$T_OUT" in
  *"already has PR"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: P11 - the probe resumed a CLOSED-unmerged PR";;
  *) T_PASS=$((T_PASS+1));;
esac
t_assert_contains "$T_OUT" "PR #7 opened against main" "P11: ...a replacement PR is opened instead"

# P12. THE GHE HOST SURVIVES the --repo derivation (round 5, T24): an
# Enterprise remote must pin the selector to ITS host, not gh's default.
_pr_fixture p12
# The remote's URL carries an Enterprise host the stub will declare
# unoperable: the slug derivation runs BEFORE the probe, and the probe before
# any push, so the block halts at the third leg with the derived selector
# already on record - no network, and the host pinning is what the stub saw.
git -C "$PR_REPO" remote set-url origin https://ghe.example.com/owner/repo.git
touch "$PR_STATE/nongithub"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 1 "P12: an unreachable Enterprise host halts at the third leg (before any push)"
t_assert_contains "$T_OUT" "silent local fall-through" "P12: ...the gh-inoperable halt, not a network attempt"
t_assert_eq "ghe.example.com/owner/repo" "$(cat "$PR_STATE/gh_repo")" "P12: the selector carries the remote's host"

# R8. THE TAG-SET SELECTOR against REAL STATE and DISTINCT REPOS (round 5
# T22/T23/T25; discriminating form per round 6 T26): presence assertions
# cannot tell a scoped selector from an unscoped one when every spine targets
# the same repo, so this fixture declares three - the CURRENT release's
# closed spine lands in "current", an earlier closed release's in "earlier",
# an abandoned spine's in "abandon" - and the assertion is EQUALITY.
mkdir -p "$TMP/r8ws/.ossify" "$TMP/r8cur" "$TMP/r8earl" "$TMP/r8aband"
cat > "$TMP/r8ws/.ossify/topology.json" <<R8TOPO
{"schema_version":1,"repos":{"current":{"root":"$TMP/r8cur"},"earlier":{"root":"$TMP/r8earl"},"abandon":{"root":"$TMP/r8aband"}},"well_known_paths":{}}
R8TOPO
( cd "$TMP/r8ws"
  bash "$OSS" init r8f >/dev/null
  R8REL="$(bash "$OSS" release_add g goal)"
  R8EARLY_REL="$(bash "$OSS" release_add e "earlier goal")"
  R8EARLY_SP="$(bash "$OSS" spine_add "$R8EARLY_REL" es flesh earlier)"
  bash "$OSS" work_item_add "$R8EARLY_SP" ei earlier >/dev/null
  bash "$OSS" spine_status "$R8EARLY_SP" closed >/dev/null
  R8ABANDON_SP="$(bash "$OSS" spine_add "$R8REL" as flesh abandon)"
  bash "$OSS" work_item_add "$R8ABANDON_SP" ai abandon >/dev/null
  bash "$OSS" spine_status "$R8ABANDON_SP" abandoned >/dev/null
  R8CLOSED_SP="$(bash "$OSS" spine_add "$R8REL" cs flesh current)"
  bash "$OSS" work_item_add "$R8CLOSED_SP" ci current >/dev/null
  bash "$OSS" spine_status "$R8CLOSED_SP" closed >/dev/null
  printf '%s\n' "$R8REL" > "$TMP/r8ws/.rel"
)
R8REL="$(cat "$TMP/r8ws/.rel")"
# Run the assignment line AS BASH SOURCE (eval), so the shell processes the
# jq escapes exactly as the shipped script does - passing the extracted text
# through quotes leaves the backslashes as data and jq fails on \$root.
SEL_ASSIGN="$(grep 'tag_repos=' "$TAG_BLOCK" | head -1 | sed 's/ *\\$//')"
sel_rc=0; SEL_OUT="$(cd "$TMP/r8ws" && rel="$R8REL" PATH="$(dirname "$OSS"):$PATH" eval "$SEL_ASSIGN" && printf '%s' "$tag_repos")" || sel_rc=$?
# Assert on $sel_rc directly - there is no t_capture here, so T_RC would hold
# the PREVIOUS capture's status and read green or red for the wrong scenario.
t_assert_eq 0 "$sel_rc" "R8: the tag-set selector executes against real state (a jq failure would abort)"
t_assert_eq "current" "$SEL_OUT" "R8: the selector yields EXACTLY the current release's closed-spine repo (an unscoped selector would name earlier/abandon too)"

# P13. THE CLASS SWEEP, instance 1 (T16's class, landing + record passes):
# a per-repo base mapping with TWO entries for one repo is a halt everywhere
# it is consumed - the tag pass fixed this in round 4; the landing and record
# passes still first-wins.
_pr_fixture p13
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main
canonical:release-line'; . '$MERGE_BLOCK'"
t_assert_rc 1 "P13: conflicting bases halt the LANDING pass"
t_assert_contains "$T_OUT" "conflicting base" "P13: ...naming both lines, not first-wins"
_pr_fixture p13b
printf "7 MERGED\n" > "$PR_STATE/pr"
git -C "$PR_REPO" rev-parse "$PR_BRANCH" > "$PR_STATE/head_oid"
git -C "$PR_REPO" rev-parse "$PR_BRANCH" > "$PR_STATE/merge_commit"
printf "%s\n" "$(git -C "$PR_REPO" rev-parse "$PR_BRANCH")" > "$PR_STATE/pushed_tip"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; spine_branch='spine/r0.s5-tier'; repo_base_branches='canonical:main
canonical:release-line'; pr_lines='canonical:7'; . '$PRRECORD_BLOCK'"
t_assert_rc 1 "P13b: conflicting bases halt the RECORD pass"
t_assert_contains "$T_OUT" "conflicting base" "P13b: ...same guard, same halt"

# P14. THE CLASS SWEEP, instance 2 (T23's class, landing pass): a selector
# failure inside the process substitution silently yields ZERO repos and the
# pass succeeds having landed nothing. The repo list is read as an
# assignment whose failure aborts, never as a silent empty loop.
mkdir -p "$TMP/p14-shim"
{ printf '#!/usr/bin/env bash\ncase "$1 $2" in\n  "repo_root canonical") echo %s ;;\n  "branch_name "*) echo %s ;;\n  *"target_repo"*) exit 5 ;;\n  *) exit 5 ;;\nesac\n' "$TMP/p13" "$PR_BRANCH"; } > "$TMP/p14-shim/oss"
chmod +x "$TMP/p14-shim/oss"
t_capture env "PATH=$TMP/p14-shim:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
if [ "$T_RC" -eq 0 ]; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: P14 - a repo-list read failure succeeded silently, landing nothing"
else
  T_PASS=$((T_PASS+1))
fi

# P15. A RESUMED PR WHOSE HEAD EXISTS ONLY REMOTELY (round 7, T27): work-pr or
# a hand-driven loop can push fix commits from ANOTHER checkout, so gh reports
# a headRefOid this checkout does not have. The pre-handoff lineage check must
# fetch the head before judging it, or every such resume halts on "unknown
# revision".
_pr_fixture p15
# The spine branch must be on the remote before the clone can build on it;
# _pr_fixture leaves it local-only (the landing pass is what pushes it).
git -C "$PR_REPO" push -q origin "$PR_BRANCH"
# A commit on the spine branch made and pushed from a SEPARATE clone - the
# ceremony checkout never sees it locally.
CL15="$TMP/p15-clone"; rm -rf "$CL15"; git clone -q "$PR_ORIGIN" "$CL15"
git -C "$CL15" config user.email t@t; git -C "$CL15" config user.name t
git -C "$CL15" checkout -q "$PR_BRANCH"
echo remotefix > "$CL15/remotefix.txt"; git -C "$CL15" add remotefix.txt; git -C "$CL15" commit -qm remotefix
git -C "$CL15" push -q origin "$PR_BRANCH"
REMOTE_HEAD15="$(git -C "$CL15" rev-parse "$PR_BRANCH")"
if git -C "$PR_REPO" cat-file -e "$REMOTE_HEAD15" 2>/dev/null; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: P15 fixture is vacuous - the ceremony checkout already has the remote head"
else
  T_PASS=$((T_PASS+1))
fi
printf "7 OPEN\n" > "$PR_STATE/pr"
printf "%s\n" "$REMOTE_HEAD15" > "$PR_STATE/head_oid"
P15_LOCAL_TIP="$(git -C "$PR_REPO" rev-parse "$PR_BRANCH")"
git -C "$PR_REPO" rev-parse "$PR_BRANCH" > /tmp/p15-tip; mv /tmp/p15-tip "$PR_STATE/pushed_tip"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 0 "P15: a remotely-only resumed head is fetched and lineage-checked, not halted as unknown"
t_assert_contains "$T_OUT" "already has PR #7" "P15: ...and the resume proceeds to the handoff"
t_assert_eq "$P15_LOCAL_TIP" "$(git -C "$PR_REPO" rev-parse "$PR_BRANCH")" \
  "P15: ...without moving the local spine branch (the fetch installed the object, nothing more)"

# R9. THE TAG THAT EXISTS ONLY ON THE REMOTE (round 7, T28): an earlier
# multi-repo close pushed the tag and halted; the resumed close runs from a
# fresh, no-tags checkout. Local-only existence testing takes the creation
# arm, mints a different annotated object, and the push is refused - the
# resume wedges. The remote must be consulted before creating.
_pr_fixture r9
CL9="$TMP/r9-clone"; rm -rf "$CL9"; git clone -q "$PR_ORIGIN" "$CL9"
git -C "$CL9" config user.email t@t; git -C "$CL9" config user.name t
git -C "$CL9" checkout -q main
# A DIFFERENT message than the block's own "release $rel" mint: two annotated
# tags minted in the same second with identical tagger and message produce the
# SAME object sha, the push then reads "up-to-date", and the fixture loses its
# discrimination entirely.
git -C "$CL9" tag -a r9 -m "tagged by the earlier halted close" main
git -C "$CL9" push -q origin r9
R9_REMOTE_TAG="$(git --git-dir="$PR_ORIGIN" rev-parse 'refs/tags/r9')"
if git -C "$PR_REPO" rev-parse -q --verify 'refs/tags/r9' >/dev/null 2>&1; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: R9 fixture is vacuous - the local checkout already has the tag"
else
  T_PASS=$((T_PASS+1))
fi
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 0 "R9: a remote-only existing tag is fetched and resumed, not re-created"
t_assert_contains "$T_OUT" "already tagged" "R9: ...through the same verification arm"
t_assert_eq "$R9_REMOTE_TAG" "$(git -C "$PR_REPO" rev-parse 'refs/tags/r9')" "R9: the remote tag object stands - no second annotation was minted"

# P16. THE RESUMED PR MUST CONTAIN THE CURRENT TIP (round 8, T32): the
# pre-handoff check proves the PUSHED tip's ancestry, but the local spine
# branch can have advanced after the PR was opened - merging the old PR would
# close the spine while silently omitting the newer commits. A halt naming
# both tips, never a guess about which to keep.
_pr_fixture p16
git -C "$PR_REPO" push -q origin "$PR_BRANCH"
CL16="$TMP/p16-clone"; rm -rf "$CL16"; git clone -q "$PR_ORIGIN" "$CL16"
git -C "$CL16" config user.email t@t; git -C "$CL16" config user.name t
git -C "$CL16" checkout -q "$PR_BRANCH"
printf "7 OPEN\n" > "$PR_STATE/pr"
P16_PUBLISHED_TIP="$(git -C "$PR_REPO" rev-parse "$PR_BRANCH")"
printf "%s\n" "$P16_PUBLISHED_TIP" > "$PR_STATE/pushed_tip"
printf "%s\n" "$P16_PUBLISHED_TIP" > "$PR_STATE/head_oid"
# The local spine branch advances AFTER the PR was opened - not pushed.
echo late > "$PR_REPO/late.txt"; git -C "$PR_REPO" add late.txt; git -C "$PR_REPO" commit -qm "late local work"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 1 "P16: a resumed PR missing the current local tip halts"
t_assert_contains "$T_OUT" "advanced past" "P16: ...naming the local tip the PR does not contain"

# R10. A BRANCH NAMED LIKE THE RELEASE (round 8, T30): refs/heads/r9 and
# refs/tags/r9 coexist, and a bare `git push <remote> r9` cannot resolve the
# source. The push uses a fully qualified tag refspec.
_pr_fixture r10
git -C "$PR_REPO" branch r9
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 0 "R10: the tag push resolves under a branch/tag name collision"
t_assert_contains "$T_OUT" "tagged r9" "R10: ...and lands"

# R11. THE BASE AHEAD OF THE REMOTE (round 8, T31): unpushed local commits on
# the base would be TAGGED and the tag object published while the published
# base branch never carries the commit the tag claims to mark. Halt naming
# the state - the D5 discipline.
_pr_fixture r11
# The fixture parks the repo on the SPINE branch; the unpushed commit must
# land on the BASE branch or the guard is never exercised.
git -C "$PR_REPO" checkout -q main
echo unpushed > "$PR_REPO/unpushed.txt"; git -C "$PR_REPO" add unpushed.txt
git -C "$PR_REPO" commit -qm unpushed
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 1 "R11: a base ahead of the remote halts before tagging"
t_assert_contains "$T_OUT" "published line does not carry" "R11: ...naming what the tag would falsely mark"
if git -C "$PR_REPO" rev-parse -q --verify 'refs/tags/r9' >/dev/null 2>&1; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: R11 - a tag was created despite the halt"
else
  T_PASS=$((T_PASS+1))
fi

# R12. A BASE BEHIND THE PUBLISHED TIP (round 10, T37): the round-9
# fast-forward ran AFTER the boundary audit had examined the stale tree, so
# the tag marked commits the audit never saw. Behind is now a REFUSAL: halt,
# name the state, pull-and-re-run is the remedy. No mutation of the base
# after the audit, ever.
_pr_fixture r12
CL12="$TMP/r12-clone"; rm -rf "$CL12"; git clone -q "$PR_ORIGIN" "$CL12"
git -C "$CL12" config user.email t@t; git -C "$CL12" config user.name t
git -C "$CL12" checkout -q main
echo final > "$CL12/final.txt"; git -C "$CL12" add final.txt; git -C "$CL12" commit -qm "the final spine PR merged elsewhere"
git -C "$CL12" push -q origin main
R12_REMOTE_TIP="$(git --git-dir="$PR_ORIGIN" rev-parse main)"
R12_STALE_TIP="$(git -C "$PR_REPO" rev-parse main)"
t_capture env "PATH=$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; rel='r9'; repo_base_branches='canonical:main'; . '$TAG_BLOCK'"
t_assert_rc 1 "R12: a base behind the published tip halts - never mutated after the audit"
t_assert_contains "$T_OUT" "behind the published tip" "R12: ...naming the state and the pull-and-re-run remedy"
if git -C "$PR_REPO" rev-parse -q --verify 'refs/tags/r9' >/dev/null 2>&1; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: R12 - a tag was created despite the halt"
else
  T_PASS=$((T_PASS+1))
fi
t_assert_eq "$R12_STALE_TIP" "$(git -C "$PR_REPO" rev-parse main)" "R12: the local base was left untouched (no post-audit mutation)"

# P17. A HOSTLESS REMOTE (round 9, T35): a filesystem remote path parses into
# a plausible owner/repo selector, aiming every gh call at an unrelated
# GitHub repository. The derivation must refuse hostless URLs - the empty
# selector trips the existing non-GitHub halt, never a wrong-repo handoff.
_pr_fixture p17
git -C "$PR_REPO" config --unset "url.$PR_ORIGIN.insteadOf"
git -C "$PR_REPO" remote set-url origin "$PR_ORIGIN"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 1 "P17: a filesystem-path remote halts instead of deriving a selector"
t_assert_contains "$T_OUT" "cannot derive an owner/repo" "P17: ...naming the derivation failure, not acting on a wrong repo"
if [ -f "$PR_STATE/gh_repo" ]; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: P17 - a gh call fired despite the hostless remote"
else
  T_PASS=$((T_PASS+1))
fi

# P18. SEVERAL REMOTES HALT, origin preference included (round 10, T36): in a
# fork checkout origin is the FORK and upstream the canonical repo - an
# origin-preferring rule PRs the fork. Any multi-remote shape halts naming
# them; the single-remote case (whatever its name) is the straightforward one.
_pr_fixture p18
git -C "$PR_REPO" remote add upstream "$PR_ORIGIN"
t_capture env "GH_STATE=$PR_STATE" "PATH=$GHSTUB:$PR_SHIM:$PATH" bash -c \
  "set -euo pipefail; spine_id='r0.s5'; spine_slug='tier'; repo_base_branches='canonical:main'; . '$MERGE_BLOCK'"
t_assert_rc 1 "P18: a two-remote (fork-shaped) repo halts the landing pass"
t_assert_contains "$T_OUT" "several remotes" "P18: ...naming them, never silently preferring origin"

cd /; rm -rf "$TMP"

# A FLOOR ON THE ASSERTION COUNT. Every check in test-block-ledger.sh proves
# this file EXTRACTS and SOURCES each covered block; none of them can see the
# behavioural assertions around that being deleted, and a file whose assertions
# are gone reports pass=0 fail=0 and exits 0. The floor is what makes wholesale
# removal loud. Raise it when the file grows; never lower it to make a run go
# green. (Codex P2 round 3 on PR #144.)
if [ "$T_PASS" -lt 220 ]; then
  echo "FAIL: test-close.sh ran only $T_PASS assertions (floor 220) - assertions were removed, not just skipped"
  T_FAIL=$((T_FAIL+1))
fi
t_summary
