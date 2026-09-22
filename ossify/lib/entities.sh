#!/usr/bin/env bash
# Entity write paths: thin payload builders over oss_state_mutate.

# THE dispatch predicate, one definition for every site that asks "was this item
# dispatched?" (#529). All THREE fields, because set_work_item_exec journals
# branch, worktree_path and base_sha in one payload and accepts a half-write:
# `work_item_exec <wi> "" "" <sha>` records base_sha alone at rc 0, and a
# two-field read called that undispatched - which is how a dispatched item
# abandoned successfully and its work was stranded. Read by the abandonment
# refusal, the dispatch refusal, the spine-level retirement refusal, and (in
# words, the same three names) doctor's §5 drift bullet, which
# test-prose-contracts.sh holds to this line.
_OSS_DISPATCHED_JQ='((.branch // "") != "") or ((.worktree_path // "") != "") or ((.base_sha // "") != "")'

# The shared resolve-exactly-one read (#529, #533 half A) - the same ladder the
# registry verbs use (#525). ONE jq pass counts the records, so a duplicate id
# can no longer turn a numeric test's input into a multi-line string: the
# pre-lock probe read one line per matching record, the numeric `case` arm then
# fired, and the verb answered rc 2 "cannot read work item" - while the statuses
# that skipped that read proceeded on the SAME state at rc 0. rc 1 no state, 2
# unreadable, 7 unknown or duplicate.
_oss_entity_require_single() { # $1=state-file $2=collection-selector(uses $v) $3=what $4=value
  local sf="$1" sel="$2" what="$3" val="$4" n
  if [ ! -f "$sf" ]; then
    echo "oss: no state at $sf - run 'oss init <name>' first" >&2; return 1
  fi
  n="$(jq --arg v "$val" "[$sel] | length" "$sf" 2>/dev/null)" || {
    echo "oss: cannot read $what '$val' from $sf" >&2; return 2; }
  case "$n" in ''|*[!0-9]*)
    echo "oss: cannot read $what '$val' from $sf" >&2; return 2 ;;
  esac
  if [ "$n" -eq 0 ]; then
    echo "oss: unknown $what '$val'" >&2; return 7
  fi
  if [ "$n" -gt 1 ]; then
    echo "oss: $what '$val' matches $n records - duplicate ids have no supported repair yet (#305); refusing rather than guessing" >&2; return 7
  fi
}

# The three never-strand guards (#529). Each is handed to oss_state_mutate as
# its `$5`, so it is evaluated INSIDE that function's lock, immediately before
# the append: the pre-lock spelling was a check-to-append race - a concurrent
# work_item_exec commits its dispatch between the read and the append, and the
# item ends up abandoned while dispatched, which is the state every close-path
# reader then skips. #528 is that race, with data loss as its outcome.
#
# rc contract, inherited from the merged hook: 0 lets the append through, 7
# refuses it having printed its own message, and ANY other rc fails closed at 4 -
# so a guard that could not answer never mints.

_oss_entity_guard_wi_status() { # $1=state-file $2=payload about to be minted
  local sf="$1" wi st d st2
  wi="$(printf '%s' "$2" | jq -r '.work_item // ""')" || return 4
  st="$(printf '%s' "$2" | jq -r '.status // ""')" || return 4
  _oss_entity_require_single "$sf" '.work_items[] | select(.id == $v)' "work item" "$wi" || return $?
  # Only an abandonment is guarded; every other status is a plain write.
  [ "$st" = "abandoned" ] || return 0
  # `abandoned` is refused on an item that records a dispatch - ANY of the three
  # fields the writer journals - or that is `complete`, whose merge is already on
  # the spine branch. Every close-path reader skips an abandoned item, so either
  # pair strands work that never reaches the spine branch and, post-close,
  # silently shrinks release close's tag set instead of failing it. Prose alone
  # did not hold this (decomposition.md §1 says "only a never-dispatched item is
  # withdrawn"); doctor reports the pair as drift (§5), which is the report, not
  # the guard - this is the guard.
  d="$(jq -r --arg w "$wi" "[.work_items[] | select(.id == \$w)] | first | (${_OSS_DISPATCHED_JQ})" "$sf" 2>/dev/null)" || {
    echo "oss: cannot read work item '$wi' from $sf" >&2; return 2; }
  if [ "$d" = "true" ]; then
    echo "oss: work item '$wi' records a dispatch (branch, worktree_path or base_sha) - it was dispatched, and 'abandoned' means withdrawn BEFORE any dispatch; a dispatched item's round lands or halts, and a plan that drops it is a replan, not a withdrawal (plan-spine/references/decomposition.md §1)" >&2
    return 7
  fi
  st2="$(jq -r --arg w "$wi" "[.work_items[] | select(.id == \$w)] | first | .status // \"\"" "$sf" 2>/dev/null)" || {
    echo "oss: cannot read work item '$wi' from $sf" >&2; return 2; }
  if [ "$st2" = "complete" ]; then
    echo "oss: work item '$wi' is complete - its merge is on the spine branch, so 'abandoned' would take a landed line out of every close-path reader and out of release close's tag set; a plan that drops a landed item is a replan, not a withdrawal (plan-spine/references/decomposition.md §1)" >&2
    return 7
  fi
  # An `active` item is a round in flight, and the SPINE level already counts one
  # as 'ran something' - so this level must too, or one status write turns a
  # spine the rail has just refused into one it retires a call later. Measured on
  # the unguarded setter: `work_item_status <wi> active` (no dispatch record) then
  # `abandoned` returned rc 0, and the retirement that had answered rc 7 naming
  # that item answered rc 0 immediately after. The route out is the documented
  # one: land the round, or return the item to planned first.
  if [ "$st2" = "active" ]; then
    echo "oss: work item '$wi' is active - its round is in flight, and an active item is one this spine's retirement counts as 'ran something', so withdrawing it here would retire that spine a call later. Land the round, or return the item to planned first if the round was abandoned without a landing: \"oss work_item_status $wi planned\" (plan-spine/references/decomposition.md §1)" >&2
    return 7
  fi
}

_oss_entity_guard_wi_exec() { # $1=state-file $2=payload about to be minted
  local sf="$1" wi st rb rp rs nb np ns rec
  wi="$(printf '%s' "$2" | jq -r '.work_item // ""')" || return 4
  _oss_entity_require_single "$sf" '.work_items[] | select(.id == $v)' "work item" "$wi" || return $?
  # The MIRROR of the abandonment guard, and the same harm entered through the
  # companion verb: an `abandoned` item was withdrawn BEFORE any dispatch, so
  # journaling a branch or worktree onto it re-creates the exact stranded state
  # the other guard refuses to create in the other order. Measured: with this arm
  # absent, `work_item_status <wi> abandoned` then `work_item_exec` both returned
  # rc 0 and left {status:abandoned, branch, worktree_path} - the pair doctor
  # reports as drift. decomposition.md §1 gives the way back, so the refusal
  # names it.
  #
  # THIS VERB MAINTAINS THE RECORD THAT EVERY OTHER GUARD READS, so it guards the
  # record as well as the status. Three clauses follow: a write that records no
  # dispatch at all, one that empties a field the record already holds (branch
  # and worktree_path are how close finds the work), and one onto a landed item
  # whose provenance its record IS. Measured on the unguarded write:
  # `work_item_exec <wi> "" "" ""` returned rc 0 and wiped a recorded dispatch,
  # after which the abandonment AND the retirement both returned rc 0 - the strand
  # #529 exists to prevent, entered through the verbs that maintain the record.
  rec="$(jq -r --arg w "$wi" --argjson p "$2" '
    ([.work_items[] | select(.id == $w)] | first) as $r
    | [($r.status // ""), ($r.branch // ""), ($r.worktree_path // ""), ($r.base_sha // ""),
       ($p.branch // ""), ($p.worktree_path // ""), ($p.base_sha // "")] | join("\u0001")' "$sf" 2>/dev/null)" || {
    echo "oss: cannot read work item '$wi' from $sf" >&2; return 2; }
  # The separator is U+0001, NOT a tab: an IFS *whitespace* character makes `read`
  # strip leading empties and collapse runs, so a record with no dispatch at all
  # (four leading empty fields) would shift left and this guard would refuse every
  # legitimate dispatch. A non-whitespace delimiter preserves empty fields exactly.
  IFS=$'\x01' read -r st rb rp rs nb np ns <<<"$rec"
  if [ -z "$nb" ] && [ -z "$np" ] && [ -z "$ns" ]; then
    echo "oss: work_item_exec for '$wi' records no dispatch at all - all three fields are empty, so this is not a dispatch, and on an item that has one it would erase the record of it. A dispatch names the round's branch, worktree_path and base_sha (work-item/references/round-orchestration.md §3)" >&2
    return 7
  fi
  if { [ -n "$rb" ] && [ -z "$nb" ]; } || { [ -n "$rp" ] && [ -z "$np" ]; } || { [ -n "$rs" ] && [ -z "$ns" ]; }; then
    echo "oss: work_item_exec for '$wi' would drop a dispatch field the record already holds (branch, worktree_path, base_sha) - a re-dispatch REPLACES all three, and emptying one leaves an item the predicate still calls dispatched that close can no longer find (work-item/references/round-orchestration.md §3)" >&2
    return 7
  fi
  if [ "$st" = "abandoned" ]; then
    echo "oss: work item '$wi' is abandoned - it was withdrawn before any dispatch, so it has no round to run and no worktree to hold. Un-withdraw it first: \"oss work_item_status $wi planned\" (plan-spine/references/decomposition.md §1)" >&2
    return 7
  fi
  if [ "$st" = "complete" ]; then
    echo "oss: work item '$wi' is complete - its merge is on the spine branch, and its record names the branch and worktree that landed there; a re-dispatch would overwrite that provenance, and a later close re-run would gate against the redo. Landed work that must be redone is a new item, not a re-dispatch (plan-spine/references/decomposition.md §1)" >&2
    return 7
  fi
}

_oss_entity_guard_spine_status() { # $1=state-file $2=payload about to be minted
  local sf="$1" sp st blockers
  sp="$(printf '%s' "$2" | jq -r '.spine // ""')" || return 4
  st="$(printf '%s' "$2" | jq -r '.status // ""')" || return 4
  _oss_entity_require_single "$sf" '.spines[] | select(.id == $v)' "spine" "$sp" || return $?
  [ "$st" = "abandoned" ] || return 0
  # The SPINE LEVEL of the same invariant. A retirement is for a spine that ran
  # nothing; every close-path reader skips an abandoned item, so retiring a spine
  # whose items were dispatched, are active, or have landed strands that work -
  # the same harm one level up, and it returned rc 0 before this guard.
  blockers="$(jq -r --arg s "$sp" "
    [.work_items[] | select(.spine == \$s)
     | select((${_OSS_DISPATCHED_JQ}) or (.status == \"active\") or (.status == \"complete\"))
     | \"\(.id)(\(.status))\"]
    | join(\", \")" "$sf" 2>/dev/null)" || {
    echo "oss: cannot read the work items of spine '$sp' from $sf" >&2; return 2; }
  if [ -n "$blockers" ]; then
    echo "oss: spine '$sp' records dispatched or landed work ($blockers) - a spine that ran anything is closed, not retired, and every close-path reader skips the items a retirement would abandon, so that work would never reach the spine branch. Close it instead: returning an item to 'planned' re-opens it for a re-dispatch and does NOT clear the dispatch record that blocks this retirement - a re-dispatch REPLACES that record (plan-spine/references/decomposition.md §1)" >&2
    return 7
  fi
}

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
  # The existence read AND the retirement precondition are one guard, handed to
  # oss_state_mutate as `$5` so both are evaluated inside its lock (#528/#529):
  # a pre-lock read is a check-to-append race, and the append here is the one
  # that decides whether a spine's dispatched work is abandoned.
  oss_state_mutate "$sf" set_spine_status \
    "$(jq -n --arg s "$spine" --arg st "$st" --arg ts "$(_oss_now)" '{spine:$s,status:$st,at:$ts}')" \
    "" _oss_entity_guard_spine_status
}

oss_entity_set_work_item_status() { # $1=state $2=work-item-id $3=status
  local sf="$1" wi="$2" st="$3"
  # `abandoned` = minted, then withdrawn before any dispatch (1.11.0). The
  # value is a compatibility contract: live journals already carry it.
  case "$st" in planned|active|complete|abandoned) ;; *)
    echo "oss: work item status must be planned|active|complete|abandoned" >&2; return 2;; esac
  # The existence read, the duplicate-id read and the abandonment precondition
  # are ONE guard, evaluated inside oss_state_mutate's lock (#528/#529). The
  # payload shape is unchanged - live journals already carry
  # {work_item,status,at} - so this is a precondition, not a contract edit.
  oss_state_mutate "$sf" set_work_item_status \
    "$(jq -n --arg w "$wi" --arg st "$st" --arg ts "$(_oss_now)" '{work_item:$w,status:$st,at:$ts}')" \
    "" _oss_entity_guard_wi_status
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
  # The existence read and the mirror precondition are one guard, evaluated
  # inside oss_state_mutate's lock (#528/#529) - the same `$5` slot the
  # abandonment guard uses, so the two directions of the invariant cannot drift
  # apart. set_work_item_exec's op and payload are untouched: this is a
  # precondition, and it names the way back (work_item_status <id> planned).
  oss_state_mutate "$sf" set_work_item_exec \
    "$(jq -n --arg w "$wi" --arg b "$3" --arg p "$4" --arg s "$5" \
      '{work_item:$w,branch:$b,worktree_path:$p,base_sha:$s}')" \
    "" _oss_entity_guard_wi_exec
}
