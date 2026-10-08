#!/usr/bin/env bash
# PR #703 round 1: fail-closed reads and cleanup paths, through real dispatch.
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
. "$HERE/lib/blocks.sh"
OSS="$HERE/../bin/oss"
TMP="$(mktemp -d)"
trap 'find "$TMP" -depth -delete' EXIT
only="${1:-all}"
fixture() {
  F="$TMP/$1"; mkdir -p "$F/ws/.ossify" "$F/core" "$F/ui"
  for repo in core ui; do
    git -C "$F/$repo" init -q -b main
    git -C "$F/$repo" config user.email t@t; git -C "$F/$repo" config user.name t
    echo seed > "$F/$repo/f"; git -C "$F/$repo" add f; git -C "$F/$repo" commit -qm seed
  done
  printf '{"schema_version":1,"repos":{"core":{"root":"%s/core"},"ui":{"root":"%s/ui"}},"well_known_paths":{}}\n' "$F" "$F" > "$F/ws/.ossify/topology.json"
  oss init inv >/dev/null; oss release_add R0 g >/dev/null; oss spine_add r0 Demo bone core >/dev/null
  oss work_item_add r0.s1 One core >/dev/null
  mkdir -p "$F/ws/docs/specs/r0/r0.s1-demo"
}
oss() { (cd "$F/ws" && bash "$OSS" "$@"); }
inventory() { t_capture oss spine_inventory r0.s1; }
verdict() { printf '%s\n' "$T_OUT" | awk -F'\t' -v kind="$1" -v id="$2" -v col="$3" '$1==kind && $2==id {print $col}'; }
healthy() {
  git -C "$F/core" checkout -q -b spine/r0.s1-demo
  oss spine_base_set r0.s1 core main >/dev/null
}
spawn() {
  WT="$(oss worktree_add core r0.s1.w1 one spine/r0.s1-demo)"
  oss work_item_exec r0.s1.w1 work/r0.s1.w1-one "$WT" "$(git -C "$WT" rev-parse HEAD)" >/dev/null
  oss work_item_status r0.s1.w1 active >/dev/null
}
land() {
  echo work > "$WT/work"; git -C "$WT" add work; git -C "$WT" commit -qm work
  git -C "$F/core" merge -q --no-ff work/r0.s1.w1-one -m landing
  oss work_item_status r0.s1.w1 complete >/dev/null
}
if [ "$only" = all ] || [ "$only" = R1 ]; then
  # Physical ref failures: invalid spelling and a valid-looking missing object.
  for site in spine-fresh spine-reentry item; do
    for damage in malformed dangling; do
      fixture "r1-$site-$damage"
      ref=spine/r0.s1-demo
      if [ "$site" != spine-fresh ]; then healthy; fi
      if [ "$site" = item ]; then
        spawn; land; git -C "$F/core" worktree remove "$WT"
        ref=work/r0.s1.w1-one
      elif [ "$site" = spine-reentry ]; then
        oss work_item_add r0.s1 Two ui >/dev/null
        git -C "$F/ui" checkout -q -b spine/r0.s1-demo
        oss spine_base_set r0.s1 ui main >/dev/null
        git -C "$F/core" checkout -q main
      fi
      mkdir -p "$F/core/.git/refs/heads/${ref%/*}"
      if [ "$damage" = malformed ]; then printf 'broken-ref\n'; else printf '%040d\n' 1; fi > "$F/core/.git/refs/heads/$ref"
      inventory
      printf 'R1 %s %s rc=%s: %s\n' "$site" "$damage" "$T_RC" "$T_OUT"
      t_assert_rc 3 "R1 $site $damage halts dispatcher"
      if [ "$site" = item ]; then
        t_assert_eq halt:unreadable "$(verdict item r0.s1.w1 4)" "R1 $damage item ref never skips"
      else
        t_assert_eq halt:unreadable "$(verdict repo core 3)" "R1 $site $damage never reads absent"
      fi
    done
  done
  # Valid absence, presence, and a cleaned item retain their normal routes.
  fixture r1-absent; inventory
  t_assert_rc 0 'R1 absent control succeeds'; t_assert_eq fresh "$(verdict repo core 3)" 'R1 truly absent spine is fresh'
  healthy; inventory
  t_assert_rc 0 'R1 present control succeeds'; t_assert_eq ok "$(verdict repo core 3)" 'R1 present spine is ok'
  spawn; land; git -C "$F/core" worktree remove "$WT"; git -C "$F/core" branch -d work/r0.s1.w1-one >/dev/null
  inventory
  t_assert_rc 0 'R1 post-cleanup control succeeds'; t_assert_eq skip "$(verdict item r0.s1.w1 4)" 'R1 absent item branch still skips'
  # Simulated old Git: only --exists refuses rc129, everything else is real.
  mkdir -p "$TMP/old-git"
  REAL_GIT="$(command -v git)"; export REAL_GIT
  cat > "$TMP/old-git/git" <<'GIT'
#!/usr/bin/env bash
for arg in "$@"; do [ "$arg" != --exists ] || exit 129; done
exec "$REAL_GIT" "$@"
GIT
  chmod +x "$TMP/old-git/git"
  fixture r1-old-absent; PATH="$TMP/old-git:$PATH" inventory
  t_assert_rc 0 'R1 old Git absent control succeeds'; t_assert_eq fresh "$(verdict repo core 3)" 'R1 rc129 fallback reads true absence'
  healthy; spawn; PATH="$TMP/old-git:$PATH" inventory
  t_assert_rc 0 'R1 old Git present control succeeds'; t_assert_eq redispatch "$(verdict item r0.s1.w1 4)" 'R1 rc129 fallback reads present item'
  git -C "$F/core" pack-refs --all --prune; PATH="$TMP/old-git:$PATH" inventory
  t_assert_rc 0 'R1 old Git packed control succeeds'; t_assert_eq ok "$(verdict repo core 3)" 'R1 rc129 fallback reads packed spine'
fi
t_summary
