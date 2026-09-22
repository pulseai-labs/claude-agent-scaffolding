#!/usr/bin/env bash
# Cross-file prose contracts. Prose is an executable artifact here and it has no
# other CI: nothing else in this suite can see a drift between two documents.
#
# The one guarded here is the engine's own deadlock. The callee's pre-flight
# Gate 1 treats a handoff whose Constraints omit `git_policy: STAGE-not-commit`
# or the return JSON shape as MALFORMED, and malformed is itself a gap. So the
# orchestrator-side contract that says what to write into a handoff
# (handoff-contract.md) must agree, to the byte, with the callee-side contract
# that says what will be read back (returns.md) and with the binding body
# (SKILL.md). If they drift, every dispatch returns gaps-surfaced, no work ever
# starts, and there is no runtime signal at all - the failure is two documents
# disagreeing.
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
WI="$HERE/../skills/work-item"

# The TEMPLATE line, not the worked example: both files also carry a filled-in
# example of each shape, and those legitimately differ. The templates are the
# ones still holding `<placeholder>` markers.
_shape() { # $1=file $2=mode
  { grep -F "\"mode\": \"$2\"" "$1" || true; } | { grep -F '<' || true; } | head -1
}

for mode in complete gaps-surfaced; do
  base="$(_shape "$WI/references/returns.md" "$mode")"
  # Non-emptiness FIRST. Two files that both fail to match would compare equal,
  # and the parity assertions below would pass while asserting nothing.
  if [ -n "$base" ]; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: returns.md declares no '$mode' template - the parity checks below are vacuous"
  fi
  for f in "$WI/SKILL.md" "$WI/references/handoff-contract.md"; do
    t_assert_eq "$base" "$(_shape "$f" "$mode")" \
      "$(basename "$f") carries the '$mode' return shape byte-identically to returns.md"
  done
done

# The other half of Gate 1's Constraints requirement. handoff-contract.md must
# carry the literal the callee looks for - a paraphrase ("stage, do not commit")
# reads fine to a human and fails the gate.
for f in "$WI/SKILL.md" "$WI/references/pre-flight.md" "$WI/references/handoff-contract.md"; do
  if grep -Fq 'git_policy: STAGE-not-commit' "$f"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $(basename "$f") does not carry the literal 'git_policy: STAGE-not-commit'"
  fi
done

# ---------------------------------------------------------------------------
# Memory-bank harvest contracts. The harvest has no verb since the conversion
# (close/references/harvest.md §7 — "you are the writer"), which makes these
# prose-only contracts the harvest's only mechanical surface. They were held
# by the deleted test-harvest.sh section F; deleting the producer must not
# delete the guard on what it guarded.
# ---------------------------------------------------------------------------
CLOSE="$HERE/../skills/close"

# The §9 heading is matched by EXACT STRING at harvest time. If the contract
# that pins it and the ceremony that greps it ever disagree, every report reads
# as "no suggestions" and the harvest is silently empty at "wrote 0".
_H9='## 9. Suggestions for memory bank'
for f in "$WI/references/report-contract.md" "$CLOSE/references/harvest.md"; do
  if grep -Fq -- "$_H9" "$f"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $(basename "$f") does not carry the byte-exact heading '$_H9'"
  fi
done

# Step 9 of the spine-close checklist must still route to the ceremony's only
# copy — a step that names no reference is a caller that does not call.
if grep -Fq -- 'references/harvest.md' "$CLOSE/references/spine-close.md"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: spine-close.md step 9 does not route to 'references/harvest.md'"
fi

# The two-file allowlist the apply holds in prose must name the same two files
# the ceremony tells the reader to choose between.
for tok in '09-known-issues.md' '10-decisions-log.md'; do
  if grep -Fq -- "$tok" "$CLOSE/references/harvest.md"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: harvest.md does not name the allowlisted target '$tok'"
  fi
done


# --- The manifest refusal: one string, three hardcoded copies -----------------
# Skills may not `source` the libs, so a ceremony that must print the refusal
# verbatim has no choice but to carry the literal. That makes drift the default:
# #272/#310 changed the refusal to name the topology remedies and two ceremonies
# kept printing the pre-topology text, sending a topology-only project to
# /init-workspace. No runtime signal - the ceremony refuses correctly, with the
# wrong remedy. Discovered by grep rather than a fixed list, so a fourth copy is
# covered the moment it is written.
OSSLIB="$HERE/../lib"
OSSSK="$HERE/.."
_refusal_literal() { sed -n 's/^[^"]*"//; s/"$//p' "$1"; }

REF_LIB="$(sed -n 's/^OSS_MANIFEST_REFUSAL="\(.*\)"$/\1/p' "$OSSLIB/manifest.sh")"
if [ -n "$REF_LIB" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: cannot read OSS_MANIFEST_REFUSAL from lib/manifest.sh - the parity checks below are vacuous"
fi

# Every prose file printing the refusal's opening clause must print all of it.
REF_COPIES="$({ grep -rl 'ossify requires a topology declaration' "$OSSSK/skills" "$OSSSK/commands" || true; } | sort)"
REF_N="$(printf '%s\n' "$REF_COPIES" | { grep -c . || true; })"
if [ "$REF_N" -ge 3 ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: only $REF_N prose copy/copies of the manifest refusal found - expected the start, plan-release and plan-spine probes at minimum"
fi

# A pipe into `while` runs the loop in a SUBSHELL and every t_assert_eq inside
# it increments a counter that dies with it - the summary would report a clean
# run having asserted nothing. Read from a file instead.
REF_LIST="$(mktemp)"; printf '%s\n' "$REF_COPIES" > "$REF_LIST"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  # EVERY occurrence in the file, not `head -1`. A file carrying two copies had
  # only its first checked, so the second could drift silently - which is the
  # same hole one file up: this guard exists because copies drift, and a guard
  # that checks one copy per file reintroduces it within the file.
  n=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    n=$((n+1))
    t_assert_eq "$REF_LIB" "$(printf '%s' "$line" | sed 's/^[^"]*"//; s/"$//')" \
      "$(basename "$(dirname "$f")")/$(basename "$f") copy #$n prints OSS_MANIFEST_REFUSAL byte-identically"
  done <<EOF
$({ grep -F 'ossify requires a topology declaration' "$f" || true; })
EOF
  if [ "$n" -gt 0 ]; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $f matched the refusal grep but yielded no line to compare - the assertions above are vacuous"
  fi
done < "$REF_LIST"
rm -f "$REF_LIST"

# --- /start's topology probe must not halt ----------------------------------
# The block printed the refusal then `exit 0`, while the paragraph under it said
# to author a topology and carry on. A model following the block stopped; one
# following the prose proceeded - and the no-manifest project is exactly the
# case /start exists to serve, so the halt made the headline feature of
# #272/#310 unreachable through its own ceremony. Mechanical fact, mechanical
# check: the probe block carries no exit.
# The probe is no longer the first bash block — the dispatcher-resolution
# recipe precedes it — so select the block that actually carries `state_path`.
PROBE="$(awk '/^```bash$/{inb=1; buf=""; next} inb && /^```$/{if (buf ~ /state_path/) {printf "%s", buf; exit} inb=0; next} inb{buf=buf $0 "\n"}' "$OSSSK/skills/start/SKILL.md")"
if printf '%s' "$PROBE" | grep -q 'state_path'; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: no bash block in start/SKILL.md carries state_path - the exit check below is vacuous"
fi
case "$PROBE" in
  *exit*) T_FAIL=$((T_FAIL+1)); echo "FAIL: start/SKILL.md's topology probe carries an 'exit' - a refused probe must author and proceed, not halt" ;;
  *)      T_PASS=$((T_PASS+1)) ;;
esac

# --- The remote-redaction contract (PR #345 rounds 3 and 6) -------------------
#
# Two documents redact credentials out of a git remote before printing it:
# wayfinder/references/tracker.md and close/references/boundary-audit.md. The
# same defect has now been found in each of them separately - round 3 fixed
# tracker.md's lowercase-only scheme, and round 6 found boundary-audit.md still
# lowercase-only AND https-only. Fixing one site and not the other is the
# failure this check exists to stop, so the ladder runs against BOTH, extracted
# from the prose rather than restated here: a test carrying its own copy of the
# pattern passes while the shipped document rots.
_redactor() { # $1=file - the sed expression the document actually ships
  { grep -o "sed -E 's#[^']*'" "$1" || true; } | head -1
}
# The two documents redact DIFFERENT INPUT SHAPES, and feeding one the other's
# shape fails against correct prose: tracker.md filters a bare URL from
# `git remote get-url` and anchors at ^, boundary-audit.md filters whole
# `git remote -v` lines (name<TAB>url<TAB>(fetch)) and cannot anchor. The
# ladder is about credentials surviving, not about line shape, so each document
# is fed what it actually reads.
_shape_for() { case "$1" in *tracker.md) printf '%s\n' "$2" ;; *) printf 'origin\t%s\t(fetch)\n' "$2" ;; esac; }
for doc in "$OSSSK/skills/wayfinder/references/tracker.md" \
           "$OSSSK/skills/close/references/boundary-audit.md"; do
  name="$(basename "$doc")"
  red="$(_redactor "$doc")"
  # Non-emptiness FIRST: an extraction that found nothing would redact nothing
  # and every leak assertion below would pass against an empty filter.
  if [ -n "$red" ]; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: no sed redactor extracted from $name - the leak ladder below is vacuous"; continue
  fi
  # Proof the extracted filter is load-bearing at all: a plain credential must
  # not survive it. Without this, a filter that is merely INERT passes the
  # whole ladder, since every case below only asserts a secret is absent.
  plain="$(_shape_for "$doc" 'https://secret@github.com/o/r.git' | eval "$red")"
  case "$plain" in
    *secret*) T_FAIL=$((T_FAIL+1)); echo "FAIL: $name does not redact even a plain lowercase https credential" ;;
    *)        T_PASS=$((T_PASS+1)) ;;
  esac
  # Each case pairs a remote with the secret that must not survive it. Scheme
  # casing (git preserves it), non-https schemes, and a password containing '@'
  # (a greedy match to the LAST '@' before the first '/', not the first).
  while IFS='|' read -r url secret why; do
    [ -n "$url" ] || continue
    out="$(_shape_for "$doc" "$url" | eval "$red")"
    case "$out" in
      *"$secret"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: $name leaked '$secret' from $url - $why" ;;
      *)           T_PASS=$((T_PASS+1)) ;;
    esac
  done <<'EOF'
HTTPS://s3cr3t@github.com/o/r.git|s3cr3t|git preserves scheme casing, so an https?-only pattern prints it unchanged
ssh://user:p4ssw0rd@gitlab.example.com/o/r.git|p4ssw0rd|credentials are not an https-only affair
https://user:p@sstail@github.com/o/r.git|sstail|[^/@]+@ stops at the first @ and leaves the rest of the password
https://x-access-token:ghs_faketoken123@github.com/o/r.git|ghs_faketoken123|the token form git credential helpers actually write
EOF
done

# --- /adopt's completion floor (issue #303) -----------------------------------
#
# #303: two adopt pilots closed green on `oss doctor` with an empty registry -
# the state gate proves integrity, never completeness. The floor that fixes it
# lives in adopt §6 as prose, so prose tokens are its only mechanical surface.
# Pin CLAUSE FRAGMENTS, not bare nouns: round 1 of the #365 review measured the
# first version of this row vacuous for two of three refusal conditions - bare
# 'posture' and 'per-station lines' survived their bullets' deletion via the
# output-table rows. Every token below occurs exactly once in §6's span, inside
# the clause it pins; a narrowing pass that drops a refusal condition, the
# parity arm, or the waiver attribution goes red here, not in the next pilot.
_adopt6="$(awk '/^## 6\. Outputs/{f=1} /^## 7\./{f=0} f' "$OSSSK/skills/adopt/SKILL.md")"
if [ -n "$_adopt6" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: cannot extract adopt §6 - the floor checks below are vacuous"
fi
for tok in 'The completion floor comes first' 'journey table is absent' \
           'per step it marks' 'operator-confirmed' 'the posture bone is absent' \
           'outside its four' 'no closed `Release 0`' 'its stub retrospective absent' \
           'lacks the per-station lines'; do
  case "$_adopt6" in
    *"$tok"*) T_PASS=$((T_PASS+1)) ;;
    *) T_FAIL=$((T_FAIL+1)); echo "FAIL: adopt §6 no longer carries floor token '$tok'" ;;
  esac
done

# --- The risk-gate CSV grammar, stated once and enforced (#340) ---------------
#
# #340: the prose called controls "a free-text CSV" of "phrases" while the
# splitter cut on every bare comma — the prose invited the input that
# corrupted three of four gates on the pilot, and the append-only journal
# made it unrepairable. The grammar now lives ONCE in risk-gates.md §3; the
# verbs enforce it mechanically. This row pins both halves to each other:
# the grammar sentence must survive rewording, and the corrective verb the
# prose names must exist in the dispatcher surface.
RG="$OSSSK/skills/start/references/risk-gates.md"
for tok in 'bare `,` separates entries' 'literal comma inside an entry' \
           'risk_gate_set_controls' 'spell multiple directories as multiple entries'; do
  if /usr/bin/grep -Fq "$tok" "$RG"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: risk-gates.md no longer carries grammar token '$tok'"
  fi
done
if /usr/bin/grep -Fq 'risk_gate_set_controls' "$OSSSK/lib/commands.sh"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: risk-gates.md names risk_gate_set_controls but the dispatcher has no such verb - the prose promises a repair path that does not exist"
fi

# --- /adopt authors a topology too (PR #345 round 6) --------------------------
#
# Round 6: plugin.json and /start's own refusal text both promise that /adopt
# authors .ossify/topology.json, while adopt's A1 gate read as refusal-only and
# stopped at the failed probe - the promise was unhonoured, not merely
# undocumented. The mechanical half of that is a three-document parity fact: if
# someone narrows the claim, all three must move together.
for f in "$OSSSK/.claude-plugin/plugin.json" \
         "$OSSSK/skills/start/SKILL.md" \
         "$OSSSK/skills/adopt/SKILL.md"; do
  if grep -q 'adopt' "$f" && grep -qi 'author' "$f"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $(basename "$f") no longer pairs /adopt with topology authoring - the other two still promise it"
  fi
done

# --- phase 2: the abandoned carve-out's own claims, held mechanically --------
#
# Three sites, each with the same failure shape this file exists for: the words
# are the whole guard, and nothing else in the suite can see them drift.
#
# (a) work-item close must READ the status before it diagnoses a missing
# worktree (#531 site 1). A direct `/close <abandoned-id>` routes into this
# document, its §1 block halts on the absent worktree, and the prose then asserts
# the CAUSE - "the lane skipped work_item_exec" - which is wrong for a withdrawn
# item (never dispatched) and sends the operator to the wrong remedy. The block
# is one of this file's D rows (deferred, never executed by the suite), so this
# assertion is its only hold.
WIC="$OSSSK/skills/close/references/work-item-close.md"
# This file grepped text until now; site (a) needs the SHARED block extractor
# (tests/lib/blocks.sh), the same one test-close.sh and test-block-ledger.sh use,
# because the claim is about a block's internals rather than a line's presence.
. "$HERE/lib/blocks.sh"
_PC_TMP="$(mktemp -d)"; _F="$_PC_TMP/wic-block.sh"
if oss_block_extract "$WIC" 'no recorded worktree for' "$_F" 2>/dev/null && [ -s "$_F" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md §1's block no longer extracts - the checks below are vacuous"
fi
# The status read and the abandoned arm must both be there, and the arm must come
# BEFORE the worktree halt: an arm placed after it is unreachable, because the
# halt exits first.
_ab_line="$(grep -n 'abandoned' "$_F" | head -1 | cut -d: -f1)"
_halt_line="$(grep -n 'no recorded worktree' "$_F" | head -1 | cut -d: -f1)"
if [ -n "$_ab_line" ] && [ -n "$_halt_line" ] && [ "$_ab_line" -lt "$_halt_line" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md §1 does not test for 'abandoned' BEFORE the missing-worktree halt (ab=${_ab_line:-none} halt=${_halt_line:-none}) - an abandoned item is told the lane skipped work_item_exec"
fi
if grep -Fq 'status' "$_F" ; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md §1's block never reads .status - it cannot tell a withdrawn item from a skipped dispatch"
fi
# The TEST, not just the word: the block must COMPARE the status against
# 'abandoned'. Asserting merely that "abandoned" appears in the block passes on
# the message text alone, so a block that reads the status and then ignores it
# (or tests something else) would satisfy the weaker form - measured by mutation.
if grep -Fq '= "abandoned"' "$_F" || grep -Fq "= 'abandoned'" "$_F"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md §1 does not COMPARE the status against 'abandoned' - naming it in a message is not testing it"
fi
# The route out must not leave the SAME trap the release-close halt did: if this
# item's spine is already closed, un-withdrawing it puts a planned item inside a
# closed spine, which release close's tag selector then accepts. And the arm may
# not prescribe reopening it either: close leaves the spine's integration branch
# in place, the lane halts on an existing branch (round-orchestration.md section
# 2), so the arm has to name THAT obstruction and the route that can run - a new
# spine. The first form of this assertion pinned `spine_status`, i.e. the reopen
# that does not work; it was replaced when the round-3 review proved it out.
for _lit in 'work_item_status' 'spine_add' 'round-orchestration.md' 'decomposition.md'; do
  if grep -Fq "$_lit" "$_F"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md §1's abandoned arm does not name '$_lit'"
  fi
done

# (b) the withdrawal arm's demo-ledger remedy must WORK (#531 site 3 / F15). The
# sentence shipped in 1.11.0 said a demo line the withdrawn item alone was going
# to add "goes the same way" as a pending amendment - pointing at ledger_unplan,
# which answers rc 7 for an ordinary active line. The line stays active, its
# implementation was withdrawn, and it then blocks this spine and every later
# cumulative demo. The remedy for that case is retire/replace.
DECOMP="$OSSSK/skills/plan-spine/references/decomposition.md"
if grep -Fq 'goes the same way' "$DECOMP"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: decomposition.md §1 still says a demo line 'goes the same way' - that points at ledger_unplan, which cannot clear an active line"
else
  T_PASS=$((T_PASS+1))
fi
_wd_para="$(grep -A 14 'Any demo line the withdrawn item alone' "$DECOMP")"
case "$_wd_para" in
  *ledger_retire*|*ledger_supersede*) T_PASS=$((T_PASS+1));;
  *) T_FAIL=$((T_FAIL+1)); echo "FAIL: decomposition.md §1's withdrawal arm names neither ledger_retire nor ledger_supersede for the active-line case - the remedy is unreachable from the text";;
esac
case "$_wd_para" in
  *"rc 7"*) T_PASS=$((T_PASS+1));;
  *) T_FAIL=$((T_FAIL+1)); echo "FAIL: decomposition.md §1's withdrawal arm does not say why ledger_unplan fails there (rc 7) - the operator retries it";;
esac
# The INVOCATION, not the verb name: `ledger_retire`/`ledger_supersede` take
# <line-id> <spine-id> <reason> (lib/commands.sh declares _oss_need 3 for both),
# so the two-argument forms this paragraph shipped exit 2 and plan nothing. The
# OLD form is the search term - it is what a regression here would be phrased in.
case "$_wd_para" in
  *"ledger_retire <line-id> <spine-id>"*|*"ledger_supersede <line-id> <spine-id>"*) T_PASS=$((T_PASS+1));;
  *) T_FAIL=$((T_FAIL+1)); echo "FAIL: decomposition.md §1's remedy does not name the by-spine argument - a two-argument ledger_retire/ledger_supersede exits 2";;
esac
case "$_wd_para" in
  *"ledger_retire <line-id> <reason>"*|*"ledger_supersede <line-id> <new-line-id>"*) T_FAIL=$((T_FAIL+1)); echo "FAIL: decomposition.md §1's remedy still shows a two-argument form (it exits 2) - or supersede's second argument as a replacement line id, which it is not";;
  *) T_PASS=$((T_PASS+1));;
esac
case "$_wd_para" in
  *"demo-amendments.md"*) T_PASS=$((T_PASS+1));;
  *) T_FAIL=$((T_FAIL+1)); echo "FAIL: decomposition.md §1's remedy does not cite demo-amendments.md - the document that owns the keying rule the amendment depends on";;
esac

# (c) doctor's zero-match touch-surface sweep (#523). This is the DETECTOR the
# 1.11.0 re-point verbs never had, and it is agent-performed prose, so the facts
# without which it is unexecutable must be present IN THE RECIPE: the semantics
# oracle (touch_check - never a hand-rolled glob match, because a shell `*`
# crosses `/`, so a matcher written there would disagree with the verb that
# decides reclassification) and the corpus (git ls-files, per declared repo). The
# exclusion must be present too, or every deliberately-matching-nothing surface
# becomes a false finding. Asserting the block's own content rather than a
# mention somewhere in the file: measured by mutation, a file-level grep passes
# while the recipe no longer calls the oracle.
SKILLS="$HERE/../skills"
SI="$SKILLS/doctor/references/state-inspection.md"
_SW="$_PC_TMP/sweep-block.sh"
if oss_block_extract "$SI" 'ls-files -z' "$_SW" 2>/dev/null && [ -s "$_SW" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: state-inspection.md §5's touch-surface sweep block no longer extracts - the checks below are vacuous"
fi
# The INVOCATION form, not the word: the block's own comment explains what the
# oracle is, so a word-grep passes on the comment while the recipe no longer
# calls it - measured by mutation.
if grep -Fq '"$oss_bin" touch_check' "$_SW" && grep -Fq 'ls-files' "$_SW"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the §5 sweep recipe does not INVOKE both the oracle (\"\$oss_bin\" touch_check) and the corpus (git ls-files)"
fi
if grep -Fq 'not-applicable' "$SI"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: state-inspection.md's surface sweep does not name 'not-applicable' - every deliberate placeholder becomes a false finding"
fi


# (d) the §5 sweep must RUN, and must not read a failure as an absence (#523).
# It shipped classified ILLUSTRATIVE, and the review of #555 found two defects
# in its logic that no execution could see: `$repos` was never assigned anywhere
# in the doctor skill, and an unreadable repo read as a zero-match. Either one
# turns EVERY bone and gate into a finding - the false-positive cascade the
# check exists to prevent, inverted. The block is OPERATIVE by the ledger's own
# rule (control flow, rc handling, and a variable one step assigns and a later
# step consumes), so it is extracted AND executed here against a real repo.
# That is what moves its ledger row from I to O.
#
# Run with NOTHING injected that the caller does not genuinely supply
# (tests/lib/blocks.sh): `oss_bin` and `repos` ARE the caller's, so they are
# passed; everything else the block must establish itself.
OSS="$HERE/../bin/oss"
SWWS="$_PC_TMP/sweepws"; mkdir -p "$SWWS/.ossify" "$SWWS/canon"
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s"},"gone":{"root":"%s"}},"well_known_paths":{}}\n' \
  "$SWWS/canon" "$SWWS/absent" > "$SWWS/.ossify/topology.json"
( cd "$SWWS/canon" && git init -q . && : > tracked.txt && git add tracked.txt \
  && git -c user.email=t@t -c user.name=t commit -qm fixture ) >/dev/null 2>&1
SWS="$SWWS/state.json"
( cd "$SWWS" && OSS_STATE_FILE="$SWS" bash "$OSS" init "sweep" ) >/dev/null 2>&1
( cd "$SWWS" && OSS_STATE_FILE="$SWS" bash "$OSS" bone_add ADR-9091 "on a tracked file" "tracked.txt" ) >/dev/null 2>&1
( cd "$SWWS" && OSS_STATE_FILE="$SWS" bash "$OSS" bone_add ADR-9092 "on nothing" "nowhere/at/all/**" ) >/dev/null 2>&1
# cd in the MAIN shell, not a subshell: t_capture/t_assert mutate the T_PASS/
# T_FAIL globals, and a subshell's mutations never propagate (test-manifest.sh
# documents the vacuous-green trap this avoids).
cd "$SWWS"
t_capture env OSS_STATE_FILE="$SWS" oss_bin="$OSS" repos="$(printf 'canonical\ngone')" bash -c \
  "set -euo pipefail; . '$_SW'; printf 'HITS%s\n' \"\$(cat \"\$hits\")\"; printf 'SKIPPED[%s]\n' \"\$skipped\"; printf 'ROSTER%s\n' \"\$roster\"; printf 'INHITS%s\n' \"\$(grep -c ADR-9092 \"\$hits\" 2>/dev/null || true)\""
cd "$HERE"
t_assert_rc 0 "(d) the sweep COMPLETES with a declared repo unreadable - it reports the skip rather than exiting the whole run"
t_assert_contains "$T_OUT" "skip: touch(gone)" "(d) ... naming the unreadable repo by key, in the §1 grammar"
t_assert_contains "$T_OUT" "bone ADR-9091" "(d) ... recording the surface that matched a tracked file"
t_assert_contains "$T_OUT" "INHITS0" "(d) ... and the zero-match surface is NOT among the hits - counted from the file itself, so the roster naming the same id cannot mask it"
t_assert_contains "$T_OUT" "SKIPPED[ gone]" "(d) ... and feeding \$skipped, which the prose's partial-corpus rule reads"
# The ROSTER: touch_check answers "<kind> <id>" per match and never the glob,
# so a warn line naming "the id and the glob list" has no other source. Without
# this read the report's second half is unfillable and the `not-applicable`
# exclusion is unreadable - the same unassigned-variable class as $repos.
t_assert_contains "$T_OUT" "ADR-9092" "(d) ... and $roster carrying a surface that matched NOTHING, which is exactly the one a warn line names"
t_assert_contains "$T_OUT" "nowhere/at/all/**" "(d) ... with its glob list, which touch_check's own output cannot supply"
# G4: with EVERY declared repo unreadable the read set is EMPTY, and the sweep
# must report that rather than one absence per surface.
t_capture env OSS_STATE_FILE="$SWS" oss_bin="$OSS" repos="gone" bash -c "set -euo pipefail; . '$_SW'; echo DONE"
t_assert_rc 0 "(d) a read set that came back EMPTY does not abort the sweep"
t_assert_contains "$T_OUT" "no declared repo could be read" "(d) ... it reports that the sweep inspected nothing, rather than reporting every healthy surface as unmatched"
# The corpus arm: `repos` UNSET under strict mode. This is the shipped defect
# (an unassigned variable), so it is run with NOTHING injected.
t_capture env OSS_STATE_FILE="$SWS" oss_bin="$OSS" bash -c "set -euo pipefail; . '$_SW'; echo DONE"
t_assert_rc 0 "(d) an unset \$repos does not abort the sweep under strict mode"
t_assert_contains "$T_OUT" "skip: touch - the declared repo keys could not be read" "(d) ... it says the sweep did not run, instead of sweeping an empty corpus and reporting every surface"
# The registry arm: a batch that is INCONCLUSIVE leaves no hits either, so an
# unreadable registry must not read as a whole-corpus absence.
SWSB="$_PC_TMP/broken-state.json"; printf '%s\n' '{"schema_version":2}' > "$SWSB"
t_capture env OSS_STATE_FILE="$SWSB" oss_bin="$OSS" repos="canonical" bash -c "set -euo pipefail; . '$_SW'; echo DONE"
t_assert_rc 0 "(d) an unreadable registry does not abort the sweep"
t_assert_contains "$T_OUT" "registry could not be read" "(d) ... it reports the registry failure, so an empty \$hits is not read as every surface matching nothing"
# The resolver arm: touch_check returns its RESOLVER's rc 1 before it ever looks
# at the registry - measured, so rc 1 there is indistinguishable from "clean" and
# the rc alone cannot catch it. Only a second probe can, which is why one exists.
SWBR="$_PC_TMP/badroute"; mkdir -p "$SWBR/.ossify"
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s"}},"well_known_paths":{"project_state":"${repos.nosuch.root}/ps.json"}}\n' \
  "$SWBR/canon" > "$SWBR/.ossify/topology.json"
cd "$SWBR"
t_capture env oss_bin="$OSS" repos="canonical" bash -c "set -euo pipefail; . '$_SW'; echo DONE"
cd "$HERE"
t_assert_rc 0 "(d) an unresolvable state route does not abort the sweep"
t_assert_contains "$T_OUT" "state could not be resolved or read" "(d) ... it reports that instead of an absence, even though touch_check's rc 1 there looks exactly like clean"
# R2-2: the legacy key set must exclude ai_workspace, or a planning file under it
# can satisfy a stale product glob and suppress a real warning.
if grep -Fq 'OTHER than `ai_workspace`' "$_SW"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the sweep's corpus comment does not exclude ai_workspace from the legacy pairing-manifest key set - a planning file then satisfies a stale product glob and the zero-match warning is suppressed"
fi
rm -rf "$_PC_TMP"
t_summary
