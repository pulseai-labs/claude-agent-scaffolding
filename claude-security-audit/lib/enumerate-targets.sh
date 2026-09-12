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

# _csa_enum_extensionless_hook_handlers <project-root>
# Emit safe extensionless executable handlers or reject newline-containing ones.
_csa_enum_extensionless_hook_handlers() {
  local root="$1" hooks="$1/.claude/hooks"
  [[ -d "$hooks" ]] || return 0

  find "$hooks" -type f -print0 2>/dev/null | while IFS= read -r -d '' handler; do
    case "${handler##*/}" in
      *.*) : ;;
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
    if ! _csa_enum_extensionless_hook_handlers "$root"; then
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

csa_enum_enabled_plugins() {
  local root="$1"
  local project_settings="$root/.claude/settings.json"
  local user_settings="${HOME}/.claude/settings.json"
  local project_list="[]"
  local user_list="[]"
  if [[ -f "$project_settings" ]]; then
    project_list="$(jq -c '.enabledPlugins // []' "$project_settings" 2>/dev/null || echo '[]')"
  fi
  if [[ -f "$user_settings" ]]; then
    user_list="$(jq -c '.enabledPlugins // []' "$user_settings" 2>/dev/null || echo '[]')"
  fi
  jq -nc --argjson p "$project_list" --argjson u "$user_list" '$p + $u | unique | .[]' 2>/dev/null \
    | tr -d '"'
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
    done < <(csa_enum_enabled_plugins "$root")
  } | awk -F '\t' '!seen[$NF]++'
}

csa_enum_paranoid_candidates() {
  local cache="${HOME}/.claude/plugins/cache"
  [[ -d "$cache" ]] || return 0
  local enabled
  enabled="$(csa_enum_enabled_plugins "${CSA_PROJECT_ROOT:-$PWD}" | sort -u)"
  local enabled_lines=$'\n'"$enabled"$'\n'
  find "$cache" -maxdepth 1 -mindepth 1 -type d 2>/dev/null \
    | xargs -n1 basename 2>/dev/null \
    | sort -u \
    | while read -r p; do
        [[ "$enabled_lines" == *$'\n'"$p"$'\n'* ]] || printf '%s\n' "$p"
      done
}
