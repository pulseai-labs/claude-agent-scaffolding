#!/usr/bin/env bash
# paseo-crew's verbatim copies of herdr-crew, and one manifest restatement.
#
# paseo-crew was ported from herdr-crew (D1 of the paseo-crew design), and three
# of its files are copies rather than code of its own:
#
#   tests/test-fidelity-pins.sh                 ← herdr-crew's, plugin name only
#   tests/eval/lib/aggregate-scores.sh          ← ossify's, below its header
#   skills/orchestrate/references/dsh-driver.md ← herdr-crew's, plugin name only
#
# herdr-crew stays installed, so a fix landing in one copy only leaves the other
# silently behind. A plugin suite cannot see its sibling; this repo-root script sees
# both trees, which is why it runs from CI's repo-root steps. Transport-bearing
# policy files are NOT pinned: a pin that needs a transport-word substitution list
# encodes the port, not parity.
#
# Usage: bash tests/test-paseo-crew-parity.sh
# Deps:  bash 3.2+, diff, sed, jq.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

printf 'paseo-crew parity pins\n'

HERDR_PINS="$ROOT/herdr-crew/tests/test-fidelity-pins.sh"
PASEO_PINS="$ROOT/paseo-crew/tests/test-fidelity-pins.sh"

# Both files non-empty FIRST: an empty file and an empty file are byte-identical,
# so the comparison below would certify two gutted copies as in sync.
for f in "$HERDR_PINS" "$PASEO_PINS"; do
  rel="${f#"$ROOT"/}"
  if [[ ! -f "$f" ]]; then fail "$rel exists"
  elif [[ ! -s "$f" ]]; then fail "$rel is non-empty"
  else pass "$rel exists and is non-empty"; fi
done

if [[ -s "$HERDR_PINS" && -s "$PASEO_PINS" ]]; then
  # cmp on the substituted stream, not a `[[ == ]]` on a command substitution:
  # `$(…)` strips trailing newlines from BOTH sides, so a blank line appended to
  # one copy — a real drift — would compare equal and read green.
  if cmp -s <(sed 's/herdr-crew/paseo-crew/g' "$HERDR_PINS") "$PASEO_PINS"; then
    pass "paseo-crew/tests/test-fidelity-pins.sh is herdr-crew's apart from the plugin name"
  else
    fail "tests/test-fidelity-pins.sh drifted from herdr-crew's copy — re-copy it, or land the same edit in both; only the plugin name may differ"
  fi
fi

HERDR_DSH="$ROOT/herdr-crew/skills/orchestrate/references/dsh-driver.md"
PASEO_DSH="$ROOT/paseo-crew/skills/orchestrate/references/dsh-driver.md"
for f in "$HERDR_DSH" "$PASEO_DSH"; do
  rel="${f#"$ROOT"/}"
  if [[ ! -f "$f" ]]; then fail "$rel exists"
  elif [[ ! -s "$f" ]]; then fail "$rel is non-empty"
  else pass "$rel exists and is non-empty"; fi
done
if [[ -s "$HERDR_DSH" && -s "$PASEO_DSH" ]]; then
  if cmp -s <(sed 's/herdr-crew/paseo-crew/g' "$HERDR_DSH") "$PASEO_DSH"; then
    pass "paseo-crew's dsh-driver.md is herdr-crew's apart from the plugin name"
  else
    fail "dsh-driver.md drifted between herdr-crew and paseo-crew — land the same edit in both; only the plugin name may differ"
  fi
fi

OSSIFY_LIB="$ROOT/ossify/tests/eval/lib/aggregate-scores.sh"
PASEO_LIB="$ROOT/paseo-crew/tests/eval/lib/aggregate-scores.sh"

for f in "$OSSIFY_LIB" "$PASEO_LIB"; do
  rel="${f#"$ROOT"/}"
  if [[ ! -f "$f" ]]; then fail "$rel exists"
  elif [[ ! -s "$f" ]]; then fail "$rel is non-empty"
  else pass "$rel exists and is non-empty"; fi
done

# The body is everything from the first `set ` line to EOF, in both copies: the
# headers are per-copy by design (paseo-crew's carries the porting note), and
# everything below them is not. The extraction is measured BEFORE it is compared,
# because an absent marker yields an empty body and two empty bodies are
# byte-identical — the pin would read green over a library neither copy has.
o_body="$(awk '/^set /{f=1} f' "$OSSIFY_LIB" | wc -l | tr -d ' ')"
h_body="$(awk '/^set /{f=1} f' "$PASEO_LIB" | wc -l | tr -d ' ')"
if [[ "$o_body" -eq 0 || "$h_body" -eq 0 ]]; then
  fail "both aggregate-scores.sh copies carry a set-line body to compare — an empty body compares equal to another"
elif cmp -s <(awk '/^set /{f=1} f' "$OSSIFY_LIB") <(awk '/^set /{f=1} f' "$PASEO_LIB"); then
  pass "paseo-crew/tests/eval/lib/aggregate-scores.sh is ossify's below its header"
else
  fail "tests/eval/lib/aggregate-scores.sh drifted from ossify's below its header — re-copy it; editing it is how the two stop agreeing"
fi

# The Claude manifest restates the marketplace entry's description. Nothing
# asserted they agree, so a description edit that landed in one and not the other
# shipped two different claims about the same plugin.
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
MANIFEST="$ROOT/paseo-crew/.claude-plugin/plugin.json"
if [[ ! -f "$MARKETPLACE" || ! -f "$MANIFEST" ]]; then
  fail "the marketplace listing and the plugin manifest both exist"
else
  # The emptiness guard uses $( ) deliberately — stripping is what "empty" means
  # here — while the EQUALITY test must not, which is why the jq expression runs
  # twice per side and the two checks use different machinery. $( ) strips
  # trailing newlines from both sides, so a description differing only in one
  # reads equal; cmp over the streams sees it. Both are hardened the same way as
  # the two copy pins above.
  #
  # Note where this pin's mutations live: on the STREAM, not the file. Appending
  # a blank line to either JSON source leaves jq's output byte-identical —
  # measured — because jq re-serializes the value and the file's own trailing
  # newline never reaches it. The discriminating mutation is a `\n` INSIDE the
  # description string, which is what cmp catches and $( ) does not.
  mkt="$(jq -r '.plugins[] | select(.name == "paseo-crew") | .description' "$MARKETPLACE")"
  man="$(jq -r '.description' "$MANIFEST")"
  if [[ -z "$mkt" || -z "$man" ]]; then
    fail "the marketplace entry and the manifest both carry a description — empty on one side, and an empty string equals no other claim"
  elif cmp -s <(jq -r '.plugins[] | select(.name == "paseo-crew") | .description' "$MARKETPLACE") \
              <(jq -r '.description' "$MANIFEST"); then
    pass "the marketplace entry's description matches the plugin manifest's"
  else
    fail "the marketplace entry's description matches the plugin manifest's — the plugin is described two ways"
  fi
fi

# paseo-crew's Codex prompts, and the collision they exist to avoid (#535 in
# herdr-crew, ported here because it is a general sibling-plugin hazard, not a
# herdr-crew-specific one). The `interface.defaultPrompt` array is a user-facing
# surface — the suggested actions on the Codex plugin page, where the string is
# actually clickable — and it is exactly the kind of thing a blind name
# substitution carries over verbatim from whichever plugin was copied. Both
# herdr-crew and orca-crew stay installed alongside paseo-crew, so a sibling's
# prompts landing here unnoticed would be silently revertible on the one
# surface the operator actually clicks. The pin has two halves: paseo-crew's own
# text, and the two-tree fact that makes it a fix — no prompt paseo-crew offers
# is one herdr-crew offers, and none is one orca-crew offers, which is exactly
# the claim a single plugin's own suite cannot see. `cmp` over the jq streams
# rather than `[[ == ]]` on command substitution, for the reason the
# description pin above states: `$( )` strips trailing newlines from both sides.
CODEX_PASEO="$ROOT/paseo-crew/.codex-plugin/plugin.json"
CODEX_HERDR="$ROOT/herdr-crew/.codex-plugin/plugin.json"
CODEX_ORCA="$ROOT/orca-crew/.codex-plugin/plugin.json"
if [[ ! -f "$CODEX_PASEO" || ! -f "$CODEX_HERDR" || ! -f "$CODEX_ORCA" ]]; then
  fail "paseo-crew's, herdr-crew's and orca-crew's Codex manifests all exist — a missing one makes the prompt counts vacuous"
else
  expected_prompts='Start a Paseo orchestrator session for this objective.
Dispatch a Paseo worker seat for this task.
Review PR 123 in a fresh Paseo seat.'
  if cmp -s <(jq -r '.interface.defaultPrompt[]' "$CODEX_PASEO") <(printf '%s\n' "$expected_prompts"); then
    pass "paseo-crew's Codex prompts are the Paseo-specific three"
  else
    fail "paseo-crew's Codex prompts are the Paseo-specific three — read: $(jq -r '.interface.defaultPrompt[]' "$CODEX_PASEO" | tr '\n' '|')"
  fi

  # Half two, whole-line matches: a substring test would call a prompt shared whenever
  # one merely CONTAINS another, and a count over an empty read certifies nothing, so
  # the read is asserted non-empty before the comparison is believed. Checked against
  # each sibling separately — the two comparisons are independent claims, and one
  # sibling clearing it says nothing about the other.
  shared=0
  checked=0
  while IFS= read -r prompt; do
    [[ -n "$prompt" ]] || continue
    checked=$((checked + 1))
    n="$(jq -r '.interface.defaultPrompt[]' "$CODEX_HERDR" | awk -v p="$prompt" '$0 == p { n++ } END { print n+0 }')"
    shared=$((shared + n))
  done < <(jq -r '.interface.defaultPrompt[]' "$CODEX_PASEO")
  if [[ "$checked" -eq 0 ]]; then
    fail "no prompt paseo-crew offers is one herdr-crew offers — read no prompts at all"
  elif [[ "$shared" -eq 0 ]]; then
    pass "no prompt paseo-crew offers is one herdr-crew offers (checked $checked)"
  else
    fail "no prompt paseo-crew offers is one herdr-crew offers — $shared shared with herdr-crew"
  fi

  shared=0
  checked=0
  while IFS= read -r prompt; do
    [[ -n "$prompt" ]] || continue
    checked=$((checked + 1))
    n="$(jq -r '.interface.defaultPrompt[]' "$CODEX_ORCA" | awk -v p="$prompt" '$0 == p { n++ } END { print n+0 }')"
    shared=$((shared + n))
  done < <(jq -r '.interface.defaultPrompt[]' "$CODEX_PASEO")
  if [[ "$checked" -eq 0 ]]; then
    fail "no prompt paseo-crew offers is one orca-crew offers — read no prompts at all"
  elif [[ "$shared" -eq 0 ]]; then
    pass "no prompt paseo-crew offers is one orca-crew offers (checked $checked)"
  else
    fail "no prompt paseo-crew offers is one orca-crew offers — $shared shared with orca-crew"
  fi
fi

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
