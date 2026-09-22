#!/usr/bin/env bash
# lib/manifest.sh — pairing manifest read/write/resolve/validate
#
# Cross-plugin contract per SPEC §6.2 / §6.3 / §6.4 / §6.5.
# Consumers: scaffold-onboard v0.2, scaffold-dev v0.1, architect-critic v0.2 (loose).
#
# Bash 3.2+ compatible (stock macOS). Requires: jq.
#
# Implementation strategy:
#   - WRITE: constructed with `jq -n` using --arg / --argjson (NOT template
#            substitution). Safer for structured JSON; preserves literal
#            `${ai_workspace.root}` / `${canonical.root}` placeholders that
#            must remain unresolved at write time and be resolved at read time
#            by wi_manifest_resolve.
#   - READ:  thin `jq -r` wrapper that returns full JSON or a specific path.
#   - RESOLVE: pure-bash parameter expansion + a regex loop for ${PLUGIN_DATA:<name>}.
#
# Functions:
#   wi_plugin_data_dir <plugin-name>
#   wi_manifest_write  <ai-root> <canonical-root> <project-type> [--git-remote URL]
#                      [--canonical-git-remote URL] [--default-branch NAME]
#   wi_manifest_read   <ai-root> [<field-jq-path>]
#   wi_manifest_resolve <ai-root> <string-with-vars>
#   wi_manifest_validate <ai-root>

set -u

# Source helpers if not already loaded (wi_log_* etc).
if ! declare -F wi_log_info >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_helpers.sh"
fi

# ---------------------------------------------------------------------------
# Constants (per SPEC §6.5)
# ---------------------------------------------------------------------------

# Writer emits this version. Bump on breaking schema change.
WI_MANIFEST_SCHEMA_VERSION="1.0"

# Reader accepts these versions. Single value in v0.1.0; comma-separated list
# in later releases as additive versions accrue.
WI_MANIFEST_SUPPORTED_VERSIONS="1.0"

# Manifest path is always <ai-root>/.workspace/pairing.json (per SPEC §6.1).
_wi_manifest_path() {
  echo "$1/.workspace/pairing.json"
}

# wi_plugin_version — resolve the writing tool's version from the sibling plugin
# manifest. `created_by` is provenance ("which workspace-init wrote this manifest"),
# so it must reflect the actual running version, not a frozen literal (#71). The
# .claude-plugin manifest is the single source of truth and is already guarded by
# tests/test-codex-dual-publish.sh. Fallback keeps the <semver> shape if unreadable.
wi_plugin_version() {
  local libdir manifest ver="" src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" ]]; then
    libdir="$(cd "$(dirname "$src")" && pwd)"
    manifest="$libdir/../.claude-plugin/plugin.json"
    ver="$(jq -r '.version // empty' "$manifest" 2>/dev/null)"
  fi
  [[ -n "$ver" ]] || ver="0.0.0"
  printf '%s' "$ver"
}

# ---------------------------------------------------------------------------
# wi_plugin_data_dir — Claude Code plugin-data convention
# ---------------------------------------------------------------------------
#
# Discovery (2026-05-25):
#   - Claude Code sets ${CLAUDE_PLUGIN_DATA} per-process to the INVOKING
#     plugin's data dir. Useless for cross-plugin resolution (SPEC §6.3).
#   - Actual layout on disk: ~/.claude/plugins/data/<plugin>-<marketplace>/
#     (e.g. architect-critic-claude-agent-scaffolding).
#   - But marketplace suffix is unknown at manifest-author time. Existing
#     plugins (scaffold, scaffold-onboard, ai-mentor, architect-critic) all
#     fall back to ${HOME}/.claude/plugins/data/<plugin> for their own data
#     paths when ${CLAUDE_PLUGIN_DATA} is unset (e.g. shell-level tests).
#
# Resolution order:
#   1. ${CLAUDE_PLUGINS_ROOT}/<plugin>/data  — if env var is set (future-proof)
#   2. ${HOME}/.claude/plugins/data/<plugin>-<marketplace> — if a directory
#       matching that prefix exists under the known plugin-data root
#       (matches the actual on-disk layout for installed plugins)
#   3. ${HOME}/.claude/plugins/data/<plugin> — convention used by existing
#       plugins' own fallbacks; always returned as the final default
#       (regardless of existence, per SPEC §13.3 — path is returned, warning
#       is optional in v0.1).
#
# Note on (2): callers may pass plugin names that aren't installed. We don't
# guarantee the returned path exists; SPEC §13.3 explicitly says the resolver
# returns a path even for missing plugins.
wi_plugin_data_dir() {
  local plugin="$1"
  if [[ -z "$plugin" ]]; then
    wi_log_error "wi_plugin_data_dir: missing plugin name"
    return 1
  fi

  # (1) Future env var hook
  if [[ -n "${CLAUDE_PLUGINS_ROOT:-}" ]]; then
    echo "${CLAUDE_PLUGINS_ROOT}/${plugin}/data"
    return 0
  fi

  # (2) Probe for actual installed-plugin marketplace-suffixed dir
  local data_root="${HOME}/.claude/plugins/data"
  if [[ -d "$data_root" ]]; then
    # Glob may leave the literal pattern if no match; guard with -d.
    local cand
    for cand in "$data_root/${plugin}"-*; do
      if [[ -d "$cand" ]]; then
        echo "$cand"
        return 0
      fi
    done
    # Also accept exact-name match (no marketplace suffix)
    if [[ -d "$data_root/${plugin}" ]]; then
      echo "$data_root/${plugin}"
      return 0
    fi
  fi

  # (3) Default fallback — convention used by existing plugins' own paths.
  # Path may not exist yet; that's fine for SPEC §13.3.
  echo "${data_root}/${plugin}"
  return 0
}

# ---------------------------------------------------------------------------
# wi_manifest_write
# ---------------------------------------------------------------------------
# Usage:
#   wi_manifest_write <ai-root> <canonical-root> <project-type> \
#     [--git-remote URL] [--canonical-git-remote URL] [--default-branch NAME]
#
# Writes <ai-root>/.workspace/pairing.json. Atomic via tmp-then-mv. Constructs
# JSON with `jq -n` for safety (proper escaping, no template clobber of the
# literal `${ai_workspace.root}` / `${canonical.root}` placeholders in
# during_dev + well_known_paths).
wi_manifest_write() {
  local ai_root="" canonical_root="" project_type=""
  local ai_git_remote_json="null"
  local canonical_git_remote_json="null"
  local default_branch="main"
  # ai_workspace.git_tracked: a JSON boolean literal. Defaults true (fresh-init and
  # Scenario-A create the AI workspace as a git repo); the Scenario-C pairing skill
  # passes --ai-git-tracked false when the existing AI workspace is not a git repo (#71).
  local ai_git_tracked_json="true"
  # Optional tooling_repo (#48 Stage 2 marketplace routing). Absent → key omitted.
  local tooling_root=""
  local tooling_git_remote_json="null"

  # Positional args first (3 required).
  if [[ $# -lt 3 ]]; then
    wi_log_error "wi_manifest_write: usage: wi_manifest_write <ai-root> <canonical-root> <project-type> [--flags]"
    return 1
  fi
  ai_root="$1"; canonical_root="$2"; project_type="$3"
  shift 3

  # Flags.
  while (( $# > 0 )); do
    case "$1" in
      --git-remote)
        if [[ -z "${2:-}" ]]; then
          wi_log_error "wi_manifest_write: --git-remote requires URL"
          return 1
        fi
        # Use --argjson with a JSON string so null vs "url" is preserved.
        ai_git_remote_json="$(printf '%s' "$2" | jq -R '.')"
        shift 2
        ;;
      --canonical-git-remote)
        if [[ -z "${2:-}" ]]; then
          wi_log_error "wi_manifest_write: --canonical-git-remote requires URL"
          return 1
        fi
        canonical_git_remote_json="$(printf '%s' "$2" | jq -R '.')"
        shift 2
        ;;
      --default-branch)
        if [[ -z "${2:-}" ]]; then
          wi_log_error "wi_manifest_write: --default-branch requires NAME"
          return 1
        fi
        default_branch="$2"
        shift 2
        ;;
      --ai-git-tracked)
        case "${2:-}" in
          true|false) ai_git_tracked_json="$2" ;;
          *) wi_log_error "wi_manifest_write: --ai-git-tracked requires true|false"; return 1 ;;
        esac
        shift 2
        ;;
      --tooling-repo)
        if [[ -z "${2:-}" ]]; then
          wi_log_error "wi_manifest_write: --tooling-repo requires PATH"
          return 1
        fi
        tooling_root="$2"
        shift 2
        ;;
      --tooling-repo-remote)
        if [[ -z "${2:-}" ]]; then
          wi_log_error "wi_manifest_write: --tooling-repo-remote requires URL"
          return 1
        fi
        tooling_git_remote_json="$(printf '%s' "$2" | jq -R '.')"
        shift 2
        ;;
      *)
        wi_log_error "wi_manifest_write: unknown flag: $1"
        return 1
        ;;
    esac
  done

  # Validation.
  case "$project_type" in
    personal|work) ;;
    *) wi_log_error "wi_manifest_write: invalid project_type '$project_type' (expected: personal|work)"; return 1 ;;
  esac

  # tooling_repo (optional): a remote without a root would be silently dropped at
  # emit time (the key is gated on tooling_root); and a relative root breaks the
  # later `cd "$target"` in scaffold-dev's sd_issue_create. Fail loud on both.
  if [[ "$tooling_git_remote_json" != "null" && -z "$tooling_root" ]]; then
    wi_log_error "wi_manifest_write: --tooling-repo-remote requires --tooling-repo"
    return 1
  fi
  if [[ -n "$tooling_root" && "$tooling_root" != /* ]]; then
    wi_log_error "wi_manifest_write: --tooling-repo must be an absolute path: $tooling_root"
    return 1
  fi

  if [[ ! -d "$ai_root" ]]; then
    wi_log_error "wi_manifest_write: ai_root not a directory: $ai_root"
    return 1
  fi

  local ai_name canonical_name
  ai_name="$(basename "$ai_root")"
  canonical_name="$(basename "$canonical_root")"
  local tooling_name=""
  [[ -n "$tooling_root" ]] && tooling_name="$(basename "$tooling_root")"

  # ISO 8601 UTC timestamp.
  local created_at
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Ensure .workspace/ exists; mkdir -p is idempotent.
  local manifest
  manifest="$(_wi_manifest_path "$ai_root")"
  local manifest_dir
  manifest_dir="$(dirname "$manifest")"
  mkdir -p "$manifest_dir" || {
    wi_log_error "wi_manifest_write: failed to create $manifest_dir"
    return 1
  }

  # Build via `jq -n`. Tmp-then-mv for atomicity.
  local tmp="${manifest}.tmp.$$"
  if ! jq -n \
      --arg schema_version           "$WI_MANIFEST_SCHEMA_VERSION" \
      --arg ai_root                  "$ai_root" \
      --arg ai_name                  "$ai_name" \
      --arg canonical_root           "$canonical_root" \
      --arg canonical_name           "$canonical_name" \
      --arg canonical_default_branch "$default_branch" \
      --arg project_type             "$project_type" \
      --arg created_at               "$created_at" \
      --arg created_by               "workspace-init@$(wi_plugin_version)" \
      --argjson ai_git_tracked       "$ai_git_tracked_json" \
      --argjson ai_git_remote        "$ai_git_remote_json" \
      --argjson canonical_git_remote "$canonical_git_remote_json" \
      --arg     tooling_root         "$tooling_root" \
      --arg     tooling_name         "$tooling_name" \
      --argjson tooling_git_remote   "$tooling_git_remote_json" \
      '{
         schema_version: $schema_version,
         topology: "dual-repo",
         ai_workspace: {
           root: $ai_root,
           name: $ai_name,
           git_tracked: $ai_git_tracked,
           git_remote: $ai_git_remote
         },
         canonical: {
           root: $canonical_root,
           name: $canonical_name,
           git_tracked: true,
           git_remote: $canonical_git_remote,
           default_branch: $canonical_default_branch
         },
         tooling_repo: (if $tooling_root != "" then {
           root: $tooling_root,
           name: $tooling_name,
           git_remote: $tooling_git_remote
         } else null end),
         routing: {
           master_spec:              "ai_workspace",
           executive_summary:        "canonical",
           memory_bank:              "ai_workspace",
           claude_md:                "ai_workspace",
           agents_md:                "ai_workspace",
           scaffold_project_outputs: "ai_workspace",
           backlog:                  "canonical",
           project_plan:             "canonical",
           roadmap:                  "canonical",
           prd:                      "canonical",
           srs:                      "canonical",
           product_adrs:             "canonical",
           process_adrs:             "ai_workspace",
           sprint_specs:             "ai_workspace",
           implementation_handoffs:  "ai_workspace",
           brainstorm_artifacts:     "ai_workspace"
         },
         during_dev: {
           worktrees_dir:        "${canonical.root}/.worktrees",
           branch_naming:        "slice/sprint-{N}-work-{NN}-{kebab-name}",
           sprint_dir_template:  "${ai_workspace.root}/docs/specs/sprint-{N}",
           slice_spec_format:    "wabash-format-b-v1"
         },
         well_known_paths: {
           master_spec:            "${ai_workspace.root}/docs/MASTER-SPEC.md",
           memory_bank:            "${ai_workspace.root}/.claude/memory-bank",
           roadmap_state:          "${ai_workspace.root}/.workspace/project-roadmap.json",
           superpowers_brainstorm: "${ai_workspace.root}/.superpowers/brainstorm"
         },
         git_policy: {
           project_type:           $project_type,
           allow_ai_local_commits: true,
           allow_ai_local_merge:   true,
           allow_ai_local_rebase:  true,
           allow_ai_fetch:         false,
           allow_ai_push:          false,
           allow_ai_pull:          false,
           trace_filter: {
             enforce: true,
             blocked_patterns: [
               "^Co-Authored-By:",
               "^🤖 Generated with",
               "<noreply@anthropic\\.com>",
               "<noreply@openai\\.com>"
             ]
           }
         },
         created_at: $created_at,
         created_by: $created_by
       }
       | (if .tooling_repo == null then del(.tooling_repo) else . end)' > "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    wi_log_error "wi_manifest_write: jq failed building manifest at $manifest"
    return 1
  fi

  mv "$tmp" "$manifest" || {
    wi_log_error "wi_manifest_write: failed to mv tmp to $manifest"
    rm -f "$tmp"
    return 1
  }
  return 0
}

# ---------------------------------------------------------------------------
# wi_manifest_read
# ---------------------------------------------------------------------------
# Usage:
#   wi_manifest_read <ai-root>                  → full JSON to stdout
#   wi_manifest_read <ai-root> <field-jq-path>  → `jq -r` of that field
#
# Returns:
#   0  on success
#   1  if manifest is missing OR (when a field is given) the field is absent / null
#
# A "missing field" is distinguished from JSON null using `jq -e`. Boolean
# false is intentionally treated as a present-with-value (not missing).
wi_manifest_read() {
  local ai_root="$1"
  local field="${2:-}"
  local manifest
  manifest="$(_wi_manifest_path "$ai_root")"

  if [[ ! -f "$manifest" ]]; then
    wi_log_error "wi_manifest_read: manifest not found: $manifest"
    return 1
  fi

  if [[ -z "$field" ]]; then
    # Full JSON.
    cat "$manifest"
    return 0
  fi

  # Field requested. Honor the contract above: a present, non-null value (INCLUDING
  # boolean false / 0) is returned; only a missing key, a non-indexable path, or JSON
  # null counts as "missing". Do NOT use `// empty` or `jq -e` here — jq's `//` and
  # `-e` both treat false/0 as falsy, which would mis-read git_tracked:false and the
  # allow_ai_* booleans (#71/#84, Devin). `try … catch null` swallows path-index
  # errors (e.g. `.does.not.exist`) the way the old `2>/dev/null` did.
  local result
  result="$(jq -r "try (${field}) catch null | if . == null then empty else . end" "$manifest" 2>/dev/null)"
  if [[ -z "$result" ]]; then
    return 1
  fi
  echo "$result"
  return 0
}

# ---------------------------------------------------------------------------
# wi_manifest_resolve
# ---------------------------------------------------------------------------
# Usage:
#   wi_manifest_resolve <ai-root> <string-with-vars>
#
# Resolves the four forms per SPEC §6.3, in this order:
#   1. ${ai_workspace.root}, ${canonical.root}  — manifest field refs
#   2. ${PLUGIN_DATA:<plugin-name>}             — cross-plugin data dir
#   3. ${HOME}, ${USER}                         — standard env vars
#
# Output: resolved string to stdout (no trailing newline manipulation beyond
# `echo`'s default).
#
# Returns 1 if the manifest is missing; 0 otherwise. Unresolved tokens are
# left in place (the caller can detect them by looking for `${`).
wi_manifest_resolve() {
  local ai_root="$1"
  local input="$2"
  local manifest
  manifest="$(_wi_manifest_path "$ai_root")"

  if [[ ! -f "$manifest" ]]; then
    wi_log_error "wi_manifest_resolve: manifest not found: $manifest"
    return 1
  fi

  local result="$input"

  # Form 1 — manifest field refs.
  local aw_root cn_root
  aw_root="$(jq -r '.ai_workspace.root // empty' "$manifest" 2>/dev/null)"
  cn_root="$(jq -r '.canonical.root    // empty' "$manifest" 2>/dev/null)"
  if [[ -n "$aw_root" ]]; then
    result="${result//\$\{ai_workspace.root\}/$aw_root}"
  fi
  if [[ -n "$cn_root" ]]; then
    result="${result//\$\{canonical.root\}/$cn_root}"
  fi

  # Form 2 — ${PLUGIN_DATA:<name>}. Bash 3.2 supports BASH_REMATCH with [[ =~ ]].
  # Allow [a-zA-Z0-9_-] in plugin names (hyphens are common; underscores possible).
  # Bound the loop to avoid pathological inputs.
  local guard=0
  while [[ "$result" =~ \$\{PLUGIN_DATA:([a-zA-Z0-9_-]+)\} ]]; do
    local plugin="${BASH_REMATCH[1]}"
    local data_dir
    data_dir="$(wi_plugin_data_dir "$plugin")" || {
      wi_log_warn "wi_manifest_resolve: wi_plugin_data_dir failed for '$plugin'"
      # Replace with empty to avoid infinite loop.
      result="${result//\$\{PLUGIN_DATA:${plugin}\}/}"
      continue
    }
    result="${result//\$\{PLUGIN_DATA:${plugin}\}/$data_dir}"
    guard=$((guard + 1))
    if (( guard > 64 )); then
      wi_log_warn "wi_manifest_resolve: PLUGIN_DATA loop guard tripped (>64 substitutions)"
      break
    fi
  done

  # Form 3 — standard env vars. Limited set per SPEC §6.3 ("also supported").
  result="${result//\$\{HOME\}/$HOME}"
  # USER may be unset in minimal envs; fall back to id -un.
  local _user="${USER:-$(id -un 2>/dev/null)}"
  result="${result//\$\{USER\}/$_user}"

  echo "$result"
  return 0
}

# SPEC §6.3 refers to this resolver as `mi_manifest_resolve` (cross-plugin
# canonical name). Provided as an alias so consumers (scaffold-onboard,
# scaffold-dev) that follow the SPEC name verbatim find it without indirection.
mi_manifest_resolve() { wi_manifest_resolve "$@"; }

# ---------------------------------------------------------------------------
# wi_manifest_validate
# ---------------------------------------------------------------------------
# Usage:
#   wi_manifest_validate <ai-root>
#
# Checks:
#   - Manifest exists and is valid JSON
#   - schema_version is in WI_MANIFEST_SUPPORTED_VERSIONS
#   - All §6.4 "yes" required fields present
#
# Returns 0 on valid, 1 with an error message to stderr otherwise. Error
# messages naming the manifest path so consumers can act on the message.
wi_manifest_validate() {
  local ai_root="$1"
  local manifest
  manifest="$(_wi_manifest_path "$ai_root")"

  if [[ ! -f "$manifest" ]]; then
    wi_log_error "wi_manifest_validate: manifest not found at $manifest"
    return 1
  fi

  # Must be valid JSON.
  if ! jq -e . "$manifest" >/dev/null 2>&1; then
    wi_log_error "wi_manifest_validate: $manifest is not valid JSON"
    return 1
  fi

  # schema_version.
  local v
  v="$(jq -r '.schema_version // empty' "$manifest" 2>/dev/null)"
  if [[ -z "$v" ]]; then
    wi_log_error "wi_manifest_validate: schema_version missing in $manifest"
    return 1
  fi
  # Membership test against comma-separated WI_MANIFEST_SUPPORTED_VERSIONS.
  local accepted=0
  local IFS=,
  local sv
  for sv in $WI_MANIFEST_SUPPORTED_VERSIONS; do
    if [[ "$sv" == "$v" ]]; then accepted=1; break; fi
  done
  unset IFS
  if (( accepted == 0 )); then
    wi_log_error "wi_manifest_validate: schema_version '$v' unsupported in $manifest (supported: $WI_MANIFEST_SUPPORTED_VERSIONS); update workspace-init"
    return 1
  fi

  # Required-field checks (per SPEC §6.4 table — "yes" rows).
  #
  # We use a single jq program for all presence checks; jq returns the
  # comma-separated names of any missing fields (or empty when all present).
  local missing
  missing="$(jq -r '
    [
      (if has("schema_version")    then empty else "schema_version"    end),
      (if has("topology")          then empty else "topology"          end),
      (if .ai_workspace            != null then empty else "ai_workspace" end),
      (if .ai_workspace.root       != null then empty else "ai_workspace.root" end),
      (if .ai_workspace.name       != null then empty else "ai_workspace.name" end),
      (if .ai_workspace | has("git_tracked") then empty else "ai_workspace.git_tracked" end),
      (if .canonical               != null then empty else "canonical" end),
      (if .canonical.root          != null then empty else "canonical.root" end),
      (if .canonical.name          != null then empty else "canonical.name" end),
      (if .canonical | has("git_tracked")    then empty else "canonical.git_tracked" end),
      (if .canonical.default_branch != null then empty else "canonical.default_branch" end),
      # tooling_repo is OPTIONAL (#48 Stage 2); validate its sub-schema only when present.
      # Guard on object-type FIRST: a non-object value (e.g. a hand-edited string)
      # would make the .root/.name indexing throw, abort jq, and — with stderr
      # swallowed — let `missing` come back empty so an invalid manifest passes.
      (if (has("tooling_repo") and (.tooling_repo | type) != "object") then "tooling_repo (must be an object)" else empty end),
      (if (has("tooling_repo") and (.tooling_repo | type) == "object") then (if .tooling_repo.root != null then empty else "tooling_repo.root" end) else empty end),
      (if (has("tooling_repo") and (.tooling_repo | type) == "object") then (if .tooling_repo.name != null then empty else "tooling_repo.name" end) else empty end),
      (if .routing                 != null then empty else "routing" end),
      (if .routing.master_spec              != null then empty else "routing.master_spec" end),
      (if .routing.executive_summary        != null then empty else "routing.executive_summary" end),
      (if .routing.memory_bank              != null then empty else "routing.memory_bank" end),
      (if .routing.claude_md                != null then empty else "routing.claude_md" end),
      (if .routing.agents_md                != null then empty else "routing.agents_md" end),
      (if .routing.scaffold_project_outputs != null then empty else "routing.scaffold_project_outputs" end),
      (if .routing.backlog                  != null then empty else "routing.backlog" end),
      (if .routing.project_plan             != null then empty else "routing.project_plan" end),
      (if .routing.roadmap                  != null then empty else "routing.roadmap" end),
      (if .routing.prd                      != null then empty else "routing.prd" end),
      (if .routing.srs                      != null then empty else "routing.srs" end),
      (if .routing.product_adrs             != null then empty else "routing.product_adrs" end),
      (if .routing.process_adrs             != null then empty else "routing.process_adrs" end),
      (if .routing.sprint_specs             != null then empty else "routing.sprint_specs" end),
      (if .routing.implementation_handoffs  != null then empty else "routing.implementation_handoffs" end),
      (if .routing.brainstorm_artifacts     != null then empty else "routing.brainstorm_artifacts" end),
      (if .during_dev                       != null then empty else "during_dev" end),
      (if .during_dev.worktrees_dir         != null then empty else "during_dev.worktrees_dir" end),
      (if .during_dev.branch_naming         != null then empty else "during_dev.branch_naming" end),
      (if .during_dev.sprint_dir_template   != null then empty else "during_dev.sprint_dir_template" end),
      (if .during_dev.slice_spec_format     != null then empty else "during_dev.slice_spec_format" end),
      (if .git_policy                       != null then empty else "git_policy" end),
      (if .git_policy.project_type          != null then empty else "git_policy.project_type" end),
      (if .git_policy | has("allow_ai_local_commits") then empty else "git_policy.allow_ai_local_commits" end),
      (if .git_policy | has("allow_ai_local_merge")   then empty else "git_policy.allow_ai_local_merge"   end),
      (if .git_policy | has("allow_ai_local_rebase")  then empty else "git_policy.allow_ai_local_rebase"  end),
      (if .git_policy | has("allow_ai_fetch")         then empty else "git_policy.allow_ai_fetch"         end),
      (if .git_policy | has("allow_ai_push")          then empty else "git_policy.allow_ai_push"          end),
      (if .git_policy | has("allow_ai_pull")          then empty else "git_policy.allow_ai_pull"          end),
      (if .git_policy.trace_filter          != null then empty else "git_policy.trace_filter" end),
      (if .git_policy.trace_filter | has("enforce")          then empty else "git_policy.trace_filter.enforce" end),
      (if .git_policy.trace_filter | has("blocked_patterns") then empty else "git_policy.trace_filter.blocked_patterns" end),
      (if .created_at != null then empty else "created_at" end),
      (if .created_by != null then empty else "created_by" end)
    ] | join(", ")
  ' "$manifest" 2>/dev/null)"

  if [[ -n "$missing" ]]; then
    wi_log_error "wi_manifest_validate: $manifest missing required fields: $missing"
    return 1
  fi

  return 0
}
