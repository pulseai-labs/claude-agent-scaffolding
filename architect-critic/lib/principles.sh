#!/usr/bin/env bash
# lib/principles.sh — principles.md load + comment-strip + 4-source merge (Phase B, Task TB.2)
# macOS bash 3.2 portable; BSD awk sub() chains (Adaptation 1); no declare -A.

# Returns the absolute path to principles.md in the data dir.
ac_principles_path() {
  echo "$(ac_data_dir)/principles.md"
}

# v0.2 — Source-resolution helpers for the 3-source principles model.
#
# The v0.2 contract recognizes three principal sources (plus optional
# memory-bank patterns). Each source is rendered in this fixed display order
# in the merged view:
#
#   shipped-default  →  user-promoted  →  project  [→  memory-bank]
#
# Each principle block in a principles.md file is preceded by an HTML comment
# of the form:
#
#   <!-- source: <source>, principle_id: <pp-id>[, promoted_at: <ISO8601>] -->
#   - **Title:** body text...
#
# These helpers expose the *paths* to each source. Existence is not asserted;
# callers (or `ac_principles_merge`) skip missing files silently.

# Returns the path to the shipped-default principles template. Resolved
# relative to this lib file's parent dir so it works regardless of
# $CLAUDE_PLUGIN_ROOT being set (test isolation).
ac_principles_shipped_path() {
  local self_dir
  self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  echo "$self_dir/templates/principles.md"
}

# Returns the user-global principles path under $HOME.
# Honors $HOME overrides (so tests can sandbox via _v02_isolate_home).
ac_principles_user_path() {
  echo "$HOME/.claude/architect-critic/principles.md"
}

# Returns the project-scoped principles path (under git toplevel) or empty
# if cwd is not inside a git repo.
ac_principles_project_path() {
  local top
  top="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [[ -z "$top" ]]; then
    return 0
  fi
  echo "$top/.claude/architect-critic/principles.md"
}

# Parse a principles.md file and emit one JSON line per principle block.
# Block format expected:
#   <!-- source: ..., principle_id: ..., promoted_at: ... -->
#   - **Title:** body text
#
# Output fields per line: source, principle_id, promoted_at, text.
# Missing meta keys default to empty string. Missing/blank principle lines
# (no `-` line after a comment) get text="".
#
# macOS bash 3.2 + BSD awk portable. Uses awk to find HTML comments and the
# following non-blank line as the principle text.
ac_principles_parse_meta() {
  local file="$1"
  [[ ! -f "$file" ]] && return 0

  awk '
    function extract_kv(comment, key,   v, pat) {
      # Extract value for "<key>:" up to the next comma or end-of-comment.
      pat = key ":[[:space:]]*"
      if (match(comment, pat) == 0) return ""
      v = substr(comment, RSTART + RLENGTH)
      # Trim leading whitespace
      sub(/^[[:space:]]+/, "", v)
      # Cut at comma or trailing "-->"
      sub(/[[:space:]]*,.*$/, "", v)
      sub(/[[:space:]]*-->.*$/, "", v)
      sub(/[[:space:]]+$/, "", v)
      return v
    }
    function json_escape(s,   r) {
      r = s
      gsub(/\\/, "\\\\", r)
      gsub(/"/, "\\\"", r)
      gsub(/\t/, "\\t", r)
      gsub(/\r/, "\\r", r)
      gsub(/\n/, "\\n", r)
      return r
    }
    /<!--[[:space:]]*source:/ {
      comment = $0
      src = extract_kv(comment, "source")
      pid = extract_kv(comment, "principle_id")
      pat = extract_kv(comment, "promoted_at")
      # Now read forward until we find the principle line (starts with "-").
      text = ""
      while ((getline nextline) > 0) {
        if (nextline ~ /^[[:space:]]*$/) continue
        if (nextline ~ /^[[:space:]]*<!--/) {
          # Hit the next meta comment without a principle line in between.
          # Emit current meta with empty text, then re-process this line.
          break
        }
        if (nextline ~ /^[[:space:]]*-/) {
          text = nextline
          # Strip leading "- " and any "  " indentation
          sub(/^[[:space:]]*-[[:space:]]*/, "", text)
          break
        }
        # Other lines (e.g. paragraph continuation) — keep scanning.
      }
      printf "{\"source\":\"%s\",\"principle_id\":\"%s\",\"promoted_at\":\"%s\",\"text\":\"%s\"}\n", \
        json_escape(src), json_escape(pid), json_escape(pat), json_escape(text)
      # If the line we read was a new meta comment, re-process it.
      if (nextline ~ /^[[:space:]]*<!--[[:space:]]*source:/) {
        $0 = nextline
        # Fall through into the next iteration via a re-evaluation hack:
        # awk does not let us "rewind", so duplicate the parse here.
        comment = $0
        src = extract_kv(comment, "source")
        pid = extract_kv(comment, "principle_id")
        pat = extract_kv(comment, "promoted_at")
        text = ""
        while ((getline nextline2) > 0) {
          if (nextline2 ~ /^[[:space:]]*$/) continue
          if (nextline2 ~ /^[[:space:]]*<!--/) break
          if (nextline2 ~ /^[[:space:]]*-/) {
            text = nextline2
            sub(/^[[:space:]]*-[[:space:]]*/, "", text)
            break
          }
        }
        printf "{\"source\":\"%s\",\"principle_id\":\"%s\",\"promoted_at\":\"%s\",\"text\":\"%s\"}\n", \
          json_escape(src), json_escape(pid), json_escape(pat), json_escape(text)
      }
    }
  ' "$file"
}

# Merge shipped + user + project (+ optional memory-bank patterns) into a
# single JSON array of principle objects, in display order:
#
#   shipped-default  →  user-promoted  →  project  →  memory-bank
#
# Duplicate principle_id: last-source-wins. The winning entry gets an
# `overrides_source` field naming the displaced source. The displaced entry
# is dropped from the array.
#
# Memory-bank source is only included if $ARCHITECT_CRITIC_MEMORY_BANK_PATH
# is set and the file exists. Each memory-bank line that begins with "- "
# becomes a synthetic principle with source=memory-bank (no principle_id).
ac_principles_merge() {
  local tmp
  tmp="$(mktemp -t ac-principles-merge.XXXXXX)" || return 1

  {
    # 1. Shipped defaults — always present
    local shipped
    shipped="$(ac_principles_shipped_path)"
    [[ -f "$shipped" ]] && ac_principles_parse_meta "$shipped"

    # 2. User-global
    local user
    user="$(ac_principles_user_path)"
    [[ -f "$user" ]] && ac_principles_parse_meta "$user"

    # 3. Project-scoped
    local proj
    proj="$(ac_principles_project_path)"
    [[ -n "$proj" && -f "$proj" ]] && ac_principles_parse_meta "$proj"

    # 4. Memory-bank patterns (optional, opt-in via env var)
    local mb="${ARCHITECT_CRITIC_MEMORY_BANK_PATH:-}"
    if [[ -n "$mb" && -f "$mb" ]]; then
      while IFS= read -r line; do
        # Strip leading "- " and skip non-bullet lines
        case "$line" in
          -\ *)
            local text="${line#- }"
            # JSON-escape minimal
            text="${text//\\/\\\\}"
            text="${text//\"/\\\"}"
            printf '{"source":"memory-bank","principle_id":"","promoted_at":"","text":"%s"}\n' "$text"
            ;;
        esac
      done < "$mb"
    fi
  } > "$tmp"

  # Apply last-wins dedup by principle_id (skipping empty ids — those can't
  # collide). Build the final array with jq.
  jq -s '
    # Drop placeholder/documentation entries:
    #   - principle_id missing the canonical "pp-" prefix, AND
    #   - synthetic memory-bank entries (which legitimately have no id) are kept
    # Also drop entries with empty text (no principle bullet followed the meta).
    map(select(
      (.source == "memory-bank") or
      (((.principle_id // "") | startswith("pp-")) and ((.text // "") != ""))
    ))
    # Then: display-order list with dedup-by-principle_id (last wins).
    # Track displaced source on the winner via overrides_source.
    | reduce .[] as $p (
      [];
      if ($p.principle_id // "") == "" then
        . + [$p]
      else
        ((map(.principle_id) | index($p.principle_id)) as $hit
        | if $hit == null then
            . + [$p]
          else
            .[$hit] as $prev
            | (.[:$hit] + .[$hit+1:]) + [$p + {overrides_source: $prev.source}]
          end)
      end
    )
  ' "$tmp"

  local rc=$?
  rm -f "$tmp"
  return $rc
}

# Filter the merged principles array to a single logical source.
# Args: <shipped|user|project|memory-bank|all>
# Mapping: shipped→shipped-default, user→user-promoted, project→project.
ac_principles_filter_by_source() {
  local source_arg="$1"
  local target=""
  case "$source_arg" in
    shipped|shipped-default) target="shipped-default" ;;
    user|user-promoted)      target="user-promoted" ;;
    project)                 target="project" ;;
    memory-bank)             target="memory-bank" ;;
    all|"")
      ac_principles_merge
      return $?
      ;;
    *)
      ac_log_warn "ac_principles_filter_by_source: unknown source '$source_arg' — returning empty array"
      printf '[]\n'
      return 0
      ;;
  esac

  ac_principles_merge | jq --arg s "$target" 'map(select(.source == $s))'
}

# Seed principles.md from the FULL plugin template (with example commented
# principles) if it does not already exist. Used at plugin install time only.
# Locates templates/principles.md via ac_principles_shipped_path (resolved
# relative to this lib file — no plugin-root env var is exported on any
# surface).
ac_principles_seed() {
  local dest
  dest="$(ac_principles_path)"
  if [[ -f "$dest" ]]; then
    return 0
  fi
  local template
  template="$(ac_principles_shipped_path)"
  if [[ ! -f "$template" ]]; then
    ac_log_warn "principles.md template not found at $template — creating empty file"
    mkdir -p "$(dirname "$dest")"
    touch "$dest"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$template" "$dest"
}

# Seed principles.md with a MINIMAL placeholder (preamble + empty "Your
# principles" section — NO commented example principles).
#
# Used at runtime re-seed (when the user has deleted principles.md between
# runs). Per SPEC G5 ("Principles file is user-owned"), the critic must not
# silently restore example principles the user already saw and chose to delete
# — that would violate the user-owned guarantee. The full example set is for
# first-install only; runtime re-seed gets the minimal placeholder.
ac_principles_seed_minimal() {
  local dest
  dest="$(ac_principles_path)"
  if [[ -f "$dest" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cat > "$dest" <<'EOF'
# Architect-critic principles

This file is yours. The architect-critic loads it as the user-global principles set every audit.
Each line that doesn't begin with `#` is treated as an active principle. Edit freely; the critic
never overwrites your edits — it only appends via /promote-principle (manual) or auto-promotion
(with your consent).

## Your principles

(empty — add yours here, one per line, or run /promote-principle from any session)
EOF
}

# Load user-global principles from principles.md.
# - Strips lines starting with "# " (both headers AND inline comments per §6.4).
# - Strips trailing "[promoted YYYY-MM-DD source:......]" annotations.
# - Emits one active principle per line (blank lines omitted).
# Uses BSD awk sub() chains (Adaptation 1 — no gawk 3-arg match()).
ac_principles_load_user_global() {
  local pfile
  pfile="$(ac_principles_path)"
  if [[ ! -f "$pfile" ]]; then
    # Re-seed MINIMAL (preamble only, no examples) on runtime missing — per
    # SPEC §11 edge case + G5 user-owned guarantee. The full example template
    # is install-time only; runtime re-seed must NOT silently restore examples
    # the user has already deleted (v0.1.3 correctness fix).
    ac_log_info "principles.md missing — re-seeding minimal placeholder (no examples)"
    ac_principles_seed_minimal
    [[ ! -f "$pfile" ]] && return 0
  fi
  awk '
    /^# / { next }              # skip header / comment lines (§6.4 rule 1+2)
    /^[[:space:]]*$/ { next }   # skip blank lines
    {
      line = $0
      # Strip trailing [promoted ...] annotation (Adaptation 1: sub() chain)
      sub(/[[:space:]]*\[promoted[^]]*\][[:space:]]*$/, "", line)
      # Trim leading/trailing whitespace
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      if (length(line) > 0) print line
    }
  ' "$pfile"
}

# Load content of named phases from a master-spec file.
# Args: <spec_path> <phase_ids_csv>
# Phase markers: <!-- master-spec:phase id=N name=<slug> -->
# Extracts content from the marker line up to (but not including) the next marker or EOF.
# Uses BSD awk sub() chains to parse phase id (Adaptation 1).
# Gracefully returns empty if spec_path does not exist.
ac_principles_load_master_spec_phases() {
  local spec_path="$1"
  local phase_ids_csv="$2"
  if [[ ! -f "$spec_path" ]]; then
    return 0
  fi
  # Build a pattern string for awk to check membership in phase_ids_csv.
  # We pass the csv as a string and split it inside awk.
  awk -v ids="$phase_ids_csv" '
    BEGIN {
      n = split(ids, wanted, ",")
      for (i = 1; i <= n; i++) wanted_set[wanted[i]] = 1
      in_wanted = 0
    }
    /<!-- master-spec:phase / {
      # Extract the phase id using sub() chains (Adaptation 1)
      line = $0
      sub(/^.*id=/, "", line)
      sub(/[^0-9].*$/, "", line)
      pid = line
      if (pid in wanted_set) {
        in_wanted = 1
      } else {
        in_wanted = 0
      }
      # Print the marker line itself as part of the phase block
      if (in_wanted) print $0
      next
    }
    in_wanted { print }
  ' "$spec_path"
}

# Load content of .claude/memory-bank/03-code-patterns.md if it exists.
# Gracefully returns empty if absent.
ac_principles_load_memory_bank_patterns() {
  local pfile=".claude/memory-bank/03-code-patterns.md"
  if [[ -f "$pfile" ]]; then
    cat "$pfile"
  fi
}

# Load content of .claude/memory-bank/08-governance.md if it exists.
# Gracefully returns empty if absent.
ac_principles_load_memory_bank_governance() {
  local gfile=".claude/memory-bank/08-governance.md"
  if [[ -f "$gfile" ]]; then
    cat "$gfile"
  fi
}

# Compose the full principles block from all 4 sources with section headers.
# Args: <spec_path> <phase_ids_csv>
# Per SPEC §7 composition pseudo-code:
#   - Omit each section entirely if its source is absent/empty.
# Output goes to stdout.
ac_principles_compose() {
  local spec_path="$1"
  local phase_ids_csv="$2"

  # Source 1: user-global principles
  local user_principles
  user_principles="$(ac_principles_load_user_global)"
  if [[ -n "$user_principles" ]]; then
    printf '%s\n' "# User-global principles"
    printf '%s\n' "$user_principles"
    printf '\n'
  fi

  # Source 2: master-spec accumulated phases
  local phase_content
  phase_content="$(ac_principles_load_master_spec_phases "$spec_path" "$phase_ids_csv")"
  if [[ -n "$phase_content" ]]; then
    printf '%s\n' "# Project context (MASTER-SPEC accumulated phases $phase_ids_csv)"
    printf '%s\n' "$phase_content"
    printf '\n'
  fi

  # Source 3: project patterns
  local patterns
  patterns="$(ac_principles_load_memory_bank_patterns)"
  if [[ -n "$patterns" ]]; then
    printf '%s\n' "# Project patterns"
    printf '%s\n' "$patterns"
    printf '\n'
  fi

  # Source 4: project governance
  local governance
  governance="$(ac_principles_load_memory_bank_governance)"
  if [[ -n "$governance" ]]; then
    printf '%s\n' "# Project governance"
    printf '%s\n' "$governance"
    printf '\n'
  fi
}
