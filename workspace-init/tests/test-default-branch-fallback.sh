#!/usr/bin/env bash
# tests/test-default-branch-fallback.sh — unit tests for the 4-step default
# branch fallback chain in lib/git-init.sh (SPEC §8.4).
#
# Coverage (~11 tests):
#   F1. Step 1 succeeds — origin/HEAD symbolic-ref is set, returns its branch
#   F2. Step 1 fails, step 2 succeeds — symbolic-ref HEAD returns refs/heads/<branch>
#   F3. Steps 1+2 fail (detached HEAD), step 3 attempted; documents why
#       step-3-only-success is infeasible in practice (see test body)
#   F4. All 3 fail → prompt path triggered; piped answer flows through
#   F5. All 3 fail → prompt returns empty → defaults to `main`
#   F6. Custom branch name `develop` survives detection roundtrip
#   I1. Fresh init forces `main` even when global git config says `master`
#   I2. Fresh pair initializes both repos on `main`
#   I3. Idempotent init preserves an existing repo's branch
#   I4. Gitfile-backed existing AI repo remains idempotent and stageable
#   I5. Git 2.27-compatible fallback still initializes fresh repos on main
#   D1. Dispatcher path: origin remote without origin/HEAD falls through (#482)
#   D2. Dispatcher path: origin/HEAD set still wins at step 1
#   D3. Dispatcher path: a non-repo reaches the prompt and defaults to main

source "$(dirname "$0")/_helpers.sh"
source "$WI_LIB_DIR/_helpers.sh"
source "$WI_LIB_DIR/git-init.sh"

# Shared sandbox — direct mktemp (avoids $() trap-loss).
_WI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/wi-defbranch-test.XXXXXX")"
_wi_defbranch_cleanup() {
  if [[ -d "$_WI_TMP" ]]; then
    chmod -R u+w "$_WI_TMP" 2>/dev/null || true
    rm -rf "$_WI_TMP"
  fi
}
trap _wi_defbranch_cleanup EXIT

# Quiet git committer identity for ephemeral test repos.
_GIT_ID=(-c user.email=t@t.test -c user.name=tester)

# Helper: create a fresh repo at $1 with one commit on branch $2.
_make_repo_with_branch() {
  local repo="$1"
  local branch="$2"
  mkdir -p "$repo"
  git -C "$repo" init -q
  # Force HEAD to point at the desired branch BEFORE first commit so that
  # `git symbolic-ref HEAD` returns refs/heads/<branch> regardless of the
  # local init.defaultBranch config.
  git -C "$repo" symbolic-ref HEAD "refs/heads/${branch}"
  git -C "$repo" "${_GIT_ID[@]}" commit --allow-empty -q -m "init"
}

# ---------------------------------------------------------------------------
# F1. Step 1: origin/HEAD symbolic-ref → returns its branch
# ---------------------------------------------------------------------------
test_F1_step1_origin_head_succeeds() {
  local upstream="$_WI_TMP/f1-upstream.git"
  local repo="$_WI_TMP/f1-repo"

  # Create a bare upstream repo with branch `main` (one commit needed so HEAD
  # is a real ref, not unborn).
  local seed="$_WI_TMP/f1-seed"
  _make_repo_with_branch "$seed" "main"
  git clone -q --bare "$seed" "$upstream"

  # Clone the upstream — clone auto-fetches and sets origin/HEAD.
  git clone -q "$upstream" "$repo"

  # Make sure origin/HEAD is set (clone usually does this; fall back to --auto
  # for safety on quirky git versions).
  git -C "$repo" remote set-head origin --auto >/dev/null 2>&1 || true

  local branch
  branch="$(wi_git_detect_default_branch "$repo")"
  assert_eq "main" "$branch" "F1: step 1 origin/HEAD returns main" || return 1
}

# ---------------------------------------------------------------------------
# F2. Step 1 fails (no origin), step 2 succeeds via symbolic-ref HEAD
# ---------------------------------------------------------------------------
test_F2_step2_symbolic_ref_head() {
  local repo="$_WI_TMP/f2-repo"
  _make_repo_with_branch "$repo" "main"

  # No remotes — step 1 should return empty. Step 2 reads HEAD → refs/heads/main.
  local branch
  branch="$(wi_git_detect_default_branch "$repo")"
  assert_eq "main" "$branch" "F2: step 2 returns main from symbolic-ref HEAD" || return 1
}

# ---------------------------------------------------------------------------
# F3. Steps 1+2 fail (detached HEAD) — step 3 also returns empty in this case.
#
# Note: per SPEC §8.4 step 3 is `git branch --show-current`. When HEAD is
# detached, both step 2 (`symbolic-ref HEAD`) and step 3 (`branch
# --show-current`) return empty — so a "step-2-fails-but-step-3-succeeds"
# state is not constructible with standard git porcelain. Step 3 is a
# defensive belt-and-suspenders fallback for edge cases like worktree HEAD
# weirdness. We verify here that the function does NOT crash on detached HEAD
# and that the prompt path takes over (validated separately in F4/F5).
# ---------------------------------------------------------------------------
test_F3_detached_head_falls_through_to_prompt() {
  local repo="$_WI_TMP/f3-repo"
  _make_repo_with_branch "$repo" "main"

  # Detach HEAD by checking out the commit SHA directly.
  local sha
  sha="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" checkout -q --detach "$sha"

  # Sanity: steps 2 and 3 truly return empty in this state.
  local s2 s3
  s2="$(git -C "$repo" symbolic-ref HEAD 2>/dev/null | sed 's@^refs/heads/@@')"
  s3="$(git -C "$repo" branch --show-current 2>/dev/null)"
  [[ -z "$s2" && -z "$s3" ]] || {
    echo "    expected steps 2+3 empty on detached HEAD; s2=$s2 s3=$s3"
    return 1
  }

  # With steps 1-3 empty, the function must fall through to the prompt path.
  # Pipe an explicit branch name and verify it round-trips.
  local branch
  branch="$(echo "release" | wi_git_detect_default_branch "$repo")"
  assert_eq "release" "$branch" "F3: detached HEAD falls through to prompt" || return 1
}

# ---------------------------------------------------------------------------
# F4. All 3 fail → prompt path → piped answer flows through
# ---------------------------------------------------------------------------
test_F4_prompt_accepts_piped_answer() {
  local repo="$_WI_TMP/f4-repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
  # Unborn HEAD on an init.defaultBranch — but we want ALL THREE to fail.
  # Trick: point HEAD at a non-standard ref that has no commits AND no branch.
  # Simplest reliable construct: init then `git update-ref -d HEAD` so that
  # symbolic-ref HEAD also returns empty.
  #
  # Actually: fresh `git init` leaves HEAD as a symbolic ref pointing at
  # refs/heads/<defaultBranch>, so step 2 WILL succeed (returning the
  # configured default branch name even with no commits). To force step 2 to
  # fail too, we delete the HEAD file outright.
  rm -f "$repo/.git/HEAD"
  # Now `git symbolic-ref HEAD` errors and step 2 returns empty.
  # `git branch --show-current` also returns empty (no HEAD).

  local branch
  branch="$(echo "develop" | wi_git_detect_default_branch "$repo")"
  assert_eq "develop" "$branch" "F4: piped answer 'develop' flows through prompt" || return 1
}

# ---------------------------------------------------------------------------
# F5. All 3 fail → prompt with empty input → defaults to `main`
# ---------------------------------------------------------------------------
test_F5_prompt_empty_input_defaults_to_main() {
  local repo="$_WI_TMP/f5-repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
  rm -f "$repo/.git/HEAD"

  local branch
  branch="$(echo "" | wi_git_detect_default_branch "$repo")"
  assert_eq "main" "$branch" "F5: empty prompt input defaults to main" || return 1
}

# ---------------------------------------------------------------------------
# F6. Custom branch name `develop` survives roundtrip via step 2
# ---------------------------------------------------------------------------
test_F6_custom_branch_develop_roundtrip() {
  local repo="$_WI_TMP/f6-repo"
  _make_repo_with_branch "$repo" "develop"

  local branch
  branch="$(wi_git_detect_default_branch "$repo")"
  assert_eq "develop" "$branch" "F6: custom branch develop detected" || return 1
}

# ---------------------------------------------------------------------------
# I1. Fresh init explicitly normalizes the unborn branch to `main`
# ---------------------------------------------------------------------------
test_I1_fresh_init_forces_main_over_global_master() {
  local repo="$_WI_TMP/i1-repo"
  local config="$_WI_TMP/i1-gitconfig"
  mkdir -p "$repo/.workspace"
  git config --file "$config" init.defaultBranch master

  GIT_CONFIG_GLOBAL="$config" GIT_CONFIG_NOSYSTEM=1 \
    wi_git_init "$repo" "$repo" || return 1

  local branch
  branch="$(git -C "$repo" symbolic-ref --short HEAD)"
  assert_eq "main" "$branch" "I1: fresh init ignores configured master" || return 1
  grep -qE "^GIT_INIT[[:space:]]+${repo}$" "$repo/.workspace/init-log" || {
    echo "    I1: fresh init was not recorded in init-log"
    return 1
  }
}

# ---------------------------------------------------------------------------
# I2. Fresh pair normalizes BOTH repositories to `main`
# ---------------------------------------------------------------------------
test_I2_fresh_pair_initializes_both_on_main() {
  local ai="$_WI_TMP/i2-ai"
  local canonical="$_WI_TMP/i2-canonical"
  local config="$_WI_TMP/i2-gitconfig"
  mkdir -p "$ai/.workspace" "$canonical"
  git config --file "$config" init.defaultBranch master

  GIT_CONFIG_GLOBAL="$config" GIT_CONFIG_NOSYSTEM=1 \
    wi_git_init_pair "$ai" "$canonical" || return 1

  assert_eq "main" "$(git -C "$ai" symbolic-ref --short HEAD)" \
    "I2: AI workspace branch is main" || return 1
  assert_eq "main" "$(git -C "$canonical" symbolic-ref --short HEAD)" \
    "I2: canonical branch is main" || return 1
}

# ---------------------------------------------------------------------------
# I3. Idempotent init never renames an existing repository's branch
# ---------------------------------------------------------------------------
test_I3_existing_repo_branch_is_preserved() {
  local repo="$_WI_TMP/i3-repo"
  _make_repo_with_branch "$repo" "develop"

  wi_git_init "$repo" "$repo" >/dev/null 2>&1 || return 1

  assert_eq "develop" "$(git -C "$repo" branch --show-current)" \
    "I3: existing branch remains develop" || return 1
}

# ---------------------------------------------------------------------------
# I4. Gitfile-backed existing repo is skipped without breaking later staging
# ---------------------------------------------------------------------------
test_I4_gitfile_repo_is_preserved_and_stageable() {
  local repo="$_WI_TMP/i4-repo"
  local git_dir="$_WI_TMP/i4-git-dir"
  mkdir -p "$repo/.workspace"
  git init -q --separate-git-dir="$git_dir" "$repo"
  git -C "$repo" symbolic-ref HEAD refs/heads/develop

  wi_git_init "$repo" "$repo" >/dev/null 2>&1 || return 1
  assert_eq "develop" "$(git -C "$repo" symbolic-ref --short HEAD)" \
    "I4: gitfile-backed branch remains develop" || return 1

  printf 'tracked through gitfile\n' > "$repo/example.txt"
  wi_git_stage_ai_workspace "$repo" || return 1
  assert_eq "example.txt" "$(git -C "$repo" diff --cached --name-only -- example.txt)" \
    "I4: gitfile-backed AI workspace stages successfully" || return 1
}

# ---------------------------------------------------------------------------
# I5. Git <=2.27 fallback: no --initial-branch support still yields main
# ---------------------------------------------------------------------------
test_I5_old_git_fallback_initializes_main() {
  local repo="$_WI_TMP/i5-repo"
  local config="$_WI_TMP/i5-gitconfig"
  local shim_dir="$_WI_TMP/i5-bin"
  local real_git
  real_git="$(command -v git)"
  mkdir -p "$repo/.workspace" "$shim_dir"
  git config --file "$config" init.defaultBranch master

  cat > "$shim_dir/git" <<'EOF'
#!/usr/bin/env bash
set -u
for arg in "$@"; do
  if [[ "$arg" == "--initial-branch=main" ]]; then
    exit 129
  fi
done
exec "$WI_TEST_REAL_GIT" "$@"
EOF
  chmod +x "$shim_dir/git"

  WI_TEST_REAL_GIT="$real_git" PATH="$shim_dir:$PATH" \
    GIT_CONFIG_GLOBAL="$config" GIT_CONFIG_NOSYSTEM=1 \
    wi_git_init "$repo" "$repo" || return 1

  assert_eq "main" "$(git -C "$repo" symbolic-ref --short HEAD)" \
    "I5: fallback ignores configured master" || return 1
  grep -qE "^GIT_INIT[[:space:]]+${repo}$" "$repo/.workspace/init-log" || {
    echo "    I5: fallback init was not recorded in init-log"
    return 1
  }
}

# ---------------------------------------------------------------------------
# D1-D3. The DISPATCHED path (#482). The skills call `wi
# git_detect_default_branch`, which runs under `set -euo pipefail`; the F-tests
# above source the lib under `set -u` only and cannot see an abort there.
# ---------------------------------------------------------------------------
test_D1_dispatcher_origin_without_head_falls_through() {
  local repo="$_WI_TMP/d1-canon"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" symbolic-ref HEAD refs/heads/trunk
  git -C "$repo" remote add origin https://example.invalid/x.git

  local out rc
  out="$("$WI_BIN" git_detect_default_branch "$repo" </dev/null 2>/dev/null)"
  rc=$?
  assert_eq 0 "$rc" "D1: dispatcher exit status" || return 1
  assert_eq "trunk" "$out" "D1: falls through to local HEAD" || return 1
}

test_D2_dispatcher_origin_head_still_wins() {
  local seed="$_WI_TMP/d2-seed" upstream="$_WI_TMP/d2-upstream.git"
  local repo="$_WI_TMP/d2-clone"
  _make_repo_with_branch "$seed" "develop"
  git clone -q --bare "$seed" "$upstream"
  git clone -q "$upstream" "$repo"
  git -C "$repo" checkout -q -b feature

  local out rc
  out="$("$WI_BIN" git_detect_default_branch "$repo" </dev/null 2>/dev/null)"
  rc=$?
  assert_eq 0 "$rc" "D2: dispatcher exit status" || return 1
  assert_eq "develop" "$out" "D2: origin/HEAD beats the current branch" || return 1
}

test_D3_dispatcher_non_repo_defaults_to_main() {
  local dir="$_WI_TMP/d3-not-a-repo"
  mkdir -p "$dir"

  local out rc
  out="$(GIT_CEILING_DIRECTORIES="$_WI_TMP" "$WI_BIN" git_detect_default_branch "$dir" </dev/null 2>/dev/null)"
  rc=$?
  assert_eq 0 "$rc" "D3: dispatcher exit status" || return 1
  assert_eq "main" "$out" "D3: EOF at the prompt defaults to main" || return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "== Running tests for lib/git-init.sh default-branch fallback =="
echo ""

wi_test_run test_F1_step1_origin_head_succeeds
wi_test_run test_F2_step2_symbolic_ref_head
wi_test_run test_F3_detached_head_falls_through_to_prompt
wi_test_run test_F4_prompt_accepts_piped_answer
wi_test_run test_F5_prompt_empty_input_defaults_to_main
wi_test_run test_F6_custom_branch_develop_roundtrip
wi_test_run test_I1_fresh_init_forces_main_over_global_master
wi_test_run test_I2_fresh_pair_initializes_both_on_main
wi_test_run test_I3_existing_repo_branch_is_preserved
wi_test_run test_I4_gitfile_repo_is_preserved_and_stageable
wi_test_run test_I5_old_git_fallback_initializes_main
wi_test_run test_D1_dispatcher_origin_without_head_falls_through
wi_test_run test_D2_dispatcher_origin_head_still_wins
wi_test_run test_D3_dispatcher_non_repo_defaults_to_main

echo ""
wi_test_summary
