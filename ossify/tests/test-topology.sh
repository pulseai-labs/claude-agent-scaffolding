#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
. "$HERE/../lib/manifest.sh"
. "$HERE/../lib/worktree.sh"
. "$HERE/../lib/commands.sh"
# id/state/entities/ledger/demo added for Task 11's five-repo E2E (below): it
# drives real state minting (oss_state_init/oss_entity_*), ledger lines, and
# the demo runner, none of which the earlier resolver-only blocks in this
# file needed.
. "$HERE/../lib/id.sh"
. "$HERE/../lib/state.sh"
. "$HERE/../lib/entities.sh"
. "$HERE/../lib/ledger.sh"
. "$HERE/../lib/demo.sh"
TMP="$(mktemp -d)"

# --- topology discovery wins; pairing still discovered alone ---
mkdir -p "$TMP/ws/.ossify" "$TMP/ws/sub" "$TMP/legacy/.workspace" "$TMP/legacy/sub"
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"},"ui":{"root":"$TMP/ui"}},"well_known_paths":{}}
JSON
cat > "$TMP/legacy/.workspace/pairing.json" <<JSON
{"schema_version":"1.0","ai_workspace":{"root":"$TMP/legacy"},"canonical":{"root":"$TMP/canon"},"well_known_paths":{}}
JSON
cd "$TMP/ws/sub"
t_capture oss_topology_discover
t_assert_rc 0 "topology discovered from nested dir"
t_assert_eq "$TMP/ws/.ossify/topology.json" "$T_OUT" "topology path"
cd "$TMP/legacy/sub"
t_capture oss_topology_discover
t_assert_rc 0 "pairing fallback discovered"
t_assert_eq "$TMP/legacy/.workspace/pairing.json" "$T_OUT" "pairing path"
cd "$TMP"
t_capture oss_topology_discover
t_assert_rc 1 "neither file -> rc 1"
cd "$HERE"

# --- topology wins regardless of which is nearer, on the SAME walk-up chain ---
# The contract is "topology wins when both exist ANYWHERE on the walk-up", not
# "whichever is closer to $PWD". Two orderings, both must resolve to topology.
mkdir -p "$TMP/mix1/.workspace" "$TMP/mix1/inner/.ossify" "$TMP/mix1/inner/sub"
cat > "$TMP/mix1/.workspace/pairing.json" <<JSON
{"schema_version":"1.0","ai_workspace":{"root":"$TMP/mix1"},"canonical":{"root":"$TMP/canon"},"well_known_paths":{}}
JSON
cat > "$TMP/mix1/inner/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"}},"well_known_paths":{}}
JSON
cd "$TMP/mix1/inner/sub"
t_capture oss_topology_discover
t_assert_rc 0 "topology nearer than pairing: discovered"
t_assert_eq "$TMP/mix1/inner/.ossify/topology.json" "$T_OUT" "topology nearer than pairing: topology wins"
cd "$HERE"

mkdir -p "$TMP/mix2/.ossify" "$TMP/mix2/inner/.workspace" "$TMP/mix2/inner/sub"
cat > "$TMP/mix2/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"}},"well_known_paths":{}}
JSON
cat > "$TMP/mix2/inner/.workspace/pairing.json" <<JSON
{"schema_version":"1.0","ai_workspace":{"root":"$TMP/mix2/inner"},"canonical":{"root":"$TMP/canon"},"well_known_paths":{}}
JSON
cd "$TMP/mix2/inner/sub"
t_capture oss_topology_discover
t_assert_rc 0 "pairing nearer than topology: discovered"
t_assert_eq "$TMP/mix2/.ossify/topology.json" "$T_OUT" "pairing nearer than topology: topology STILL wins"
cd "$HERE"

# --- the internal shape, from both sources ---
cd "$TMP/ws"
t_capture _oss_shape_file
t_assert_rc 0 "shape resolved from topology"
t_assert_contains "$T_OUT" '"core"' "shape carries core"
t_assert_contains "$T_OUT" '"source":"topology"' "shape names its source"
# workspace is implicit: parent of .ossify/
t_assert_contains "$T_OUT" "\"workspace\":\"$TMP/ws\"" "implicit workspace root"
t_capture oss_manifest_state_path
t_assert_rc 0 "state path via topology"
t_assert_eq "$TMP/ws/.ossify/project-state.json" "$T_OUT" "convention default unchanged"
cd "$TMP/legacy"
t_capture _oss_shape_file
t_assert_contains "$T_OUT" '"canonical"' "pairing translates canonical"
t_assert_contains "$T_OUT" '"source":"pairing"' "shape names pairing"
t_assert_contains "$T_OUT" "\"workspace\":\"$TMP/legacy\"" "pairing workspace from key"
cd "$HERE"

# --- future writer-side roles translate; unknown keys ride along ignored ---
cat > "$TMP/legacy/.workspace/pairing.json" <<JSON
{"schema_version":"1.0","ai_workspace":{"root":"$TMP/legacy"},"canonical":{"root":"$TMP/canon"},"tooling_repo":{"root":"$TMP/tools"},"routing":{"extra":"ignored"},"during_dev":{"worktrees_dir":"\${canonical.root}/.worktrees"}}
JSON
cd "$TMP/legacy"
t_capture _oss_shape_file
t_assert_contains "$T_OUT" '"tooling_repo"' "tooling_repo becomes a declared repo"
case "$T_OUT" in *'"routing"'*) t_assert_eq "absent" "present" "routing is NOT a repo (no .root)";; *) t_assert_rc 0 "non-root keys are not repos";; esac
cd "$HERE"

# --- malformed manifest: found but unparseable must fail LOUD, not silent ---
# Regression guard: at the base commit, a malformed pairing.json (missing
# ai_workspace.root) still printed a diagnostic to stderr. _oss_shape_file must
# not regress that to a silent rc 1 for either source.
mkdir -p "$TMP/badtopo/.ossify"
printf '{not valid json' > "$TMP/badtopo/.ossify/topology.json"
cd "$TMP/badtopo"
t_capture _oss_shape_file
t_assert_rc 1 "malformed topology.json refused"
t_assert_contains "$T_OUT" "could not be parsed" "malformed topology.json: stderr names the parse failure"
cd "$HERE"

mkdir -p "$TMP/badpair/.workspace"
printf '{not valid json' > "$TMP/badpair/.workspace/pairing.json"
cd "$TMP/badpair"
t_capture oss_manifest_state_path
t_assert_rc 1 "malformed pairing.json refused via state_path (the function skills call)"
t_assert_contains "$T_OUT" "could not be parsed" "malformed pairing.json: stderr names the parse failure"
cd "$HERE"

# --- refusal: old tokens stay, new remedy added ---
cd "$TMP"
t_capture oss_manifest_require
t_assert_rc 1 "require refuses when no declaration"
t_assert_contains "$T_OUT" "/init-workspace" "refusal keeps /init-workspace token"
t_assert_contains "$T_OUT" "/pair-workspace" "refusal keeps /pair-workspace token"
t_assert_contains "$T_OUT" "/ossify:start" "refusal names /ossify:start"
t_assert_contains "$T_OUT" "/ossify:adopt" "refusal names /ossify:adopt"
cd "$HERE"

# --- the repos map is itself a boundary: empty, absent, and reserved ---------
# `repos: (.repos // {})` normalized every one of these to an EMPTY repo map and
# returned rc 0, so `oss state_path` succeeded and /start read the topology as
# resolved: it would neither author one nor overwrite the broken file, and the
# first defaulted repo operation failed with "[] are declared". The pairing arm
# had always excluded `ai_workspace` by name; the topology arm had no such arm,
# so a declared `.repos.ai_workspace` was shadowed by the reserved alias and
# `oss repo_root ai_workspace` returned the WORKSPACE root, silently, for a key
# the operator declared to mean a product repo.
mkdir -p "$TMP/bad-empty/.ossify" "$TMP/bad-null/.ossify" "$TMP/bad-absent/.ossify" "$TMP/topo-r/.ossify"
printf '%s\n' '{"schema_version":1,"repos":{},"well_known_paths":{}}'  > "$TMP/bad-empty/.ossify/topology.json"
printf '%s\n' '{"schema_version":1,"repos":null,"well_known_paths":{}}' > "$TMP/bad-null/.ossify/topology.json"
printf '%s\n' '{"schema_version":1,"well_known_paths":{}}'              > "$TMP/bad-absent/.ossify/topology.json"
cat > "$TMP/topo-r/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"},"ai_workspace":{"root":"$TMP/nope"}},"well_known_paths":{}}
JSON
mkdir -p "$TMP/topo-a/.ossify"
printf '%s\n' '[1,2]' > "$TMP/topo-a/.ossify/topology.json"
cd "$TMP/topo-a"
t_capture _oss_shape_file
t_assert_rc 1 "a topology whose top level is not an object refuses"
t_assert_contains "$T_OUT" "not a JSON object" "the non-object refusal names the shape, not a parse error"
for bad in bad-empty bad-null bad-absent; do
  cd "$TMP/$bad"
  t_capture _oss_shape_file
  t_assert_rc 1 "topology with a $bad repo map refuses"
  t_assert_contains "$T_OUT" "declares no repos" "$bad refusal says the repo map is empty, not that the JSON is unparseable"
  t_capture oss_manifest_state_path
  t_assert_rc 1 "$bad does not resolve a state path - /start must still author"
done
cd "$TMP/topo-r"
t_capture _oss_shape_file
t_assert_rc 1 "a topology declaring the reserved key ai_workspace refuses"
# The fixture dir is `topo-r`, not `bad-reserved`: the shape echoes the
# workspace PATH, so a directory named ...reserved made this assertion pass on
# a string the fixture itself planted, against the very bug it exists to catch.
t_assert_contains "$T_OUT" "cannot be declared" "the reserved-key refusal says ai_workspace cannot be declared"
# The reserved alias itself still resolves where it is NOT declared.
cd "$TMP/ws"
t_capture _oss_repo_root ai_workspace
t_assert_rc 0 "ai_workspace remains resolvable as the reserved alias on a valid topology"
t_assert_eq "$TMP/ws" "$T_OUT" "reserved alias still returns the workspace root"
cd "$HERE"

# --- every .repos ENTRY is a boundary, not just the map ------------------------
# The first cut of these checks validated only that `.repos` was a non-empty
# object without `ai_workspace`. An uppercase key, or an entry that is not
# `{root: "..."}`, sailed through: `oss state_path` succeeded, /start read the
# topology as resolved and preserved the file, state was initialized - and the
# first `oss repo_root` failed AFTER onboarding had partially proceeded. Both
# reviewers found this independently on the same commit.
mkdir -p "$TMP/topo-k/.ossify" "$TMP/topo-e/.ossify" "$TMP/topo-s/.ossify"
cat > "$TMP/topo-k/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"UI":{"root":"$TMP/ui"}},"well_known_paths":{}}
JSON
printf '%s\n' '{"schema_version":1,"repos":{"ui":{}},"well_known_paths":{}}' > "$TMP/topo-e/.ossify/topology.json"
printf '%s\n' '{"schema_version":1,"repos":{"ui":"/tmp/ui"},"well_known_paths":{}}' > "$TMP/topo-s/.ossify/topology.json"
cd "$TMP/topo-k"
t_capture _oss_shape_file
t_assert_rc 1 "a topology key outside [a-z][a-z0-9_-]* refuses"
# Not just "UI": the SHAPE echoes the repo map, so before the fix this
# assertion passed on the very output the bug produced.
t_assert_contains "$T_OUT" "is not a valid repo name" "the bad-key refusal says the name is invalid, naming it"
t_assert_contains "$T_OUT" "UI" "...and names the offending key"
cd "$TMP/topo-e"
t_capture _oss_shape_file
t_assert_rc 1 "a repo entry with no root refuses"
t_assert_contains "$T_OUT" "root" "the no-root refusal names the missing field"
cd "$TMP/topo-s"
t_capture _oss_shape_file
t_assert_rc 1 "a repo entry that is a string rather than an object refuses"
# And none of them lets /start read the workspace as already onboarded.
for bad in topo-k topo-e topo-s; do
  cd "$TMP/$bad"
  t_capture oss_manifest_state_path
  t_assert_rc 1 "$bad does not resolve a state path"
done
cd "$HERE"

# --- one top-level value, and a well_known_paths that is an object ------------
# `jq -e .` accepts a concatenated JSON STREAM, so two objects in one file
# passed every check once per value and the projection emitted TWO shapes -
# `oss state_path` then returned a multiline "path" and `oss init` could create
# a directory with an embedded newline in its name. And `(.well_known_paths //
# {})` preserved a string or array verbatim: the later `.well_known_paths
# .project_state` read errors, the error is swallowed as an empty route, and
# /start initializes state at the default path instead of refusing.
mkdir -p "$TMP/topo-2/.ossify" "$TMP/topo-w/.ossify"
{ printf '%s\n' '{"schema_version":1,"repos":{"a":{"root":"/tmp/a"}},"well_known_paths":{}}'
  printf '%s\n' '{"schema_version":1,"repos":{"b":{"root":"/tmp/b"}},"well_known_paths":{}}'
} > "$TMP/topo-2/.ossify/topology.json"
printf '%s\n' '{"schema_version":1,"repos":{"a":{"root":"/tmp/a"}},"well_known_paths":"nope"}' \
  > "$TMP/topo-w/.ossify/topology.json"
cd "$TMP/topo-2"
t_capture _oss_shape_file
t_assert_rc 1 "a topology holding two concatenated JSON values refuses"
t_assert_contains "$T_OUT" "exactly one" "the stream refusal says exactly one top-level value is required"
t_capture oss_manifest_state_path
t_assert_rc 1 "...and no multiline state path is produced"
cd "$TMP/topo-w"
t_capture _oss_shape_file
t_assert_rc 1 "a non-object well_known_paths refuses"
t_assert_contains "$T_OUT" "well_known_paths" "the refusal names the field"
cd "$HERE"

# --- both walk-up loops must inspect "/" itself -------------------------------
# `while [ "$dir" != "/" ]` as the loop CONDITION exits before checking the
# root, so a workspace AT the filesystem root - or any run started beneath one -
# reported no declaration at all. Creating /.ossify here is not possible (and
# would not be acceptable if it were), so this asserts the loop SHAPE: a
# mechanical fact, and the regression it guards is a one-character edit away.
for fn in oss_topology_discover oss_manifest_discover; do
  body="$(sed -n "/^${fn}() {/,/^}/p" "$HERE/../lib/manifest.sh")"
  if printf '%s' "$body" | grep -q 'while'; then
    T_PASS=$((T_PASS+1))
  else
    T_FAIL=$((T_FAIL+1)); echo "FAIL: could not extract $fn's walk loop - the assertion below is vacuous"
  fi
  case "$body" in
    *'while [ "$dir" != "/" ]'*)
      T_FAIL=$((T_FAIL+1)); echo "FAIL: $fn exits its walk before inspecting \"/\" - a root-level declaration is invisible" ;;
    *) T_PASS=$((T_PASS+1)) ;;
  esac
done

# --- a repo root carrying a backslash resolves to ITSELF ----------------------
# The resolver read `[.key, .value.root] | @tsv`, and @tsv ESCAPES backslashes:
# a declared `/tmp/a\b` came back as `/tmp/a\\b`, `read -r` preserved both
# characters, and the substitution produced a path that does not exist - so
# `oss init` wrote state beside the declared repo instead of at its routed
# destination. Keys are grammar-checked and cannot carry a backslash; roots can.
BSW="$(mktemp -d)"; mkdir -p "$BSW/.ossify"
BSROOT="$BSW/a\\b"
mkdir -p "$BSROOT"
jq -n --arg r "$BSROOT" \
  '{schema_version:1,repos:{core:{root:$r}},well_known_paths:{project_state:"${repos.core.root}/ps.json"}}' \
  > "$BSW/.ossify/topology.json"
cd "$BSW"
t_capture _oss_repo_root core
t_assert_rc 0 "a repo root containing a backslash resolves"
t_assert_eq "$BSROOT" "$T_OUT" "...to the literal declared path, not a re-escaped one"
t_capture oss_manifest_state_path
t_assert_rc 0 "a \${repos.<name>.root} token over that root resolves"
t_assert_eq "$BSROOT/ps.json" "$T_OUT" "...to the routed destination, not a manufactured sibling"
cd "$HERE"; rm -rf "$BSW"

# --- schema_version is a boundary too ----------------------------------------
# The projection read v1 field semantics off whatever it was given. A file
# declaring schema_version 2 (or omitting it) resolved, /start preserved it as
# already-onboarded, and every later verb read a document written for a
# different schema as though it were v1.
mkdir -p "$TMP/topo-v2/.ossify" "$TMP/topo-v0/.ossify"
printf '%s\n' '{"schema_version":2,"repos":{"a":{"root":"/tmp/a"}},"well_known_paths":{}}' > "$TMP/topo-v2/.ossify/topology.json"
printf '%s\n' '{"repos":{"a":{"root":"/tmp/a"}},"well_known_paths":{}}'                    > "$TMP/topo-v0/.ossify/topology.json"
cd "$TMP/topo-v2"
t_capture _oss_shape_file
t_assert_rc 1 "a topology declaring schema_version 2 refuses"
t_assert_contains "$T_OUT" "schema_version" "the refusal names the field"
cd "$TMP/topo-v0"
t_capture _oss_shape_file
t_assert_rc 1 "a topology with no schema_version refuses"
cd "$HERE"

# --- grammar is an injection boundary, refused BEFORE any jq read ---
cd "$TMP/ws"   # declares core + ui only
# rc 2 alone does NOT prove the grammar fired: an undeclared-but-well-formed key
# refuses at the same rc, so a key the grammar wrongly ADMITS still scores a pass
# on rc. Assert the grammar's own message instead. `Core`/`svcA` are the live
# case - a bracket RANGE is collation-ordered under a UTF-8 locale, so the old
# `*[!a-z0-9_-]*` admitted uppercase on the operator's macOS shell and refused it
# under CI's C locale, and this loop went green on both for different reasons.
for bad in 'x|hack' '1core' 'Core' 'svcA' 'core.js' 'a b' '-core' '_core'; do
  t_capture _oss_repo_root "$bad"
  t_assert_rc 2 "invalid repo key '$bad' refused at rc 2"
  t_assert_contains "$T_OUT" "invalid repo key" \
    "repo key '$bad' refused by the GRAMMAR, not by an undeclared-key lookup"
done
# The empty key is NOT a grammar case: `_oss_repo_root` routes it to the default
# resolver before any validation, and with two repos declared that is ambiguous.
t_capture _oss_repo_root ''
t_assert_rc 2 "empty repo key refused at rc 2"
t_assert_contains "$T_OUT" "name one" "empty key refused as an ambiguous default, not by the grammar"
t_capture _oss_repo_root ui
t_assert_rc 0 "declared repo resolves"
t_assert_eq "$TMP/ui" "$T_OUT" "ui root"
t_capture _oss_repo_root nosuch
t_assert_rc 2 "undeclared repo refused"
t_assert_contains "$T_OUT" "core, ui" "refusal lists declared repos"
t_capture _oss_repo_root ai_workspace
t_assert_rc 0 "ai_workspace still resolves (reserved)"
t_assert_eq "$TMP/ws" "$T_OUT" "workspace root via reserved key"
cd "$TMP/legacy"
t_capture _oss_repo_root canonical
t_assert_rc 0 "legacy canonical resolves through translation"
t_assert_eq "$TMP/canon" "$T_OUT" "legacy canonical root"
t_capture _oss_repo_root tooling_repo
t_assert_rc 0 "tooling_repo resolves (was refused by the enum)"
cd "$HERE"

# --- token vocabulary: repos tokens, alias, fail-safe unknown ---
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"},"canonical":{"root":"$TMP/canon"}},"well_known_paths":{"project_state":"\${repos.ui.root}/ps.json"}}
JSON
cd "$TMP/ws"
t_capture oss_manifest_state_path
t_assert_rc 1 "unknown repo in a route token is refused (left for the guard)"
t_assert_contains "$T_OUT" "unresolved" "guard names it unresolved"
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"},"ui":{"root":"$TMP/ui"}},"well_known_paths":{"project_state":"\${repos.core.root}/.ossify/ps.json"}}
JSON
t_capture oss_manifest_state_path
t_assert_rc 0 "repos-token route resolves"
t_assert_eq "$TMP/core/.ossify/ps.json" "$T_OUT" "repos.core.root substituted"
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"}},"well_known_paths":{"project_state":"\${canonical.root}/ps.json"}}
JSON
t_capture oss_manifest_state_path
t_assert_rc 1 "canonical alias without a canonical repo is refused"
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"}},"well_known_paths":{"project_state":"\${canonical.root}/ps.json"}}
JSON
t_capture oss_manifest_state_path
t_assert_rc 0 "canonical alias resolves when declared"
t_assert_eq "$TMP/canon/ps.json" "$T_OUT" "canonical alias substitutes to the declared canonical root"
# --- review round 1, Finding 3: both spellings must resolve identically for
# a repo literally named canonical - ${canonical.root} is documented as an
# alias, so pin that the two spellings are not just each individually
# resolvable but resolve to the SAME value.
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"}},"well_known_paths":{"project_state":"\${repos.canonical.root}/ps.json"}}
JSON
t_capture oss_manifest_state_path
t_assert_rc 0 "repos.canonical.root spelling resolves for a repo literally named canonical"
t_assert_eq "$TMP/canon/ps.json" "$T_OUT" "both spellings resolve to the identical value"
cd "$HERE"

# --- review round 1, Finding 1: an UNRESOLVABLE repo-root token must NOT
# substitute to the empty string. `${repos.<name>.root}/ps.json` collapsing to
# `/ps.json` is a well-formed, root-anchored path manufactured out of an absent
# value, exactly the trap the ${HOME} comment in _oss_manifest_resolve already
# names and guards against. The token must be LEFT IN PLACE so the
# unresolved-token guard catches it, the same substituting-when-present
# discipline every other substitution in that function follows.
#
# This used to reach that guard via `"core":{"root":""}` - a DECLARED repo with
# an empty root. `_oss_topology_shape` now refuses that entry outright, which is
# strictly better: the workspace never resolves at all rather than resolving and
# failing later. So the token here names an UNDECLARED repo instead, which is
# the remaining way a repo-root token fails to substitute.
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"}},"well_known_paths":{"project_state":"\${repos.nosuch.root}/ps.json"}}
JSON
cd "$TMP/ws"
t_capture oss_manifest_state_path
t_assert_rc 1 "an unresolvable repo-root token is left in place, not substituted to empty"
t_assert_contains "$T_OUT" "unresolved" "guard names it unresolved rather than manufacturing a root-anchored path"
# And the entry-shape refusal is what an empty declared root gets now.
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":""}},"well_known_paths":{}}
JSON
t_capture oss_manifest_state_path
t_assert_rc 1 "a declared-but-empty repo root refuses at the shape"
t_assert_contains "$T_OUT" "non-empty root" "...naming the entry rather than a downstream token"
cd "$HERE"

# --- sole-repo default: any name resolves; N>1 refuses listing ---
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"}},"well_known_paths":{}}
JSON
cd "$TMP/ws"
t_capture _oss_repo_root ""            # unset key
t_assert_rc 0 "unset key resolves the sole repo"
t_assert_eq "$TMP/core" "$T_OUT" "sole repo root, whatever its name"
# Discriminator for site 6 (oss_cmd_repo_root): under the OLD literal
# `${1:-canonical}` default this fixture (sole repo "core", no "canonical"
# declared) would refuse at rc 2 - "canonical" is not declared. The new rule
# resolves it, mirroring the demo-runner block's non-canonical discriminator.
t_capture oss_cmd_repo_root            # dispatcher default, N=1, not named canonical
t_assert_rc 0 "dispatcher default resolves the sole repo even when it is not named canonical"
t_assert_eq "$TMP/core" "$T_OUT" "dispatcher default: sole repo root"
cat > "$TMP/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMP/core"},"ui":{"root":"$TMP/ui"}},"well_known_paths":{}}
JSON
t_capture _oss_repo_root ""
t_assert_rc 2 "unset key with N>1 refuses"
t_assert_contains "$T_OUT" "core, ui" "refusal lists both"
t_capture oss_cmd_repo_root            # dispatcher default
t_assert_rc 2 "dispatcher default refuses under N>1"
# Discriminator: under the OLD literal `${1:-canonical}` default this ALSO
# refuses at rc 2 - "canonical" is simply not declared here either, by
# membership, not by ambiguity. "no repo key given" is unique to
# _oss_default_repo_key's own refusal and unreachable from that old message
# ("repo 'canonical' is not declared (declared: core, ui)"), so this is what
# actually pins site 6 to the new rule rather than the old literal default.
t_assert_contains "$T_OUT" "no repo key given" "refusal is the new helper's, not the old literal-canonical membership check"
cd "$HERE"

# ===========================================================================
# Task 11 Step 1 - the five-repo E2E. Everything above this line proves the
# resolver, one call at a time, against small (0/1/2-repo) fixtures. This
# proves the whole declared surface holds together at the N the design was
# built for: five repos, each with its own git history, worktree lifecycle
# and orphan-scoping, declared in ONE topology.json - plus the pulsebase
# migration guarantee (a translated pairing manifest carrying a state file
# whose work items already say `target_repo:"canonical"`, exactly as a live
# pre-migration project's state does).
#
# A FRESH mktemp tree, never $TMP: every block above this one rewrites
# $TMP/ws/.ossify/topology.json in place, so inheriting it here would make
# this block's result depend on whichever fixture happened to run last -
# the "fixtures coupled through state" trap.
# ===========================================================================
E5="$(mktemp -d)"
mkdir -p "$E5/ws/.ossify"
for r in core backend cron ui uilib; do
  mkdir -p "$E5/$r"
  git -C "$E5/$r" init -q
  git -C "$E5/$r" config user.email t@t; git -C "$E5/$r" config user.name t
  echo seed > "$E5/$r/seed.txt"
  git -C "$E5/$r" add .; git -C "$E5/$r" commit -qm seed
done
cat > "$E5/ws/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$E5/core"},"backend":{"root":"$E5/backend"},"cron":{"root":"$E5/cron"},"ui":{"root":"$E5/ui"},"uilib":{"root":"$E5/uilib"}},"well_known_paths":{}}
JSON
cd "$E5/ws"

# --- every declared repo resolves, plus the reserved ai_workspace key ---
for r in core backend cron ui uilib; do
  t_capture _oss_repo_root "$r"
  t_assert_rc 0 "E2E5: repo_root resolves '$r'"
  t_assert_eq "$E5/$r" "$T_OUT" "E2E5: '$r' root matches its declared path"
done
t_capture _oss_repo_root ai_workspace
t_assert_rc 0 "E2E5: ai_workspace still resolves under N=5"
t_assert_eq "$E5/ws" "$T_OUT" "E2E5: ai_workspace root"

# --- an unset repo key refuses, listing ALL FIVE (not truncated) ---
t_capture _oss_repo_root ""
t_assert_rc 2 "E2E5: an unset repo key under N=5 refuses"
for r in core backend cron ui uilib; do
  t_assert_contains "$T_OUT" "$r" "E2E5: refusal lists '$r' among the declared set"
done
t_capture oss_cmd_repo_root
t_assert_rc 2 "E2E5: dispatcher default under N=5 refuses the same way"

# --- worktree_add per repo; work_item_exec journals it; orphans clean ---
E5S="$E5/ws/.ossify/project-state.json"
oss_state_init "$E5S" "five-repo-e2e" >/dev/null
E5REL="$(oss_entity_add_release "$E5S" "multi-repo" "cross-repo demo")"
E5SP="$(oss_entity_add_spine "$E5S" "$E5REL" "cross-repo spine" flesh core)"
for r in core backend cron ui uilib; do
  wi="$(oss_entity_add_work_item "$E5S" "$E5SP" "wire $r" "$r")"
  t_capture oss_worktree_add "$r" "$wi" "wire-$r" HEAD
  t_assert_rc 0 "E2E5: worktree_add for '$r' succeeds"
  wt="$T_OUT"
  t_assert_eq "$E5/$r/.worktrees/$wi" "$wt" "E2E5: '$r's worktree lands under ITS OWN root, not another repo's"
  branch="$(oss_id_work_item_branch "$wi" "wire-$r")"
  base_sha="$(git -C "$E5/$r" rev-parse HEAD)"
  t_capture oss_entity_set_work_item_exec "$E5S" "$wi" "$branch" "$wt" "$base_sha"
  t_assert_rc 0 "E2E5: work_item_exec journals '$r's worktree"
  t_capture oss_worktree_orphans "$r" "$E5S"
  t_assert_rc 0 "E2E5: worktree_orphans for '$r' ran clean"
  t_assert_eq "" "$T_OUT" "E2E5: '$r' has no orphan once work_item_exec journaled the path"
done

# --- demo workdir: explicit arg runs; without one under N=5 it refuses ---
oss_ledger_add_auto "$E5S" "$E5SP" "core seed present" "test -f seed.txt" "exit:0" >/dev/null
t_capture oss_demo_workdir "$E5S" "$E5/core"
t_assert_rc 0 "E2E5: demo workdir with an explicit arg runs"
t_assert_eq "$E5/core" "$T_OUT" "E2E5: explicit workdir echoed verbatim"
t_capture oss_demo_run_auto "$E5S" "$E5/core"
t_assert_rc 0 "E2E5: demo run against the explicit workdir passes"
t_assert_contains "$T_OUT" "PASS 1 lines" "E2E5: exactly the one seeded auto line ran"

t_capture oss_demo_workdir "$E5S"
t_assert_rc 2 "E2E5: demo workdir with no explicit arg and no composition_root refuses under N=5"
for r in core backend cron ui uilib; do
  t_assert_contains "$T_OUT" "$r" "E2E5: workdir refusal lists '$r'"
done
# oss_demo_run_auto's own workdir guard collapses ANY oss_demo_workdir failure
# to rc 1 (`|| return 1`, not `|| return $?`) - MEASURED, not assumed: the
# refusal above is rc 2 from oss_demo_workdir itself. The message still
# survives (it is on stderr before the collapse), so the runner still refuses
# and still names the declared set; only the numeric rc differs.
t_capture oss_demo_run_auto "$E5S"
t_assert_rc 1 "E2E5: demo run with no explicit workdir also refuses under N=5"
t_assert_contains "$T_OUT" "no repo key given" "E2E5: ...and the refusal is the same ambiguity message, not a generic failure"

cd "$HERE"
rm -rf "$E5"

# --- the migration guarantee: target_repo:"canonical" in STATE, resolved
# through a manifest that is a TRANSLATED PAIRING (no topology.json anywhere
# on the walk-up) - the exact shape a live pre-migration project (pulsebase)
# carries in its own state file today. ---
PB="$(mktemp -d)"
mkdir -p "$PB/ws/.workspace" "$PB/canon"
git -C "$PB/canon" init -q
git -C "$PB/canon" config user.email t@t; git -C "$PB/canon" config user.name t
echo seed > "$PB/canon/f.txt"; git -C "$PB/canon" add .; git -C "$PB/canon" commit -qm seed
cat > "$PB/ws/.workspace/pairing.json" <<JSON
{"schema_version":"1.0","ai_workspace":{"root":"$PB/ws"},"canonical":{"root":"$PB/canon"},"well_known_paths":{}}
JSON
cd "$PB/ws"
PBS="$PB/ws/.ossify/project-state.json"
oss_state_init "$PBS" "pulsebase-shape" >/dev/null
PBREL="$(oss_entity_add_release "$PBS" "legacy" "pre-migration state")"
PBSP="$(oss_entity_add_spine "$PBS" "$PBREL" "legacy spine" flesh canonical)"
# Written with the EXPLICIT legacy value, exactly as a pre-migration state
# carries it - not the sole-repo default's inference (also "canonical" here,
# but for a different reason; this pins the literal recorded field).
PBWI="$(oss_entity_add_work_item "$PBS" "$PBSP" "legacy work item" canonical)"
t_capture oss_state_read "$PBS" '.work_items[0].target_repo'
t_assert_eq "canonical" "$T_OUT" "pulsebase shape: the work item's target_repo is the literal legacy value"
t_capture oss_worktree_add canonical "$PBWI" "legacy-slug" HEAD
t_assert_rc 0 "pulsebase shape: worktree_add resolves canonical through the TRANSLATED pairing manifest"
PBWT="$T_OUT"
# Review round 1, finding 4: PBWT must be checked against an INDEPENDENTLY
# known path, not merely carried forward - the E5 loop above does exactly
# this (`t_assert_eq "$E5/$r/.worktrees/$wi" "$wt"`) and this fixture had
# skipped its own counterpart, so the no-orphan assertion below was
# inheriting whatever worktree_add produced rather than confirming it was
# right. This is the migration guarantee the whole build rests on, so its
# path gets the same independent check as every other repo in this file.
t_assert_eq "$PB/canon/.worktrees/$PBWI" "$PBWT" "pulsebase shape: the worktree lands at the id-named path under the TRANSLATED canonical root"
oss_entity_set_work_item_exec "$PBS" "$PBWI" "$(oss_id_work_item_branch "$PBWI" legacy-slug)" \
  "$PBWT" "$(git -C "$PB/canon" rev-parse HEAD)" >/dev/null
t_capture oss_worktree_orphans canonical "$PBS"
t_assert_rc 0 "pulsebase shape: worktree_orphans reads the target_repo:\"canonical\" record through translation"
t_assert_eq "" "$T_OUT" "pulsebase shape: no orphan - the journaled record claims its directory under the translated root"

cd "$HERE"
rm -rf "$PB"

# --- an EXPLICIT repo key must be declared, not merely well-formed -----------
# The `if [ -z "$N" ]; then default; else use-it-raw` idiom appears at ten
# sites. Six resolve the key through `_oss_repo_root` on the next line, so a bad
# key refuses there. Three PERSIST it - a spine's `target_repo`, a work item's,
# a patch record's `repo` - and those refused nothing: a typo'd or undeclared
# key entered the journal and failed only when a later ceremony tried to route
# on it, far from the mistake.
#
# Asserted through `oss_cmd_*`, not the `oss_entity_*`/`oss_ledger_*` functions
# beneath them, because that is where the guard lives and where every real
# caller arrives: a skill never sources a lib, it shells out to `oss`.
#
# `ai_workspace` is refused at the same boundary for a different reason: it
# RESOLVES (it is the reserved alias), so a membership check alone would admit
# it, and a work item targeting it routes a close commit and a merge into the
# process workspace.
KT="$(mktemp -d)"; mkdir -p "$KT/.ossify" "$KT/core" "$KT/ui"
export OSS_STATE_FILE="$KT/state.json"
cat > "$KT/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$KT/core"},"ui":{"root":"$KT/ui"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON
cd "$KT"
oss_cmd_init "explicit-key-guard" >/dev/null
oss_cmd_release_add "r-keys" "explicit key coverage" >/dev/null
for badkey in nosuch ai_workspace; do
  t_capture oss_cmd_spine_add r0 "spine-$badkey" flesh "$badkey"
  t_assert_rc 2 "spine with an explicit '$badkey' target refuses at rc 2"
  t_capture oss_cmd_get '[.spines[]] | length'
  t_assert_eq "0" "$T_OUT" "spine with an explicit '$badkey' target wrote NOTHING to state"
done
t_capture oss_cmd_spine_add r0 "good-spine" flesh core
t_assert_eq "r0.s1" "$T_OUT" "a declared explicit key still creates the spine"
for badkey in nosuch ai_workspace; do
  t_capture oss_cmd_work_item_add r0.s1 "wi-$badkey" "$badkey"
  t_assert_rc 2 "work item with an explicit '$badkey' target refuses at rc 2"
  t_capture oss_cmd_patch_add deadbee "patch text" "$badkey"
  t_assert_rc 2 "patch record with an explicit '$badkey' repo refuses at rc 2"
done
t_capture oss_cmd_get '[.work_items[]] | length'
t_assert_eq "0" "$T_OUT" "no work item was written by any refused explicit key"
t_capture oss_cmd_get '[.patch_records[]?] | length'
t_assert_eq "0" "$T_OUT" "no patch record was written by any refused explicit key"
# The declared keys still work, and the reserved alias is refused for a WRITE
# while remaining resolvable as a root.
t_capture oss_cmd_work_item_add r0.s1 "good wi" ui
t_assert_rc 0 "a declared explicit key still creates the work item"
t_capture oss_cmd_get '.work_items[0].target_repo'
t_assert_eq "ui" "$T_OUT" "the declared key is what lands in state"
t_capture oss_cmd_patch_add cafe123 "good patch" core
t_assert_rc 0 "a declared explicit key still records the patch"
t_capture oss_cmd_repo_root ai_workspace
t_assert_rc 0 "ai_workspace is still resolvable as a ROOT - only the write refuses it"
unset OSS_STATE_FILE
cd "$HERE"
rm -rf "$KT"

# --- the cumulative demo needs a composition root under N>1 -----------------
# `oss_demo_workdir` short-circuits on an ABSOLUTE composition_root and
# otherwise falls to `_oss_default_repo_key`, which refuses under N>1. /start
# told operators to leave composition_root unset unless Release 0 is "trivially
# single-repo", and spine close calls a bare `oss demo_run` - so an ordinarily
# onboarded multi-repo project could not pass its own mandatory demo gate, and
# the refusal it got named repo keys rather than the field that was missing.
CT="$(mktemp -d)"; mkdir -p "$CT/.ossify" "$CT/a" "$CT/b"
export OSS_STATE_FILE="$CT/state.json"
cat > "$CT/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"a":{"root":"$CT/a"},"b":{"root":"$CT/b"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON
cd "$CT"
oss_cmd_init "composition-demo" >/dev/null
t_capture oss_demo_workdir "$OSS_STATE_FILE"
t_assert_rc 2 "N>1 with no composition_root refuses"
t_assert_contains "$T_OUT" "composition_set" "the refusal names the remedy - the missing FIELD, not the repo keys"
oss_cmd_composition_set "src/app" >/dev/null
t_capture oss_demo_workdir "$OSS_STATE_FILE"
t_assert_rc 2 "N>1 with a RELATIVE composition_root still refuses - it composes against a default repo that does not exist"
t_assert_contains "$T_OUT" "absolute" "the relative-root refusal says it must be absolute"
oss_cmd_composition_set "$CT/a/app" >/dev/null
t_capture oss_demo_workdir "$OSS_STATE_FILE"
t_assert_rc 0 "N>1 with an ABSOLUTE composition_root resolves"
t_assert_eq "$CT/a/app" "$T_OUT" "and it resolves to that root verbatim"
# The single-repo path is untouched: the sole declared repo is still the default.
CT1="$(mktemp -d)"; mkdir -p "$CT1/.ossify" "$CT1/only"
export OSS_STATE_FILE="$CT1/state.json"
cat > "$CT1/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"only":{"root":"$CT1/only"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON
cd "$CT1"
oss_cmd_init "sole-repo-demo" >/dev/null
t_capture oss_demo_workdir "$OSS_STATE_FILE"
t_assert_rc 0 "one declared repo with no composition_root still resolves"
t_assert_eq "$CT1/only" "$T_OUT" "and it is the sole repo's root"
unset OSS_STATE_FILE
cd "$HERE"
rm -rf "$CT" "$CT1"

t_summary
