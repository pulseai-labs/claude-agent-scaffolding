#!/usr/bin/env bash
# Cumulative product demo ledger (spec §3, §6.1) + patch lane records.

oss_ledger_add_auto() { # $1=state $2=spine $3=text $4=command $5=expected
  # Validate the spine exists BEFORE anything else: a demo line journaled
  # against a nonexistent spine (typo like r0.s99) is silently skipped at
  # spine close, which filters by source_spine — the line counts as authored
  # but never runs, producing phantom coverage. Same reject-before-mutate
  # shape as _oss_ledger_plan_amendment and oss_ledger_apply_pending below.
  jq -e --arg s "$2" '.spines[] | select(.id == $s)' "$1" >/dev/null 2>&1 \
    || { echo "oss: unknown spine '$2' - a demo line keyed to a spine that does not exist would never be exercised at close" >&2; return 7; }
  # The `exit:` operand must be digits-only END TO END. The old glob
  # `exit:[0-9]*` was "exit:" + ONE digit + anything, so plausible authoring
  # slips ("exit:0 (tests green)", "exit:0abc", "exit:0 # green") were accepted
  # here — and the runner's `[ "$rc" -ne "${expected#exit:}" ]` then exits 2 on
  # the non-numeric operand, which the enclosing `if` reads as FALSE: the FAIL
  # branch is skipped and the line counts as passed. The ledger is append-only,
  # so one such line re-reports green at every future close. Same
  # `''|*[!0-9]*` idiom as state.sh's schema-version guard, for the same reason:
  # a value that is not digits makes the later numeric test error rather than
  # compare, and an erroring test reads as "condition not met".
  case "$5" in
    exit:*)
      case "${5#exit:}" in ''|*[!0-9]*)
        echo "oss: expected 'exit:<n>' takes digits only (got '$5')" >&2; return 2;; esac ;;
    contains:?*) ;;
    *) echo "oss: expected must be 'exit:<n>' or 'contains:<str>'" >&2; return 2 ;;
  esac
  oss_state_mutate "$1" add_demo_line \
    "$(jq -n --arg s "$2" --arg t "$3" --arg c "$4" --arg e "$5" --arg ts "$(_oss_now)" \
      '{type:"auto",text:$t,command:$c,expected:$e,source_spine:$s,status:"active",status_reason:null,status_by:null,at:$ts}')" \
    demo
}

oss_ledger_add_user() { # $1=state $2=spine $3=text $4=outcome
  # Same validation as add_auto: an unknown source_spine journals silently
  # and is never run at the close ceremony.
  jq -e --arg s "$2" '.spines[] | select(.id == $s)' "$1" >/dev/null 2>&1 \
    || { echo "oss: unknown spine '$2' - a demo line keyed to a spine that does not exist would never be exercised at close" >&2; return 7; }
  local lower
  lower="$(printf '%s' "$3" | tr '[:upper:]' '[:lower:]')"
  lower="${lower#"${lower%%[![:space:]]*}"}"   # trim leading whitespace so " Open ..." can't evade the ban
  case "$lower" in inspect\ *|view\ *|open\ *)
    echo "oss: inspector phrasing banned in user journey lines (spec §5.3 floor) - phrase as an action the user performs for value" >&2
    return 2;; esac
  oss_state_mutate "$1" add_demo_line \
    "$(jq -n --arg s "$2" --arg t "$3" --arg o "$4" --arg ts "$(_oss_now)" \
      '{type:"user",text:$t,outcome:$o,source_spine:$s,status:"active",status_reason:null,status_by:null,at:$ts}')" \
    demo
}

_oss_ledger_require_line() { # $1=state $2=line-id
  jq -e --arg id "$2" '.demo_ledger[] | select(.id == $id)' "$1" >/dev/null 2>&1 \
    || { echo "oss: unknown demo line '$2'" >&2; return 7; }
}

# D1: supersede/retire are PLANNING verbs. They record intent and leave the line
# live, so a sibling spine closing before this one still runs the flow, and a
# spine that is replanned or abandoned drops no coverage. `close` applies them.
_oss_ledger_plan_amendment() { # $1=state $2=line-id $3=status $4=by-spine $5=reason
  _oss_ledger_require_line "$1" "$2" || return $?
  # <by-spine> is the JOIN KEY apply_demo_pending matches on, not mere
  # provenance: a typo'd spine here means the amendment is never applied by
  # any close, silently and forever. Validate it like the line id
  # (demo-amendments.md §3 documents the same rule for readers of the prose).
  jq -e --arg s "$4" '.spines[] | select(.id == $s)' "$1" >/dev/null 2>&1 \
    || { echo "oss: unknown spine '$4' - an amendment keyed to a spine that does not exist would never be applied" >&2; return 7; }
  oss_state_mutate "$1" set_demo_line_pending \
    "$(jq -n --arg id "$2" --arg st "$3" --arg by "$4" --arg r "$5" --arg ts "$(_oss_now)" \
      '{id:$id,status:$st,by:$by,reason:$r,at:$ts}')"
}
oss_ledger_supersede() { _oss_ledger_plan_amendment "$1" "$2" superseded "$3" "$4"; }
oss_ledger_retire()    { _oss_ledger_plan_amendment "$1" "$2" retired    "$3" "$4"; }

# The close-time apply. Runs AFTER merge and BEFORE the cumulative demo, so the
# demo measures the amended set against a product where the flow really is gone.
# Same reject-before-mutate shape as _oss_ledger_plan_amendment: this is the
# only mutator this task added that lacked it (F3) - an unknown or typo'd spine
# used to return rc 0 and journal a no-op, so `close` (Task 9) would report
# success while silently applying nothing.
oss_ledger_apply_pending() { # $1=state $2=spine
  jq -e --arg s "$2" '.spines[] | select(.id == $s)' "$1" >/dev/null 2>&1 \
    || { echo "oss: unknown spine '$2' - apply_pending against a spine that does not exist would apply nothing while reporting success" >&2; return 7; }
  oss_state_mutate "$1" apply_demo_pending "$(jq -n --arg s "$2" '{spine:$s}')"
}

# The escape hatch: clears the CALLING spine's planned amendment on a line.
# There is no `reactivate` for an APPLIED one by design - once close has
# applied it the ledger records history.
#
# F1 (2026-07-31): a line now carries a LIST of pending amendments, one per
# spine, so "clear the pending amendment on line d1" is ambiguous - clearing
# every spine's entry indiscriminately is the same silent-coverage-loss
# footgun F1 exists to remove, just moved from set/apply to unplan. The spine
# is therefore REQUIRED, not optional, and is validated the same way the two
# planning verbs validate it: reject-before-mutate, both on an unknown line and
# on a spine that holds no pending amendment on that line (a typo'd spine here
# would otherwise silently no-op and look like it worked).
oss_ledger_unplan() { # $1=state $2=line-id $3=spine
  _oss_ledger_require_line "$1" "$2" || return $?
  jq -e --arg id "$2" --arg s "$3" \
      '.demo_ledger[] | select(.id == $id) | (.pending_amendments // []) | map(select(.by == $s)) | length > 0' \
      "$1" >/dev/null 2>&1 \
    || { echo "oss: spine '$3' holds no pending amendment on line '$2'" >&2; return 7; }
  oss_state_mutate "$1" clear_demo_pending "$(jq -n --arg id "$2" --arg s "$3" '{id:$id,spine:$s}')"
}

# Quarantine is NOT a planned amendment: it is raised at close/doctor time when a
# line actually fails for causes unrelated to any open spine, so it applies at
# once. The release is recorded because §6.1 makes it a parking ticket that
# expires - "fixed or retired by the next release close" needs an anchor.
oss_ledger_quarantine() { # $1=state $2=line-id $3=reason $4=release
  _oss_ledger_require_line "$1" "$2" || return $?
  oss_state_mutate "$1" set_demo_line_status \
    "$(jq -n --arg id "$2" --arg st quarantined --arg by quarantine \
        --arg r "$3" --arg rel "${4:-}" \
      '{id:$id,status:$st,by:$by,reason:$r,release:$rel}')"
}

oss_ledger_active_auto() { jq '[.demo_ledger[] | select(.type == "auto" and .status == "active")]' "$1"; }

# The quarantine gate's twin of oss_reg_expired_fakes (spec §6.1 parking ticket,
# §6.2 step 4). §6.1 says a quarantined line "must be fixed or retired by the
# next release close", so the blocking set is every line quarantined in a release
# STRICTLY EARLIER than this one - `<`, not `<=`. A line quarantined during THIS
# release is a fresh ticket that comes due at the next close, and folding it in
# here would make a close unable to quarantine anything without blocking itself.
#
# THE FIELD IS `.quarantined_in_release`, NOT `.release`. `oss_ledger_quarantine`
# builds a payload keyed `release` (line 106), but `_oss_apply_op`'s
# `set_demo_line_status` writes it onto the line as `.quarantined_in_release`
# (state.sh:84) - and only when it is non-empty. A selector written from the
# payload shape reads a key that exists on no line, returns empty, and every
# quarantine escapes at rc 0 forever. The payload is the wire format; the line is
# the record.
#
# A quarantine with NO release anchor blocks, marked `no-release-anchor`: §6.1's
# ticket expires against a release, so a ticket carrying none can never come due.
# `oss ledger_quarantine` takes the release as `${3:-}` and the dispatcher passes
# `${3:-}` through, so an anchorless quarantine is one omitted argument away.
#
# Same rc polarity as the fake gate - 0 = CLEAN, 1 = BLOCKING, 2 =
# could-not-check - and the same shape-only validation of the release argument.
oss_ledger_expired_quarantines() { # $1=state $2=release ; rc 0 clean, 1 blocking, 2 could-not-check
  local sf="$1" rel="$2" out
  case "${rel#r}" in ''|*[!0-9]*)
    echo "oss: expired_quarantines needs a release id of the form r<N> (got '$rel')" >&2; return 2 ;; esac
  out="$(jq -r --arg rel "$rel" '
      ($rel | ltrimstr("r") | tonumber) as $cut
      | .demo_ledger[]
      | select(.status == "quarantined")
      | . as $l
      | (try (.quarantined_in_release | ltrimstr("r") | tonumber) catch null) as $q
      | select($q == null or $q < $cut)
      | [ $l.id,
          (if $q == null then "no-release-anchor" else $l.quarantined_in_release end),
          ($l.status_reason // "") ] | @tsv' "$sf" 2>/dev/null)" \
    || { echo "oss: cannot read the demo ledger from '$sf' - the quarantine gate is INCONCLUSIVE, not clean" >&2; return 2; }
  [ -n "$out" ] || return 0
  printf '%s\n' "$out"
  return 1
}

oss_ledger_add_patch() { # $1=state $2=commit $3=one-liner $4=repo-key
  local repo
  # #272/#310 Task 5: same if-form default resolution as the nine Task 4
  # sites - command substitution inside a default expansion (`${4:-$(...)}`)
  # would swallow _oss_default_repo_key's rc 2 refusal and its stderr, so the
  # caller never learns why. No state schema bump: `add_patch_record`
  # (state.sh) is untouched, and replaying an old journal produces patch
  # records with no `repo` key at all - readers treat that as `canonical`.
  if [ -z "${4:-}" ]; then repo="$(_oss_default_repo_key)" || return $?; else repo="$4"; fi
  oss_state_mutate "$1" add_patch_record \
    "$(jq -n --arg c "$2" --arg t "$3" --arg repo "$repo" --arg ts "$(_oss_now)" '{commit:$c,text:$t,repo:$repo,at:$ts}')"
}
