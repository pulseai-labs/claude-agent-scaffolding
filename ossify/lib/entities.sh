#!/usr/bin/env bash
# Entity write paths: thin payload builders over oss_state_mutate.

oss_entity_add_release() { # $1=state $2=name $3=goal
  local sf="$1" ts; ts="$(_oss_now)"
  oss_state_mutate "$sf" add_release \
    "$(jq -n --arg n "$2" --arg g "$3" --arg ts "$ts" \
      '{name:$n,goal:$g,status:"planned",created_at:$ts}')" \
    release
}

oss_entity_add_spine() { # $1=state $2=release-id $3=name $4=class $5=target_repo
  local sf="$1" rel="$2" class="$4" ts
  case "$class" in bone|flesh) ;; *) echo "oss: class must be bone|flesh" >&2; return 2;; esac
  jq -e --arg r "$rel" '.releases[] | select(.id == $r)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown release '$rel'" >&2; return 7; }
  ts="$(_oss_now)"
  oss_state_mutate "$sf" add_spine \
    "$(jq -n --arg r "$rel" --arg n "$3" --arg c "$class" --arg t "$5" --arg ts "$ts" \
      '{release:$r,name:$n,class:$c,target_repo:$t,status:"planned",created_at:$ts}')" \
    "spine:$rel"
}

oss_entity_add_work_item() { # $1=state $2=spine-id $3=title $4=target_repo
  local sf="$1" spine="$2" ts tr
  jq -e --arg s "$spine" '.spines[] | select(.id == $s)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown spine '$spine'" >&2; return 7; }
  # Callers (commands.sh) now always pass an explicit key; this default is kept
  # so a direct lib call is honest about the same sole-repo rule (#272/#310
  # Task 4 - was a literal `canonical`).
  if [ -z "${4:-}" ]; then tr="$(_oss_default_repo_key)" || return $?; else tr="$4"; fi
  ts="$(_oss_now)"
  oss_state_mutate "$sf" add_work_item \
    "$(jq -n --arg s "$spine" --arg t "$3" --arg r "$tr" --arg ts "$ts" \
      '{spine:$s,title:$t,target_repo:$r,status:"planned",created_at:$ts}')" \
    "work_item:$spine"
}

oss_entity_set_spine_class() { # $1=state $2=spine-id $3=new-class $4=reason
  local sf="$1" spine="$2" to="$3" from ts
  case "$to" in bone|flesh) ;; *) echo "oss: class must be bone|flesh" >&2; return 2;; esac
  from="$(jq -r --arg s "$spine" '.spines[] | select(.id == $s) | .class // empty' "$sf")"
  [ -n "$from" ] || { echo "oss: unknown spine '$spine'" >&2; return 7; }
  ts="$(_oss_now)"
  oss_state_mutate "$sf" set_spine_class \
    "$(jq -n --arg s "$spine" --arg f "$from" --arg t2 "$to" --arg r "$4" --arg ts "$ts" \
      '{spine:$s,from:$f,to:$t2,reason:$r,at:$ts}')"
}

oss_entity_set_release_meta() { # $1=state $2=release-id $3=patch-json
  local sf="$1" rel="$2" patch="$3"
  jq -e --arg r "$rel" '.releases[] | select(.id == $r)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown release '$rel'" >&2; return 7; }
  oss_state_mutate "$sf" set_release_meta \
    "$(jq -n --arg r "$rel" --argjson patch "$patch" '{release:$r,patch:$patch}')"
}

oss_entity_add_veto() { # $1=state $2=spine $3=finding $4=disposition $5=reason
  local sf="$1" spine="$2" disp="$4"
  case "$disp" in auto-bone|override|escalate) ;; *)
    echo "oss: disposition must be auto-bone|override|escalate" >&2; return 2;; esac
  jq -e --arg s "$spine" '.spines[] | select(.id == $s)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown spine '$spine'" >&2; return 7; }
  oss_state_mutate "$sf" add_veto_disposition \
    "$(jq -n --arg s "$spine" --arg f "$3" --arg d "$disp" --arg r "$5" --arg ts "$(_oss_now)" \
      '{spine:$s,finding:$f,disposition:$d,reason:$r,at:$ts}')"
}

oss_entity_set_spine_status() { # $1=state $2=spine-id $3=status
  local sf="$1" spine="$2" st="$3"
  case "$st" in planned|active|closed|abandoned) ;; *)
    echo "oss: spine status must be planned|active|closed|abandoned" >&2; return 2;; esac
  jq -e --arg s "$spine" '.spines[] | select(.id == $s)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown spine '$spine'" >&2; return 7; }
  oss_state_mutate "$sf" set_spine_status \
    "$(jq -n --arg s "$spine" --arg st "$st" --arg ts "$(_oss_now)" '{spine:$s,status:$st,at:$ts}')"
}

oss_entity_set_work_item_status() { # $1=state $2=work-item-id $3=status
  local sf="$1" wi="$2" st="$3"
  case "$st" in planned|active|complete) ;; *)
    echo "oss: work item status must be planned|active|complete" >&2; return 2;; esac
  jq -e --arg w "$wi" '.work_items[] | select(.id == $w)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown work item '$wi'" >&2; return 7; }
  oss_state_mutate "$sf" set_work_item_status \
    "$(jq -n --arg w "$wi" --arg st "$st" --arg ts "$(_oss_now)" '{work_item:$w,status:$st,at:$ts}')"
}

oss_entity_set_release_status() { # $1=state $2=release-id $3=status
  local sf="$1" rel="$2" st="$3"
  case "$st" in planned|active|closed) ;; *)
    echo "oss: release status must be planned|active|closed" >&2; return 2;; esac
  jq -e --arg r "$rel" '.releases[] | select(.id == $r)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown release '$rel'" >&2; return 7; }
  oss_state_mutate "$sf" set_release_status \
    "$(jq -n --arg r "$rel" --arg st "$st" --arg ts "$(_oss_now)" '{release:$r,status:$st,at:$ts}')"
}

oss_entity_set_work_item_exec() { # $1=state $2=wi-id $3=branch $4=worktree-path $5=base-sha
  local sf="$1" wi="$2"
  jq -e --arg w "$wi" '.work_items[] | select(.id == $w)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown work item '$wi'" >&2; return 7; }
  oss_state_mutate "$sf" set_work_item_exec \
    "$(jq -n --arg w "$wi" --arg b "$3" --arg p "$4" --arg s "$5" \
      '{work_item:$w,branch:$b,worktree_path:$p,base_sha:$s}')"
}
