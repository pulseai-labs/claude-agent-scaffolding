#!/usr/bin/env bash
# Bones / risk gates / fakes / feature map + touch-surface matching.

# CSV grammar (#340): a bare "," separates entries; "\," is a literal comma
# inside one. The escaped comma is parked on the private-use codepoint U+E000
# for the split and restored after; a RAW U+E000 in the input would silently
# become a comma, so it is refused up front (fail-closed, never rewritten).
_oss_csv_to_json() {
  # A raw U+E000 in the input would silently become a comma after the
  # round-trip; refuse it up front (fail-closed). jq runs the codepoint test
  # because neither bash 3.2 (no \uXXXX in $'...') nor zsh quoting can
  # express the codepoint reliably here.
  # \p{Co} (any private-use codepoint) rather than a U+E000 literal: jq's
  # test() refuses to match the codepoint written as an escape, while the
  # category matches - measured - and the sentinel is inside the category.
  if [ "$(printf '%s' "$1" | jq -Rr 'if test("\\p{Co}") then "raw-pua" else empty end')" = "raw-pua" ]; then
    echo "oss: input contains a private-use codepoint (U+E000-family, the internal CSV escape range) - remove it and retry" >&2
    return 2
  fi
  printf '%s\n' "$1" | jq -R '
  gsub("\\\\,"; "\uE000")
  | split(",")
  | map(gsub("\uE000"; ",") | gsub("^ +| +$";""))
  | map(select(length>0))'; }

oss_reg_add_bone() { # $1=state $2=adr-ref $3=title $4=touch-csv $5=revisit(optional)
  local touch; touch="$(_oss_csv_to_json "$4")" || return $?
  oss_state_mutate "$1" add_bone \
    "$(jq -n --arg adr "$2" --arg t "$3" --argjson touch "$touch" \
        --arg rv "${5:-}" --arg ts "$(_oss_now)" \
      '{adr:$adr,title:$t,touch:$touch,revisit_trigger:(if $rv=="" then null else $rv end),at:$ts}')"
}

oss_reg_add_risk_gate() { # $1=state $2=name $3=touch-csv $4=controls-csv
  local touch c
  touch="$(_oss_csv_to_json "$3")" || return $?
  c="$(_oss_csv_to_json "$4")" || return $?
  oss_state_mutate "$1" add_risk_gate \
    "$(jq -n --arg n "$2" --argjson touch "$touch" \
        --argjson c "$c" --arg ts "$(_oss_now)" \
      '{name:$n,touch:$touch,controls:$c,at:$ts}')"
}

# Corrective append (#340): replaces a named gate's controls with a fresh
# journaled mutation — the journal is never edited, so replay stays
# authoritative and state_restore rebuilds the CORRECTED state. Duplicate
# gate names are #305's defect; this verb refuses rather than guessing.
oss_reg_set_risk_gate_controls() { # $1=state $2=name $3=controls-csv
  local sf="$1" name="$2" n
  if [ ! -f "$sf" ]; then
    echo "oss: no state at $sf - run 'oss init <name>' first" >&2; return 1
  fi
  # Explicit failure routing: under bin/oss errexit, an unguarded failing
  # assignment here hard-exits with jq's raw parse error before the case
  # below can label it (rc 5, not our rc 2).
  n="$(jq --arg n "$name" '[.risk_gates[] | select(.name == $n)] | length' "$sf" 2>/dev/null)" || {
    echo "oss: cannot read risk gates from $sf" >&2; return 2; }
  case "$n" in ''|*[!0-9]*)
    echo "oss: cannot read risk gates from $sf" >&2; return 2 ;;
  esac
  if [ "$n" -eq 0 ]; then
    echo "oss: unknown risk gate '$name'" >&2; return 7
  fi
  if [ "$n" -gt 1 ]; then
    echo "oss: risk gate '$name' matches $n gates - duplicate names have no supported repair yet (#305); refusing rather than guessing" >&2; return 7
  fi
  local c; c="$(_oss_csv_to_json "$3")" || return $?
  oss_state_mutate "$sf" set_risk_gate_controls \
    "$(jq -n --arg n "$name" --argjson c "$c" \
      '{name:$n,controls:$c}')"
}

oss_reg_add_fake() { # $1=state $2=boundary $3=channel $4=reason $5=trigger $6=expiry-release
  case "$3" in real|fake|deferred) ;; *) echo "oss: channel must be real|fake|deferred" >&2; return 2;; esac
  oss_state_mutate "$1" add_fake \
    "$(jq -n --arg b "$2" --arg c "$3" --arg r "$4" --arg tr "$5" --arg ex "$6" --arg ts "$(_oss_now)" \
      '{boundary:$b,channel:$c,reason:$r,replacement_trigger:$tr,expiry_release:$ex,status:"active",at:$ts}')"
}

oss_reg_add_feature() { # $1=state $2=name $3=value $4=class-guess $5=source
  oss_state_mutate "$1" add_feature \
    "$(jq -n --arg n "$2" --arg v "$3" --arg cg "$4" --arg s "$5" --arg ts "$(_oss_now)" \
      '{name:$n,value:$v,class_guess:$cg,source:$s,at:$ts}')"
}

# Touch-surface matching: bones/risk_gates store touch:[glob,...]. Matches
# each given path against every stored glob via bash `case` glob semantics
# (case-globs: `*` matches `/`, so `src/domain/**` matches any path under
# src/domain/ as a plain prefix-wildcard - not a real double-star). Prints
# `bone <adr>` / `risk_gate <name>` per match, rc 0 if any path matched any
# glob, rc 1 if clean. Dedup of repeated matches is deliberately not done in
# v1 (callers act on any-match, not on the match list).
# rc 2 = "could not check" and is NEVER folded into rc 1 = "clean". Every
# documented call site is `if oss touch_check …; then HIT; else CLEAN; fi`, so a
# failure that returned 1 classified an unreadable state as a genuine clean
# verdict — the mechanical half of class declaration degrading toward `flesh`,
# the permissive class, with no stdout and no stderr to say so. The blanket
# `2>/dev/null || true` that used to wrap both jq producers is exactly what
# erased that difference. A state without `.bones`/`.risk_gates` is malformed
# (doctor's shape check flags it) and is inconclusive here, not clean; an empty
# `[]` registry is well-formed and IS clean.
oss_reg_touch_check() { # $1=state $2..=paths ; rc 0 any match, 1 clean, 2 could-not-check
  local sf="$1"; shift
  [ "$#" -gt 0 ] || { echo "oss: touch_check needs at least one path" >&2; return 2; }
  local hit=1 path glob kind name bones_tsv gates_tsv
  bones_tsv="$(jq -r '.bones[] | . as $b | .touch[] | ["bone", $b.adr, .] | @tsv' "$sf" 2>/dev/null)" \
    || { echo "oss: cannot read bones from '$sf' - touch check is INCONCLUSIVE, not clean" >&2; return 2; }
  gates_tsv="$(jq -r '.risk_gates[] | . as $g | .touch[] | ["risk_gate", $g.name, .] | @tsv' "$sf" 2>/dev/null)" \
    || { echo "oss: cannot read risk_gates from '$sf' - touch check is INCONCLUSIVE, not clean" >&2; return 2; }
  while IFS=$'\t' read -r kind name glob; do
    [ -n "$glob" ] || continue
    for path in "$@"; do
      # shellcheck disable=SC2254
      case "$path" in $glob) echo "$kind $name"; hit=0;; esac
    done
  done < <(printf '%s\n%s\n' "$bones_tsv" "$gates_tsv")
  return "$hit"
}

# Release-close blocking gate (spec §6.1 fake ledger, §6.2 step 3). Returns the
# OUTSTANDING fakes that have reached or passed their expiry release.
#
# rc contract, and it is the OPPOSITE POLARITY to oss_reg_touch_check on
# purpose: 0 = CLEAN (the blocking set is empty), 1 = BLOCKING (non-empty, one
# TSV line per fake on stdout), 2 = could-not-check. touch_check answers "did
# anything match" (0 = hit); this answers "may the close proceed" (0 = yes), the
# same polarity as oss_verify_report_cross_check. A caller that copies the
# touch_check branch shape inverts the judge and closes exactly the releases it
# exists to block, so the ceremony's `case` arms are spelled out in
# skills/close/references/fake-expiry.md §2.
#
# Selector, both arms load-bearing:
#   * STATUS - `active` OR `renewed`. `replaced` is the ONLY resolving status
#     (the status enum in oss_reg_set_fake_status, below). Selecting on
#     `active` alone lets a renewal escape its
#     own deadline: someone already pushed that deadline once, which is what
#     makes the renewal the entry MOST in need of the check, and it would fail
#     silently green.
#   * EXPIRY - AT OR BEFORE this release, compared NUMERICALLY. Identity lets
#     every fake that outlived its deadline escape forever. A string compare is
#     wrong from r10 on: jq evaluates `"r2" <= "r10"` as false, so the `r` is
#     stripped and the remainder compared as a number.
#
# A record whose `expiry_release` cannot be parsed as `r<N>` BLOCKS, marked
# `unparseable-expiry`. It is not skipped: an expiry that never compares is an
# expiry that never fires, which is precisely "deferred truth becomes permanent
# silently". `try/catch` keeps the malformed value from aborting the whole
# selector, so one bad record cannot make every other fake escape with it.
#
# The release argument is validated for SHAPE only, never for existence: this is
# a read-only selector whose release id reaches it from `oss id_parse`, and an
# existence check would add an rc-7 arm the ceremony has no branch for.
oss_reg_expired_fakes() { # $1=state $2=release ; rc 0 clean, 1 blocking, 2 could-not-check
  local sf="$1" rel="$2" out
  case "${rel#r}" in ''|*[!0-9]*)
    echo "oss: expired_fakes needs a release id of the form r<N> (got '$rel')" >&2; return 2 ;; esac
  out="$(jq -r --arg rel "$rel" '
      ($rel | ltrimstr("r") | tonumber) as $cut
      | .fakes[]
      | select(.status == "active" or .status == "renewed")
      | . as $f
      | (try (.expiry_release | ltrimstr("r") | tonumber) catch null) as $e
      | select($e == null or $e <= $cut)
      | [ $f.boundary,
          $f.status,
          (if $e == null then "unparseable-expiry" else $f.expiry_release end),
          ($f.replacement_trigger // "") ] | @tsv' "$sf" 2>/dev/null)" \
    || { echo "oss: cannot read fakes from '$sf' - the expiry gate is INCONCLUSIVE, not clean" >&2; return 2; }
  [ -n "$out" ] || return 0
  printf '%s\n' "$out"
  return 1
}

oss_reg_set_fake_status() { # $1=state $2=boundary $3=status $4=reason [$5=new-expiry]
  local sf="$1" b="$2" st="$3"
  case "$st" in active|replaced|renewed) ;; *)
    echo "oss: fake status must be active|replaced|renewed" >&2; return 2;; esac
  jq -e --arg b "$b" '.fakes[] | select(.boundary == $b)' "$sf" >/dev/null 2>&1 \
    || { echo "oss: unknown fake boundary '$b'" >&2; return 7; }
  oss_state_mutate "$sf" set_fake_status \
    "$(jq -n --arg b "$b" --arg st "$st" --arg r "$4" --arg ex "${5:-}" --arg ts "$(_oss_now)" \
      '{boundary:$b,status:$st,reason:$r,expiry:$ex,at:$ts}')"
}
