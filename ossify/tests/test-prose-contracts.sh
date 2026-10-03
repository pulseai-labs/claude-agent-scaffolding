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
# (c) THE ARM MAY NOT ASSUME THE ITEM HAS NO DISPATCH ANY MORE (P1-B, the operator's
# ruling of 2026-09-23; round-3 finding at work-item-close.md:43). The arm used to
# assert "it has no worktree by construction" and "nothing should be reconstructed
# for it" - impossible for the state the narrowing ships, because an `abandoned`
# item that records a dispatch field is exactly what the dropped mirror arm used to
# prevent and doctor's §5 exists to report. It is this file's D row (never executed
# by the suite), so this is its only hold, and the checks pull in opposite
# directions ON PURPOSE: the recorded fields must be READ and NAMED, and the
# impossibility must be GONE. Either one alone is satisfiable by a mutation.
#
# Both positive checks are scoped to the DRIFT BRANCH's own message line, not to
# the whole block: an unscoped `grep -Fq 'work_item_status $wi planned'` is
# satisfied by the CLEAN branch's identical route further down, so deleting the
# route from the branch that needs it would stay green - the substring-satisfied-
# by-another-line trap this file has now been bitten by twice (the -A 8 window in
# §5, and the field list whose explanation carried the field name).
_drift="$(grep -F 'records a dispatch field' "$_F" || true)"
_case="$(grep -A 1 'is abandoned AND records a dispatch field' "$_F" || true)"
_rec_read="$(grep -F 'select(.id==' "$_F" | grep -F 'base_sha' || true)"
if [ -n "$_case" ] && case "$_case" in *'work_item_status $wi planned'*) true;; *) false;; esac; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md §1's drift branch does not name the record repair (work_item_status \$wi planned) in its OWN message - the operator is left with a halt and no route for the one pair that needs it"
fi
# The fields must be READ, not just mentioned: the arm's state read is the line that
# selects the item and names the three fields. The read and the message are two
# different lines in the block, so each half is checked where it actually lives.
_read_ok=1
for _f3 in '.branch' '.worktree_path' '.base_sha'; do
  case "$_rec_read" in *"$_f3"*) ;; *) _read_ok=0;; esac
done
if [ "$_read_ok" = 1 ] && case "$_drift" in *'drift'*) true;; *) false;; esac; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md §1's abandoned arm does not read all three dispatch fields and name the drift pair they form - it still tells the operator to skip an item the record says was dispatched"
fi
if grep -Fq 'by construction' "$_F"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md §1's abandoned arm re-asserts 'by construction' - an abandoned item CAN record a dispatch field (the drift pair), so the impossibility claim is exactly the trap this row exists to catch"
else
  T_PASS=$((T_PASS+1))
fi

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
# (tests/lib/blocks.sh): `oss_bin`, `repos` and `sf` ARE the caller's — the last
# because §2 resolves it once for the whole read-out and §5 consumes it, never
# re-deriving the precedence (#561 round 1, R14). Everything else the block must
# establish itself.
OSS="$HERE/../bin/oss"
SWWS="$_PC_TMP/sweepws"; mkdir -p "$SWWS/.ossify" "$SWWS/canon"
SWS="$SWWS/state.json"
# The state is ROUTED at $SWS and also exported as $OSS_STATE_FILE - the same
# project either way, which is the pairing #561's gate accepts. An override that
# is NOT this directory's manifest-routed state must skip the sweep instead, and
# so must a route that cannot be resolved at all (the round-1 R1 bypass).
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s"},"gone":{"root":"%s"}},"well_known_paths":{"project_state":"%s"}}\n' \
  "$SWWS/canon" "$SWWS/absent" "$SWS" > "$SWWS/.ossify/topology.json"
( cd "$SWWS/canon" && git init -q . && : > tracked.txt && git add tracked.txt \
  && git -c user.email=t@t -c user.name=t commit -qm fixture ) >/dev/null 2>&1
( cd "$SWWS" && OSS_STATE_FILE="$SWS" bash "$OSS" init "sweep" ) >/dev/null 2>&1
( cd "$SWWS" && OSS_STATE_FILE="$SWS" bash "$OSS" bone_add ADR-9091 "on a tracked file" "tracked.txt" ) >/dev/null 2>&1
( cd "$SWWS" && OSS_STATE_FILE="$SWS" bash "$OSS" bone_add ADR-9092 "on nothing" "nowhere/at/all/**" ) >/dev/null 2>&1
( cd "$SWWS" && OSS_STATE_FILE="$SWS" bash "$OSS" risk_gate_add RG-7 "also/nowhere/**" "packages/core/**" ) >/dev/null 2>&1
# cd in the MAIN shell, not a subshell: t_capture/t_assert mutate the T_PASS/
# T_FAIL globals, and a subshell's mutations never propagate (test-manifest.sh
# documents the vacuous-green trap this avoids).
cd "$SWWS"
t_capture env OSS_STATE_FILE="$SWS" oss_bin="$OSS" sf="$SWS" repos="$(printf 'canonical\ngone')" bash -c \
  "set -euo pipefail; . '$_SW'; printf 'HITS%s\n' \"\$(cat \"\$hits\")\"; printf 'SKIPPED[%s]\n' \"\$skipped\"; printf 'ROSTER%s\n' \"\$roster\"; printf 'KINDS%s\n' \"\$(printf '%s' \"\$roster\" | jq -r '[.[].kind]|join(\",\")')\"; printf 'INHITS%s\n' \"\$(grep -c ADR-9092 \"\$hits\" 2>/dev/null || true)\""
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
# #561 (1): the roster must ALSO carry the surface KIND. It is what decides
# which re-point verb a warn line's remedy names (`bone_set_touch` vs
# `risk_gate_set_touch`), and for a surface that matched NOTHING `touch_check`
# emits no line at all, so the kind has no other source. Both branches of the
# projection are exercised: two bones and a risk gate.
t_assert_contains "$T_OUT" "KINDSbone,bone,risk_gate" "(d) ... and the KIND of every surface, in touch_check's own vocabulary - the only thing that picks the re-point verb"
# G4: with EVERY declared repo unreadable the read set is EMPTY, and the sweep
# must report that rather than one absence per surface. Run from the workspace so
# the route resolves: this arm is about the corpus loop, and the foreign-state
# gate above would refuse first from a directory with no manifest (round 1, R1).
cd "$SWWS"
t_capture env OSS_STATE_FILE="$SWS" oss_bin="$OSS" sf="$SWS" repos="gone" bash -c "set -euo pipefail; . '$_SW'; echo DONE"
t_assert_rc 0 "(d) a read set that came back EMPTY does not abort the sweep"
t_assert_contains "$T_OUT" "no declared repo could be read" "(d) ... it reports that the sweep inspected nothing, rather than reporting every healthy surface as unmatched"
# The corpus arm: `repos` UNSET under strict mode. This is the shipped defect
# (an unassigned variable), so it is run with NOTHING injected.
t_capture env OSS_STATE_FILE="$SWS" oss_bin="$OSS" sf="$SWS" bash -c "set -euo pipefail; . '$_SW'; echo DONE"
t_assert_rc 0 "(d) an unset \$repos does not abort the sweep under strict mode"
t_assert_contains "$T_OUT" "skip: touch - the declared repo keys could not be read" "(d) ... it says the sweep did not run, instead of sweeping an empty corpus and reporting every surface"
cd "$HERE"
# The registry arm: a batch that is INCONCLUSIVE leaves no hits either, so an
# unreadable registry must not read as a whole-corpus absence. The workspace's
# OWN route resolves to the broken state, so the foreign-state gate above is
# satisfied and this arm still reaches touch_check's rc 2 (round 1, R1: an
# unresolvable route now refuses before this point).
SWBRK="$_PC_TMP/brokenroute"; mkdir -p "$SWBRK/.ossify"
printf '%s\n' '{"schema_version":2}' > "$SWBRK/broken-state.json"
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s/canon"}},"well_known_paths":{"project_state":"%s/broken-state.json"}}\n' \
  "$SWBRK" "$SWBRK" > "$SWBRK/.ossify/topology.json"
cd "$SWBRK"
t_capture env oss_bin="$OSS" sf="$SWBRK/broken-state.json" repos="canonical" bash -c "set -euo pipefail; . '$_SW'; echo DONE"
cd "$HERE"
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
# #561 (2): the sweep must NOT run when the state in play is not this
# directory's manifest-routed state. That is §4's worktree gate, and it is this
# block's own hazard: with $OSS_STATE_FILE pointing at ANOTHER workspace's state,
# every surface THAT state knows and these repos do not is reported as matching
# no tracked file, after inspecting the wrong corpus, with every command exiting
# 0. An unset `hits` and an unset `roster` are the signature of "did not run".
SWF="$_PC_TMP/foreignws"; mkdir -p "$SWF/.ossify" "$SWF/canon"
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s/canon"}},"well_known_paths":{"project_state":"%s/state.json"}}\n' \
  "$SWF" "$SWF" > "$SWF/.ossify/topology.json"
( cd "$SWF" && bash "$OSS" init foreign >/dev/null && bash "$OSS" bone_add ADR-7777 "a foreign-only surface" "foreign/only/**" ) >/dev/null 2>&1
cd "$SWWS"
t_capture env OSS_STATE_FILE="$SWF/state.json" oss_bin="$OSS" sf="$SWF/state.json" repos="canonical" bash -c \
  "set -euo pipefail; . '$_SW'; printf 'HITS[%s]\n' \"\${hits:-unset}\"; printf 'ROSTER[%s]\n' \"\${roster:-unset}\""
cd "$HERE"
t_assert_rc 0 "#561: a foreign state does not abort the sweep"
t_assert_contains "$T_OUT" "skip: touch - the state in play" "#561 ... it refuses the run in the §1 grammar, naming the state in play against the routed answer"
t_assert_contains "$T_OUT" "HITS[unset]" "#561 ... and nothing was swept: \$hits was never created"
t_assert_contains "$T_OUT" "ROSTER[unset]" "#561 ... and no foreign registry was read, so no warn line can be composed from it"
# ROUND 1, R1: the gate must not be bypassed by a route that resolves to
# NOTHING. A topology whose `project_state` value is relative makes
# `"$oss_bin" state_path` refuse, and the old gate read that empty answer as
# consent (its `[ -n "$routed" ] &&` guard) and swept a foreign registry against
# this directory's repos. "Cannot be compared" is not "the same project".
SWREL="$_PC_TMP/relroute"; mkdir -p "$SWREL/.ossify" "$SWREL/canon"
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s/canon"}},"well_known_paths":{"project_state":"./state.json"}}\n' \
  "$SWREL" > "$SWREL/.ossify/topology.json"
cd "$SWREL"
t_capture env OSS_STATE_FILE="$SWF/state.json" oss_bin="$OSS" sf="$SWF/state.json" repos="canonical" bash -c \
  "set -euo pipefail; . '$_SW'; printf 'HITS[%s]\n' \"\${hits:-unset}\""
cd "$HERE"
t_assert_rc 0 "#561 R1: an unresolvable route does not abort the sweep"
t_assert_contains "$T_OUT" "is not this directory's manifest-routed state" "#561 R1 ... it refuses: an empty routed answer is not consent to compare"
t_assert_contains "$T_OUT" "unresolved" "#561 R1 ... and the line says the route could not be resolved"
t_assert_contains "$T_OUT" "HITS[unset]" "#561 R1 ... and nothing was swept against this directory's repos"
# CONTROL: with NO override the same fixture still sweeps - the gate refuses a
# foreign state, not every run, and the routed state's roster still fills.
cd "$SWWS"
t_capture env oss_bin="$OSS" sf="$SWS" repos="canonical" bash -c \
  "set -euo pipefail; . '$_SW'; printf 'HITS%s\n' \"\$(cat \"\$hits\")\"; printf 'KINDS%s\n' \"\$(printf '%s' \"\$roster\" | jq -r '[.[].kind]|join(\",\")')\""
cd "$HERE"
t_assert_contains "$T_OUT" "bone ADR-9091" "#561 control: no override, so the routed state sweeps its corpus"
t_assert_contains "$T_OUT" "KINDSbone,bone,risk_gate" "#561 control: ... and the roster comes from the routed state"
# #558 / ledger line 87, both halves, resolved here.
# (i) the block never removed its `$hits` temp file. The removal is prose the
# agent performs once the warn lines are written, so it must be present OUTSIDE
# the fence and absent INSIDE it - an in-fence removal would empty the report's
# own source.
if grep -Fq 'rm -f "$hits"' "$_SW"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the §5 sweep block deletes \$hits itself - the warn lines are composed FROM that file"
else
  T_PASS=$((T_PASS+1))
fi
if grep -Fq 'once the warn lines are written' "$SI" && grep -Fq 'rm -f "$hits"' "$SI"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the §5 sweep never removes its \$hits temp file - the leak stays open (#558)"
fi
# (ii) the arbitrary fixed batch: xargs splits at the system's own argument
# limit, so `-n 200` only multiplies dispatcher spawns per corpus.
if grep -Fq 'xargs -0 -n 200' "$_SW"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the §5 sweep still batches at a fixed 'xargs -n 200' - one dispatcher per 200 tracked paths (#558)"
else
  T_PASS=$((T_PASS+1))
fi
# R2-2: the legacy key set must exclude ai_workspace, or a planning file under it
# can satisfy a stale product glob and suppress a real warning.
if grep -Fq 'OTHER than `ai_workspace`' "$_SW"; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: the sweep's corpus comment does not exclude ai_workspace from the legacy pairing-manifest key set - a planning file then satisfies a stale product glob and the zero-match warning is suppressed"
fi
# --- phase (e): §3's bones drift check compares SETS, not counts (#154) -------
#
# Shipped as a cardinality comparison - `.bones | length` against section 4's row
# count - which cannot tell the two documented directions apart. Replace a
# registered bone's index row with a DIFFERENT hand-written id and both counts
# stay at 1 while *both* directions are present, so the check reported clean on
# exactly the drift it exists to find. The block is OPERATIVE by the ledger's
# rule (control flow, a refusal arm, temp files, and a set difference), so it is
# extracted AND executed here, and the fixture asserts its own shape (equal
# counts) so the pin cannot drift into a trivially-unequal case that proves
# nothing.
_E_SVMD="$SKILLS/doctor/references/spec-validation.md"
_E_SV="$_PC_TMP/sv-block.sh"
if oss_block_extract "$_E_SVMD" 'only_reg=' "$_E_SV" 2>/dev/null && [ -s "$_E_SV" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: spec-validation.md §3's drift block no longer extracts - the checks below are vacuous"
fi
_E_WS="$_PC_TMP/driftws"; mkdir -p "$_E_WS/.ossify" "$_E_WS/canon" "$_E_WS/docs"
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s/canon"}},"well_known_paths":{"master_spec":"%s/docs/MASTER-SPEC.md","project_state":"%s/.ossify/project-state.json"}}\n' \
  "$_E_WS" "$_E_WS" "$_E_WS" > "$_E_WS/.ossify/topology.json"
( cd "$_E_WS" && bash "$OSS" init drift >/dev/null && bash "$OSS" bone_add ADR-0002 "the registered bone" "packages/core/**" >/dev/null ) >/dev/null 2>&1
_e_spec() { # $1=ws ; remaining args = section-4 table rows
  local ws="$1"; shift
  {
    printf '# MASTER-SPEC\n\n## 1. Vision\nx\n\n## 2. Posture & boundary\nx\n\n## 3. Feature map\nx\n\n## 4. Bones-registry index\n\n| ADR | Title |\n|---|---|\n'
    printf '%s\n' "$@"
    printf '\n## 5. Journeys\nx\n'
  } > "$ws/docs/MASTER-SPEC.md"
}
_e_run() { ( cd "$1" && oss_bin="$OSS" bash -c "set -euo pipefail; . '$_E_SV'" ); }
# The fixture's own shape: the two counts the OLD rule compared are EQUAL here,
# so a regression back to cardinality reads this fixture as clean and fails (e1).
_e_spec "$_E_WS" '| ADR-9999 | the hand-written row |'
t_assert_eq "$(jq -r '.bones | length' "$_E_WS/.ossify/project-state.json")" \
            "$(awk '/^## 4\./ {f=1; next} /^## / {f=0} f' "$_E_WS/docs/MASTER-SPEC.md" | grep -cE '^[[:space:]]*\|[[:space:]]*ADR-' || true)" \
            "(e) the fixture carries EQUAL registry and index counts - without that this pin stops exercising #154"
# (e1) THE DEFECT: equal counts, both directions present -> BOTH are named.
t_capture _e_run "$_E_WS"
t_assert_rc 0 "(e) the drift check runs to completion on an equal-count mismatch"
t_assert_contains "$T_OUT" "registry entry with no index row: ADR-0002" "(e) ... naming the registered bone the index lost - the direction a count comparison cannot see"
t_assert_contains "$T_OUT" "index row with no registry entry: ADR-9999" "(e) ... AND naming the hand-written row in the same run: equal counts is not a match"
# (e2) CONTROL: the matched pair is clean, and the clean case SPEAKS (doctor's
# own rule: silence is indistinguishable from a pass).
_e_spec "$_E_WS" '| ADR-0002 | the registered bone |'
t_capture _e_run "$_E_WS"
t_assert_rc 0 "(e) the matched spec runs clean"
t_assert_contains "$T_OUT" "ok: spec - bones index matches the registry" "(e) ... and it emits its line rather than staying silent"
if printf '%s' "$T_OUT" | grep -Fq 'no index row'; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: (e) the matched fixture still produced a drift finding - the set difference is wrong in the other direction"
else
  T_PASS=$((T_PASS+1))
fi
# (e3) CONTROL: one direction at a time. A comparison that reports both
# directions whenever either fires is a count check wearing a set's clothes, and
# the two directions have different remedies in the table.
_e_spec "$_E_WS" '| ADR-0002 | the registered bone |' '| ADR-0007 | the extra row |'
t_capture _e_run "$_E_WS"
t_assert_contains "$T_OUT" "index row with no registry entry: ADR-0007" "(e) an extra index row alone is named"
if printf '%s' "$T_OUT" | grep -Fq 'registry entry with no index row'; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: (e) a one-way mismatch also reported the OTHER direction - the halves are not being compared as sets"
else
  T_PASS=$((T_PASS+1))
fi
# (e4) REFUSAL ARM: an index half that cannot be READ is not an EMPTY one. The
# heading is what this recipe reads section 4 by, so its absence must refuse.
printf '# MASTER-SPEC\n\n## Bones\n\n| ADR | Title |\n|---|---|\n| ADR-0002 | x |\n' > "$_E_WS/docs/MASTER-SPEC.md"
t_capture _e_run "$_E_WS"
t_assert_rc 0 "(e) a spec with no readable section-4 heading does not abort the run"
t_assert_contains "$T_OUT" "section 4 carries no" "(e) ... it refuses the comparison instead of reading the index as empty - the same failure-read-as-absence class §5's sweep names"
if printf '%s' "$T_OUT" | grep -Fq 'no index row'; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: (e) an unreadable index half was reported as a registry-only mismatch - that is the defect class this pin exists for"
else
  T_PASS=$((T_PASS+1))
fi
# (e5) REFUSAL ARM: the registry half unreadable (jq cannot read `.bones[].adr`),
# which must refuse rather than compare against an empty registry.
_E_WS2="$_PC_TMP/driftws2"; mkdir -p "$_E_WS2/.ossify" "$_E_WS2/canon" "$_E_WS2/docs"
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s/canon"}},"well_known_paths":{"master_spec":"%s/docs/MASTER-SPEC.md","project_state":"%s/.ossify/project-state.json"}}\n' \
  "$_E_WS2" "$_E_WS2" "$_E_WS2" > "$_E_WS2/.ossify/topology.json"
printf '%s\n' '{"schema_version":9}' > "$_E_WS2/.ossify/project-state.json"
_e_spec "$_E_WS2" '| ADR-0002 | x |'
t_capture _e_run "$_E_WS2"
t_assert_rc 0 "(e) an unreadable registry does not abort the run"
t_assert_contains "$T_OUT" "could not read both halves" "(e) ... it names the unreadable half instead of reporting every index row as orphaned"
if printf '%s' "$T_OUT" | grep -Fq 'no registry entry'; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: (e) an unreadable registry read as an EMPTY one - every index row was reported as a hand-written row"
else
  T_PASS=$((T_PASS+1))
fi
# (e6) ROUND 1, R3: an unresolvable route must REFUSE, not abort. Both resolver
# calls in the block are guarded, so under `set -euo pipefail` it reaches its own
# refusal arm instead of dying inside the command substitution - which is what
# the shipped block did (`sv_state="$(...)"` aborted the whole sourced read-out).
_E_WS3="$_PC_TMP/driftws3"; mkdir -p "$_E_WS3/.ossify" "$_E_WS3/canon" "$_E_WS3/docs"
printf '{"schema_version":1,"repos":{"canonical":{"root":"%s/canon"}},"well_known_paths":{"master_spec":"%s/docs/MASTER-SPEC.md","project_state":"./state.json"}}\n' \
  "$_E_WS3" "$_E_WS3" > "$_E_WS3/.ossify/topology.json"
_e_spec "$_E_WS3" '| ADR-0002 | x |'
t_capture _e_run "$_E_WS3"
t_assert_rc 0 "(e) R3: an unresolvable state route does not abort the drift check under strict mode"
t_assert_contains "$T_OUT" "could not read" "(e) R3 ... it reaches its refusal arm and says which half it could not read"

# --- phase (f): §3's ADR numbering scan must read an adopted series (#301) ----
#
# The scan matched `^adr-` and `^NNNN-` only. On an adopted series in the other
# case - `ADR-001-redb-for-storage.md`, PulseDB's - it returned NOTHING, and an
# empty answer is not "start at 1": it minted `ADR-0001` over an existing
# `ADR-001`, duplicating the identifier bone citations and touch records key on.
# Two further rules lived only in prose: the minted WIDTH (`%04d` regardless of
# the series it read) and an unreadable `docs/adr/` answering like an empty one.
# The block is OPERATIVE (a loop, `exit 1`, a format chosen at runtime), so it is
# extracted AND executed.
_AD="$SKILLS/start/references/bones-registry.md"
_SC="$_PC_TMP/adr-scan.sh"
if oss_block_extract "$_AD" 'matches=' "$_SC" 2>/dev/null && [ -s "$_SC" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: bones-registry.md §3's numbering scan no longer extracts - the checks below are vacuous"
fi
_o_ws() { # $1=name ; echoes a workspace whose canonical repo has an empty docs/adr
  local d="$_PC_TMP/ni/$1"
  mkdir -p "$d/.ossify" "$d/canon/docs/adr"
  printf '{"schema_version":1,"repos":{"canonical":{"root":"%s/canon"}},"well_known_paths":{}}\n' "$d" > "$d/.ossify/topology.json"
  printf '%s\n' "$d"
}
_o_next() { ( cd "$1" && env oss_bin="$OSS" repos="canonical" bash -c "set -euo pipefail; . '$_SC'" ); }
# THE DEFECT: an uppercase three-digit series is read, and the mint continues it.
_O_U="$(_o_ws upper)"; : > "$_O_U/canon/docs/adr/ADR-001-redb-for-storage.md"; : > "$_O_U/canon/docs/adr/ADR-002-single-writer.md"
t_capture _o_next "$_O_U"
t_assert_rc 0 "#301: the numbering scan completes on an adopted series"
t_assert_contains "$T_OUT" "ADR-003" "#301 ... and CONTINUES it: ADR-001/ADR-002 are read, so the next id is ADR-003 at the series' own width"
if printf '%s' "$T_OUT" | grep -Fq 'ADR-001'; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: #301 the scan minted an id that already exists - matching one case answers an empty series and restarts at 1"
else
  T_PASS=$((T_PASS+1))
fi
# CONTROLS: every other form keeps working, and a non-series mints nothing from.
_O_B="$(_o_ws bare)"; : > "$_O_B/canon/docs/adr/0003-record-architecture-decisions.md"
t_capture _o_next "$_O_B"
t_assert_contains "$T_OUT" "ADR-0004" "#301 control: the bare scaffold-onboard seed is still read"
_O_L="$(_o_ws lower)"; : > "$_O_L/canon/docs/adr/adr-0007-hexagonal.md"
t_capture _o_next "$_O_L"
t_assert_contains "$T_OUT" "ADR-0008" "#301 control: the lowercase four-digit form is still read"
_O_E="$(_o_ws empty)"
t_capture _o_next "$_O_E"
t_assert_contains "$T_OUT" "ADR-0001" "#301 control: an empty series starts at ADR-0001, four digits"
_O_D="$(_o_ws decoy)"; : > "$_O_D/canon/docs/adr/README.md"; : > "$_O_D/canon/docs/adr/0001-notes.txt"
t_capture _o_next "$_O_D"
t_assert_contains "$T_OUT" "ADR-0001" "#301 control: README.md and a non-.md file are not a series to continue"
# REFUSAL ARM: an unreadable docs/adr/ must not answer like an empty one, or the
# next ADR is minted blind over whatever is in there.
_O_P="$(_o_ws perm)"; chmod 000 "$_O_P/canon/docs/adr"
t_capture _o_next "$_O_P"
_o_prc=$T_RC
chmod 755 "$_O_P/canon/docs/adr"
t_assert_eq 1 "$_o_prc" "#301: an unreadable docs/adr/ refuses (rc 1) rather than answering as an empty series"
t_assert_contains "$T_OUT" "could not read" "#301 ... naming the directory it could not read"
if printf '%s' "$T_OUT" | grep -Fq 'ADR-'; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: #301 an unreadable series was answered with a minted id - a failure read as an absence"
else
  T_PASS=$((T_PASS+1))
fi

# --- phase 3: the never-strand invariant's two surfaces must agree -----------
#
# The dispatch predicate is one definition used at four sites, and one of them is
# PROSE: doctor's §5 drift bullet reports the very pair the rails refuse to
# create. If the bullet names fewer fields than the shell predicate reads, the
# report and the rail disagree about what "dispatched" means - and the
# disagreement is invisible in both directions (the bullet under-reports, the
# rail over-refuses, and each looks correct read alone). Measured: the shipped
# bullet named two fields while the guard read two, and the third (base_sha) was
# how a half-write dispatch became an abandonment.
ENT="$OSSSK/lib/entities.sh"
SI3="$OSSSK/skills/doctor/references/state-inspection.md"
# The PREDICATE's own definition, not a mention anywhere in the file: the three
# field names also appear in the dispatch payload builder, so a file-level grep
# passes while the predicate reads fewer (measured - the same trap as phase 2's
# sweep row, where a word-grep passed on a comment). Anchored to COLUMN 0 and
# required to be UNIQUE: `grep -F '…='` would take the first match, so a future
# comment carrying the literal above the definition would satisfy the field
# checks while the real predicate drifted under it (round 1, GLM seat).
_pred_n="$(grep -cE '^_OSS_DISPATCHED_JQ=' "$ENT" || true)"
if [ "$_pred_n" = "1" ]; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: entities.sh must define the shared dispatch predicate (_OSS_DISPATCHED_JQ=) exactly once at column 0, found $_pred_n - the parity checks below are vacuous otherwise"
fi
_pred="$(grep -E '^_OSS_DISPATCHED_JQ=' "$ENT" || true)"
for _f in branch worktree_path base_sha; do
  case "$_pred" in
    *"$_f"*) T_PASS=$((T_PASS+1));;
    *) T_FAIL=$((T_FAIL+1)); echo "FAIL: the dispatch predicate's definition does not read '$_f'";;
  esac
done
# The bullet's field list, and the window is its OWN two lines. It was `-A 8`
# until this narrowing pass, and the mutation battery found why that was too wide:
# the bullet's EXPLANATION below it names `base_sha` as well (`work_item_exec <wi>
# "" "" <sha>` records it), so deleting `base_sha` from the field list itself left
# this row GREEN - the check was satisfied by the prose that explains the field,
# which is the round-1 #2 trap one level down (a check that passes on surrounding
# commentary instead of on its subject). Measured: with `-A 2` the same deletion is
# RED. The anchor below it is the bullet's own bolded heading, so this window is
# the list, not the explanation.
_bullet="$(grep -A 2 'An `abandoned` work item with a recorded' "$SI3")"
for _f in branch worktree_path base_sha; do
  case "$_bullet" in
    *"$_f"*) T_PASS=$((T_PASS+1));;
    *) T_FAIL=$((T_FAIL+1)); echo "FAIL: state-inspection.md §5's abandoned-drift bullet does not name '$_f' - the report and the rail disagree about what dispatched means";;
  esac
done
# The item-level rail keeps three clauses (a recorded dispatch / `complete` /
# `active`) and it is PROSE that tells the model to walk them, so the prose must
# name all three. Round 2 (#21) is exactly this row's failure mode: the sentence
# named a dispatched or landed item and said nothing about `active`, which the same
# rail refuses - a never-dispatched item a lane had already marked in flight.
# Re-anchored by the 1.12.0 narrowing (operator ruling, 2026-09-23): the old anchor
# was the sentence that ALSO claimed the retirement was enforced, and that rail does
# not ship (#563), so the anchor is the claim that remains true.
_SK3="$OSSSK/skills/plan-spine/SKILL.md"
_sk="$(grep -A 1 'The withdrawal is enforced rather than declared' "$_SK3" || true)"
if [ -n "$_sk" ]; then
  T_PASS=$((T_PASS+1))
  for _f in dispatched complete active 'rc 7'; do
    case "$_sk" in
      *"$_f"*) T_PASS=$((T_PASS+1));;
      *) T_FAIL=$((T_FAIL+1)); echo "FAIL: plan-spine/SKILL.md's withdrawal sentence does not name '$_f' - the rail refuses on it and the prose the model follows is narrower than the rail";;
    esac
  done
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: plan-spine/SKILL.md no longer states what the withdrawal refusal is enforced ON - re-anchor this row or drop it"
fi
# ADJACENT CONTROL, and it is the loosening's own: this row went from pinning one
# exact sentence to pinning field names, so it accepts more - and what it must still
# REJECT is the claim that went with the dropped rails. A prose sentence asserting
# the retirement is enforced would be a rule the release does not keep, which is the
# same report/rail disagreement one level up.
if grep -Fq 'Both are now enforced rather than declared' "$_SK3"; then
  T_FAIL=$((T_FAIL+1)); echo "FAIL: plan-spine/SKILL.md claims the retirement is enforced - that rail does not ship in 1.12.0 (#563)"
else
  T_PASS=$((T_PASS+1))
fi
# The third reader of the dispatch record is a close-path diagnosis, and it is
# one field wide if nobody holds it: work-item-close.md's halt gloss explains a
# missing worktree_path as "the lane skipped work_item_exec", which is FALSE for
# the base_sha-only half-write this phase documents - the lane dispatched and
# recorded no worktree. The halt is right either way; the diagnosis the operator
# recovers from must name both causes.
_wc="$(grep -A 3 'A missing .worktree_path. means' "$OSSSK/skills/close/references/work-item-close.md" || true)"
if [ -n "$_wc" ]; then
  case "$_wc" in
    *base_sha*) T_PASS=$((T_PASS+1));;
    *) T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md's missing-worktree_path gloss does not name the base_sha-only half-write - it tells the operator a lane broke when a dispatch is on record";;
  esac
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md no longer states the missing-worktree_path diagnosis at all - re-anchor this row or drop it"
fi

# 1.13.0 - /ossify:work-pr is a ROUTER: merge-bar's working-a-pr where that plugin
# is installed, the bundled loop otherwise. Losing either arm strands a host:
# without the fallback, an install with no merge-bar has no loop at all; without
# the route, merge-bar is never used from ossify.
_WP="$HERE/../commands/work-pr.md"
for _lit in 'working-a-pr' 'references/work-pr/loop.md'; do
  if grep -Fq -- "$_lit" "$_WP"; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: commands/work-pr.md no longer names '$_lit' - the router lost an arm"
  fi
done

# 1.13.0 final review - four sentences whose absence was a finding.
# (a) patch/SKILL.md: the separate worktree is cut BEFORE the reproduction and
#     the fix are written - otherwise a model following the steps in order writes
#     them into a checkout a running spine is parked on.
_PS="$HERE/../skills/patch/SKILL.md"
_wt="$(awk '/worktree/{print NR; exit}' "$_PS")"; _rp="$(awk '/Reproduce first/{print NR; exit}' "$_PS")"
if [ -n "$_wt" ] && [ -n "$_rp" ] && [ "$_wt" -lt "$_rp" ]; then T_PASS=$((T_PASS+1)); else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: patch/SKILL.md does not direct the worktree cut before 'Reproduce first' (worktree line ${_wt:-none}, reproduce line ${_rp:-none})"; fi
# (b)-(d) spine close's merge-bar seam and the barrier's own-scope paths.
_SC="$HERE/../skills/close/references/spine-close.md"
_RO="$HERE/../skills/work-item/references/round-orchestration.md"
for _pair in "$_SC|keeps the first two lines" "$_SC|pr_fields=\"\$(cat" "$_RO|§7 fix-up"; do
  _f="${_pair%%|*}"; _lit="${_pair#*|}"
  if grep -Fq -- "$_lit" "$_f"; then T_PASS=$((T_PASS+1)); else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: $(basename "$_f") does not state '$_lit'"; fi
done

# 1.13.1 (#614 items 1-6) - one pin per item, each red on 1.13.0's text.
_IL="$HERE/../skills/plan-spine/references/intake-and-ledger.md"
_RC="$HERE/../skills/close/references/release-close.md"
_pin() { # $1=ok(0/1) $2=message
  if [ "$1" = 0 ]; then T_PASS=$((T_PASS+1)); else T_FAIL=$((T_FAIL+1)); echo "FAIL: $2"; fi
}
# (1) patch §2: the re-check on the actual diff re-reads the ledger overlap, not only touch_check.
_r=1; grep -Fq 're-read the ledger lines overlapping the changed paths' "$_PS" && _r=0
_pin "$_r" "patch/SKILL.md §2's final-diff re-check does not re-read the ledger overlap - a ledger line on a path the fix touched unexpectedly goes undispositioned"
# (2) spine-close: merge-bar's fields are loaded per hosting repo INSIDE the landing loop,
#     so each repo's PR carries only its own Known limits.
_lo="$(awk '/^while IFS= read -r repo; do/{print NR; exit}' "$_SC")"
_ld="$(awk -v s="${_lo:-0}" 'NR>s && /^done <<EOF/{print NR; exit}' "$_SC")"
_lf="$(awk '/pr_fields="\$\(cat "\$pr_fields_dir\/\$repo"\)"/{print NR; exit}' "$_SC")"
_r=1; if [ -n "$_lo" ] && [ -n "$_ld" ] && [ -n "$_lf" ] && [ "$_lo" -lt "$_lf" ] && [ "$_lf" -lt "$_ld" ]; then _r=0; fi
_pin "$_r" "spine-close.md does not load \$pr_fields per repo inside the landing loop (loop ${_lo:-none}-${_ld:-none}, load ${_lf:-none}) - every hosting PR carries the spine-wide Known limits"
_r=0; grep -Fq 'one text for every' "$_SC" && _r=1
_pin "$_r" "spine-close.md still composes one \$pr_fields text for every hosting repo"
# (3) release-close: patch discovery fetches tags before listing them.
_ft="$(awk '/fetch --tags/{print NR; exit}' "$_RC")"
_fe="$(awk '/for-each-ref --sort=creatordate/{print NR; exit}' "$_RC")"
_r=1; if [ -n "$_ft" ] && [ -n "$_fe" ] && [ "$_ft" -lt "$_fe" ]; then _r=0; fi
_pin "$_r" "release-close.md lists patch tags without fetching them first (fetch ${_ft:-none}, list ${_fe:-none}) - a tag pushed from another clone is missed"
# (4) release-close: patch discovery reads every declared non-AI repo, not only the landed ones.
_r=1; grep -Fq 'every non-AI repo the resolved topology declares' "$_RC" && ! grep -Fq 'For each repo this release landed in' "$_RC" && _r=0
_pin "$_r" "release-close.md's patch discovery covers only the repos the release landed in - a patch in a declared repo no spine touched is missed"
# (5) intake-and-ledger §1: only a SPINE id assigns a request; a release-level pull-in
#     is re-dispositioned to the spine and recorded in SPINE.md when the spine takes it.
_r=1; grep -Fq 'pulled in — <spine id>` disposition is already assigned' "$_IL" && grep -Fq 're-disposition it' "$_IL" && _r=0
_pin "$_r" "intake-and-ledger.md §1 treats a release-level 'pulled in' as assigned - no SPINE.md records the request and spine close never closes it"
# (6) patch §4: origin must be a GitHub repository, checked before anything is cut.
_gh="$(awk '/remote get-url origin/{print NR; exit}' "$_PS")"
_wa="$(awk '/worktree add -b/{print NR; exit}' "$_PS")"
_r=1; if [ -n "$_gh" ] && [ -n "$_wa" ] && [ "$_gh" -lt "$_wa" ]; then _r=0; fi
_pin "$_r" "patch/SKILL.md §4 does not require a GitHub origin before the cut (check ${_gh:-none}, cut ${_wa:-none}) - a non-GitHub origin fails only at the PR step, after the commit"

# #619 round 1 - three review findings, each pinned red before its fix.
# (1b) release-close: patch discovery skips a filesystem-only root (no git, so no patch).
_r=1; grep -Fq 'skip a root that is not a git repository' "$_RC" && _r=0
_pin "$_r" "release-close.md's patch discovery runs git/gh against filesystem-only roots - release close fails on a supported topology"
# (1c) patch §2: the final-diff path list keeps a rename's old path.
_r=1; grep -Fq 'git diff --no-renames --name-only' "$_PS" && _r=0
_pin "$_r" "patch/SKILL.md §2's final-diff list drops a renamed file's old path - its ledger line goes undispositioned"
# (6b) patch §4: every origin push URL is checked, not only the fetch URL.
_r=1; grep -Fq 'remote get-url --push --all origin' "$_PS" && _r=0
_pin "$_r" "patch/SKILL.md §4 checks only origin's fetch URL - a non-GitHub pushurl passes"

# #619 round 2 - two review findings, each pinned red before its fix.
# (6c) patch §4: push and fetch URLs are compared host-and-all (gh's `url`), not by owner/repo.
_r=1; grep -Fq -- '--json url' "$_PS" && ! grep -Fq -- '--json nameWithOwner' "$_PS" && _r=0
_pin "$_r" "patch/SKILL.md §4 compares origin URLs by nameWithOwner - two GitHub hosts with one owner/repo pass"
# (3b) release-close: patch tags are fetched from origin, the remote /ossify:patch pushes to.
_r=1; grep -Fq 'fetch --tags origin' "$_RC" && ! grep -Fq 'fetch --tags <remote>' "$_RC" && _r=0
_pin "$_r" "release-close.md fetches patch tags from an unnamed <remote> - a multi-remote repo can miss what /ossify:patch pushed to origin"

# #619 round 3 (operator-approved) - two findings this PR introduced.
# (2b) spine-close: a repo-agnostic limit goes on a repo that OPENS a PR - a local-arm repo has none.
_r=1; grep -Fq 'first hosting repo that opens a PR' "$_SC" && _r=0
_pin "$_r" "spine-close.md routes repo-agnostic Known limits to the first hosting repo, which may take the local arm and open no PR - the limit never reaches the ledger"
# (4b) release-close: skip the PR lookup where origin is not a GitHub repository.
_r=1; grep -Fq 'skip the `gh pr list` call where `gh repo view` cannot resolve `origin`' "$_RC" && _r=0
_pin "$_r" "release-close.md runs gh pr list against a non-GitHub origin in a declared repo - patch discovery fails on a supported topology"


# 1.13.2 (#628 items 1-2, #579, #552, #296, #397, #342) - one pin per defect, each red on 1.13.1's text.
_OSSR="$HERE/.."
# (#628.1) spine-close: a resumed PR's Known limits are reconciled with this repo's fields file.
_r=1; grep -Fq "reconcile the resumed PR's Known limits" "$_SC" && _r=0
_pin "$_r" "spine-close.md's resume arm never reconciles a resumed PR's body with this repo's fields - a PR opened under 1.13.0 keeps the spine-wide Known limits"
# (#628.2) patch §5: the changed-path re-check repeats after each review-fix round.
_r=1; grep -Fq "re-run §2's changed-path re-check after each review-fix round" "$_PS" && _r=0
_pin "$_r" "patch/SKILL.md does not repeat §2's changed-path re-check after review-fix rounds - a ledger line on a path a fix round touched reaches merge undispositioned"
# (#552) external-executor §4 no longer claims close fingerprints the four oids.
_r=0; grep -Fq 'same four components' "$_OSSR/skills/work-item/references/external-executor.md" && _r=1
_pin "$_r" "external-executor.md still claims work-item-close.md §2 fingerprints the four *_oid components - it computes none"
# (#296) adopt: six gates (A0-A5), never "five", in every place that counts them.
_r=0
for _f in "$_OSSR/skills/adopt/SKILL.md" "$_OSSR/commands/adopt.md" "$_OSSR/../.claude-plugin/marketplace.json"; do
  tr '\n' ' ' < "$_f" | grep -Eq 'five +(fail-closed|pre-flight) +gates|all five pass' && { _r=1; echo "  (#296 site: $(basename "$_f"))"; }
done
_pin "$_r" "adopt is still described with five gates where §3 defines six (A0-A5) - A0's OSS_STATE_FILE guard reads as preamble"
# (#397) doctor: the fix-finding route names the ONE write surface §1 defines.
_r=0; grep -Fq 'two explicit-write surfaces' "$_OSSR/skills/doctor/SKILL.md" && _r=1
_pin "$_r" "doctor/SKILL.md's fix-finding route excepts 'two explicit-write surfaces' - §1 defines exactly one"
# (#342) start §11 authors the lean MASTER-SPEC before auditing it.
_r=1; grep -Fq 'author the lean MASTER-SPEC here' "$_OSSR/skills/start/SKILL.md" && _r=0
_pin "$_r" "start/SKILL.md §11 audits a lean MASTER-SPEC that no step before it authors - §13 only lists it as an output"
# (#579.1) the active-clause refusal cites the doc that carries its closed-spine caveat...
_al="$(grep -F "is active - its round is declared in flight" "$_OSSR/lib/entities.sh")"
_r=1; case "$_al" in *"(close/references/work-item-close.md §1)"*) _r=0;; esac
_pin "$_r" "entities.sh's active-clause refusal cites a doc that does not carry its closed-spine caveat"
# ...and decomposition.md §1 carries the caveat beside the reversal it qualifies.
_r=1; grep -Fq 'only while its spine is still open' "$_OSSR/skills/plan-spine/references/decomposition.md" && _r=0
_pin "$_r" "decomposition.md §1 states the planned-reversal route without the closed-spine caveat"
# (#579.2) the 1.11.0 notes point at the predicate 1.12.0 replaced it with.
_r=1; grep -Fq '1.12.0 replaces this predicate' "$_OSSR/README.md" && _r=0
_pin "$_r" "ossify/README.md's 1.11.0 section still teaches the branch-or-worktree predicate as current"
# (#579.3) both READMEs name the dropped refusal so it cannot be read as the shipped complete clause.
_r=0
for _f in "$_OSSR/README.md" "$_OSSR/../README.md"; do
  grep -Fq 'landed-provenance refusal' "$_f" || { _r=1; echo "  (#579.3 site: $_f)"; }
  grep -Fq 'the landed-item refusal' "$_f" && { _r=1; echo "  (#579.3 old name still in: $_f)"; }
done
_pin "$_r" "the 1.12.0 notes name the dropped refusal and the shipped complete clause identically - they assert and deny the same transition"
# (#579.4) the guard-set comment names both guards that ship.
_r=0; grep -Fq 'One guard ships' "$_OSSR/lib/entities.sh" && _r=1
_pin "$_r" "entities.sh's rail header says one guard ships while the file defines two"

# #633 round 1 - two Codex classes, each pinned red before its fix.
# (A) start §11 authors all seven sections before the audit - section 7 applies §12's floors.
_r=1; grep -Fq "section 7 applies §12's floors" "$_OSSR/skills/start/SKILL.md" && _r=0
_pin "$_r" "start/SKILL.md §11 authors the spec from §4-§10 only - the audit reads it without section 7"
# (B) spine-close reconciliation covers a MERGED resumed PR and repo-agnostic limits.
#     Narrowed at #633 round 3 (operator): no instruction deletes ledger lines - a line
#     names its PR but not its repo, so a deletion can remove another repo's limit.
_r=1; grep -Fq 'On a MERGED resumed PR' "$_SC" && grep -Fq 'a repo-agnostic limit stays only on the first hosting repo' "$_SC" && grep -Fq 'does not repair those lines' "$_SC" && ! grep -Fq 'Remove each one that belongs to another repo' "$_SC" && _r=0
_pin "$_r" "spine-close.md's reconciliation skips a MERGED resumed PR, leaves repo-agnostic limits on every PR, or deletes ledger lines it cannot attribute to a repo"

# #633 round 2 - one Codex class, pinned red before its fix.
# (C) the reconciliation edits only the Known limits section, on open AND merged PRs.
_r=1; grep -Fq "Edit only the body's \`## Known limits\` section" "$_SC" && ! grep -Fq 'past editing' "$_SC" && _r=0
_pin "$_r" "spine-close.md's reconciliation rewrites every field after pushed-tip (discarding review edits) or calls a merged body uneditable"


# 1.13.3 (#265, #266) - one pin per defect, each red on 1.13.2's text. The
# behaviour itself is judged by the start-occupied-destination eval surface;
# these pins hold only the wiring a model would need to find it.
_SS="$_OSSR/skills/start/SKILL.md"
# (#265a) start §2's re-authoring guard fires on a MASTER-SPEC of any schema.
_r=1; grep -Fq 'A MASTER-SPEC of any schema, lean or legacy, already exists at the routing' "$_SS" && ! grep -Fq 'A lean MASTER-SPEC already exists at the routing destination' "$_SS" && _r=0
_pin "$_r" "start/SKILL.md §2's re-authoring guard is keyed on a lean MASTER-SPEC - a legacy spec walks past it into the writes"
# (#265b) start §3 settles occupied destinations before init, and §13 honours them.
_r=1; grep -Fq 'settle every occupied destination' "$_SS" && grep -Fq 'honour the per-file answers §3 collected' "$_SS" && [ -f "$_OSSR/skills/start/references/occupied-destinations.md" ] && _r=0
_pin "$_r" "start/SKILL.md has no occupied-destination rule before its first write - an existing MASTER-SPEC, CLAUDE.md or LIVE memory-bank file is overwritten"
# (#265c) the rule asks per file and never moves, merges or migrates on its own.
_OD="$_OSSR/skills/start/references/occupied-destinations.md"
_r=1; [ -f "$_OD" ] && grep -Fq 'oss repo_root ai_workspace' "$_OD" && grep -Fq 'no default, no automatic move, merge or migration' "$_OD" && grep -Fq 'Not offered for the MASTER-SPEC' "$_OD" && grep -Fq 'Never write a file whose path was' "$_OD" && _r=0
_pin "$_r" "occupied-destinations.md does not resolve the AI workspace or allows an answer the operator did not give"
# (#266) doctor's and close's fail: state remedy names the ceremonies that own init.
_r=0
for _f in "$_OSSR/skills/doctor/references/state-inspection.md" "$_OSSR/skills/close/SKILL.md"; do
  grep -Fq '`"$oss_bin" init <name>`' "$_f" && { _r=1; echo "  (#266 site: $(basename "$_f"))"; }
  grep -F '| `fail: state` |' "$_f" | grep -Fq '/ossify:start' || { _r=1; echo "  (#266 no /ossify:start in: $(basename "$_f"))"; }
  grep -F '| `fail: state` |' "$_f" | grep -Fq 'on Devin run `adopt` on Claude Code or Codex' || { _r=1; echo "  (#636 no non-Claude route in: $(basename "$_f"))"; }
done
_pin "$_r" "the fail: state remedy names a bare init - following it leaves state that /start and /adopt both refuse"

# --- 1.13.4 (#154, #561, #301, #299) -----------------------------------------
# One pin per prose rule the four fixes ship. The behavioural half of each is
# held by phases (d)-(f) above, which extract and EXECUTE the blocks; these hold
# the words a model has to find to act at all. Each is red on 1.13.3's text.
_SV4="$_OSSR/skills/doctor/references/spec-validation.md"
_SI4="$_OSSR/skills/doctor/references/state-inspection.md"
# (#154) the drift check says SETS, and refuses an unreadable half out loud.
_r=1; grep -Fq 'Compare identifier *sets*, never their counts' "$_SV4" && grep -Fq 'an unreadable half is not an empty one' "$_SV4" && ! grep -Fq 'Compare against the row count of section 4' "$_SV4" && _r=0
_pin "$_r" "spec-validation §3 still compares counts (or lost its refusal arm) - a mismatch with equal counts in both directions reads clean"
# (#561) the re-point remedy takes its verb from the roster's KIND, and §5 names
# the state-versus-manifest gate its block now applies.
_r=1; grep -Fq "chosen from the surface's own" "$_SI4" && grep -Fq 'never guessed from the id' "$_SI4" && grep -Fq "The sweep is about THIS directory's state" "$_SI4" && _r=0
_pin "$_r" "state-inspection §5 offers both re-point verbs for an unmatched surface, or does not document the state-versus-manifest gate"
# (#301) the ADR file joins the series it finds; the default is only for an EMPTY
# directory; the trailer admits adoption as a third source with adopt's baseline.
_AD4="$_OSSR/skills/start/references/bones-registry.md"
_r=1; grep -Fq 'joins the target repo' "$_AD4" && grep -Fq 'When that directory is **empty**' "$_AD4" && grep -Fq 'Never add the prefix to, or' "$_AD4" && _r=0
_pin "$_r" "bones-registry §3 prescribes one filename form regardless of the repo's series - the rule contradicts the reason bone ADRs live in that repo"
_HR4="$_OSSR/skills/close/references/harvest.md"
_r=1; grep -Fq 'source: report|handoff|adoption' "$_HR4" && grep -Fq 'a source that is exactly `report`, `handoff` or' "$_HR4" && grep -Fq 'r0 baseline <sha>' "$_HR4" && _r=0
_pin "$_r" "harvest's trailer grammar admits only report|handoff - an adopted series cannot be recorded honestly"
_r=1; grep -Fq '`source: adoption`' "$_OSSR/skills/adopt/SKILL.md" && grep -Fq 'r0 baseline <sha>' "$_OSSR/skills/adopt/SKILL.md" && _r=0
_pin "$_r" "adopt C5 routes to harvest's provenance trailer without naming its source - the actor's own site never says what to write"
# (#299) the private boundary inventory has ONE address, stated where the actor
# writes it, and the two sites that claimed a state index now say the truth.
_PB4="$_OSSR/skills/start/references/posture-block.md"
_r=1; grep -Fq '`<ai-workspace>/docs/private-boundary-inventory.md`' "$_PB4" && grep -Fq 'convention, not a route' "$_PB4" && ! grep -Fq 'indexed from `project-state.json`' "$_PB4" && _r=0
_pin "$_r" "posture-block §7 leaves the private boundary inventory unnamed (or still claims a project-state index that does not exist) - every adopter names it differently"
_r=1; ! grep -Fq 'indexed from' "$_OSSR/skills/close/references/boundary-audit.md" && grep -Fq 'docs/private-boundary-inventory.md' "$_OSSR/skills/close/references/boundary-audit.md" && grep -Fq "if it cannot be located, this step is" "$_OSSR/skills/close/references/boundary-audit.md" && _r=0
_pin "$_r" "boundary-audit still names a state index for the inventory, drops its convention path, or loses the INCONCLUSIVE arm for an adopted file"
# (#299) "root" is a PATH, not a repo key - the clause the Rust-workspace case
# needs - and the critic's non-interactive default RECORDS that nobody answered.
_r=1; grep -Fq 'The value is a PATH, not a repo key' "$_PB4" && grep -Fq 'the crate/workspace directory *inside*' "$_PB4" && _r=0
_pin "$_r" "posture-block §10 leaves 'composition root' meaning both the repo and the crate inside it"
_r=1; grep -Fq 'proceed and record that no operator' "$_OSSR/skills/start/SKILL.md" && grep -Fq 'recording that no operator' "$_OSSR/skills/start/references/critic-moment.md" && _r=0
_pin "$_r" "the critic moment's non-interactive default proceeds without recording that no operator answered"
# (#299) the inventory is a CHECKED destination now, not an output nobody can
# find - occupied-destinations lists it with its path like every other output.
_r=1; grep -Fq 'private boundary inventory at' "$_OSSR/skills/start/references/occupied-destinations.md" && grep -Fq '<ai-workspace>/docs/private-boundary-inventory.md' "$_OSSR/skills/start/references/occupied-destinations.md" && _r=0
_pin "$_r" "occupied-destinations leaves the private inventory among the outputs no route names - /start cannot check a file it cannot address"

# --- 1.13.4 round 1 (#561 R1/R8/R14/R15): one state-path name per surface -----
# §5 consumes §2's resolved `$sf` (never a second spelling of the precedence, and
# exactly ONE resolver call for the routed half); §3 keeps its own differently
# named `sv_state` so a composed read-out cannot reassign either; and the gate's
# rationale has one owner - the §5 prose - with the block comment pointing at it
# instead of arguing a third time.
_r=1; [ "$(grep -v '^[[:space:]]*#' "$_SW" | grep -c 'state_path')" = 1 ] && ! grep -Fq 'sf="${OSS_STATE_FILE:-}"' "$_SW" && grep -Fq 'consumed, never re-derived' "$_SW" && _r=0
_pin "$_r" "state-inspection §5 re-derives the state path (a second precedence spelling, or more than one state_path call) instead of consuming §2's \$sf"
_r=1; grep -Fq 'sv_state' "$_SV4" && grep -Fq 'not `sf`' "$_SV4" && grep -Fq 'sv_state' "$_SI4" && _r=0
_pin "$_r" "spec-validation §3 names its manifest-routed state \$sf - the same name state-inspection §2 uses for the override-first path, so one surface can reassign the other's state"
_r=1; grep -Fq 'owned by the prose under this fence' "$_SW" && [ "$(grep -c 'as written' "$_SI4")" = 1 ] && _r=0
_pin "$_r" "state-inspection's foreign-gate rationale is argued in more than one place (or the block comment no longer points at its owner) - three independently-worded copies drift"
# The gate must not read an empty routed answer as consent: an unresolvable route
# refuses, and that arm must be reachable (the `-n "$routed"` precondition that
# bypassed it is gone).
_r=1; grep -Fq '[ -z "${sf:-}" ] || [ -z "$routed" ] || [ "$sf" != "$routed" ]' "$_SW" && ! grep -Fq 'elif [ -n "$routed" ] &&' "$_SW" && _r=0
_pin "$_r" "state-inspection §5 bypasses the foreign-state gate when the manifest route resolves to nothing (F1) - a foreign registry is swept against this directory's repos"

rm -rf "$_PC_TMP"
t_summary
