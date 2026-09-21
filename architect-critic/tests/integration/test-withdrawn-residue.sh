#!/usr/bin/env bash
# test-withdrawn-residue.sh — withdrawal residue guard for architect-critic 0.7.0.
#
# Asserts that no shipped architect-critic file (plus the two repo-root
# surfaces that describe the plugin) still references the withdrawn machinery:
# the auto-promotion vote/instinct/suppression engine, the deterministic
# consolidator, the plugin-data principles readers/seeders, and the dead state
# writers that served only them.
#
# Scope is a property, not content: shipped dirs only — tests/ and CHANGELOG.md
# legitimately keep naming deleted verbs (fixtures carry legacy state fields;
# history records what shipped). The false-positive discipline is pinned by
# three fixture trees built in a temp dir, not by weaker needles.

set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/.." && pwd)"
TESTS_PASSED=0
TESTS_FAILED=0

assert_pass() {
  local desc="$1"
  echo "  PASS: $desc"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

assert_fail() {
  local desc="$1"
  echo "  FAIL: $desc"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

# ---------------------------------------------------------------------------
# Needles — every one must be absent from in-scope files.
# Fixed needles use grep -F; regex needles use grep -iE (case-insensitive).
# Kept-surface identifiers that must NOT match: promoting-principle,
# /promote-principle, principle_promotions, state_append_promotion,
# promoted_at, consolidate, instinct (bare English word).
# ---------------------------------------------------------------------------

FIXED_NEEDLES=(
  'promotion.sh'                 # lib file references / sourcing
  'promotion_'                   # every promotion_* verb (add_vote, check_candidates, apply_suppression, promote, ...)
  'consolidator'                 # consolidator.sh, consolidator_merge, "the consolidator" prose
  'instinct_'                    # instinct_signal, instinct_observations
  'principles_merge'
  'principles_load_user_global'
  'principles_seed'              # ac_principles_seed + ac_principles_seed_minimal
  'seed_minimal'
  'principles_compose'
  'principles_parse_meta'
  'principles_filter_by_source'
  'load_master_spec_phases'
  'load_memory_bank'
  'ac_principles_path'           # the plugin-data resolver; NOT a substring of the three kept resolvers
  'state_append_declined'
  'state_add_suppression'
  'state_read'                   # ac_state_read and any arc state_read verb
  'candidate_promotions'
  'declined_candidates'
  'auto_promote_suppressions'
)

REGEX_NEEDLES=(
  'auto[-_ ]promot'              # auto-promotion / auto_promote_* / "auto promote" claims
  'instinct[[:space:]-]*(signal|style|n=)'   # "instinct signal", "instinct-style", "instinct N=3"
)

# ---------------------------------------------------------------------------
# scan_scope <plugin_dir> <repo_root> — prints one "relpath: needle" line per
# hit on stdout; returns 0 always (caller counts the lines).
# In-scope: the plugin's shipped dirs (recursive) + plugin README.md, plus the
# repo-root .claude-plugin/marketplace.json and README.md surfaces.
# Out of scope by construction: tests/, CHANGELOG.md, .git/, everything else.
# ---------------------------------------------------------------------------
scan_scope() {
  local pdir="$1" rroot="$2"
  local dirs=(lib bin skills commands hooks-handlers templates rules hooks .claude-plugin .codex-plugin .devin-plugin)
  local files=()
  local d
  for d in "${dirs[@]}"; do
    if [[ -d "$pdir/$d" ]]; then
      while IFS= read -r f; do files+=("$f"); done < <(find "$pdir/$d" -type f 2>/dev/null)
    fi
  done
  [[ -f "$pdir/README.md" ]] && files+=("$pdir/README.md")
  [[ -f "$rroot/.claude-plugin/marketplace.json" ]] && files+=("$rroot/.claude-plugin/marketplace.json")
  [[ -f "$rroot/README.md" ]] && files+=("$rroot/README.md")

  local f needle
  for f in "${files[@]}"; do
    for needle in "${FIXED_NEEDLES[@]}"; do
      if grep -qF "$needle" "$f" 2>/dev/null; then
        grep -nF "$needle" "$f" | while IFS= read -r line; do
          printf '%s:%s [needle: %s]\n' "${f#$rroot/}" "${line%%:*}" "$needle"
        done
      fi
    done
    for needle in "${REGEX_NEEDLES[@]}"; do
      if grep -qiE "$needle" "$f" 2>/dev/null; then
        grep -niE "$needle" "$f" | while IFS= read -r line; do
          printf '%s:%s [needle: %s]\n' "${f#$rroot/}" "${line%%:*}" "$needle"
        done
      fi
    done
  done
}

# ---------------------------------------------------------------------------
# Fixture trees — pin the false-positive discipline (the S6 lesson: scope is
# not content). Three trees under one temp root:
#   (i)   legit prose in an in-scope file               → scan must report 0
#   (ii)  a deleted verb inside CHANGELOG.md + tests/   → scan must report 0
#   (iii) the same verb in an in-scope skills/ file     → scan must report >0
# ---------------------------------------------------------------------------
test_fixture_scope_discipline() {
  echo "Fixture trees — scope discipline"
  local tmp legit_hit deleted_verb
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ac-residue-fixtures.XXXXXX")"
  legit_hit=0
  deleted_verb='arc_bin" promotion_add_vote ch-1'

  # (i) legitimate prose only — every false-positive class the plan named.
  mkdir -p "$tmp/t1/architect-critic/skills/x" "$tmp/t1/.claude-plugin"
  cat > "$tmp/t1/architect-critic/skills/x/SKILL.md" <<'EOF'
The promoting-principle skill backs /promote-principle. It records into
principle_promotions[] via state_append_promotion, stamps promoted_at, and
consolidate is still the English word for the reviewer's dedup judgment.
Trust your instinct on whether the spec is complete.
EOF
  cat > "$tmp/t1/architect-critic/README.md" <<'EOF'
Manual promotion via /promote-principle. Consolidate means judgment.
EOF
  printf '{}\n' > "$tmp/t1/.claude-plugin/marketplace.json"
  printf 'nothing here\n' > "$tmp/t1/README.md"

  local hits
  hits="$(scan_scope "$tmp/t1/architect-critic" "$tmp/t1")"
  if [[ -z "$hits" ]]; then
    assert_pass "fixture (i): legitimate prose (promoting-principle, principle_promotions, state_append_promotion, consolidate, instinct) reports zero hits"
  else
    assert_fail "fixture (i): legitimate prose produced hits:"
    printf '%s\n' "$hits"
  fi

  # (ii) the deleted verb inside out-of-scope paths — must not be seen.
  mkdir -p "$tmp/t2/architect-critic/tests" "$tmp/t2/.claude-plugin"
  printf '%s\n' "$deleted_verb" > "$tmp/t2/architect-critic/CHANGELOG.md"
  printf '%s\n' "$deleted_verb" > "$tmp/t2/architect-critic/tests/t.sh"
  printf '{}\n' > "$tmp/t2/.claude-plugin/marketplace.json"
  printf 'nothing here\n' > "$tmp/t2/README.md"

  hits="$(scan_scope "$tmp/t2/architect-critic" "$tmp/t2")"
  if [[ -z "$hits" ]]; then
    assert_pass "fixture (ii): deleted verb inside CHANGELOG.md and tests/ is out of scope (zero hits)"
  else
    assert_fail "fixture (ii): out-of-scope files leaked hits:"
    printf '%s\n' "$hits"
  fi

  # (iii) adjacent control — the same verb in an in-scope file MUST fire.
  mkdir -p "$tmp/t3/architect-critic/skills/x" "$tmp/t3/.claude-plugin"
  printf '%s\n' "$deleted_verb" > "$tmp/t3/architect-critic/skills/x/SKILL.md"
  printf '{}\n' > "$tmp/t3/.claude-plugin/marketplace.json"
  printf 'nothing here\n' > "$tmp/t3/README.md"

  hits="$(scan_scope "$tmp/t3/architect-critic" "$tmp/t3")"
  if [[ -n "$hits" ]] && printf '%s\n' "$hits" | grep -qF 'promotion_'; then
    assert_pass "fixture (iii): planted promotion_add_vote in skills/ is caught (adjacent control)"
  else
    assert_fail "fixture (iii): planted deleted verb in skills/ was NOT caught — scanner is blind"
  fi

  rm -rf "$tmp"
}

# ---------------------------------------------------------------------------
# Real run — the same scanner pointed at the repo.
# ---------------------------------------------------------------------------
test_real_repo_clean() {
  echo "Repo scan — no withdrawn-mechanism residue in shipped files"
  local hits
  hits="$(scan_scope "$PLUGIN_DIR" "$REPO_ROOT")"
  if [[ -z "$hits" ]]; then
    assert_pass "no in-scope shipped file references withdrawn machinery (${#FIXED_NEEDLES[@]} fixed + ${#REGEX_NEEDLES[@]} regex needles, all clean)"
  else
    assert_fail "withdrawn-mechanism residue found:"
    printf '%s\n' "$hits"
  fi
}

test_deleted_lib_files() {
  echo "Deleted library files absent"
  if [[ ! -e "$PLUGIN_DIR/lib/promotion.sh" ]]; then
    assert_pass "lib/promotion.sh deleted"
  else
    assert_fail "lib/promotion.sh still exists"
  fi
  if [[ ! -e "$PLUGIN_DIR/lib/consolidator.sh" ]]; then
    assert_pass "lib/consolidator.sh deleted"
  else
    assert_fail "lib/consolidator.sh still exists"
  fi
}

# ---------------------------------------------------------------------------
# Kept-surface pins (failure mode: deleting something a kept path needs).
# These are GREEN at the base commit and must stay GREEN — they pin the
# contract the withdrawal must NOT break.
# ---------------------------------------------------------------------------
test_kept_verbs_still_listed() {
  echo "Kept dispatcher verbs still advertised"
  local ARC="$PLUGIN_DIR/bin/arc"
  local list kept missing=()
  list="$(bash "$ARC" --list 2>/dev/null || true)"
  for kept in principles_shipped_path principles_user_path principles_project_path \
              state_append_run state_append_promotion \
              state_external_run_list state_external_run_get; do
    if ! printf '%s\n' "$list" | grep -qxF "$kept"; then
      missing+=("$kept")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    assert_pass "arc --list still advertises all 7 kept verbs (3 resolvers + append_run + append_promotion + 2 external-run reads)"
  else
    assert_fail "arc --list dropped kept verbs: ${missing[*]}"
  fi
}

test_deleted_verbs_not_listed() {
  echo "Deleted verbs no longer advertised"
  local ARC="$PLUGIN_DIR/bin/arc"
  local list gone still=()
  list="$(bash "$ARC" --list 2>/dev/null || true)"
  for gone in promotion_fingerprint promotion_add_vote promotion_check_candidates promotion_apply_suppression promotion_promote \
              promotion_instinct_signal consolidator_merge \
              principles_merge principles_load_user_global principles_seed principles_seed_minimal \
              principles_compose principles_parse_meta principles_filter_by_source \
              principles_load_master_spec_phases principles_load_memory_bank_patterns \
              principles_load_memory_bank_governance principles_path \
              state_append_declined state_add_suppression state_read; do
    if printf '%s\n' "$list" | grep -qxF "$gone"; then
      still+=("$gone")
    fi
  done
  if [[ ${#still[@]} -eq 0 ]]; then
    assert_pass "arc --list advertises none of the 21 deleted function suffixes"
  else
    assert_fail "arc --list still advertises deleted verbs: ${still[*]}"
  fi
}

test_step10_contract_labels() {
  echo "Step 10 summary contract — every label verbatim"
  local skill="$PLUGIN_DIR/skills/critiquing-spec/SKILL.md"
  [[ -f "$skill" ]] || { assert_fail "critiquing-spec/SKILL.md missing"; return; }
  local label missing=()
  for label in "Adversaries used" "Challenges" "Concessions" "Auto-applied" "Escalated" "Deferred" "Candidates piled" "Principles" "Elapsed"; do
    if ! grep -qE "^  ${label}[[:space:]]*:" "$skill"; then
      missing+=("$label")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    assert_pass "all nine Step-10 labels present verbatim (incl. Candidates piled)"
  else
    assert_fail "Step-10 labels missing: ${missing[*]}"
  fi
  if grep -qF 'shared-procedure:consolidate-rebuttal-append' "$skill"; then
    assert_pass "shared-procedure:consolidate-rebuttal-append anchor present (async resume entry point)"
  else
    assert_fail "shared-procedure anchor missing — managing-async-critique resume path would dangle"
  fi
}

# --- Run all ---
test_fixture_scope_discipline
test_real_repo_clean
test_deleted_lib_files
test_kept_verbs_still_listed
test_deleted_verbs_not_listed
test_step10_contract_labels

echo ""
echo "Scope: architect-critic/{lib,bin,skills,commands,hooks-handlers,templates,rules,hooks,.claude-plugin,.codex-plugin,.devin-plugin}/ + architect-critic/README.md + <repo>/.claude-plugin/marketplace.json + <repo>/README.md"
echo "Needles checked: ${#FIXED_NEEDLES[@]} fixed-string + ${#REGEX_NEEDLES[@]} case-insensitive regex"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
