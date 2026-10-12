#!/usr/bin/env bash
# Demo-line status: planned, deferred, escaped (ossify 1.16.0; #363, #726, #710).
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
. "$HERE/../lib/id.sh"; . "$HERE/../lib/state.sh"; . "$HERE/../lib/manifest.sh"
. "$HERE/../lib/entities.sh"; . "$HERE/../lib/ledger.sh"; . "$HERE/../lib/verify.sh"
. "$HERE/../lib/worktree.sh"; . "$HERE/../lib/demo.sh"
TMP="$(mktemp -d)"; S="$TMP/state.json"
mkdir -p "$TMP/.workspace" "$TMP/canon"
cat > "$TMP/.workspace/pairing.json" <<EOF
{"schema_version":"1.0","ai_workspace":{"root":"$TMP"},"canonical":{"root":"$TMP/canon"},"well_known_paths":{}}
EOF
cd "$TMP"
oss_state_init "$S" line-status >/dev/null
oss_entity_add_release "$S" "r" "goal" >/dev/null
oss_entity_add_spine "$S" r0 "spine one" bone canonical >/dev/null
oss_entity_add_spine "$S" r0 "spine two" flesh canonical >/dev/null

# --- Task 1: the journal op writes the new fields only for their own status
oss_ledger_add_user "$S" r0.s1 "export an album with its captions" "captions survive" >/dev/null
oss_state_mutate "$S" set_demo_line_status '{"id":"d1","status":"deferred","by":"r0.s1","reason":"operator: no device today","until":"r2"}'
t_capture oss_state_read "$S" '.demo_ledger[0].deferred_until_release'
t_assert_eq "r2" "$T_OUT" "deferred writes deferred_until_release"
t_capture oss_state_read "$S" '.demo_ledger[0] | has("escape_clause")'
t_assert_eq "false" "$T_OUT" "deferred does not create escape_clause"
oss_state_mutate "$S" set_demo_line_status '{"id":"d1","status":"escaped","by":"r0.s1","reason":"operator: negative result accepted","clause":"SPINE.md: close on a written negative result"}'
t_capture oss_state_read "$S" '.demo_ledger[0].escape_clause'
t_assert_eq "SPINE.md: close on a written negative result" "$T_OUT" "escaped writes escape_clause"
oss_ledger_add_auto "$S" r0.s1 "plain" "true" "exit:0" >/dev/null
oss_state_mutate "$S" set_demo_line_status '{"id":"d2","status":"quarantined","by":"quarantine","reason":"x","release":"r1"}'
t_capture oss_state_read "$S" '.demo_ledger[1] | (has("deferred_until_release") or has("escape_clause"))'
t_assert_eq "false" "$T_OUT" "a quarantine creates neither new key (old-journal replay shape)"
t_capture oss_state_replay "$S"
t_assert_rc 0 "replay clean across the new fields"

cd "$HERE"; rm -rf "$TMP"
t_summary
