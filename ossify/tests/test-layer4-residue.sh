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
# same counting discipline as test-external-executor-contract.sh. And index()
# is exactly why every needle is anchored to THIS mechanism's shape - a path,
# an env var, a schema field, a print string, a backticked tool name or a
# hyphenated compound - and why no bare English word is a needle: a substring
# cannot tell "the `.github/workflows/tests.yml` pointer" or a sentence-initial
# "Workflow" or "the release workflows" from the deleted engine, and a gate
# that flags legitimate prose trains its reader to dismiss the red. What a
# substring cannot say is carried structurally instead: the directory is gone,
# and no `allowed-tools:` line grants the tool. §4's false-positive control
# proves the needle set is clean on legitimate prose as a class, not only on
# today's tree.
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
# 1. Structural residue: the directory and the dedicated suite are gone, and
#    no allowed-tools grant names the tool. The grant check is structural
#    because the substring test cannot be: the frontmatter key is anchored at
#    column 0, and "Workflow" on that line is a grant, never prose.
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
ossify/workflows
test-workflows
`Workflow`
layer 4: workflow
workflow unavailable
(6 agents
six-agent
NEEDLES

NEEDLES_OUTER="$TMPDIR_WORK/needles-outer"
cat > "$NEEDLES_OUTER" <<'NEEDLES'
verify-work-item
OSSIFY_NO_WORKFLOWS
fidelity_truncated
agents_run
layer 4: workflow
(6 agents
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

# The tool grant, structurally: a column-0 `allowed-tools:` line containing
# "Workflow" is the mechanism being re-granted. Same-line only - the shipped
# grants are single-line, and a hypothetical wrapped form is covered by the
# backticked needle the moment prose names the tool.
grant_hits="$(awk '/^allowed-tools:/ && index($0, "Workflow") { print FILENAME ":" FNR }' $(cat "$FLIST"))"
if [ -z "$grant_hits" ]; then T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1))
  echo "FAIL: an allowed-tools grant re-admits the Workflow tool:"
  printf '      %s\n' $grant_hits
fi

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
# subset only (see the header for why path-form and tool-name needles are not
# scanned here: README's own structure carries `.github/workflows` references
# for CI that have nothing to do with this mechanism).
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

# ---------------------------------------------------------------------------
# 4. The false-positive control: the same needle set over legitimate prose must
#    hit NOTHING. Without this, only today's tree is proven clean - not the
#    rule, and the next "`.github/workflows`" pointer or sentence-initial
#    "Workflow" silently re-opens the class this gate just closed.
# ---------------------------------------------------------------------------
LEGIT="$TMPDIR_WORK/legitimate-prose.md"
cat > "$LEGIT" <<'EOF'
The CI workflow list lives at `.github/workflows/tests.yml`; consult it before
changing a gate. Workflow ordering matters in that file, and the release
workflows run serially. A critic that refutes a claim has refuted it; the
reviewer is the claim's refuter, and six agents of chaos are not a mechanism.
EOF

legit_hits="$(while IFS= read -r needle; do
  [ -n "$needle" ] || continue
  awk -v needle="$needle" 'index($0, needle) { print FILENAME ":" FNR ": " needle }' "$LEGIT"
done < "$NEEDLES_INNER")"
if [ -z "$legit_hits" ]; then T_PASS=$((T_PASS+1))
else
  T_FAIL=$((T_FAIL+1))
  echo "FAIL: a needle matches legitimate prose - the needle is wrong, not the prose:"
  printf '      %s\n' $legit_hits
fi

t_summary
