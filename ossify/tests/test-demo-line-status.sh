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

# --- Task 2: default planned, explicit active, anything else refused
t_capture oss_ledger_add_auto "$S" r0.s2 "a planned line" "false" "exit:0"
t_assert_rc 0 "add_auto with no status ok"; P1="$T_OUT"
t_capture oss_state_read "$S" "[.demo_ledger[] | select(.id==\"$P1\")][0].status"
t_assert_eq "planned" "$T_OUT" "a new auto line defaults to planned"
t_capture oss_ledger_add_user "$S" r0.s2 "cancel an order and see it leave the list" "order gone"
P2="$T_OUT"
t_capture oss_state_read "$S" "[.demo_ledger[] | select(.id==\"$P2\")][0].status"
t_assert_eq "planned" "$T_OUT" "a new user line defaults to planned"
t_capture oss_ledger_add_auto "$S" r0.s2 "bad status" "true" "exit:0" live
t_assert_rc 2 "an unknown initial status is refused"
t_capture oss_ledger_add_user "$S" r0.s2 "x" "y" deferred
t_assert_rc 2 "a new line cannot start deferred"

# --- Task 3: activation
t_capture oss_ledger_activate "$S" "$P1"
t_assert_rc 0 "activate a planned line"
t_capture oss_state_read "$S" "[.demo_ledger[] | select(.id==\"$P1\")][0].status"
t_assert_eq "active" "$T_OUT" "planned -> active"
t_capture oss_ledger_activate "$S" "$P1"
t_assert_rc 2 "activating an active line is refused"
t_assert_contains "$T_OUT" "active" "the refusal names the current status"
t_capture oss_ledger_activate "$S" d999
t_assert_rc 7 "activate an unknown line is rc 7"
# activate_spine touches only that spine's PLANNED lines; a deferred line stays deferred
oss_ledger_add_auto "$S" r0.s2 "second planned" "true" "exit:0" >/dev/null
oss_ledger_add_auto "$S" r0.s1 "other spine planned" "true" "exit:0" >/dev/null; O1="$(oss_state_read "$S" '.demo_ledger[-1].id')"
oss_ledger_add_user "$S" r0.s2 "rename a playlist and find it by its new name" "found" active >/dev/null; U1="$(oss_state_read "$S" '.demo_ledger[-1].id')"
oss_state_mutate "$S" set_demo_line_status "{\"id\":\"$U1\",\"status\":\"deferred\",\"by\":\"r0.s2\",\"reason\":\"operator: later\",\"until\":\"r1\"}"
t_capture oss_ledger_activate_spine "$S" r0.s2
t_assert_rc 0 "activate_spine ok"; t_assert_contains "$T_OUT" "activated 2" "both planned lines of r0.s2 (P2 and the second planned auto line)"
t_capture oss_state_read "$S" "[.demo_ledger[] | select(.source_spine==\"r0.s2\" and .status==\"planned\")] | length"
t_assert_eq "0" "$T_OUT" "no planned line left on r0.s2"
t_capture oss_state_read "$S" "[.demo_ledger[] | select(.id==\"$O1\")][0].status"
t_assert_eq "planned" "$T_OUT" "another spine's planned line is untouched"
t_capture oss_state_read "$S" "[.demo_ledger[] | select(.id==\"$U1\")][0].status"
t_assert_eq "deferred" "$T_OUT" "a deferred line is not undone by activate_spine (Review Focus 3)"
t_capture oss_ledger_activate_spine "$S" r0.s2
t_assert_rc 0 "a second activate_spine is fine"; t_assert_contains "$T_OUT" "activated 0" "zero is not an error"
t_capture oss_ledger_activate_spine "$S" r9.s9
t_assert_rc 7 "unknown spine is rc 7"
t_capture oss_ledger_activate "$S" "$U1"
t_assert_rc 0 "a deferred line can be activated (walked now)"

cd "$HERE"; rm -rf "$TMP"
t_summary
