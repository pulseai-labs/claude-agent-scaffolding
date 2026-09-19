#!/usr/bin/env bash
# lib/promotion.sh — FULL auto-promotion machinery (v0.2, SPEC §7.2)
#
# Per-fingerprint vote accumulation across DISTINCT runs. When vote_count
# reaches T=4, surface as a promotion candidate (basis: pattern-recurrence).
# Supplementary instinct-recurrence signal surfaces fingerprints that appear
# in N=3 consecutive recent_runs (basis: instinct-recurrence).
#
# State.json (schema v3; v2 fields retained) shape used by this file:
#
#   candidate_promotions[] := [
#     {fingerprint, first_seen_at, last_seen_at, vote_count,
#      appeared_in_runs: [run_id, ...], texts: [challenge_text, ...]}
#   ]
#   auto_promote_suppressions[] := [
#     {fingerprint, suppressed_at, expires_at, reason_score}
#   ]
#   principle_promotions[] := [
#     {timestamp, source, text, scope, fingerprint, promotion_basis}
#   ]
#   recent_runs[].instinct_observations[] := [fingerprint, ...]   # optional per-run
#
# Portability: macOS bash 3.2 + jq + shasum -a 256; no gawk 3-arg match(),
# no declare -A. All state mutations are jq + ac_guarded_jq_write under a
# state.lock acquired via ac_lock_acquire / released via ac_lock_release.

# ---------------------------------------------------------------------------
# ac_promotion_fingerprint <text>
#
# Emits sha256(normalize(text)) as 64-char lowercase hex.
# Normalization (per SPEC §7.2):
#   - lowercase
#   - strip ASCII punctuation
#   - collapse runs of whitespace to a single space
#   - trim leading/trailing whitespace
# ---------------------------------------------------------------------------
ac_promotion_fingerprint() {
  local text="$1"
  # tr -d removes all listed punctuation; tr -s squeezes whitespace runs.
  # shasum -a 256 is available on macOS by default (BSD). Output column 1 is hex.
  printf '%s' "$text" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -d '[:punct:]' \
    | tr -s '[:space:]' ' ' \
    | sed -e 's/^ //' -e 's/ $//' \
    | shasum -a 256 \
    | awk '{print $1}'
}

# ---------------------------------------------------------------------------
# ac_promotion_add_vote <fingerprint> <run_id> <challenge_text>
#
# Inserts or updates the candidate_promotions[] entry for <fingerprint>:
#   - if absent: insert with vote_count=1, appeared_in_runs=[run_id]
#   - if present AND run_id already in appeared_in_runs: no-op (dedup by run)
#   - else: increment vote_count, append run_id, update last_seen_at,
#     append texts entry (kept for surfacing UI; cap at 5)
#
# Lock around state.lock.
# ---------------------------------------------------------------------------
ac_promotion_add_vote() {
  local fingerprint="$1"
  local run_id="$2"
  local challenge_text="$3"

  local state_file lock_path now
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  ac_lock_acquire "$lock_path" || return 1
  ac_guarded_jq_write "$state_file" \
    --arg fp "$fingerprint" \
    --arg rid "$run_id" \
    --arg txt "$challenge_text" \
    --arg now "$now" \
    '
    .candidate_promotions = (
      (.candidate_promotions // []) as $cands |
      if ([$cands[] | select(.fingerprint == $fp)] | length) == 0 then
        $cands + [{
          fingerprint: $fp,
          first_seen_at: $now,
          last_seen_at: $now,
          vote_count: 1,
          appeared_in_runs: [$rid],
          texts: [$txt]
        }]
      else
        $cands | map(
          if .fingerprint == $fp then
            if (.appeared_in_runs // []) | index($rid) then
              .   # already counted this run — no-op
            else
              .
              | .vote_count = ((.vote_count // 0) + 1)
              | .appeared_in_runs = ((.appeared_in_runs // []) + [$rid])
              | .last_seen_at = $now
              | .texts = (((.texts // []) + [$txt]) | .[-5:])
            end
          else .
          end
        )
      end
    )
    ' \
    "$state_file"
  local rc=$?
  ac_lock_release "$lock_path"
  return $rc
}

# ---------------------------------------------------------------------------
# ac_promotion_apply_suppression <fingerprint> <reason_score>
#
# Delegates to lib/state.sh:ac_state_add_suppression (which handles
# 30/90-day window selection from reason_score and the locked write).
# ---------------------------------------------------------------------------
ac_promotion_apply_suppression() {
  local fingerprint="$1"
  local reason_score="$2"
  ac_state_add_suppression "$fingerprint" "$reason_score"
}

# ---------------------------------------------------------------------------
# ac_promotion_check_candidates
#
# Scan candidate_promotions[]. Emit a JSON array of surfaceable candidates:
#   [{fingerprint, vote_count, basis: "pattern-recurrence",
#     texts: [...], appeared_in_runs: [...]}, ...]
#
# Filtering:
#   - skip fingerprints with an active (non-expired) suppression entry
#   - include only entries with vote_count >= 4 (SPEC §7.2 threshold T=4)
#
# "Active suppression" := exists in auto_promote_suppressions[] AND
# expires_at > now (lexicographic compare on ISO-8601 Z timestamps is
# numeric-equivalent — safe).
# ---------------------------------------------------------------------------
ac_promotion_check_candidates() {
  local state_file now
  state_file="$(ac_state_path)"
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  jq --arg now "$now" '
    (.auto_promote_suppressions // []) as $sup |
    [
      (.candidate_promotions // [])[]
      | select((.vote_count // 0) >= 4)
      | . as $c
      | select(
          ([$sup[] | select(.fingerprint == $c.fingerprint and .expires_at > $now)] | length) == 0
        )
      | {
          fingerprint: .fingerprint,
          vote_count: .vote_count,
          basis: "pattern-recurrence",
          texts: (.texts // []),
          appeared_in_runs: (.appeared_in_runs // [])
        }
    ]
  ' "$state_file"
}

# ---------------------------------------------------------------------------
# ac_promotion_instinct_signal
#
# Supplementary signal (SPEC §7.2): scan the last N=3 recent_runs entries.
# For any fingerprint that appears in instinct_observations[] of ALL N of
# those entries (consecutive recurrence), emit a candidate with
# basis: "instinct-recurrence".
#
# Also honors auto_promote_suppressions (active suppressions filter out).
# ---------------------------------------------------------------------------
ac_promotion_instinct_signal() {
  local state_file now n
  state_file="$(ac_state_path)"
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  n="${ARCHITECT_CRITIC_INSTINCT_N:-3}"

  jq --arg now "$now" --argjson n "$n" '
    (.recent_runs // []) as $runs |
    (.auto_promote_suppressions // []) as $sup |
    # Take the last N runs; if fewer than N, no instinct candidates can fire.
    ($runs | length) as $rl |
    if $rl < $n then
      []
    else
      ($runs[-$n:]) as $tail |
      # For each fingerprint appearing in the FIRST tail entry, check it appears
      # in EVERY tail entry; this is the "consecutive in N runs" rule.
      (($tail[0].instinct_observations // []) | unique) as $seed |
      [
        $seed[]
        | . as $fp
        | select(
            ([ $tail[]
              | (.instinct_observations // [])
              | index($fp)
            ] | map(select(. != null)) | length) == $n
          )
        | select(
            ([$sup[] | select(.fingerprint == $fp and .expires_at > $now)] | length) == 0
          )
        | {
            fingerprint: $fp,
            basis: "instinct-recurrence",
            consecutive_runs: $n
          }
      ]
    end
  ' "$state_file"
}

# ---------------------------------------------------------------------------
# ac_promotion_promote <fingerprint> <basis>
#
# Idempotent move: if principle_promotions[] already contains an entry with
# matching fingerprint, no-op. Else append a new principle_promotions[] entry
# stamped with promotion_basis=<basis>. Text comes from candidate_promotions[]
# texts[0] — the only promotable source that carries principle text. An
# instinct-only fingerprint (present solely as a bare string in
# recent_runs[].instinct_observations[]) is refused: the observation carries
# no principle text, so promoting it would write a hash as the principle
# (#483). Scope defaults to "user" — the skill body can override by writing
# directly via state.sh helpers when it knows the right scope.
#
# Note: this function does NOT remove the candidate_promotions[] entry —
# that is left for a future garbage-collect (or implicit re-vote that won't
# matter since promotion is already recorded). Cleanup is non-essential and
# kept out of scope to keep this function pure-append.
# ---------------------------------------------------------------------------
ac_promotion_promote() {
  local fingerprint="$1"
  local basis="$2"
  local state_file lock_path now
  state_file="$(ac_state_path)"
  lock_path="$(ac_data_dir)/state.lock"
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  ac_lock_acquire "$lock_path" || return 1
  # Classify the fingerprint in one read: "promotable" (present in a
  # text-bearing source — candidate_promotions[] or an existing
  # principle_promotions[] entry), "instinct-only" (present solely as a bare
  # fingerprint string in recent_runs[].instinct_observations[] — promotable
  # in principle but the observation carries no principle text, so it is
  # refused rather than written with a hash as text), or absent entirely.
  # jq -e exit codes keep the cases apart: rc 0 carries the classification;
  # rc 1 (false) means the fingerprint is unknown — refused with a message
  # naming it (#451); rc >= 2 means state.json itself is missing, unreadable,
  # or corrupt — a state problem reported with jq's own stderr, not a
  # fingerprint miss (#483 R2). The funnel's output check remains the safety
  # net; this precheck is the usable error.
  local kind_out kind_rc
  if kind_out="$(jq -e -r --arg fp "$fingerprint" '
      ([(.candidate_promotions // [])[] | select(.fingerprint == $fp)] | length) > 0 as $cand |
      ([(.principle_promotions // [])[] | select(.fingerprint == $fp)] | length) > 0 as $promo |
      ([.recent_runs // [] | .[] | .instinct_observations // [] | .[] | select(. == $fp)] | length) > 0 as $inst |
      if $cand or $promo then "promotable"
      elif $inst then "instinct-only"
      else false end
    ' "$state_file" 2>&1)"; then
    kind_rc=0
  else
    kind_rc=$?
  fi
  if [[ $kind_rc -ge 2 ]]; then
    if [[ -n "$kind_out" ]]; then
      printf '%s\n' "$kind_out" >&2
    fi
    ac_log_error "ac_promotion_promote: cannot read $state_file"
    ac_lock_release "$lock_path"
    return 1
  elif [[ $kind_rc -ne 0 ]]; then
    ac_log_error "ac_promotion_promote: no candidate or existing promotion with fingerprint: $fingerprint"
    ac_lock_release "$lock_path"
    return 1
  elif [[ "$kind_out" == "instinct-only" ]]; then
    ac_log_error "ac_promotion_promote: fingerprint $fingerprint has no text-bearing source — instinct observations carry no principle text"
    ac_lock_release "$lock_path"
    return 1
  fi
  ac_guarded_jq_write "$state_file" \
    --arg fp "$fingerprint" \
    --arg basis "$basis" \
    --arg now "$now" \
    '
    (.principle_promotions // []) as $promos |
    if ([$promos[] | select(.fingerprint == $fp)] | length) > 0 then
      .   # idempotent — already promoted
    else
      (.candidate_promotions // []) as $cands |
      (first($cands[] | select(.fingerprint == $fp)) // null) as $cand |
      if $cand == null then
        # Unreachable via this function — the precheck above already confirmed
        # a text-bearing source under the same lock — but keeps the program
        # from ever emitting a non-object on a miss.
        error("ac_promotion_promote: fingerprint has no text-bearing source")
      else
        .principle_promotions = $promos + [{
          timestamp: $now,
          source: "auto",
          text: ($cand.texts // [""])[0],
          scope: "user",
          fingerprint: $fp,
          promotion_basis: $basis
        }]
      end
    end
    ' \
    "$state_file"
  local rc=$?
  ac_lock_release "$lock_path"
  return $rc
}
