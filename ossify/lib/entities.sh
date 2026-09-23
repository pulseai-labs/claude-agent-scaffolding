#!/usr/bin/env bash
# Entity write paths: thin payload builders over oss_state_mutate.

# THE dispatch predicate, one definition for every site that asks "was this item
# dispatched?" (#529). All THREE fields, because set_work_item_exec journals
# branch, worktree_path and base_sha in one payload and accepts a half-write:
# `work_item_exec <wi> "" "" <sha>` records base_sha alone at rc 0, and a
# two-field read called that undispatched - which is how a dispatched item
# abandoned successfully and its work was stranded. Read by the abandonment
# refusal - the only rail this release ships (operator ruling, 2026-09-23) - and
# (in words, the same three names) doctor's §5 drift bullet, which
# test-prose-contracts.sh holds to this line.
#
# The predicate answers "dispatched" or "not", and it is only sound over
# WELL-FORMED fields - `//` cannot say so, because it takes the right side for a
# JSON `false`: a record holding `"branch": false` read as undispatched and the
# guard journaled the stranded pair it exists to prevent (round 2 on #562).
# _OSS_DISPATCH_CLS_JQ below is what separates "not dispatched" from "cannot
# answer", and a guard that cannot answer fails CLOSED at rc 4 - never coerced
# into undispatched.
_OSS_DISPATCHED_JQ='((.branch // "") != "") or ((.worktree_path // "") != "") or ((.base_sha // "") != "")'

# The field read both guards use, as a fixed token vocabulary:
#   set     a dispatch field this record holds (a non-empty string)
#   empty   the key is present and holds an empty string
#   absent  the key is absent or explicitly null - jq cannot tell those apart,
#           and the writer's own records use it for "not recorded"
#   bad     the key holds anything else: false, a number, an object, an array
# The OUTPUT is the vocabulary, never the values, so no value a record carries
# can shift or truncate this read. The pre-narrowing spelling joined the record
# and the payload with U+0001 and parsed both with ONE line-oriented `read`: a
# newline in any value truncated the parse and refused a full, valid
# re-dispatch - and once the RECORD held one, every later re-dispatch was
# refused too, so that item could never be repaired by the verb at all
# (round-2 P1 on #562). Nothing positional is parsed here.
_OSS_DISPATCH_CLS_JQ='[.branch, .worktree_path, .base_sha] | map(if . == null then "absent" elif type == "string" then (if . == "" then "empty" else "set" end) else "bad" end) | join(",")'

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

# THE never-strand rail (#529), NARROWED by the operator's ruling of 2026-09-23.
# One guard ships and it guards ONE transition - the abandonment - because a
# guard set that reads a record the same verb family can rewrite was not
# converging: two review rounds returned 15 findings each, three of round 2's
# being fallout from round 1's own fixes, and the round-2 P1 (a newline truncating
# the guard's parse) lived in a mechanism this narrowing deletes outright. The
# drop of the dispatch refusal and the spine-level retirement refusal is tracked
# in #563; what the release claims is only what it enforces.
#
# _oss_entity_guard_wi_status is handed to oss_state_mutate as its `$5`, so it is
# evaluated INSIDE that function's lock, immediately before the append: the
# pre-lock spelling was a check-to-append race - a concurrent work_item_exec
# commits its dispatch between the read and the append, and the item ends up
# abandoned while dispatched, which is the state every close-path reader then
# skips. #528 is that race, with data loss as its outcome.
#
# rc contract, inherited from the merged hook: 0 lets the append through, 7
# refuses it having printed its own message, 4 refuses a write the guard cannot
# answer, and ANY other rc is also failed closed at 4 by the hook - so a guard
# that could not answer never mints.

_oss_entity_guard_wi_status() { # $1=state-file $2=payload about to be minted
  local sf="$1" wi st d st2 cls ans
  wi="$(printf '%s' "$2" | jq -r '.work_item // ""')" || return 4
  st="$(printf '%s' "$2" | jq -r '.status // ""')" || return 4
  _oss_entity_require_single "$sf" '.work_items[] | select(.id == $v)' "work item" "$wi" || return $?
  # Only an abandonment is guarded; every other status is a plain write.
  [ "$st" = "abandoned" ] || return 0
  # `abandoned` is refused on an item that records a dispatch - ANY of the three
  # fields the writer journals - or that is `complete` or `active`. Every
  # close-path reader skips an abandoned item, so each of those pairs strands work
  # that never reaches the spine branch and, post-close, silently shrinks release
  # close's tag set instead of failing it. Prose alone did not hold this
  # (decomposition.md §1 says "only a never-dispatched item is withdrawn");
  # doctor reports the pair as drift (§5), which is the report, not the guard -
  # this is the guard.
  #
  # ONE jq pass, two FIXED tokens: the predicate's answer, and the field
  # classification. A record whose dispatch field is not a string is not read as
  # undispatched - that is the round-2 fail-open (jq's `//` takes the right side
  # for `false`) - it is a write this guard cannot answer, so it fails CLOSED at
  # rc 4. The split is on a SPACE between fixed tokens, never positional over
  # anything a record carries, so a newline in a value cannot shift it.
  ans="$(jq -r --arg w "$wi" "
    ([.work_items[] | select(.id == \$w)] | first // {}) as \$r
    | ((\$r | {branch, worktree_path, base_sha}) | (${_OSS_DISPATCHED_JQ}) | tostring)
      + \" \" + (\$r | ${_OSS_DISPATCH_CLS_JQ})" "$sf" 2>/dev/null)" || {
    echo "oss: cannot read work item '$wi' from $sf" >&2; return 2; }
  d="${ans%% *}"; cls="${ans#* }"
  case "$cls" in
    *bad*)
      # The route out must be one that WORKS for this record class (P1-A, operator
      # ruling of 2026-09-23): the repair named here is the one the exec guard
      # accepts, and for a record with nothing well-formed that is the wipe -
      # which clears the malformed field and leaves an item that reads
      # undispatched, so the withdrawal below then runs. A mixed record keeps the
      # genuine dispatch that survives the malformed field, so its repair is the
      # full re-dispatch, and the withdrawal is still refused afterwards - which is
      # the one thing this message may not promise away.
      case "$cls" in
        *set*)
          echo "oss: work item '$wi' records a dispatch field (branch, worktree_path or base_sha) that is not a string, and at least one well-formed field as well, so this guard cannot tell whether the item was dispatched - and a malformed field must not read as undispatched (jq's // takes the right side for a JSON false). Repair the record with a full re-dispatch, which replaces all three: \"oss work_item_exec $wi <branch> <worktree_path> <base_sha>\" (work-item/references/round-orchestration.md §3); the withdrawal is then refused on the dispatch that survives" >&2 ;;
        *)
          echo "oss: work item '$wi' records a dispatch field (branch, worktree_path or base_sha) that is not a string, so this guard cannot tell whether the item was dispatched - and a malformed field must not read as undispatched (jq's // takes the right side for a JSON false). Nothing well-formed is recorded, so the repair is to clear the record and then withdraw: \"oss work_item_exec $wi \"\" \"\" \"\"\" (a wipe is accepted on a record with no well-formed dispatch field to lose), then \"oss work_item_status $wi abandoned\"" >&2 ;;
      esac
      return 4 ;;
  esac
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
  # An `active` item is a round the lane declared in flight, and it can hold that
  # status with NO dispatch record - the status verb admits the write on its own,
  # and the round walk's own ordering puts worktree_add before work_item_exec
  # (work-item/references/round-orchestration.md §3), so a lane that died after
  # creating a worktree has one on disk with nothing in the record to show for it.
  # Abandoning it here drops that round out of every close-path reader, and the
  # status is the only marker it left. The route out is the documented one: land
  # the round, or return the item to planned first - the second only while its
  # spine is still open, because inside a CLOSED spine a planned item lands its
  # repo at the next release close instead (close/references/work-item-close.md §1).
  if [ "$st2" = "active" ]; then
    echo "oss: work item '$wi' is active - its round is declared in flight, and 'abandoned' means withdrawn BEFORE any dispatch, so withdrawing it would drop that round out of every close-path reader instead of landing it. Land the round; or, if it was abandoned without a landing, return the item to planned first - \"oss work_item_status $wi planned\" - and only where the item's spine is still open, since inside a closed spine a planned item lands its repo at the next release close (plan-spine/references/decomposition.md §1)" >&2
    return 7
  fi
}

# THE ONE clause the narrowing kept on the dispatch write, and the reason it is
# the one that stayed: it is what the abandonment guard above stands on. Erase
# the record and that guard sees an undispatched item and lets the strand through
# - so `work_item_exec <wi> "" "" ""` (a payload that records NO dispatch at all)
# is refused on an item that ALREADY records one. Measured on the unguarded
# write: it returned rc 0 and wiped a recorded dispatch, after which the
# abandonment returned rc 0 too, which is the strand #529 exists to prevent,
# entered through the verb that maintains the record.
#
# Nothing else is refused here. The mirror refusal (a dispatch onto a withdrawn
# item), the narrowing refusal (emptying one recorded field), and the landed-item
# refusal all ride #563 with the rest of the dropped arms: they are conditions on
# the record rather than on the abandonment transition, and read alone each looked
# correct while the set of them did not converge.
#
# Both sides are read with jq into the SAME fixed token vocabulary, and a field
# that is not a string on either side is a write this guard cannot answer: rc 4,
# never a silent "no dispatch" (#562 round 2; a JSON false reads as empty under
# jq's `//`). A payload that DOES record a dispatch is let through before the
# record is even classified - replacing a malformed field is the repair, so
# failing closed on the record must not also lock the repair out. On the RECORD
# side the malformed arm no longer refuses on its own: whether this write is a
# wipe is decided by whether a well-formed dispatch survives it (P1-A), so a
# record with a malformed field and no well-formed one accepts the same write the
# abandonment guard's rc-4 message prescribes.
_oss_entity_guard_wi_exec() { # $1=state-file $2=payload about to be minted
  local sf="$1" wi pcls rcls
  wi="$(printf '%s' "$2" | jq -r '.work_item // ""')" || return 4
  _oss_entity_require_single "$sf" '.work_items[] | select(.id == $v)' "work item" "$wi" || return $?
  pcls="$(printf '%s' "$2" | jq -r "${_OSS_DISPATCH_CLS_JQ}" 2>/dev/null)" || {
    echo "oss: cannot read the work_item_exec payload for '$wi'" >&2; return 2; }
  case "$pcls" in
    *bad*)
      echo "oss: this work_item_exec payload records a dispatch field (branch, worktree_path or base_sha) that is not a string - a malformed field must not read as no dispatch (jq's // takes the right side for a JSON false), so this guard refuses the write rather than reading it as a wipe" >&2
      return 4 ;;
    *set*) return 0 ;;
  esac
  rcls="$(jq -r --arg w "$wi" "([.work_items[] | select(.id == \$w)] | first // {}) | ${_OSS_DISPATCH_CLS_JQ}" "$sf" 2>/dev/null)" || {
    echo "oss: cannot read work item '$wi' from $sf" >&2; return 2; }
  # THE WIPE REFUSAL FIRES ON A GENUINE RECORD AND NOWHERE ELSE (P1-A, operator
  # ruling of 2026-09-23). A `set` field - a non-empty string - is a real recorded
  # dispatch and erasing it is the strand. A record whose fields are all absent,
  # empty or `bad` holds nothing worth protecting, and there this identical write
  # IS the repair: it clears a malformed field, the item then reads undispatched,
  # and the withdrawal the abandonment guard's rc-4 arm sent the operator here for
  # succeeds. Refusing it was a dead-end - the arm refused the wipe (rc 4 or rc 7),
  # named a repair that makes the item MORE dispatched, and so foreclosed the
  # withdrawal on a `planned` item that had never been dispatched at all.
  #
  # The mixed record keeps the refusal: `bad` + `set` means a genuine dispatch
  # survives the malformed field, so erasing the record would still hide it.
  case "$rcls" in
    *set*)
      echo "oss: work_item_exec for '$wi' records no dispatch at all - all three fields are empty, so this is not a dispatch, and the item already records one: this write would erase the record of it. A dispatch names the round's branch, worktree_path and base_sha (work-item/references/round-orchestration.md §3), and replacing a record rather than erasing it means giving all three" >&2
      return 7 ;;
  esac
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
  # The existence-and-duplicate read stays (#533 half A): what the narrowed
  # release dropped is the RETIREMENT PRECONDITION that shared this guard's `$5`
  # slot, not the resolver. Without the read, `set_spine_status`'s op is a bare
  # `select()` assignment - a typo'd id answers rc 0 and journals a no-op, and a
  # duplicate id takes the write on BOTH rows. With no guard slot left it is a
  # pre-lock read again, which is the check-to-append shape #569 tracks for this
  # file's other id-taking verbs: nothing here decides anything about a dispatched
  # record any more, so what the race can reach is the existence answer alone.
  _oss_entity_require_single "$sf" '.spines[] | select(.id == $v)' "spine" "$spine" || return $?
  oss_state_mutate "$sf" set_spine_status \
    "$(jq -n --arg s "$spine" --arg st "$st" --arg ts "$(_oss_now)" '{spine:$s,status:$st,at:$ts}')"
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
  # The read and the one kept clause are a guard, evaluated inside
  # oss_state_mutate's lock (#528/#529) - the same `$5` slot the abandonment
  # guard uses. set_work_item_exec's op and payload are untouched: this is a
  # precondition, and the clause it keeps (a payload that records no dispatch at
  # all, on an item that records one) is the one the abandonment guard's
  # soundness rests on.
  oss_state_mutate "$sf" set_work_item_exec \
    "$(jq -n --arg w "$wi" --arg b "$3" --arg p "$4" --arg s "$5" \
      '{work_item:$w,branch:$b,worktree_path:$p,base_sha:$s}')" \
    "" _oss_entity_guard_wi_exec
}
