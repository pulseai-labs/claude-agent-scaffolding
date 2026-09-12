#!/usr/bin/env bash
# Dispatcher subcommands for the onboarding + planning skills. Thin wrappers:
# resolve the state path (explicit > OSS_STATE_FILE > manifest) then delegate to
# the tested lib functions. NO judgment logic here - that lives in the skills.
#
# Repo rc taxonomy (the cross-verb contract): 1 generic, 2 usage, 3 lock,
# 4 apply-failure, 5 drift, 6 schema, 7 unknown-ref, 8 git/worktree.

# Arity guard. `bin/oss` runs `set -euo pipefail`, so a wrapper that expands
# `"$1"` when the caller passed nothing dies with bash's raw `unbound variable`
# at rc 1 - not the taxonomy's rc 2 = usage, and with no hint of what was
# missing. 44 of the 61 verbs did exactly that.
#
# Placed FIRST in each wrapper, so `"$1"` below it is provably safe and no
# body needs changing. Where a lib function already validates its own input
# (`oss_reg_touch_check` rejects a zero-path call at rc 2) the wrapper
# stays out of the way - the guard is for the expansion, not a second opinion.
#
# `$#` is counted AFTER the three fixed parameters are shifted off, so the
# count compares against the caller's own arguments.
_oss_need() { # $1=count $2=verb $3=usage ; then "$@" from the caller
  local want="$1" verb="$2" usage="$3"; shift 3
  [ "$#" -ge "$want" ] || {
    echo "oss: $verb needs $want argument(s) - usage: oss $verb $usage" >&2; return 2; }
}

oss_cmd_init() { # $1=project-name
  _oss_need 1 init "<project-name>" "$@" || return 2
  local sf; sf="$(_oss_resolve_state)" || return $?
  oss_state_init "$sf" "$1"
}
oss_cmd_posture_set() { # $1=posture
  _oss_need 1 posture_set "<posture>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?
  oss_state_mutate "$sf" set_posture "$(jq -n --arg p "$1" '{posture:$p}')"
}
oss_cmd_composition_set() { # $1=composition-root
  _oss_need 1 composition_set "<composition-root>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?
  oss_state_mutate "$sf" set_composition "$(jq -n --arg c "$1" '{composition_root:$c}')"
}
oss_cmd_overlay_set() { # $1=overlay-wiring
  _oss_need 1 overlay_set "<overlay-wiring>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?
  oss_state_mutate "$sf" set_overlay "$(jq -n --arg o "$1" '{overlay_wiring:$o}')"
}
oss_cmd_release_add() { # $1=name $2=goal
  _oss_need 2 release_add "<name> <goal>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_entity_add_release "$sf" "$1" "$2"
}
oss_cmd_spine_add() { # $1=release $2=name $3=class [$4=target_repo]
  _oss_need 3 spine_add "<release> <name> <class> [target_repo]" "$@" || return 2;
  local sf tr; sf="$(_oss_resolve_state)" || return $?
  tr="$(_oss_repo_key_for_write "${4:-}")" || return $?
  oss_entity_add_spine "$sf" "$1" "$2" "$3" "$tr"
}
oss_cmd_class_set() { # $1=spine $2=new-class $3=reason
  _oss_need 3 class_set "<spine> <new-class> <reason>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_entity_set_spine_class "$sf" "$1" "$2" "$3"
}
oss_cmd_bone_add() { # $1=adr $2=title $3=touch-csv [$4=revisit]
  _oss_need 3 bone_add "<adr> <title> <touch-csv> [revisit]" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_reg_add_bone "$sf" "$1" "$2" "$3" "${4:-}"
}
oss_cmd_risk_gate_add() { # $1=name $2=touch-csv $3=controls-csv
  _oss_need 3 risk_gate_add "<name> <touch-csv> <controls-csv>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_reg_add_risk_gate "$sf" "$1" "$2" "$3"
}
oss_cmd_risk_gate_set_controls() { # $1=name $2=controls-csv — corrective append (#340)
  _oss_need 2 risk_gate_set_controls "<name> <controls-csv>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_reg_set_risk_gate_controls "$sf" "$1" "$2"
}
oss_cmd_fake_add() { # $1=boundary $2=channel $3=reason $4=trigger $5=expiry-release
  _oss_need 5 fake_add "<boundary> <channel> <reason> <trigger> <expiry-release>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_reg_add_fake "$sf" "$1" "$2" "$3" "$4" "$5"
}
oss_cmd_feature_add() { # $1=name $2=value $3=class-guess $4=source
  _oss_need 4 feature_add "<name> <value> <class-guess> <source>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_reg_add_feature "$sf" "$1" "$2" "$3" "$4"
}
oss_cmd_touch_check() { # $@=paths
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_reg_touch_check "$sf" "$@"
}
oss_cmd_ledger_add_auto() { # $1=spine $2=text $3=command $4=expected
  _oss_need 4 ledger_add_auto "<spine> <text> <command> <expected>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_add_auto "$sf" "$1" "$2" "$3" "$4"
}
oss_cmd_ledger_add_user() { # $1=spine $2=text $3=outcome
  _oss_need 3 ledger_add_user "<spine> <text> <outcome>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_add_user "$sf" "$1" "$2" "$3"
}
oss_cmd_ledger_supersede() { # $1=line $2=by-spine $3=reason
  _oss_need 3 ledger_supersede "<line> <by-spine> <reason>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_supersede "$sf" "$1" "$2" "$3"
}
oss_cmd_ledger_retire() { # $1=line $2=by-spine $3=reason
  _oss_need 3 ledger_retire "<line> <by-spine> <reason>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_retire "$sf" "$1" "$2" "$3"
}
oss_cmd_ledger_quarantine()    { _oss_need 2 ledger_quarantine "<line-id> <reason> [release]" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_quarantine "$sf" "$1" "$2" "${3:-}"; }
oss_cmd_ledger_apply_pending() { _oss_need 1 ledger_apply_pending "<spine>" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_apply_pending "$sf" "$1"; }
oss_cmd_ledger_unplan()        { _oss_need 2 ledger_unplan "<line> <spine>" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_unplan "$sf" "$1" "$2"; }
oss_cmd_fake_status()          { _oss_need 3 fake_status "<boundary> <active|replaced|renewed> <reason> [new-expiry-release]" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_reg_set_fake_status "$sf" "$1" "$2" "$3" "${4:-}"; }
# The two release-close blocking gates (§6.2 steps 3 and 4). Both are rc 0 =
# CLEAN / 1 = BLOCKING / 2 = could-not-check - the OPPOSITE polarity to
# `touch_check`, which is 0 = hit. Read-only selectors: no mutation, no op.
oss_cmd_expired_fakes()        { _oss_need 1 expired_fakes "<release>" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_reg_expired_fakes "$sf" "$1"; }
oss_cmd_expired_quarantines()  { _oss_need 1 expired_quarantines "<release>" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_expired_quarantines "$sf" "$1"; }
oss_cmd_patch_add() { # $1=commit $2=text [$3=repo-key]
  _oss_need 2 patch_add "<commit-sha> <text> [repo-key]" "$@" || return 2;
  local sf repo; sf="$(_oss_resolve_state)" || return $?
  # Resolved to a CHECKED key here, not left for `oss_ledger_add_patch`'s own
  # default tier: the explicit half of that tier was trusted verbatim, so a
  # typo'd or undeclared key entered the journal and failed much later, during
  # routing, with nothing left to say which ceremony wrote it.
  repo="$(_oss_repo_key_for_write "${3:-}")" || return $?
  oss_ledger_add_patch "$sf" "$1" "$2" "$repo"
}
# Explicit state file beats the environment. Without this argument a pre-flight
# probe in one project silently reads another project's state via a stale
# exported $OSS_STATE_FILE (final review, Minor 1).
oss_cmd_get() { # $1=jq-expr [$2=state-file]
  _oss_need 1 get "<jq-expr> [state-file]" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state "${2:-}")" || return $?
  oss_state_read "$sf" "$1"
}

oss_cmd_state_restore()  { local sf; sf="$(_oss_resolve_state "${1:-}")" || return $?; oss_state_restore "$sf"; }
# `oss_cmd_manifest_get` was REMOVED in v0.2.0. Every manifest field already has
# a dedicated resolver that this raw accessor bypassed: roots via `repo_root`,
# and `well_known_paths.project_state` via `oss_manifest_state_path`.
# (`.memory_bank` has no verb since the harvest conversion — the ceremony
# resolves it in prose, close/references/harvest.md §7.) Those resolvers
# substitute the `${ai_workspace.root}` tokens; the raw read did not, so
# `manifest_get '.well_known_paths.project_state'` handed the caller a literal
# unresolved token string. Zero prose consumers plus a wrong answer for the only
# fields left to ask about. The LIB function `oss_manifest_get` stays - it is
# what `_oss_repo_root` is built on.
oss_cmd_manifest_require(){ oss_manifest_require; }
# The release's docs directory, ABSOLUTE. Prose consumers are readers who are
# not standing in a known directory, which is why this resolves the root rather
# than returning `oss_id_release_dir`'s relative half.
oss_cmd_release_dir()    {
  _oss_need 1 release_dir "<release-id>" "$@" || return 2
  local ai; ai="$(_oss_repo_root ai_workspace)" || return $?
  printf '%s/%s\n' "$ai" "$(oss_id_release_dir "$1")"
}
oss_cmd_work_item_branch(){ _oss_need 2 work_item_branch "<wi-id> <slug>" "$@" || return 2; oss_id_work_item_branch "$1" "$2"; }
oss_cmd_spine_dir()      { _oss_need 3 spine_dir "<release> <spine> <slug>" "$@" || return 2; oss_id_spine_dir "$1" "$2" "$3"; }
oss_cmd_branch_name()    { _oss_need 2 branch_name "<spine> <slug>" "$@" || return 2; oss_id_branch_name "$1" "$2"; }
# The close router (Task 9) derives its scope from the id SHAPE, so it needs this
# through the dispatcher - oss_id_parse has no wrapper today, and skill prose
# cannot reach a bare lib function (bin/oss dispatches only oss_cmd_*).
oss_cmd_id_parse()       { _oss_need 1 id_parse "<id>" "$@" || return 2; oss_id_parse "$1"; }
oss_cmd_feature_list()      { local sf; sf="$(_oss_resolve_state)" || return $?; oss_state_read "$sf" '[.feature_map[]]'; }
oss_cmd_spine_list()        { local sf; sf="$(_oss_resolve_state)" || return $?; oss_state_read "$sf" '[.spines[]]'; }
oss_cmd_ledger_active_auto(){ local sf; sf="$(_oss_resolve_state)" || return $?; oss_ledger_active_auto "$sf"; }
oss_cmd_work_item_add() { # $1=spine $2=title [$3=target_repo]
  _oss_need 2 work_item_add "<spine> <title> [target_repo]" "$@" || return 2;
  local sf tr; sf="$(_oss_resolve_state)" || return $?
  tr="$(_oss_repo_key_for_write "${3:-}")" || return $?
  oss_entity_add_work_item "$sf" "$1" "$2" "$tr"
}
oss_cmd_release_set_meta() { # $1=release $2=patch-json
  _oss_need 2 release_set_meta "<release> <patch-json>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_entity_set_release_meta "$sf" "$1" "$2"
}
oss_cmd_veto_add() { # $1=spine $2=finding $3=disposition $4=reason
  _oss_need 4 veto_add "<spine> <finding> <disposition> <reason>" "$@" || return 2;
  local sf; sf="$(_oss_resolve_state)" || return $?; oss_entity_add_veto "$sf" "$1" "$2" "$3" "$4"
}
oss_cmd_spine_status()     { _oss_need 2 spine_status "<spine> <status>" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_entity_set_spine_status "$sf" "$1" "$2"; }
oss_cmd_work_item_status() { _oss_need 2 work_item_status "<wi-id> <status>" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_entity_set_work_item_status "$sf" "$1" "$2"; }
oss_cmd_release_status()   { _oss_need 2 release_status "<release> <status>" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_entity_set_release_status "$sf" "$1" "$2"; }
oss_cmd_work_item_exec()   { _oss_need 4 work_item_exec "<wi-id> <branch> <worktree> <base-sha>" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_entity_set_work_item_exec "$sf" "$1" "$2" "$3" "$4"; }

# §9.2's explicit, never-silent migration. Journals a `migrate_schema` op rather
# than rewriting the file in place, so `$sf.base.json` stays v1 and replay still
# rebuilds live from base+journal across the version boundary.
oss_cmd_migrate() { # [$1=state-file]
  local sf v; sf="$(_oss_resolve_state "${1:-}")" || return $?
  v="$(jq -r '.schema_version // empty' "$sf" 2>/dev/null)" || v=""
  case "$v" in ''|*[!0-9]*) echo "oss: state schema missing/invalid - cannot migrate" >&2; return 6 ;; esac
  if [ "$v" -eq "$OSS_STATE_SCHEMA_VERSION" ]; then echo "already at v$v"; return 0; fi
  if [ "$v" -gt "$OSS_STATE_SCHEMA_VERSION" ]; then
    echo "oss: state schema v$v is newer than this build (v$OSS_STATE_SCHEMA_VERSION) - upgrade ossify, do not migrate" >&2
    return 6
  fi
  # F1 (2026-07-31): `migrate_schema` is version-agnostic (every clause
  # `has(...)`-guarded, verified against both a v1 and a v2 fixture) and
  # single-hop by design - it carries every upgrade the registry knows about
  # in one journaled op, not one op per version. This allowlist is deliberately
  # exact (1|2), not "< current": a state at some OTHER stale version is a gap
  # this build does not know how to close and must say so by name, never
  # guess-migrate it.
  case "$v" in
    1|2) ;;
    *) echo "oss: no migration path from v$v to v$OSS_STATE_SCHEMA_VERSION" >&2; return 6 ;;
  esac
  oss_state_mutate "$sf" migrate_schema \
    "$(jq -n --argjson from "$v" --argjson to "$OSS_STATE_SCHEMA_VERSION" '{from:$from,to:$to}')" || return $?
  echo "migrated v$v -> v$OSS_STATE_SCHEMA_VERSION"
}

# Filesystem probe for architect-critic v0.2 (binary v0.2-or-absent), mirroring
# scaffold-onboard's sf_compose_detect_architect_critic. No in-plugin callers
# remain: 1.1.0 moved the critic in-tree (skills/challenge/), so the lifecycle
# audits no longer probe for a peer plugin. Retained for external consumers
# and deprecated; removal is a major. No composition.json read. Stateless by
# design: it takes no state path and needs no manifest, so a skill can probe
# before (or without) an initialized project.
# Scan EVERY cache before deciding, and report the highest version found. The
# previous form returned on the first hit and globbed only critiquing-spec, so a
# stale v0.2 directory won over a newer v0.3 install and v0.3 was unreportable.
oss_cmd_critic_detect() {
  local cache critic_root skill_md found="absent"
  # An explicit override root (set by the .opencode wrapper when ossify is
  # selected as the architect-critic capability) takes priority over the
  # ambient cache scan. The root points at the plugin directory itself
  # (e.g. architect-critic/skills/critiquing-spec/SKILL.md).
  critic_root="${OSS_ARCHITECT_CRITIC_ROOT:-}"
  if [ -n "$critic_root" ] && [ -f "$critic_root/skills/critiquing-spec/SKILL.md" ]; then
    if [ -f "$critic_root/skills/managing-async-critique/SKILL.md" ]; then
      echo "v0.3"
    else
      echo "v0.2"
    fi
    return 0
  fi
  # `${HOME:-}`, not `${HOME}`: under the dispatcher's `set -u` an unset HOME is a
  # fatal parameter-expansion error raised BEFORE the loop body runs, so none of
  # the errexit-exemption machinery below applies - the probe dies with empty
  # stdout instead of echoing `absent`. That breaks the documented contract that
  # it answers on any machine, installed or not. The sibling was already guarded.
  for cache in "${HOME:-}/.claude/plugins/cache" "${CLAUDE_PLUGINS_DIR:-}"; do
    { [ -z "$cache" ] || [ ! -d "$cache" ]; } && continue
    for skill_md in "$cache"/*/architect-critic/*/skills/critiquing-spec/SKILL.md; do
      [ -f "$skill_md" ] || continue
      if [ -f "${skill_md%/skills/critiquing-spec/SKILL.md}/skills/managing-async-critique/SKILL.md" ]; then
        found="v0.3"
      elif [ "$found" = "absent" ]; then
        found="v0.2"
      fi
    done
  done
  echo "$found"
  [ "$found" = "absent" ] && return 1
  return 0
}

# Per-work-item verification gate (Task 5 / spec §6). Thin wrappers, no
# judgment logic - state-file resolution does not apply here, these take
# explicit paths/args like the id.sh wrappers above.
oss_cmd_verify_acs()          { _oss_need 1 verify_acs "<abs-spec-path>" "$@" || return 2; oss_verify_parse_acs "$1"; }
oss_cmd_verify_step()         { _oss_need 3 verify_step "<workdir> <command> <expectation>" "$@" || return 2; oss_verify_auto_step "$1" "$2" "$3"; }
oss_cmd_redgate()             { _oss_need 3 redgate "<workdir> <command> <expectation>" "$@" || return 2; oss_verify_redgate "$1" "$2" "$3"; }
oss_cmd_zero_tests_guard()    { _oss_need 1 zero_tests_guard "<runner-command>" "$@" || return 2; oss_verify_zero_tests_guard "$1"; }
oss_cmd_report_cross_check()  { _oss_need 2 report_cross_check "<report-path> <spec-path>" "$@" || return 2; oss_verify_report_cross_check "$1" "$2"; }

# Per-work-item worktree layer (Task 4). D4: repo-parameterized - every
# declared repo resolves via _oss_repo_root; an omitted key routes through the
# sole-repo default rule (#272/#310 Task 4). Thin dispatcher wrappers, no
# judgment logic.
oss_cmd_repo_root() {
  local key
  if [ -z "${1:-}" ]; then key="$(_oss_default_repo_key)" || return $?; else key="$1"; fi
  _oss_repo_root "$key"
}
oss_cmd_worktree_add()     { _oss_need 3 worktree_add "<repo-key> <wi-id> <slug> [base-ref]" "$@" || return 2; oss_worktree_add "$1" "$2" "$3" "${4:-HEAD}"; }
oss_cmd_worktree_resolve() { _oss_need 2 worktree_resolve "<repo-key> <wi-id>" "$@" || return 2; oss_worktree_resolve "$1" "$2"; }
oss_cmd_worktree_remove()  { _oss_need 2 worktree_remove "<repo-key> <wi-id>" "$@" || return 2; oss_worktree_remove "$1" "$2"; }
# `oss_cmd_worktree_list` was REMOVED in v0.2.0, with its lib function. STATE is
# the source of truth for worktrees ossify created - `work_item_exec` journals
# `worktree_path`, and spine-close.md §10 removes each one by reading state, not
# by enumerating the filesystem. An enumeration verb answers a question no
# ceremony asks and can disagree with state when it does. Its one real use,
# orphan detection (a directory on disk with no state record), was BUILT AGAINST
# THAT REQUIREMENT in v0.3 as `oss worktree_orphans` below - the disagreement,
# not the listing. The retired verb stays retired: `test-worktree.sh` asserts it
# is still an unknown subcommand (rc 2).
oss_cmd_worktree_orphans() {
  local key
  if [ -z "${1:-}" ]; then key="$(_oss_default_repo_key)" || return $?; else key="$1"; fi
  oss_worktree_orphans "$key" "${2:-}"
}

# Cumulative demo runner (spec §6.1 + companion §4.3). Thin dispatcher
# wrappers, no judgment logic - resolution (workdir, composition root) lives in
# lib/demo.sh; the vacuous-green guard lives in lib/verify.sh.
oss_cmd_demo_run() { # [$1=state-file] [$2=workdir]
  local sf; sf="$(_oss_resolve_state "${1:-}")" || return $?
  oss_demo_run_auto "$sf" "${2:-}"
}
# The workdir `demo_run` would use, without running anything. cumulative-demo.md
# section 2's quarantine check has to execute the failing command in exactly
# that directory, and it had no way to ask: `oss_demo_workdir` was lib-private,
# so the recipe referenced a `$wd` nothing ever assigned. Exposing the existing
# resolver is the fix rather than restating its tier rules in prose, which would
# drift from them the first time they changed.
oss_cmd_demo_workdir() { # [$1=state-file] [$2=explicit-workdir]
  local sf; sf="$(_oss_resolve_state "${1:-}")" || return $?
  oss_demo_workdir "$sf" "${2:-}"
}
oss_cmd_demo_user_lines() { local sf; sf="$(_oss_resolve_state)" || return $?; oss_demo_user_lines "$sf" "${1:-}"; }
oss_cmd_demo_record()     { _oss_need 4 demo_record "<work_item|spine|release> <id> <true|false> <line-count> [notes]" "$@" || return 2; local sf; sf="$(_oss_resolve_state)" || return $?; oss_demo_record_close "$sf" "$1" "$2" "$3" "$4" "${5:-}"; }

# Machine-checkable rules (spec §9.1, `doctor`'s third surface) have NO verbs
# since the skill-first conversion. Shape validation is performed by reading
# against the field table in doctor/references/rule-authoring.md §3 — and with
# the evaluator settled WONTFIX (2026-08-15), nothing in ossify consumes an
# mcrule block mechanically: the work-item gate's Layer 3 agent read is this
# stack's evaluation mechanism (what any other stack does with the shared
# artifact is that stack's own contract). The old --file/heredoc
# delimiter-injection hazard (Codex P1, PR #149 round 5) died with the verbs —
# no rule body enters shell source at all now, and the prose keeps the
# residual rule that one never does.

# Claude/Codex interop (spec §9.1, `doctor`'s fourth surface) has NO verb. It was
# 175 lines of bash that opened files and described what it found - diagnostics,
# which the skill-first line puts in prose. `doctor/references/interop-check.md`
# now carries it, and the agent emits the same ok:/fail: grammar by reading.
#
# What stayed here is the part that is not diagnosis: `oss repo_root` and
# `oss state_path` resolve paths, every mutating verb routes through them, and
# two spellings of one path is a real defect class. The prose calls those.
