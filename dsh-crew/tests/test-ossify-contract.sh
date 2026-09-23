#!/usr/bin/env bash
#
# dsh-crew — ossify contract parity
#
# dsh-executor mirrors ossify's external-executor records by quoting them. This
# asserts every field name the mirror uses exists in ossify's own reference
# files, and that every request-record field ossify defines is in the mirror
# (both directions for the request, so a field added on either side turns red).
#
# ossify is the sibling plugin in this marketplace checkout; OSSIFY_ROOT
# overrides that for an installed copy.
#
# Usage: bash dsh-crew/tests/test-ossify-contract.sh   Exit 0 when in parity.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

OSSIFY="${OSSIFY_ROOT:-$PLUGIN_ROOT/../ossify}"
REF="$OSSIFY/skills/work-item/references"
MIRROR="$PLUGIN_ROOT/skills/dsh-executor/references/records.md"
SKILL="$PLUGIN_ROOT/skills/dsh-executor/SKILL.md"

section "inputs"
[ -f "$REF/external-executor.md" ] && pass "ossify external-executor.md found" || { fail "ossify external-executor.md found" "$REF"; report; exit 1; }
[ -f "$REF/correction-continuation.md" ] && pass "ossify correction-continuation.md found" || { fail "ossify correction-continuation.md found"; report; exit 1; }
[ -f "$MIRROR" ] && pass "records.md exists" || { fail "records.md exists"; report; exit 1; }
[ -f "$SKILL" ] && pass "SKILL.md exists" || { fail "SKILL.md exists"; report; exit 1; }

has() { grep -qF -- "$2" "$1"; }

section "mirror → ossify: every name the mirror uses is ossify's"
for name in external_execution_request external_execution_result external_execution_gaps \
  work_item_id target_repo handoff_path spec_path worktree_path branch base_sha \
  coordinator_verdict implementer_return mode report_path summary stage_status all_staged \
  tree_oid head_oid report_oid spec_oid gaps section question severity gaps-surfaced accepted; do
  if has "$MIRROR" "$name"; then
    if has "$REF/external-executor.md" "$name" || has "$REF/returns.md" "$name"; then pass "$name"; else fail "$name is in records.md but not in ossify"; fi
  else
    fail "$name is missing from records.md"
  fi
done
for name in "OSSIFY CORRECTION CONTINUATION v1" expected_branch expected_head_sha expected_tree_oid failures; do
  if has "$MIRROR" "$name" && has "$REF/correction-continuation.md" "$name"; then pass "$name"; else fail "$name (records.md ↔ correction-continuation.md)"; fi
done

section "ossify → mirror: every request field ossify defines is mirrored"
# The request block in ossify is the yaml between 'external_execution_request:' and the
# next blank line; its keys are the contract.
ossify_req_keys="$(awk '/^external_execution_request:/{f=1; next} f && /^$/{exit} f && /^  [a-z_]+:/{sub(/:.*/,""); sub(/^  /,""); print}' "$REF/external-executor.md")"
[ -n "$ossify_req_keys" ] && pass "request keys extracted from ossify" || fail "request keys extracted from ossify"
while IFS= read -r k; do
  [ -n "$k" ] || continue
  has "$MIRROR" "$k" && pass "request field $k mirrored" || fail "request field $k mirrored"
done <<< "$ossify_req_keys"
mirror_req_keys="$(awk '/^external_execution_request:/{f=1; next} f && /^$/{exit} f && /^  [a-z_]+:/{sub(/:.*/,""); sub(/^  /,""); print}' "$MIRROR")"
[ "$(printf '%s' "$ossify_req_keys" | sort)" = "$(printf '%s' "$mirror_req_keys" | sort)" ] && pass "request field set identical" || fail "request field set identical" "ossify: $(echo $ossify_req_keys) | mirror: $(echo $mirror_req_keys)"

section "identity table: the six git reads the skill prescribes"
for row in "rev-parse --abbrev-ref HEAD" "rev-parse HEAD" "write-tree" "status --porcelain" "hash-object" "report.md"; do
  has "$SKILL" "$row" && pass "row: $row" || fail "row: $row"
done

report
