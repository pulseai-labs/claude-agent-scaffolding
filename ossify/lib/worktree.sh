#!/usr/bin/env bash
# Per-work-item worktrees. rc 8 = git/worktree operation failure (see the plan's
# rc-taxonomy note); rc 2 = usage / unknown repo key; rc 1 = not found.
#
# D4: every entry point takes a REPO KEY as its first argument. `target_repo`
# has been written into state since B4 with no reader; this is its first.
# #272/#310 generalized `_oss_repo_root` to resolve any repo the manifest
# declares, not `canonical` alone - every call site and path-shape assertion
# in this file already took the parameter, so that generalization needed no
# signature change here.

_oss_repo_root() { # $1=repo-key
  local key root shape
  if [ -z "${1:-}" ]; then key="$(_oss_default_repo_key)" || return $?; else key="$1"; fi
  shape="$(_oss_shape_file)" || return 1
  if [ "$key" = "ai_workspace" ]; then
    root="$(printf '%s' "$shape" | jq -r '.workspace // empty')"
  else
    _oss_repo_key_valid "$key" || {
      echo "oss: invalid repo key '$key' - names match [a-z][a-z0-9_-]* (ai_workspace is reserved)" >&2; return 2; }
    root="$(printf '%s' "$shape" | jq -r --arg k "$key" '.repos[$k].root // empty')"
    # An unconfigured key must NOT fall back to canonical: silently building a
    # private_core worktree inside the public repo is precisely the leak the
    # companion spec exists to prevent.
    if [ -z "$root" ] || [ "$root" = "null" ]; then
      echo "oss: repo '$key' is not declared (declared: $(printf '%s' "$shape" | jq -r '.repos | keys | join(", ")'))" >&2; return 2
    fi
  fi
  # This is a RAW jq read off the shape, so a repo root stored as
  # `${HOME}/workspace` returns the token verbatim. Every consumer treats this
  # as an absolute path — `oss release_dir` composes on it, worktree paths are
  # built from it — so an unresolved token becomes a relative-looking path that
  # resolves against the caller's cwd and writes artifacts in the wrong place.
  # Resolve here, once, against the shape's own workspace root - $shape already
  # carries it (topology-declared, or translated from a pairing manifest), so
  # this does not re-discover a manifest of its own - and refuse anything still
  # holding a `${...}` rather than handing a caller a path that only looks
  # absolute.
  #
  # Unconditional as of Task 3 (#272/#310): the call used to be gated behind a
  # `*'${'*)` case, because `_oss_manifest_resolve` required
  # `.workspace/pairing.json` to exist even for a token-free string, which
  # refused every topology-only lookup outright. Task 3 made the resolver
  # source its vocabulary from the shape instead of re-discovering a pairing
  # manifest, so a plain literal root - the common case - now passes through
  # as a no-op (the substitution loop only replaces what actually appears in
  # the string) rather than failing. MEASURED, not assumed: the full suite
  # (`bash tests/run-all.sh`, 1418 assertions) was run once with the old gate
  # in place and once with it removed - identical ALL GREEN both times - before
  # this simplification was kept.
  local ai_root; ai_root="$(printf '%s' "$shape" | jq -r '.workspace // empty')"
  root="$(_oss_manifest_resolve "$ai_root" "$root")" || return 1
  # Mirrors `_oss_manifest_wellknown_guard` (#165) and shares its grammar test, so
  # the two refusals cannot drift the way their wording already did. Same reasoning:
  # the token is documented workspace-init vocabulary that ossify deliberately does
  # not resolve (#152), so the generic "unresolved token" wording reads as a typo and
  # sends the operator to workspace-init's docs, where it is legal - away from the fix.
  # A MALFORMED PLUGIN_DATA spelling is a typo and correctly falls through to the
  # generic arm below.
  if _oss_is_plugin_data_token "$root"; then
    echo "oss: repo '$key' root uses \${PLUGIN_DATA:...}, which ossify does not resolve - route it with \${ai_workspace.root}, \${canonical.root}, \${HOME}, \${USER}, or an absolute path: '$root'" >&2
    return 2
  fi
  case "$root" in
    *'${'*) echo "oss: repo '$key' root has an unresolved token: '$root'" >&2; return 2 ;;
    /*) ;;
    *) echo "oss: repo '$key' root is not absolute: '$root'" >&2; return 2 ;;
  esac
  printf '%s\n' "$root"
}

# `oss_worktree_dir` was REMOVED in v0.2.0: built in Plan C1 and never called by
# the dispatcher, another lib, a test, or any prose. Every consumer that needs
# the path composes it from `_oss_repo_root` inline, which is what the functions
# below do.

oss_worktree_add() { # $1=repo-key $2=work-item-id $3=slug $4=base-ref ; echoes abs path
  local key="$1" wi="$2" slug="$3" base="${4:-HEAD}" root dir path branch
  root="$(_oss_repo_root "$key")" || return $?
  dir="$root/.worktrees"; path="$dir/$wi"
  branch="$(oss_id_work_item_branch "$wi" "$slug")"
  [ -e "$path" ] && { echo "oss: worktree already exists at $path" >&2; return 8; }
  mkdir -p "$dir" || return 8
  _oss_worktree_ignore "$root" || true
  # NOT `2>&1`: this function's STDOUT IS ITS RETURN VALUE (the abs path), so
  # merging git's stderr into stdout makes any warning git decides to emit become
  # part of the path the caller captures. `-q` is silent on success today, which
  # is exactly what makes this the kind of latent bug that surfaces years later
  # on someone else's git version or with a chatty hook installed. Let stderr be
  # stderr.
  if ! git -C "$root" worktree add -q -b "$branch" "$path" "$base"; then
    echo "oss: git worktree add failed for $wi (branch $branch, base $base)" >&2
    return 8
  fi
  printf '%s\n' "$path"
}

# The worktree root lives INSIDE the repo, so without this every spawn leaves
# `?? .worktrees/` in that repo's status - a dirty tree ossify itself
# created, in the very repo whose cleanliness the close ceremony checks. The
# leading dot already keeps most test runners out (pytest's default
# `norecursedirs` includes `.*`; `go test ./...` skips dirs beginning with `.`
# or `_`), so this closes the reporting half, not a demo-integrity hole.
#
# `.git/info/exclude`, NOT `.gitignore` - and this was verified empirically, not
# reasoned about. `.gitignore` is TRACKED in any real project, so appending to it
# leaves ` M .gitignore` and produces exactly the dirty tree this exists to
# prevent (measured: appending to a tracked .gitignore yields ` M .gitignore`;
# writing to .git/info/exclude yields an EMPTY status). `info/exclude` is
# repo-local, never tracked, never pushed, and is the idiomatic place for an
# ignore the tool owns rather than the project. Never edit a file the project
# owns to make a tool's own artifact disappear.
_oss_worktree_ignore() { # $1=repo-root ; best-effort, never fatal
  # Resolve the real git common dir rather than assuming `.git` is a directory.
  # A repo created with `git init --separate-git-dir` (or a submodule) has a
  # `.git` FILE pointing elsewhere — its info/exclude lives at the common dir,
  # not at `$1/.git/info/exclude`. The old `[ -d "$1/.git" ] || return 0`
  # guard skipped those repos, leaving `.worktrees/` permanently un-excluded
  # and that repo's tree dirty on every spawn. (Codex P2 finding #5.)
  local cd
  cd="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
    || { echo "oss: cannot resolve git common dir for $1 - .worktrees/ not excluded" >&2; return 1; }
  local ex="$cd/info/exclude"
  mkdir -p "$cd/info" || return 1
  [ -f "$ex" ] && grep -qxF '.worktrees/' "$ex" && return 0
  printf '%s\n' '.worktrees/' >> "$ex" 2>/dev/null || return 1
}

oss_worktree_resolve() { # $1=repo-key $2=work-item-id
  local root path; root="$(_oss_repo_root "$1")" || return $?
  path="$root/.worktrees/$2"
  [ -d "$path" ] || { echo "oss: no worktree for '$2' under $root/.worktrees" >&2; return 1; }
  printf '%s\n' "$path"
}

# Orphan detection - the ONE real use of the enumeration verb v0.2 retired (see
# the `oss_cmd_worktree_list` tombstone in lib/commands.sh, which named this
# requirement and said to build the primitive against it rather than before it).
#
# This is deliberately NOT that verb rebuilt. The tombstone's objection to
# enumeration was that a filesystem listing "answers a question no ceremony asks
# and can disagree with state". Both halves still hold - so what ships is the
# DISAGREEMENT ITSELF: the set of directories under <repo>/.worktrees that no
# work item in state claims. That set is the finding, and it is the only form of
# the question `doctor` has to ask.
#
# A directory is CLAIMED when a work item's journaled `worktree_path` is exactly
# it, or when its basename is a work item's id. The second arm is not slack.
# `oss_worktree_add` names the directory for its work item, but nothing writes
# `worktree_path` into state until `work_item_exec` journals one - so matching on
# the path alone reports every freshly-spawned worktree as an orphan, i.e. it is
# loudest precisely when the project is behaving correctly.
#
# PURE SELECTOR: the finding is the OUTPUT, never the rc. rc 0 means the check
# RAN, not that the tree is clean; a caller branching on rc reports every project
# as orphan-free. That is the same polarity the doctor SURFACE uses for
# quarantines, fakes and patch records - counted, surfaced as `warn:`, never
# folded into an exit code. (Those were doctor.sh checks until PR #184 slimmed
# the verb to its gate; they are skill prose now, and the polarity travelled with
# them.) It deliberately does NOT copy `oss touch_check`'s rc-0-is-a-hit
# polarity, which close/SKILL.md §7 already lists as a trap for exactly this
# reason.
oss_worktree_orphans() { # $1=repo-key [$2=state-file] ; echoes one abs path per orphan
  local key root sf dir path default_key
  if [ -z "${1:-}" ]; then key="$(_oss_default_repo_key)" || return $?; else key="$1"; fi
  root="$(_oss_repo_root "$key")" || return $?
  sf="$(_oss_resolve_state "${2:-}")" || return $?
  [ -f "$sf" ] || { echo "oss: state file not found at $sf" >&2; return 1; }
  # Parse the state ONCE, up front, and fail loudly if it does not parse.
  # Without this the per-directory `jq -e … || printf` treats a PARSE ERROR
  # (jq rc 5) exactly like a false predicate, so a corrupt state file makes
  # every worktree look orphaned - and `oss doctor` then stacks a
  # deletion-flavoured warning on top of the corrupt-state finding that is the
  # real problem. A selector that cannot read its input has not found zero
  # matches; it has failed. (Codex P2, PR #149.)
  # Two structural preconditions, both checked ONCE up front, because the
  # per-directory predicate below cannot tell an evaluation ERROR from a false
  # result - `jq -e … || printf` reports "unclaimed" for both.
  #
  #   1. the file parses at all (malformed JSON: jq rc 5);
  #   2. `.work_items` is an ARRAY. A parseable, replay-consistent state whose
  #      `.work_items` is a string or object makes jq error while iterating, so
  #      every directory reports as orphaned and the selector still exits 0 -
  #      the same deletion-flavoured false positive as (1), reached from a state
  #      that (1) happily accepts. `// []` does not cover this: a string is
  #      truthy, so the alternative never fires.
  # (Codex P2, PR #149 rounds 1 and 3.)
  jq -e . "$sf" >/dev/null 2>&1 || {
    echo "oss: state file at $sf is not valid JSON - cannot tell an orphan from a claimed worktree" >&2
    return 1
  }
  # `.work_items` shape is NOT checked here. It is validated inside the single
  # jq expression below, together with the computation it guards - see the note
  # there for why splitting them was the thing that kept going wrong.
  # A CONFIGURED ROOT THAT DOES NOT EXIST HAS NOT BEEN INSPECTED, and must not
  # reach the early return below. `_oss_repo_root` validates the manifest VALUE
  # - non-empty, token-free, absolute - but never that the directory is
  # there, so an unmounted volume or a moved repo resolved cleanly, failed
  # `[ -d "$dir" ]`, and exited 0 with no output. That is indistinguishable from
  # "inspected, nothing orphaned", and it violates this function's own contract
  # that rc 0 means the check RAN. `oss doctor` printed
  # `ok: worktrees(private_core) - none orphaned` about a repository absent from
  # the machine - the same false assurance #156 fixed, one level in, and
  # reachable on every repo key at once. (Codex P1, PR #160.)
  #
  # rc 2 deliberately: this is the same "cannot use this repo" class as an
  # unconfigured key, so every caller that already handles `_oss_repo_root`'s
  # rc 2 handles this with no new branch - including doctor's skip arm.
  [ -d "$root" ] || { echo "oss: repo '$key' root does not exist at $root" >&2; return 2; }
  # EXISTS is not the same as CAN BE INSPECTED, and the difference is invisible
  # to `-d`. On a root the caller cannot traverse, `[ -d "$root" ]` is TRUE while
  # `[ -d "$root/.worktrees" ]` is FALSE - not because the directory is absent
  # but because the stat cannot be performed - so a private checkout mounted
  # with restrictive permissions walked past the guard above straight into the
  # "nothing spawned yet" arm and reported clean. (Measured: with mode 000,
  # `-d root` true, `-x root` false, `-d root/.worktrees` false while the
  # directory demonstrably exists.) Same false-clean class as a missing root,
  # reached by permissions instead of absence. (Codex, PR #160 round 2.)
  #
  # EXECUTE ONLY, deliberately. This guard first demanded `-r` as well, and that
  # was an OVER-CORRECTION: reaching `$root/.worktrees` needs TRAVERSAL, while
  # read on the root is what LISTING the root would need - and this selector
  # never lists the root, it composes the `.worktrees` path directly. So a
  # mode-0111 root is fully inspectable and was being skipped. (Measured
  # 2026-08-13: at 0111, `-x root` true, `-r root` FALSE, `-d root/.worktrees`
  # true, and the orphan under it enumerable.) A false SKIP is milder than the
  # false CLEAN above - it says "did not look", which is honest - but it still
  # stops doctor reporting genuine orphans on a repo it can read. #162, from the
  # Codex review that landed six minutes after PR #160 merged.
  #
  # The minimum each operation actually needs is the rule here: traversal on the
  # root, read AND traversal on `.worktrees`, which is the directory enumerated.
  [ -x "$root" ] \
    || { echo "oss: repo '$key' root at $root cannot be traversed (permissions)" >&2; return 2; }
  dir="$root/.worktrees"
  # Nothing spawned yet is not a finding. Reachable only once the root above is
  # known to exist AND to be traversable, which is what keeps this arm meaning
  # what it says rather than absorbing two different failures.
  [ -d "$dir" ] || return 0
  # The same distinction one level down: `.worktrees` itself can be unreadable
  # while `-d` succeeds through the parent's execute bit. The glob below would
  # then match nothing, leave `cands` empty, and return 0 - clean, from a
  # directory never listed.
  { [ -x "$dir" ] && [ -r "$dir" ]; } \
    || { echo "oss: repo '$key' worktree dir at $dir cannot be read (permissions)" >&2; return 2; }

  local -a cands=()
  for path in "$dir"/*; do
    # An unmatched glob leaves the PATTERN itself as the single iteration value;
    # `-d` rejects it. `nullglob` would be tidier and is deliberately not set -
    # it is a shell-wide option and every other function the dispatcher sources
    # was written without it, so turning it on here changes their behaviour too.
    [ -d "$path" ] || continue
    cands+=("$path")
  done
  # Guarded BEFORE expansion: under `set -u`, bash 3.2 errors on "${a[@]}" for an
  # empty array, and bash 3.2 is what macOS ships.
  [ "${#cands[@]}" -gt 0 ] || return 0

  # ONE jq invocation over the whole candidate set - not one per directory, and
  # this shape is the fix for a CLASS rather than for a case.
  #
  # The previous form ran `jq -e … || printf` per directory, and that `||`
  # cannot distinguish jq returning FALSE (this directory is unclaimed: a
  # finding) from jq ERRORING (the state could not be inspected: not a finding).
  # So every malformed shape reported EVERY directory as an orphan, at rc 0,
  # with a deletion-flavoured message. It was patched three times for three
  # shapes - malformed JSON, a non-array `.work_items`, a non-object element -
  # and a fourth shape would have done it again.
  #
  # With a single call, jq's exit status IS the error signal, once: rc 0 means
  # the claims were inspected and the output is the finding; nonzero means they
  # were not, and NOTHING is reported.
  #
  # Validation lives in the same expression as the computation, deliberately.
  # Splitting them into separate bash pre-guards is what kept going wrong: each
  # guard covered the one shape that had just been reported, and the next shape
  # walked straight past all of them into the `||`. Here the shape checks
  # `error()` out through the same channel the computation uses, so an
  # unvalidated shape cannot reach the finding path at all - and a junk record
  # is REFUSED rather than silently skipped, because "some records are garbage"
  # is not evidence that a directory is unclaimed.
  #
  # SCOPED TO THIS REPO KEY. Without the `target_repo` filter, a private_core
  # work item whose id happens to be `r0.s1.w1` makes
  # `canonical/.worktrees/r0.s1.w1` look claimed - which suppresses exactly the
  # wrong-repository directory the repo-key design exists to expose, and in the
  # worst case leaves private work sitting under the public canonical root.
  # Items predating the field default to the sole-repo default rule's answer,
  # matching how `oss_cmd_work_item_add` defaults it (#272/#310 Task 4 - was a
  # literal `canonical`).
  #
  # LAZY, deliberately: `default_key` is only needed when some record actually
  # lacks `target_repo` - never, for anything written since #272/#310 Task 4,
  # because `oss_entity_add_work_item` now always fills the field (explicit or
  # resolved). Computing it UNCONDITIONALLY would make every orphan check
  # refuse outright under N>1 declared repos, even one scoped to a perfectly
  # valid EXPLICIT key with no legacy record in sight - the declared-membership
  # check above already proved `$key` is real; ambiguity in the DEFAULT must
  # not veto a call that never asked for the default. (Measured: this broke
  # `private_core`-scoped orphan detection under the two-repo PRIV/QRT fixtures
  # in test-worktree.sh when implemented as the brief's literal unconditional
  # precompute - fixed here rather than left broken.)
  local needs_default
  needs_default="$(jq -r '([.work_items[]? | select(.target_repo == null)] | length) > 0' "$sf" 2>/dev/null)" || needs_default=true
  if [ "$needs_default" = "true" ]; then
    # The refusal itself is the spec's fail-safe rule (#272/#310 Task 4): a
    # record predating `target_repo` is genuinely ambiguous under N>1 and
    # guessing a repo for it is worse than stopping. What was wrong is the
    # MESSAGE. `_oss_default_repo_key` says "no repo key given" - and here one
    # WAS given; the ambiguity is in the legacy records, not in the call. A
    # caller who reads that refusal re-runs with the key they already passed.
    if ! default_key="$(_oss_default_repo_key 2>/dev/null)"; then
      echo "oss: $(jq -r '[.work_items[]? | select(.target_repo == null)] | length' "$sf" 2>/dev/null) work item(s) in '$sf' carry no target_repo, and with [$(printf '%s' "$(_oss_shape_file 2>/dev/null)" | jq -r '.repos | keys | join(", ")' 2>/dev/null)] declared there is no safe repo to attribute them to - refusing rather than guessing. This is not about the repo key you passed. Set target_repo on those records (they predate the field) and re-run." >&2
      return 2
    fi
  else
    default_key=""
  fi
  printf '%s\n' "${cands[@]}" | jq -R -s -r --arg k "$key" --arg dk "$default_key" --slurpfile st "$sf" '
      ($st[0].work_items // []) as $all
      | (if ($all | type) != "array" then
           error(".work_items is not an array")
         elif ($all | any(type != "object")) then
           error(".work_items holds a record that is not an object")
         elif ($all | any(
                  (.id            != null and (.id            | type) != "string")
               or (.target_repo   != null and (.target_repo   | type) != "string")
               or (.worktree_path != null and (.worktree_path | type) != "string"))) then
           error(".work_items holds a record whose id, target_repo or worktree_path is not a string")
         else . end)
      | ($all | map(select((.target_repo // $dk) == $k))) as $mine
      | split("\n") | map(select(length > 0))
      | map(select(
          . as $p
          | ($p | split("/") | last) as $b
          | ($mine | any((.worktree_path // "") == $p or (.id // "") == $b)) | not))
      | .[]' || {
    echo "oss: cannot inspect work-item claims in $sf - refusing to report orphans from unreadable state" >&2
    return 1
  }
}

# D9: HALT on a dirty worktree; never `--force`. The source retries with --force
# (discarding uncommitted work) and swallows the branch delete with `|| true`,
# while its own skill prose promises a halt and the close ceremony asserts no
# work-* branch survives. Both halves are fixed here.
oss_worktree_remove() { # $1=repo-key $2=work-item-id
  local key="$1" wi="$2" root path branch dirty
  root="$(_oss_repo_root "$key")" || return $?
  path="$(oss_worktree_resolve "$key" "$wi")" || return $?
  dirty="$(git -C "$path" status --porcelain 2>/dev/null)" || dirty=""
  if [ -n "$dirty" ]; then
    echo "oss: worktree $path has uncommitted changes - refusing to remove it" >&2
    printf '%s\n' "$dirty" >&2
    return 8
  fi
  branch="$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null)" || branch=""
  git -C "$root" worktree remove "$path" || { echo "oss: git worktree remove failed for $path" >&2; return 8; }
  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    # `-d`, NOT `-D`. -D force-deletes an UNMERGED branch, destroying every
    # commit the implementer made. The close ceremony merges work/<wi> back into
    # the spine branch first (T9), so by the time remove runs the branch IS
    # merged and -d succeeds. If it does not, that is the signal that something
    # upstream failed to merge - surface it, never force past it.
    git -C "$root" branch -d "$branch" >/dev/null 2>&1 \
      || { echo "oss: worktree removed but branch '$branch' is not merged - refusing to force-delete it; merge or abandon it explicitly" >&2; return 8; }
  fi
}
