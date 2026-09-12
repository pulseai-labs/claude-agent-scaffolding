#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Layer 4 delegated-verification gates (#139).
#
# T1 - static purity over ossify/workflows/*.js: the script is orchestration
#      and must stay that way (skill-first, C1). Parses as JS; no require/
#      import, no fs/process/child_process/exec/spawn, no node: specifiers,
#      no string literal that looks like a path (the script receives every
#      path via args).
# T2 - lens-id parity: the ids declared in impl-check.md §4b and the ids the
#      close passes in args (work-item-close.md §2) are the same set. A lens
#      added to one file and not the other must go RED here.
# T3 - refuter verdict integrity: a refuter returns one verdict per reader
#      finding id, never a finding object, so the SCRIPT (not the refuter)
#      assembles the final content from the reader's own objects - the
#      refuter can correct declared_in_report_s7 per id, but can never
#      fabricate an id, rewrite a claim, or leave coverage incomplete without
#      the whole lens nulling out to the inline fallback (skill-first: this is
#      a safety rail the agent must not argue past, not judgment - code is the
#      right call here, unlike the lens texts). Extracts the exact filter
#      block from verify-work-item.js by anchor comment and executes it in
#      Node against fixtures: a fabricated-id attack, an incomplete-coverage
#      response, and a legitimate declared_in_report_s7 correction.
# T4 - fidelity_truncated propagation (round-15 P1): the fidelity reader's
#      5-finding cap means a real undeclared deviation can be silently
#      dropped unless the reader's own truncated:true survives to the final
#      return. Extracts the final-return assembly block by anchor and
#      executes it against fixture `results` arrays: a truncated fidelity
#      lens must produce fidelity_truncated:true regardless of what the
#      surviving findings say; an untruncated one must produce false.
# T5 - lens-set validation (round-17 finding G2, extended round-18 finding
#      H2): the runtime complement of T2 - T2 checks impl-check.md/
#      work-item-close.md agree on the id set AT REST; T5 checks the script
#      itself refuses to dispatch when the SUPPLIED lenses at execution time
#      are not exactly one each of fidelity/pattern/absence (G2) WITH
#      nonempty text on every one of them (H2) - a close-prose regression or
#      a consumer edit T2 cannot see. Extracts the anchored predicate and
#      executes it against fixture {id,text} arrays: the correct set passes,
#      a duplicate that silently drops fidelity fails, wrong count and wrong
#      members fail, and a correct id set with an empty or whitespace-only
#      text on one lens fails.
#
# Self-test: T1, T2, T3, T4 and T5 each run a second time against a
# planted-defect fixture and must report exactly that defect (testing
# discipline: a green sweep that was never proved to be looking certifies
# nothing).
# ---------------------------------------------------------------------------
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
T_FAIL=0
ck() { if [ "$1" -gt 0 ]; then T_FAIL=$((T_FAIL+1)); fi; }

# --- T1: static purity -----------------------------------------------------
WF="$ROOT/workflows"
[ -d "$WF" ] || { echo "FAIL: no workflows/ directory"; exit 1; }
purify() { # file -> violations on stdout
  local f="$1"
  # NOT `node --check`: workflow scripts run wrapped in an async context the
  # Workflow tool supplies (top-level `return`/`await` are the documented,
  # correct shape - see workflow-authoring's own worked examples). Checking
  # this file as a standalone ESM module (this repo's package.json sets
  # "type": "module") makes top-level `return` a SyntaxError and would reject
  # every legitimate workflow script. Static purity is a grep concern, not a
  # parser concern - T1's own scope (spec T1) never asked for a parse check.
  grep -nE '\brequire[ (]|\bimport\b|\bprocess\.|child_process|\bexec(Sync)?\s*\(|\bspawn(Sync)?\s*\(|\bfs\.|node:' "$f"
  # Absolute (/x), dot-relative (./x, ../x), AND bare relative (docs/spec.md) -
  # a quote immediately followed by word characters then a slash. Anchored to
  # right-after-the-quote so a mid-sentence slash in ordinary prose - e.g. the
  # meta block's own "one Sonnet/medium reader per lens" - does not false-fire;
  # only a slash that could plausibly start a path does.
  grep -nE '["'"'"'](\.{1,2}/|/|[A-Za-z0-9_.-]+/)' "$f"
}
VIOL=""
for f in "$WF"/*.js; do
  [ -e "$f" ] || continue
  # A direct call in THIS shell, never `find -exec sh -c 'purify ...'` — that
  # spawns a subshell with no visibility into a bash function, "command not
  # found" on stderr, and VIOL captures only stdout: a purity checker that
  # silently never runs and reports the file clean regardless of content.
  VIOL="$VIOL$(purify "$f")"
done
[ -z "$VIOL" ] || { echo "FAIL: workflow purity violations:"; echo "$VIOL"; ck 1; }

# --- T2: lens-id parity ----------------------------------------------------
IC="$ROOT/skills/close/references/impl-check.md"
WC="$ROOT/skills/close/references/work-item-close.md"
# NOT `tr -d '`- '`: with the hyphen between two other characters, GNU tr on
# the CI runner parses it as the range `` `-<space> `` (backtick to space) -
# a REVERSED range since backtick's code point is higher - and errors out,
# leaving sec4b empty and this check failing for the wrong reason (caught on
# PR #380's own CI; BSD tr on this machine accepted it silently). A bracket
# expression with the hyphen placed FIRST is unambiguous on both.
sec4b="$(awk '/^## 4b\./{f=1;next} /^## 5\./{f=0} f' "$IC" | grep -oE '^- `[a-z]+`' | sed 's/[-` ]//g' | sort -u)"
wipass="$(awk '/^## 2\. The gate/{f=1;next} /^## 3\./{f=0} f' "$WC" | grep -oE '`[a-z]+`' | tr -d '`' | sort -u | grep -E '^(fidelity|pattern|absence)$')"
EXPECT="$(printf 'absence\nfidelity\npattern')"
[ "$sec4b" = "$EXPECT" ] || { echo "FAIL: impl-check §4b lens ids are: [$sec4b]"; ck 1; }
[ "$wipass" = "$EXPECT" ] || { echo "FAIL: work-item-close.md §2 passes lenses: [$wipass]"; ck 1; }

# --- T3: refuter id-membership integrity ------------------------------------
VWI="$WF/verify-work-item.js"
extract_t3() { # $1=source file -> the anchored filter block's body lines
  sed -n '/T3-ANCHOR-START/,/T3-ANCHOR-END/p' "$1" | grep -v 'T3-ANCHOR'
}
run_t3() { # $1=extracted-body-file $2=found-json $3=verdict-json -> result JSON
  local body="$1" TMP3
  TMP3="$(mktemp -d)"
  {
    echo 'function filterSurvivors(found, verdict) {'
    cat "$body"
    echo '}'
    echo "console.log(JSON.stringify(filterSurvivors($2, $3)))"
  } > "$TMP3/harness.cjs"
  node "$TMP3/harness.cjs"
  local rc=$?
  rm -rf "$TMP3"
  return "$rc"
}
FOUND_JSON='{"findings":[{"id":"f1","lens":"fidelity","claim":"real one","evidence":{"file":"a.py","line":3},"declared_in_report_s7":false},{"id":"f2","lens":"fidelity","claim":"real two","evidence":{"file":"b.py","line":9},"declared_in_report_s7":false}]}'
T3TMP="$(mktemp -d)"
extract_t3 "$VWI" > "$T3TMP/real.txt"
[ -s "$T3TMP/real.txt" ] || { echo "FAIL: T3 anchor extraction found nothing in $VWI - anchors moved or renamed"; ck 1; }

# Scenario A - fabrication + incomplete coverage in one shot: a fabricated
# extra id (not from the reader) AND f2 never gets a verdict at all. Either
# defect alone should null the lens; both together must not cancel out.
ATTACK_VERDICT='{"verdicts":[{"id":"f1","retain":true,"declared_in_report_s7":false},{"id":"FABRICATED_ID_NOT_FROM_READER","retain":true,"declared_in_report_s7":false}]}'
T3_ATTACK="$(run_t3 "$T3TMP/real.txt" "$FOUND_JSON" "$ATTACK_VERDICT")" \
  || { echo "FAIL: T3 harness errored on the fabrication+incomplete-coverage case: $T3_ATTACK"; ck 1; }
[ "$T3_ATTACK" = "null" ] \
  || { echo "FAIL: fabricated id + incomplete coverage should null the lens, got: $T3_ATTACK"; ck 1; }

# Scenario B - legitimate full coverage, one retained with a correction to
# declared_in_report_s7 (reader said false, refuter re-verified true), one
# refuted. The survivor's claim/evidence must come through UNCHANGED from the
# reader; only declared_in_report_s7 may differ.
GOOD_VERDICT='{"verdicts":[{"id":"f1","retain":true,"declared_in_report_s7":true},{"id":"f2","retain":false,"declared_in_report_s7":false}]}'
T3_GOOD="$(run_t3 "$T3TMP/real.txt" "$FOUND_JSON" "$GOOD_VERDICT")" \
  || { echo "FAIL: T3 harness errored on the legitimate-coverage case: $T3_GOOD"; ck 1; }
printf '%s' "$T3_GOOD" | grep -q '"id":"f1"' \
  || { echo "FAIL: the legitimate survivor f1 did not come through: $T3_GOOD"; ck 1; }
printf '%s' "$T3_GOOD" | grep -q '"id":"f2"' \
  && { echo "FAIL: f2 was refuted (retain:false) but appeared in the result: $T3_GOOD"; ck 1; }
printf '%s' "$T3_GOOD" | grep -q '"claim":"real one"' \
  || { echo "FAIL: f1's claim did not come through verbatim from the reader: $T3_GOOD"; ck 1; }
printf '%s' "$T3_GOOD" | grep -q '"declared_in_report_s7":true' \
  || { echo "FAIL: the refuter's declared_in_report_s7 correction (false->true) was not applied: $T3_GOOD"; ck 1; }

# Mutation-verify the harness itself: feed it a BROKEN filter (trusts the
# refuter's verdicts with no id-membership or coverage check, as an unfixed
# script would) and confirm the fabrication+incomplete-coverage attack now
# succeeds - proving run_t3 can tell safe from broken, not just always
# agreeing with whatever it is handed.
printf '%s\n' 'return { findings: (verdict.verdicts || []).filter((v) => v.retain).map((v) => ({ id: v.id, declared_in_report_s7: v.declared_in_report_s7 })) }' \
  > "$T3TMP/broken.txt"
T3_BROKEN="$(run_t3 "$T3TMP/broken.txt" "$FOUND_JSON" "$ATTACK_VERDICT")" \
  || { echo "FAIL: T3 harness errored on the planted-broken filter: $T3_BROKEN"; ck 1; }
printf '%s' "$T3_BROKEN" | grep -q 'FABRICATED_ID_NOT_FROM_READER' \
  || { echo "FAIL: T3's own mutation-check is blind - the broken filter should have let the fabricated id through and did not: $T3_BROKEN"; ck 1; }
rm -rf "$T3TMP"

# --- T4: fidelity_truncated propagation --------------------------------------
extract_t4() { # $1=source file -> the anchored return-assembly block's body lines
  sed -n '/T4-ANCHOR-START/,/T4-ANCHOR-END/p' "$1" | grep -v 'T4-ANCHOR'
}
run_t4() { # $1=extracted-body-file $2=results-json $3=agents-run -> result JSON
  local body="$1" TMP4
  TMP4="$(mktemp -d)"
  {
    echo 'function computeReturn(results, agentsRun) {'
    cat "$body"
    echo '}'
    echo "console.log(JSON.stringify(computeReturn($2, $3)))"
  } > "$TMP4/harness.cjs"
  node "$TMP4/harness.cjs"
  local rc=$?
  rm -rf "$TMP4"
  return "$rc"
}
T4TMP="$(mktemp -d)"
extract_t4 "$VWI" > "$T4TMP/real.txt"
[ -s "$T4TMP/real.txt" ] || { echo "FAIL: T4 anchor extraction found nothing in $VWI - anchors moved or renamed"; ck 1; }

# Scenario A - THE LOAD-BEARING ROUND-15 ASSERTION. The fidelity lens hit its
# cap (truncated:true) even though the two findings it DID keep are both
# declared - exactly the shape that would otherwise pass silently. The final
# return must surface fidelity_truncated:true regardless.
TRUNC_RESULTS='[{"lens":"fidelity","truncated":true,"findings":[{"id":"f1","lens":"fidelity","declared_in_report_s7":true},{"id":"f2","lens":"fidelity","declared_in_report_s7":true}]},{"lens":"pattern","truncated":false,"findings":[]},{"lens":"absence","truncated":false,"findings":[]}]'
T4_TRUNC="$(run_t4 "$T4TMP/real.txt" "$TRUNC_RESULTS" 6)" \
  || { echo "FAIL: T4 harness errored on the truncated-fidelity case: $T4_TRUNC"; ck 1; }
printf '%s' "$T4_TRUNC" | grep -q '"fidelity_truncated":true' \
  || { echo "FAIL: fidelity_truncated did not surface true when the fidelity lens truncated, even with only declared findings surviving: $T4_TRUNC"; ck 1; }

# Scenario B - the ordinary case: no lens truncated, fidelity_truncated must
# be false, not merely falsy/absent (the close's prose checks it explicitly).
CLEAN_RESULTS='[{"lens":"fidelity","truncated":false,"findings":[]},{"lens":"pattern","truncated":false,"findings":[]},{"lens":"absence","truncated":false,"findings":[]}]'
T4_CLEAN="$(run_t4 "$T4TMP/real.txt" "$CLEAN_RESULTS" 6)" \
  || { echo "FAIL: T4 harness errored on the clean case: $T4_CLEAN"; ck 1; }
printf '%s' "$T4_CLEAN" | grep -q '"fidelity_truncated":false' \
  || { echo "FAIL: fidelity_truncated was not false when no lens truncated: $T4_CLEAN"; ck 1; }

# Mutation-verify the harness itself: feed it a planted-broken version that
# never reads `truncated` at all (as an unfixed round-15 script would) and
# confirm the truncated-fidelity case now silently loses the signal - proving
# run_t4 can tell the flag being consumed from it being ignored.
printf '%s\n' 'return { findings: results.flatMap((r) => r.findings), agents_run: agentsRun, fidelity_truncated: false }' \
  > "$T4TMP/broken.txt"
T4_BROKEN="$(run_t4 "$T4TMP/broken.txt" "$TRUNC_RESULTS" 6)" \
  || { echo "FAIL: T4 harness errored on the planted-broken consumer: $T4_BROKEN"; ck 1; }
printf '%s' "$T4_BROKEN" | grep -q '"fidelity_truncated":false' \
  || { echo "FAIL: T4's own mutation-check is blind - the broken consumer should have dropped the truncated signal and did not: $T4_BROKEN"; ck 1; }
rm -rf "$T4TMP"

# --- T5: lens-set validation -------------------------------------------------
extract_t5() { # $1=source file -> the anchored predicate block's body lines
  sed -n '/T5-ANCHOR-START/,/T5-ANCHOR-END/p' "$1" | grep -v 'T5-ANCHOR'
}
run_t5() { # $1=extracted-body-file $2=lenses-json-array ([{id,text}]) -> "true"/"false"
  local body="$1" TMP5
  TMP5="$(mktemp -d)"
  {
    echo 'function isLensSetValid(lenses) {'
    cat "$body"
    echo '}'
    echo "console.log(JSON.stringify(isLensSetValid($2)))"
  } > "$TMP5/harness.cjs"
  node "$TMP5/harness.cjs"
  local rc=$?
  rm -rf "$TMP5"
  return "$rc"
}
T5TMP="$(mktemp -d)"
extract_t5 "$VWI" > "$T5TMP/real.txt"
[ -s "$T5TMP/real.txt" ] || { echo "FAIL: T5 anchor extraction found nothing in $VWI - anchors moved or renamed"; ck 1; }
lset() { # $1 $2 $3 = ids ; wraps each as {id, text:"<id> lens text"} -> JSON array
  printf '[{"id":"%s","text":"%s lens text"},{"id":"%s","text":"%s lens text"},{"id":"%s","text":"%s lens text"}]' \
    "$1" "$1" "$2" "$2" "$3" "$3"
}

# The correct set, any order - order must not matter, only membership.
T5_OK="$(run_t5 "$T5TMP/real.txt" "$(lset pattern fidelity absence)")" \
  || { echo "FAIL: T5 harness errored on the correct lens set: $T5_OK"; ck 1; }
[ "$T5_OK" = "true" ] \
  || { echo "FAIL: the correct lens set (fidelity/pattern/absence, any order) was rejected: $T5_OK"; ck 1; }

# THE LOAD-BEARING ROUND-17 CASE: a duplicate silently drops fidelity. Same
# length as the correct set (3), so a length-only check would miss this.
T5_DUP="$(run_t5 "$T5TMP/real.txt" "$(lset pattern absence absence)")" \
  || { echo "FAIL: T5 harness errored on the duplicate-lens case: $T5_DUP"; ck 1; }
[ "$T5_DUP" = "false" ] \
  || { echo "FAIL: a duplicate lens id silently dropping fidelity should be rejected, got: $T5_DUP"; ck 1; }

# Wrong count (missing entirely) and wrong membership (an id outside the
# known three) must also fail, not just duplicates.
T5_SHORT="$(run_t5 "$T5TMP/real.txt" '[{"id":"fidelity","text":"f"},{"id":"pattern","text":"p"}]')" \
  || { echo "FAIL: T5 harness errored on the too-short case: $T5_SHORT"; ck 1; }
[ "$T5_SHORT" = "false" ] \
  || { echo "FAIL: a two-lens set (missing absence) should be rejected, got: $T5_SHORT"; ck 1; }
T5_WRONG="$(run_t5 "$T5TMP/real.txt" "$(lset fidelity pattern bogus)")" \
  || { echo "FAIL: T5 harness errored on the wrong-member case: $T5_WRONG"; ck 1; }
[ "$T5_WRONG" = "false" ] \
  || { echo "FAIL: a lens set with an unknown id should be rejected, got: $T5_WRONG"; ck 1; }

# THE LOAD-BEARING ROUND-18 CASE (finding H2): the right three ids, but one
# lens's text is empty - the id-set check alone can't see this.
T5_EMPTY="$(run_t5 "$T5TMP/real.txt" '[{"id":"fidelity","text":""},{"id":"pattern","text":"p"},{"id":"absence","text":"a"}]')" \
  || { echo "FAIL: T5 harness errored on the empty-text case: $T5_EMPTY"; ck 1; }
[ "$T5_EMPTY" = "false" ] \
  || { echo "FAIL: an empty lens.text (fidelity) should be rejected, got: $T5_EMPTY"; ck 1; }
# Whitespace-only text is the same gap in a thin disguise.
T5_BLANK="$(run_t5 "$T5TMP/real.txt" '[{"id":"fidelity","text":"   "},{"id":"pattern","text":"p"},{"id":"absence","text":"a"}]')" \
  || { echo "FAIL: T5 harness errored on the whitespace-only-text case: $T5_BLANK"; ck 1; }
[ "$T5_BLANK" = "false" ] \
  || { echo "FAIL: a whitespace-only lens.text (fidelity) should be rejected, got: $T5_BLANK"; ck 1; }

# Mutation-verify the harness itself, TWO planted-broken predicates targeting
# the two gaps this test's own history found:
# (round-17 shape) length-only - lets the duplicate-lens attack through.
printf '%s\n' 'return lenses.length === 3' > "$T5TMP/broken-length.txt"
T5_BROKEN_LEN="$(run_t5 "$T5TMP/broken-length.txt" "$(lset pattern absence absence)")" \
  || { echo "FAIL: T5 harness errored on the length-only planted-broken predicate: $T5_BROKEN_LEN"; ck 1; }
[ "$T5_BROKEN_LEN" = "true" ] \
  || { echo "FAIL: T5's own mutation-check is blind - the length-only predicate should have let the duplicate through and did not: $T5_BROKEN_LEN"; ck 1; }
# (round-18 shape) id-set-only, no text check - lets the empty-text attack
# through even though the ids are exactly right.
printf '%s\n' 'const REQUIRED_LENS_IDS = ["fidelity", "pattern", "absence"]; const lensIds = lenses.map((l) => l.id); return lensIds.length === REQUIRED_LENS_IDS.length && new Set(lensIds).size === REQUIRED_LENS_IDS.length && REQUIRED_LENS_IDS.every((id) => lensIds.includes(id))' \
  > "$T5TMP/broken-ids-only.txt"
T5_BROKEN_TXT="$(run_t5 "$T5TMP/broken-ids-only.txt" '[{"id":"fidelity","text":""},{"id":"pattern","text":"p"},{"id":"absence","text":"a"}]')" \
  || { echo "FAIL: T5 harness errored on the id-only planted-broken predicate: $T5_BROKEN_TXT"; ck 1; }
[ "$T5_BROKEN_TXT" = "true" ] \
  || { echo "FAIL: T5's own mutation-check is blind - the id-only predicate should have let the empty-text case through and did not: $T5_BROKEN_TXT"; ck 1; }
rm -rf "$T5TMP"

# --- self-test: planted defects must be caught -----------------------------
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
printf 'const x = require("fs");\nconst p = "/etc/passwd";\nconst q = "docs/spec.md";\n' > "$TMP/bad.js"
BAD="$(purify "$TMP/bad.js")"
[ -n "$BAD" ] || { echo "FAIL: purity checker missed the planted require/fs/path defects"; ck 1; }
# A here-string, not `printf ... | grep -q`: this file never sets pipefail
# (bash's default is off, and each test runs as a fresh `bash "$t"`), so the
# pipe form is not currently broken here - but grep -q exiting at the first
# match can SIGPIPE the producer, and pipefail would then report the
# pipeline's exit status as the producer's, not grep's. Cheap to avoid outright
# rather than depend on this file never gaining `set -o pipefail`.
grep -q 'docs/spec.md' <<<"$BAD" \
  || { echo "FAIL: purity checker missed the planted BARE-RELATIVE path (docs/spec.md) - the anchored regex may be too narrow again"; ck 1; }

AWK1="$(awk '/^## 4b\./{f=1;next} /^## 5\./{f=0} f' "$IC" | grep -cE '^- `[a-z]+`')"
[ "$AWK1" -ge 3 ] || { echo "FAIL: §4b lens extractor is blind (found $AWK1 ids)"; ck 1; }

[ "$T_FAIL" -eq 0 ] && echo "test-workflows: ALL GREEN" || exit 1
