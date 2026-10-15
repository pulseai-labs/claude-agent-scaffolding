#!/usr/bin/env bash
# lib/enumerate-targets.sh — scan target enumeration per SPEC §6.3 (T2-J pin).
# Requires: lib/helpers.sh.

CSA_GLOB_SECRETS="${CSA_GLOB_SECRETS:-*.md *.json *.sh *.py *.js *.ts}"
CSA_GLOB_PERMISSIONS="${CSA_GLOB_PERMISSIONS:-settings.json settings.local.json}"
CSA_GLOB_HOOKS="${CSA_GLOB_HOOKS:-*.sh *.json}"
CSA_GLOB_MCP="${CSA_GLOB_MCP:-*.json}"
CSA_GLOB_CLAUDE_MD="${CSA_GLOB_CLAUDE_MD:-CLAUDE.md}"
CSA_GLOB_PROMPT_INJECTION="${CSA_GLOB_PROMPT_INJECTION:-*.md}"
CSA_GLOB_MARKETPLACE="${CSA_GLOB_MARKETPLACE:-marketplace.json}"

csa_enum_codex_project_targets() {
  local root="$1"
  local has_codex_surface=0
  [[ -f "$root/AGENTS.md" ]] && { has_codex_surface=1; printf '%s\n' "$root/AGENTS.md"; }

  if [[ -d "$root/.codex" ]]; then
    has_codex_surface=1
    find "$root/.codex" -type f \
         \( -name '*.md' -o -name '*.json' -o -name '*.toml' -o -name '*.sh' \
            -o -name '*.py' -o -name '*.js' -o -name '*.ts' \) 2>/dev/null
    find "$root/.codex" -type l 2>/dev/null | while read -r sl; do
      printf 'info: symlink at %s not followed\n' "$sl" >&2
    done
  fi

  [[ -f "$root/.agents/plugins/marketplace.json" ]] && { has_codex_surface=1; printf '%s\n' "$root/.agents/plugins/marketplace.json"; }
  local codex_manifests
  codex_manifests="$(find "$root" -path '*/.codex-plugin/plugin.json' -type f 2>/dev/null)"
  [[ -n "$codex_manifests" ]] && { has_codex_surface=1; printf '%s\n' "$codex_manifests"; }

  if [[ "$has_codex_surface" -eq 1 && -f "${HOME}/.codex/config.toml" ]]; then
    printf '%s\n' "${HOME}/.codex/config.toml"
  fi
}

csa_enum_opencode_project_targets() {
  local root="$1"
  if [[ -L "$root/package.json" ]]; then
    printf 'info: symlink at %s not followed\n' "$root/package.json" >&2
  elif [[ -f "$root/package.json" ]]; then
    printf '%s\n' "$root/package.json"
  fi

  [[ -e "$root/.opencode" || -L "$root/.opencode" ]] || return 0
  find "$root/.opencode" \
       \( -path "$root/.opencode/node_modules" -o -path "$root/.opencode/audits" \) -prune -o \
       -type f \
       -not -path "$root/.opencode/package.json" \
       -not -path "$root/.opencode/package-lock.json" \
       -not -path "$root/.opencode/bun.lock" \
       -not -path "$root/.opencode/.gitignore" \
       -print 2>/dev/null
  find "$root/.opencode" \
       \( -path "$root/.opencode/node_modules" -o -path "$root/.opencode/audits" \) -prune -o \
       -type l -print 2>/dev/null | while read -r sl; do
    printf 'info: symlink at %s not followed\n' "$sl" >&2
  done
}

# _csa_enum_unlisted_hook_handlers <project-root>
# Emit every executable regular file under .claude/hooks/ whose suffix the main
# pass below does not list (extensionless, hidden, or an unlisted dotted suffix
# such as `preflight.tool`, #426), or reject newline-containing ones. Listed
# suffixes are skipped here so the main pass emits them exactly once: keep this
# case list equal to its -name list.
_csa_enum_unlisted_hook_handlers() {
  local root="$1" hooks="$1/.claude/hooks"
  [[ -d "$hooks" ]] || return 0

  find "$hooks" -type f -print0 2>/dev/null | while IFS= read -r -d '' handler; do
    case "${handler##*/}" in
      *.md|*.json|*.sh|*.py|*.js|*.ts) : ;;
      *) if [[ -x "$handler" ]]; then
           if [[ "$handler" == *$'\n'* || "$handler" == *$'\t'* ]]; then
             printf 'refusing newline-or-tab-containing executable hook handler\n' >&2
             return 2
           fi
           printf '%s\n' "$handler"
         else
           :
         fi
         ;;
    esac
  done
}

csa_enum_project_targets() {
  local root="$1"
  if [[ -d "$root/.claude" ]]; then
    if ! _csa_enum_unlisted_hook_handlers "$root"; then
      return 2
    fi
    # Exclude .claude/audits/ — it holds audit state/reports and must not be scanned.
    find "$root/.claude" -type f \
         -not -path "$root/.claude/audits/*" \
         \( -name '*.md' -o -name '*.json' -o -name '*.sh' \
            -o -name '*.py' -o -name '*.js' -o -name '*.ts' \) 2>/dev/null
    find "$root/.claude" -type l \
         -not -path "$root/.claude/audits/*" 2>/dev/null | while read -r sl; do
      printf 'info: symlink at %s not followed\n' "$sl" >&2
    done
  fi
  find "$root" -name 'CLAUDE.md' -type f 2>/dev/null
  [[ -f "$root/.claude-plugin/marketplace.json" ]] && printf '%s\n' "$root/.claude-plugin/marketplace.json"
  csa_enum_opencode_project_targets "$root"
  csa_enum_codex_project_targets "$root"
}

# _csa_enum_settings_plugin_list <settings-file> — the file's enabledPlugins
# array as compact JSON. An absent file, malformed JSON (SETTINGS-PARSE is the
# rule engine's concern) or a value that is not an array reads as []. A path
# that exists but is not a regular file, or cannot be read, is NOT an empty
# list: rc 2 (#424).
_csa_enum_settings_plugin_list() {
  local f="$1" list
  if [[ ! -e "$f" ]]; then
    printf '[]\n'
    return 0
  fi
  if [[ ! -f "$f" ]]; then
    # A FIFO would block jq forever; a directory holds no settings.
    printf 'csa: %s is not a regular file; the enabled-plugin set is unknown\n' "$f" >&2
    return 2
  fi
  if [[ ! -r "$f" ]]; then
    printf 'csa: cannot read %s; the enabled-plugin set is unknown\n' "$f" >&2
    return 2
  fi
  list="$(jq -c '.enabledPlugins // [] | if type == "array" then . else [] end' "$f" 2>/dev/null)" || list='[]'
  printf '%s\n' "${list:-[]}"
}

# _csa_enum_enabled_json <project-root> — the merged, de-duplicated enabled set
# as one JSON array. The lists reach jq on stdin, never as an argv value, so
# no OS per-argument limit can empty them (#424); a failure is rc 2, never [].
_csa_enum_enabled_json() {
  local root="$1" project_list user_list merged
  project_list="$(_csa_enum_settings_plugin_list "$root/.claude/settings.json")" || return 2
  user_list="$(_csa_enum_settings_plugin_list "${HOME}/.claude/settings.json")" || return 2
  if ! merged="$(printf '%s\n%s\n' "$project_list" "$user_list" | jq -sc 'add | unique')"; then
    printf 'csa: could not merge the enabled-plugin lists\n' >&2
    return 2
  fi
  printf '%s\n' "$merged"
}

csa_enum_enabled_plugins() {
  local merged
  merged="$(_csa_enum_enabled_json "$1")" || return 2
  printf '%s\n' "$merged" | jq -c '.[]' | tr -d '"'
}

csa_enum_resolve_plugin_path() {
  local name="$1"
  local cache_dir="${HOME}/.claude/plugins/cache/${name}"
  if [[ -d "$cache_dir" ]]; then
    if [[ -f "$cache_dir/.active" ]]; then
      printf '%s/%s\n' "$cache_dir" "$(cat "$cache_dir/.active")"
      return 0
    fi
    local versions; versions=$(find "$cache_dir" -maxdepth 1 -mindepth 1 -type d 2>/dev/null)
    local count; count=$(printf '%s\n' "$versions" | grep -c .)
    if [[ "$count" -eq 1 ]]; then
      printf '%s\n' "$versions"
      return 0
    fi
  fi
  local local_dir="${HOME}/.claude/plugins/local/${name}"
  if [[ -d "$local_dir" ]]; then
    printf '%s\n' "$local_dir"
    return 0
  fi
  return 1
}

csa_enum_targets_all() {
  local root="$1" project_targets
  if ! project_targets="$(csa_enum_project_targets "$root")"; then
    return 2
  fi
  # Captured first: a process substitution would drop the rc 2 of an
  # unreadable settings file and scan as if no plugin were enabled (#424).
  local enabled_plugins
  if ! enabled_plugins="$(csa_enum_enabled_plugins "$root")"; then
    return 2
  fi
  {
    [[ -n "$project_targets" ]] && printf '%s\n' "$project_targets"
    while read -r plugin_name; do
      [[ -z "$plugin_name" ]] && continue
      local plugin_path
      if ! plugin_path="$(csa_enum_resolve_plugin_path "$plugin_name")"; then
        printf 'finding: PROVENANCE-002 plugin %s enabled but not installed at expected path\n' "$plugin_name" >&2
        continue
      fi
      find "$plugin_path" -type f 2>/dev/null | while read -r f; do
        local rel="${f#$plugin_path/}"
        printf '@plugin:%s:%s\t%s\n' "$plugin_name" "$rel" "$f"
      done
    done <<< "$enabled_plugins"
  } | awk -F '\t' '!seen[$NF]++'
}

# csa_enum_paranoid_candidates — cached plugins that are not enabled, one per
# line, sorted by codepoint. Read/report only: it lists candidates and never
# approves anything. Each cache directory name is one identity, compared whole
# against the enabled set inside jq (NUL-delimited in, no word splitting,
# #425). A candidate whose name holds a newline cannot be one output line, so
# the enumeration refuses with rc 2 and emits nothing rather than split it.
csa_enum_paranoid_candidates() {
  local cache="${HOME}/.claude/plugins/cache"
  [[ -d "$cache" ]] || return 0
  local enabled_json names_file rc=0
  enabled_json="$(_csa_enum_enabled_json "${CSA_PROJECT_ROOT:-$PWD}")" || return 2
  names_file="$(mktemp "${TMPDIR:-/tmp}/csa-cache-names.XXXXXX")" || return 2
  if ! find "$cache" -maxdepth 1 -mindepth 1 -type d -print0 > "$names_file" 2>/dev/null; then
    printf 'csa: cannot list the plugin cache %s\n' "$cache" >&2
    rm -f "$names_file"
    return 2
  fi
  printf '%s\n' "$enabled_json" | jq -r --rawfile names "$names_file" '
    (map(select(type == "string") | {(.): true}) | add // {}) as $enabled
    | [ $names | split("\u0000")[] | select(length > 0) | split("/") | last ]
    | unique
    | map(select($enabled[.] | not))
    | if any(.[]; contains("\n"))
      then "csa: refusing a plugin cache name that contains a newline\n" | halt_error(2)
      else .[]
      end' || rc=2
  rm -f "$names_file"
  return "$rc"
}
