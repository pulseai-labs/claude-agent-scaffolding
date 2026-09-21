#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Layer 4 delegated-path residue gate (#507).
#
# Layer 4 runs inline on every harness; the delegated engine (the Workflow-tool
# script, its selection conditions, its fingerprint guard, its fallback and its
# print contract) is deleted. This test is the tripwire against a half-deletion:
# any shipped ossify file still naming the mechanism goes RED here, naming the
# file, the line and the needle that hit.
#
# SCOPE, stated plainly:
#   - Scanned: every file under ossify/ EXCEPT this test itself and the eval
#     run records (tests/eval/results/, tests/eval/evidence/) - those are
#     historical judgment records that legitimately name the mechanism that
#     ran, exactly as field verify.md files do. Fixture prose and rubrics are
#     NOT exempt: a scenario or scoring rule describing the deleted path as
#     current behaviour is residue, not history.
#   - Outside ossify/ only the mechanism-UNIQUE needles are scanned, and only
#     over README.md and tests/test-opencode-runtime-adapter.mjs: the root
#     README carries every plugin's row, so a generic word there could fail an
#     ossify test over another plugin's text.
#   - .opencode/lib/translate.js is deliberately not scanned: its directory
#     list names dirs shipped plugins carry, and if a plugin ships such a dir
#     again the entry legitimately returns - not this gate's call.
#
# Needles are LITERAL substrings matched with awk index(), never regex - the
# same counting discipline as test-external-executor-contract.sh. `workflows`
# is a bare word on purpose: it catches `workflows/`, `ossify/workflows` and
# regex-alternative forms alike, and the singular English word "workflow" never
# matches it. A `.github/workflows` mention inside ossify/ would hit it; none
# exists, and one appearing would be pointing at exactly the surface this gate
# watches anyway - re-derive before assuming a hit is legitimate.
#
# POSITIVE PINS ride beside the absences: the deletion must not eat the inline
# path - the handoff.md halt, the verify.md overwrite rule, the three section
# 4b lens ids and the undeclared-fidelity halt all survive, and these pins make
# an over-deletion fail rather than go quiet.
# ---------------------------------------------------------------------------
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
OSSIFY="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$OSSIFY/.." && pwd)"
SELF="$(basename "$0")"
TMPDIR_WORK="$(mktemp -d "${TMPDIR:-/tmp}/l4-residue.XXXXXX")"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

WIC="$OSSIFY/skills/close/references/work-item-close.md"
IMPL="$OSSIFY/skills/close/references/impl-check.md"

# ---------------------------------------------------------------------------
# 0. The inline path survives - absence-only checks pass vacuously on an
#    over-deleted tree, so the keep-half is asserted first.
# ---------------------------------------------------------------------------
for needle in 'no handoff.md' 'overwrites `verify.md`'; do
  if awk -v needle="$needle" 'index($0, needle) { found=1; exit } END { exit !found }' "$WIC"; then T_PASS=$((T_PASS+1))
  else T_FAIL=$((T_FAIL+1)); echo "FAIL: work-item-close.md lost '$needle' - the inline path was deleted, not just the delegated one"; fi
done
for needle in '- `fidelity` —' '- `pattern` —' '- `absence` —' 'declared_in_report_s7: false'; do
  if awk -v needle="$needle" 'index($0, needle) { found=1; exit } END { exit !found }' "$IMPL"; then T_PASS=$((T_PASS+1))
  else T_FAIL=$((T_FAIL+1)); echo "FAIL: impl-check.md lost '$needle' - the lenses or the halt rule were deleted with the mechanism"; fi
done

# ---------------------------------------------------------------------------
# 1. Structural residue: the directory and the dedicated suite are gone.
# ---------------------------------------------------------------------------
[ ! -d "$OSSIFY/workflows" ] && T_PASS=$((T_PASS+1)) \
  || { T_FAIL=$((T_FAIL+1)); echo "FAIL: ossify/workflows/ still exists"; }
[ ! -e "$HERE/test-workflows.sh" ] && T_PASS=$((T_PASS+1)) \
  || { T_FAIL=$((T_FAIL+1)); echo "FAIL: ossify/tests/test-workflows.sh still exists"; }

# ---------------------------------------------------------------------------
# 2. The needle lists. One literal per line so a needle with spaces needs no
#    escaping. INNER applies across the ossify scan scope; OUTER is the
#    mechanism-unique subset allowed on files outside ossify/.
# ---------------------------------------------------------------------------
NEEDLES_INNER="$TMPDIR_WORK/needles-inner"
cat > "$NEEDLES_INNER" <<'NEEDLES'
verify-work-item
OSSIFY_NO_WORKFLOWS
fidelity_truncated
agents_run
pre_fp
post_fp
workflows
refuter
test-workflows
Workflow
layer 4: workflow
workflow unavailable
6 agents
six agents
six-agent
the delegated call
NEEDLES

NEEDLES_OUTER="$TMPDIR_WORK/needles-outer"
cat > "$NEEDLES_OUTER" <<'NEEDLES'
verify-work-item
OSSIFY_NO_WORKFLOWS
fidelity_truncated
agents_run
layer 4: workflow
6 agents
six agents
six-agent
NEEDLES

# The inner file list: all of ossify/ minus the eval run records and this test.
FLIST="$TMPDIR_WORK/filelist"
find "$OSSIFY" -type f \
  -not -path "$OSSIFY/tests/eval/results/*" \
  -not -path "$OSSIFY/tests/eval/evidence/*" \
  -not -name "$SELF" | LC_ALL=C sort > "$FLIST"
nfiles="$(wc -l < "$FLIST" | tr -d ' ')"
if [ "$nfiles" -ge 250 ]; then T_PASS=$((T_PASS+1))
else T_FAIL=$((T_FAIL+1)); echo "FAIL: only $nfiles files enumerated - the residue walk is broken and every zero below is vacuous"; fi

# Dead-walk control: `ossify` must appear somewhere in the enumerated set, or
# the list names the wrong tree entirely.
control="$(awk 'index($0, "ossify") { print FILENAME ":" FNR; exit }' $(cat "$FLIST"))"
if [ -n "$control" ]; then T_PASS=$((T_PASS+1))
else T_FAIL=$((T_FAIL+1)); echo "FAIL: no file under ossify/ contains the string 'ossify' - the scan is dead, not clean"; fi

# ---------------------------------------------------------------------------
# 3. The scan itself. Each needle is one assertion; every hit is printed so the
#    RED names exactly what was found.
# ---------------------------------------------------------------------------
while IFS= read -r needle; do
  [ -n "$needle" ] || continue
  hits="$(awk -v needle="$needle" 'index($0, needle) { print FILENAME ":" FNR }' $(cat "$FLIST"))"
  if [ -z "$hits" ]; then T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1))
    echo "FAIL: delegated-path residue - '$needle' found:"
    printf '      %s\n' $hits
  fi
done < "$NEEDLES_INNER"

# The repo-root files that named the mechanism, under the mechanism-unique
# subset only (see the header for why `Workflow`/`workflows`/`refuter` are not
# scanned here).
for f in "$REPO/README.md" "$REPO/tests/test-opencode-runtime-adapter.mjs"; do
  while IFS= read -r needle; do
    [ -n "$needle" ] || continue
    hits="$(awk -v needle="$needle" 'index($0, needle) { print FILENAME ":" FNR }' "$f")"
    if [ -z "$hits" ]; then T_PASS=$((T_PASS+1))
    else
      T_FAIL=$((T_FAIL+1))
      echo "FAIL: delegated-path residue outside ossify/ - '$needle' in ${f##*/}:"
      printf '      %s\n' $hits
    fi
  done < "$NEEDLES_OUTER"
done

t_summary
