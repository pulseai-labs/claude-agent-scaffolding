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
PROBE="$(awk '/^```bash$/{n++} n==1 && !/^```/{print} /^```$/{if(n==1) exit}' "$OSSSK/skills/start/SKILL.md")"
if printf '%s' "$PROBE" | grep -q 'oss state_path'; then
  T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1)); echo "FAIL: start/SKILL.md's first bash block is not the topology probe - the exit check below is vacuous"
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

t_summary
