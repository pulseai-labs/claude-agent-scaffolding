#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
. "$HERE/../lib/id.sh"; . "$HERE/../lib/state.sh"; . "$HERE/../lib/registries.sh"
OSS="$HERE/../bin/oss"
TMP="$(mktemp -d)"; S="$TMP/state.json"
oss_state_init "$S" reg-demo >/dev/null

t_capture oss_reg_add_bone "$S" ADR-0002 "hexagonal domain boundary" "src/domain/**,src/lib.rs" "revisit at v1"
t_assert_rc 0 "bone added"
t_capture oss_reg_add_risk_gate "$S" live-money "src/adapters/broker/**" "paper-env,kill-switch,human-confirm,audit-trail"
t_assert_rc 0 "risk gate added"
t_capture oss_reg_add_fake "$S" "coach-llm" fake "shell for skeleton" "first real strategy iteration" r1
t_assert_rc 0 "fake added"
t_capture oss_reg_add_feature "$S" "paper trading loop" "user places a paper trade and sees P&L move" flesh journey-map
t_assert_rc 0 "feature added"

# --- D1 fake lifecycle (Task 2, named risk 7): oss_reg_set_fake_status must
# leave expiry_release ALONE when the 5th arg (new expiry) is omitted.
# test-ledger.sh only exercises the WITH-a-new-expiry (renew) path, so that
# half of the contract has no coverage without this.
t_capture oss_reg_set_fake_status "$S" "coach-llm" replaced "swapped for a real model"
t_assert_rc 0 "fake status change without a new expiry ok"
t_capture jq -r '.fakes[] | select(.boundary=="coach-llm") | .status' "$S"
t_assert_eq "replaced" "$T_OUT" "status actually changed"
t_capture jq -r '.fakes[] | select(.boundary=="coach-llm") | .expiry_release' "$S"
t_assert_eq "r1" "$T_OUT" "expiry_release is UNCHANGED when the 5th arg is omitted"

t_capture oss_reg_touch_check "$S" src/domain/dsl/compile.rs
t_assert_rc 0 "domain path matches a bone"; t_assert_contains "$T_OUT" "bone ADR-0002" "bone named"
t_capture oss_reg_touch_check "$S" src/adapters/broker/order.rs
t_assert_rc 0 "broker path matches risk gate"; t_assert_contains "$T_OUT" "risk_gate live-money" "gate named"
t_capture oss_reg_touch_check "$S" README.md
t_assert_rc 1 "clean path matches nothing"

# Fix 2: a bone/risk-gate with no touch surface is legitimate — empty CSV must
# yield an empty [] touch array, not a raw jq --argjson parse failure (rc 4).
t_capture oss_reg_add_bone "$S" ADR-9 "no-touch bone" "" ""
t_assert_rc 0 "no-touch bone added"
t_capture jq -c '.bones[] | select(.adr=="ADR-9") | .touch' "$S"
t_assert_eq "[]" "$T_OUT" "no-touch bone's touch is []"

# --- Final review finding 3: touch_check must distinguish "clean" from "could
# not check". Both were rc 1 with no stdout and no stderr — byte-identical — and
# every documented call site is `if oss touch_check …; then HIT; else CLEAN; fi`,
# so an unreadable state silently classified the spine as `flesh`, the permissive
# class. The judge failed OPEN. rc 2 (usage, the established code in these libs)
# now means inconclusive; rc 0 = matched and rc 1 = clean are unchanged — that
# inversion is deliberate and every caller depends on it.
t_capture oss_reg_touch_check "$S"
t_assert_rc 2 "zero paths is rc 2 (usage), not rc 1 (clean)"
t_assert_contains "$T_OUT" "at least one path" "zero-path usage error names the problem"

printf 'THIS IS NOT VALID JSON\n' > "$TMP/corrupt.json"
t_capture oss_reg_touch_check "$TMP/corrupt.json" src/domain/dsl/compile.rs
t_assert_rc 2 "corrupt state is rc 2 (could not check), not rc 1 (clean)"
t_assert_contains "$T_OUT" "cannot read" "unreadable state says so instead of answering clean"

t_capture oss_reg_touch_check "$TMP/nonexistent.json" src/domain/dsl/compile.rs
t_assert_rc 2 "nonexistent state file is rc 2, not rc 1"

jq 'del(.bones)' "$S" > "$TMP/nobones.json"
t_capture oss_reg_touch_check "$TMP/nobones.json" src/domain/dsl/compile.rs
t_assert_rc 2 "state missing .bones is rc 2, not rc 1"

jq 'del(.risk_gates)' "$S" > "$TMP/nogates.json"
t_capture oss_reg_touch_check "$TMP/nogates.json" src/domain/dsl/compile.rs
t_assert_rc 2 "state missing .risk_gates is rc 2, not rc 1"

# ...and the tightening must NOT turn a legitimately empty registry into
# "inconclusive": a fresh project with no bones and no gates is genuinely CLEAN.
T5="$(mktemp -d)"; S5="$T5/state.json"
oss_state_init "$S5" reg-empty >/dev/null
t_capture oss_reg_touch_check "$S5" src/domain/dsl/compile.rs
t_assert_rc 1 "empty-but-valid registries are CLEAN (rc 1), not inconclusive"
rm -rf "$T5"


# --- #340: the CSV grammar — bare "," separates; "\," is a literal comma ----
# The pilot defect: a phrase control split into fragments that no supported
# path could repair (append-only journal, no set verb). These pin the escape
# round-trip for BOTH verbs (gate controls, bone/gate touch globs) and the
# corrective-append repair verb.
t_capture _oss_csv_to_json "paper env,audit trail: record image\, mounts\, egress,kill switch"
t_assert_eq '[
  "paper env",
  "audit trail: record image, mounts, egress",
  "kill switch"
]' "$T_OUT" "escaped commas keep one phrase as ONE control"
t_capture _oss_csv_to_json "src/{exec\,api}/**,src/broker/**"
t_assert_eq '[
  "src/{exec,api}/**",
  "src/broker/**"
]' "$T_OUT" "brace-glob comma written through the escape round-trips to the literal glob"
t_capture _oss_csv_to_json "a\, b,c ,d\,"
t_assert_eq '[
  "a, b",
  "c",
  "d,"
]' "$T_OUT" "trim happens around restored commas, not inside them"
t_capture _oss_csv_to_json "plain\\path\,still-one,x"
t_assert_eq '[
  "plain\\path,still-one",
  "x"
]' "$T_OUT" "a backslash NOT before a comma passes through untouched"

t_capture oss_reg_add_risk_gate "$S" phrase-gate "src/exec/**" "paper env,audit trail: record image\, mounts,kill switch"
t_assert_rc 0 "gate with an escaped phrase control added"
t_capture jq -c '.risk_gates[] | select(.name=="phrase-gate") | .controls' "$S"
t_assert_eq '["paper env","audit trail: record image, mounts","kill switch"]' "$T_OUT" "minted controls hold the phrase whole"

# Corrective append: repair, not history edit — replay stays authoritative.
t_capture oss_reg_set_risk_gate_controls "$S" phrase-gate "paper env,human confirm,audit trail: record image\, mounts\, egress,kill switch"
t_assert_rc 0 "set_controls appends the correction"
t_capture jq -c '.risk_gates[] | select(.name=="phrase-gate") | .controls' "$S"
t_assert_eq '["paper env","human confirm","audit trail: record image, mounts, egress","kill switch"]' "$T_OUT" "controls replaced through the verb"
t_capture oss_state_replay "$S"
t_assert_rc 0 "replay reproduces the corrected state — the journal is authoritative"
t_capture _oss_csv_to_json "$(printf 'a\357\200\200b,c')"
t_assert_rc 2 "a raw private-use codepoint in input refuses (fail-closed)"
t_assert_contains "$T_OUT" "private-use codepoint" "the refusal names the codepoint family"
MUT_BEFORE="$(jq '.mutations | length' "$S")"
t_capture oss_reg_add_risk_gate "$S" pua-gate "src/**" "$(printf 'paper env\357\200\200x')"
t_assert_rc 2 "private-use through the VERB refuses cleanly (no jq noise, rc 2)"
t_capture jq '.risk_gates | map(select(.name=="pua-gate")) | length' "$S"
t_assert_eq "0" "$T_OUT" "the refused gate minted NO mutation"
t_capture oss_reg_set_risk_gate_controls "$S" phrase-gate "$(printf 'a\357\200\200b')"
t_assert_rc 2 "set_controls propagates the refusal rc too"
t_capture oss_reg_add_bone "$S" ADR-78 "pua bone" "$(printf 'src/\357\200\200**')" ""
t_assert_rc 2 "bone_add propagates the refusal rc too"
t_capture jq '.mutations | length' "$S"
t_assert_eq "$MUT_BEFORE" "$T_OUT" "every refusal above left the JOURNAL unchanged - rc 2 after a silent append reads identical from the pass count"
t_capture oss_reg_set_risk_gate_controls "$TMP/nonexistent-state.json" g1 "x"
t_assert_rc 1 "stateless project answers the init message, not a raw jq error"
t_assert_contains "$T_OUT" "oss init" "the message names the remedy verb"
t_capture oss_reg_set_risk_gate_controls "$S" no-such-gate "x"
t_assert_rc 7 "unknown gate name refuses"
t_assert_contains "$T_OUT" "unknown risk gate" "the unknown-name refusal names the gate"
t_capture oss_reg_add_risk_gate "$S" phrase-gate "src/**" "dup"   # #305 shape
t_capture oss_reg_set_risk_gate_controls "$S" phrase-gate "x"
t_assert_rc 7 "duplicate gate names refuse rather than guess"
t_assert_contains "$T_OUT" "#305" "the duplicate refusal names the issue"

# bone_add shares the splitter: a brace-glob touch entry stays one entry.
t_capture oss_reg_add_bone "$S" ADR-77 "brace touch" "src/{exec\,api}/**" ""
t_assert_rc 0 "bone with brace-glob touch added"
t_capture jq -c '.bones[] | select(.adr=="ADR-77") | .touch' "$S"
t_assert_eq '["src/{exec,api}/**"]' "$T_OUT" "bone touch holds the literal brace glob"

# --- 1.11.0: re-pointing a touch surface (#469/#369/#411/#305) -------------
# bone_add and risk_gate_add set a touch surface once. When code moves (into a
# packages/ tree, say) the registered globs match nothing and touch_check goes
# silently CLEAN on every affected bone and gate - reclassification and the
# release-close docs trigger stop firing with no error. The repair is a
# corrective append, like set_controls (#340): replay stays authoritative.
# The op names and payload keys are a compatibility contract - live journals
# already carry set_bone_touch {adr,touch} and set_risk_gate_touch {name,touch}.
ST="$TMP/touch.json"
oss_state_init "$ST" touch-demo >/dev/null
oss_reg_add_bone "$ST" ADR-0003 "silver layer" "src/silver/**,src/ingestion/**" "" >/dev/null
oss_reg_add_risk_gate "$ST" gold-correctness "src/gold/**" "golden-set" >/dev/null
t_capture oss_reg_touch_check "$ST" packages/ma/silver/load.py packages/ma/gold/build.py
t_assert_rc 1 "setup: code moved under packages/ matches no registered glob - the silent-clean defect"

N0="$(jq '.mutations | length' "$ST")"
t_capture oss_reg_set_bone_touch "$ST" ADR-0003 "packages/ma/silver/**,packages/ma/ingestion/**"
t_assert_rc 0 "bone_set_touch appends the correction"
t_capture jq -c '.bones[] | select(.adr=="ADR-0003") | .touch' "$ST"
t_assert_eq '["packages/ma/silver/**","packages/ma/ingestion/**"]' "$T_OUT" "the bone's touch surface is replaced, not extended"
t_capture jq -c '.mutations[-1] | [.op, .payload]' "$ST"
t_assert_eq '["set_bone_touch",{"adr":"ADR-0003","touch":["packages/ma/silver/**","packages/ma/ingestion/**"]}]' "$T_OUT" "journaled as set_bone_touch with payload exactly {adr,touch}"
t_capture oss_reg_touch_check "$ST" packages/ma/silver/load.py
t_assert_rc 0 "touch_check hits the new glob"
t_assert_contains "$T_OUT" "bone ADR-0003" "...and names the re-pointed bone"
t_capture oss_reg_touch_check "$ST" src/silver/load.py
t_assert_rc 1 "touch_check is clean on the old glob - it was replaced"

t_capture oss_reg_set_risk_gate_touch "$ST" gold-correctness "packages/ma/gold/**,notebooks/gold_build.py"
t_assert_rc 0 "risk_gate_set_touch appends the correction"
t_capture jq -c '.risk_gates[] | select(.name=="gold-correctness") | .touch' "$ST"
t_assert_eq '["packages/ma/gold/**","notebooks/gold_build.py"]' "$T_OUT" "the gate's touch surface is replaced"
t_capture jq -c '.risk_gates[] | select(.name=="gold-correctness") | .controls' "$ST"
t_assert_eq '["golden-set"]' "$T_OUT" "the gate's controls are untouched by a touch re-point"
t_capture jq -c '.mutations[-1] | [.op, .payload]' "$ST"
t_assert_eq '["set_risk_gate_touch",{"name":"gold-correctness","touch":["packages/ma/gold/**","notebooks/gold_build.py"]}]' "$T_OUT" "journaled as set_risk_gate_touch with payload exactly {name,touch}"
t_capture oss_reg_touch_check "$ST" packages/ma/gold/build.py
t_assert_rc 0 "touch_check hits the gate's new glob"
t_assert_contains "$T_OUT" "risk_gate gold-correctness" "...and names the re-pointed gate"
t_capture oss_reg_touch_check "$ST" src/gold/build.py
t_assert_rc 1 "touch_check is clean on the gate's old glob"

t_capture jq '.mutations | length' "$ST"
t_assert_eq "$((N0 + 2))" "$T_OUT" "one journaled mutation per accepted call"
t_capture oss_state_replay "$ST"
t_assert_rc 0 "replay reproduces the re-pointed state - the journal is authoritative"

# Refusals. None may journal: rc 2 after a silent append reads identical from
# the pass count, so the journal length is re-checked after all of them.
N1="$(jq '.mutations | length' "$ST")"
for v in oss_reg_set_bone_touch oss_reg_set_risk_gate_touch; do
  t_capture "$v" "$TMP/nonexistent-state.json" x "src/**"
  t_assert_rc 1 "$v: a stateless project answers the init message"
  t_assert_contains "$T_OUT" "oss init" "$v: the message names the remedy verb"
done
t_capture oss_reg_set_bone_touch "$ST" ADR-0404 "src/**"
t_assert_rc 7 "bone_set_touch: an unknown ADR refuses"
t_assert_contains "$T_OUT" "unknown bone 'ADR-0404'" "...and names the bone"
t_capture oss_reg_set_risk_gate_touch "$ST" no-such-gate "src/**"
t_assert_rc 7 "risk_gate_set_touch: an unknown gate refuses"
t_assert_contains "$T_OUT" "unknown risk gate 'no-such-gate'" "...and names the gate"
# An empty touch list is refused: [] makes touch_check clean on every path,
# forever - the very defect this verb exists to repair. bone_add still admits
# an empty surface (a bone with none is legitimate); a RE-POINT to nothing is
# not a repair. Whitespace-only and comma-only lists collapse to [] in the
# splitter, so they are the same case.
for csv in "" "   " " , ,"; do
  t_capture oss_reg_set_bone_touch "$ST" ADR-0003 "$csv"
  t_assert_rc 2 "bone_set_touch refuses an empty touch list ('$csv')"
  t_assert_contains "$T_OUT" "at least one glob" "...and says what it needs ('$csv')"
  t_capture oss_reg_set_risk_gate_touch "$ST" gold-correctness "$csv"
  t_assert_rc 2 "risk_gate_set_touch refuses an empty touch list ('$csv')"
  t_assert_contains "$T_OUT" "at least one glob" "...and says what it needs ('$csv')"
done
# ADJACENT CONTROL for that guard (Codex P2 and the GLM seat, round 1 on
# PR #520). The loop above pins SPACE-only emptiness - which the old
# `length > 0` form already caught, so it proves nothing about the loosening.
# The splitter trims literal spaces only, so a tab-, CR-, VT- or NBSP-only
# entry SURVIVES as a "glob" that can never match a real path, reproducing the
# exact silent-clean defect the verb exists to repair (measured: it journaled
# `["\t"]` at rc 0 and touch_check went clean). These rows are what goes RED
# under the array-length form.
for csv in "$(printf '\t')" "$(printf '\r')" "$(printf '\v')" "$(printf '\xc2\xa0')" "$(printf '　')"; do
  t_capture oss_reg_set_bone_touch "$ST" ADR-0003 "$csv"
  t_assert_rc 2 "bone_set_touch refuses a blank-lookalike list (non-space whitespace, $(printf '%s' "$csv" | od -An -tx1 | tr -d ' '))"
  t_assert_contains "$T_OUT" "at least one glob" "...and says what it needs"
  t_capture oss_reg_set_risk_gate_touch "$ST" gold-correctness "$csv"
  t_assert_rc 2 "risk_gate_set_touch refuses a blank-lookalike list (non-space whitespace, $(printf '%s' "$csv" | od -An -tx1 | tr -d ' '))"
  t_assert_contains "$T_OUT" "at least one glob" "...and says what it needs"
done
# The OTHER input the splitter mishandles: jq -R is LINE-oriented, so a csv
# wrapped over two lines emits TWO JSON values and --argjson cannot parse them.
# Fail-closed either way, but the diagnostic must not say "empty" - that is a
# false cause, and an agent following its remedy retries and stays stuck.
t_capture oss_reg_set_bone_touch "$ST" ADR-0003 "$(printf 'src/a/**\nsrc/b/**')"
t_assert_rc 2 "bone_set_touch refuses a two-line touch-csv"
t_assert_contains "$T_OUT" "not one list" "...and reports two lists, not an empty one"
t_capture oss_reg_set_risk_gate_touch "$ST" gold-correctness "$(printf 'src/a/**\nsrc/b/**')"
t_assert_rc 2 "risk_gate_set_touch refuses a two-line touch-csv"
t_assert_contains "$T_OUT" "not one list" "...and reports two lists, not an empty one"
t_capture oss_reg_set_bone_touch "$ST" ADR-0003 "$(printf 'src/\357\200\200**')"
t_assert_rc 2 "bone_set_touch propagates the private-use refusal"
t_capture oss_reg_set_risk_gate_touch "$ST" gold-correctness "$(printf 'src/\357\200\200**')"
t_assert_rc 2 "risk_gate_set_touch propagates the private-use refusal"
printf '{not json' > "$TMP/touch-corrupt.json"
t_capture oss_reg_set_bone_touch "$TMP/touch-corrupt.json" ADR-0003 "src/**"
t_assert_rc 2 "bone_set_touch: an unreadable state is rc 2, not a raw jq error"
t_capture oss_reg_set_risk_gate_touch "$TMP/touch-corrupt.json" gold-correctness "src/**"
t_assert_rc 2 "risk_gate_set_touch: an unreadable state is rc 2, not a raw jq error"
# #525: the ladder's `2>/dev/null` is a LEARNED fix, not cosmetic noise
# suppression - it is what keeps a corrupt state's refusal OURS. Without it jq's
# raw parse error lands in the same captured output as the "cannot read" line,
# and the operator (or an agent) reading the first line sees a jq failure
# instead of the remedy. The arm had no assertion before this extraction, which
# is exactly the "line a fourth hand-copy drops" the issue names - so it is
# pinned here, on all three verbs that share the ladder now.
for _v in oss_reg_set_bone_touch oss_reg_set_risk_gate_touch oss_reg_set_risk_gate_controls; do
  case "$_v" in
    oss_reg_set_bone_touch)         _a="ADR-0003";         _msg="cannot read bones" ;;
    oss_reg_set_risk_gate_touch)    _a="gold-correctness"; _msg="cannot read risk gates" ;;
    oss_reg_set_risk_gate_controls) _a="phrase-gate";      _msg="cannot read risk gates" ;;
  esac
  t_capture "$_v" "$TMP/touch-corrupt.json" "$_a" "src/**"
  t_assert_rc 2 "$_v: a corrupt state refuses at rc 2"
  t_assert_contains "$T_OUT" "$_msg" "$_v: the refusal is the verb's own message"
  case "$T_OUT" in
    *"parse error"*|*"jq: error"*)
      T_FAIL=$((T_FAIL+1)); echo "FAIL: $_v leaks jq's raw error into the refusal - the ladder's 2>/dev/null routing is gone" ;;
    *) T_PASS=$((T_PASS+1)) ;;
  esac
done
t_capture jq '.mutations | length' "$ST"
t_assert_eq "$N1" "$T_OUT" "every refusal above left the journal unchanged"
# Duplicates (#305 shape) refuse rather than guess which entry to re-point.
oss_reg_add_bone "$ST" ADR-0003 "silver layer, minted twice" "src/x/**" "" >/dev/null
oss_reg_add_risk_gate "$ST" gold-correctness "src/y/**" "dup" >/dev/null
t_capture oss_reg_set_bone_touch "$ST" ADR-0003 "src/**"
t_assert_rc 7 "bone_set_touch: a duplicate ADR refuses"
t_assert_contains "$T_OUT" "#305" "...and names the issue"
t_capture oss_reg_set_risk_gate_touch "$ST" gold-correctness "src/**"
t_assert_rc 7 "risk_gate_set_touch: a duplicate gate name refuses"
t_assert_contains "$T_OUT" "#305" "...and names the issue"

# The dispatcher path: bin/oss runs `set -euo pipefail`, which the sourced
# calls above do not. A verb that works sourced can still die there.
SD="$TMP/touch-dispatch.json"
oss_state_init "$SD" touch-dispatch >/dev/null
oss_reg_add_bone "$SD" ADR-0003 "silver layer" "src/silver/**" "" >/dev/null
oss_reg_add_risk_gate "$SD" gold-correctness "src/gold/**" "golden-set" >/dev/null
t_capture env OSS_STATE_FILE="$SD" bash "$OSS" bone_set_touch ADR-0003 "packages/ma/silver/**"
t_assert_rc 0 "oss bone_set_touch works through the strict dispatcher"
t_capture env OSS_STATE_FILE="$SD" bash "$OSS" risk_gate_set_touch gold-correctness "packages/ma/gold/**"
t_assert_rc 0 "oss risk_gate_set_touch works through the strict dispatcher"
t_capture jq -c '[.bones[0].touch, .risk_gates[0].touch]' "$SD"
t_assert_eq '[["packages/ma/silver/**"],["packages/ma/gold/**"]]' "$T_OUT" "both re-points landed through the dispatcher"
t_capture env OSS_STATE_FILE="$SD" bash "$OSS" bone_set_touch ADR-0003 ""
t_assert_rc 2 "the dispatcher returns the lib's rc 2 on an empty list, not an errexit abort"
t_assert_contains "$T_OUT" "at least one glob" "...and it is the lib's refusal, not an unknown-verb usage error"
t_capture env OSS_STATE_FILE="$SD" bash "$OSS" risk_gate_set_touch no-such-gate "src/**"
t_assert_rc 7 "the dispatcher returns the lib's rc 7 on an unknown gate"

rm -rf "$TMP"
t_summary
