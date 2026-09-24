#!/usr/bin/env bash
# herdr-crew's three verbatim copies, and one manifest restatement (#513).
#
# herdr-crew was ported from orca-crew, and three of its files are copies of a
# sibling plugin's rather than code of its own:
#
#   tests/test-fidelity-pins.sh          ← orca-crew's, plugin name only
#   tests/eval/lib/aggregate-scores.sh   ← ossify's, below its header
#   skills/orchestrate/references/dsh-driver.md ← orca-crew's, plugin name only
#
# Each copy's own header states "keep them identical" as a manual ritual, and
# nothing enforced it. orca-crew stays installed for the migration, so a fix to
# the shared file that lands in one copy only leaves the other silently behind —
# which is the drift the ritual exists to prevent and exactly the shape a
# ritual does not catch.
#
# WHY THESE AND NOT MORE. Every pair is pinned here rather than in either
# plugin's suite because a plugin suite cannot see its sibling: herdr-crew's
# run-tests.sh reads only herdr-crew/, and orca-crew's only orca-crew/. A
# repo-root script sees both trees, which is why this one runs from CI's
# repo-root steps. What each copy CONTAINS is guarded by that plugin's own
# suite; this file guards only that the two still agree.
#
# The name normalization is deliberately global: the claim is that the two files
# differ in nothing but the plugin name, so substituting the name everywhere and
# finding a byte-identical result is that claim, stated once. A narrower
# substitution would encode the three line numbers instead, which move.
#
# The eval-library body starts at its first `set ` line in both copies: the
# headers are per-copy by design (herdr-crew's carries the porting note), and
# everything below is not.
#
# Usage: bash tests/test-herdr-crew-parity.sh
# Deps:  bash 3.2+, diff, sed, jq.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  not ok  %s\n' "$1"; }

printf 'herdr-crew parity pins\n'

ORCA_PINS="$ROOT/orca-crew/tests/test-fidelity-pins.sh"
HERDR_PINS="$ROOT/herdr-crew/tests/test-fidelity-pins.sh"

# Both files non-empty FIRST: an empty file and an empty file are byte-identical,
# so the comparison below would certify two gutted copies as in sync.
for f in "$ORCA_PINS" "$HERDR_PINS"; do
  rel="${f#"$ROOT"/}"
  if [[ ! -f "$f" ]]; then fail "$rel exists"
  elif [[ ! -s "$f" ]]; then fail "$rel is non-empty"
  else pass "$rel exists and is non-empty"; fi
done

if [[ -s "$ORCA_PINS" && -s "$HERDR_PINS" ]]; then
  # cmp on the substituted stream, not a `[[ == ]]` on a command substitution:
  # `$(…)` strips trailing newlines from BOTH sides, so a blank line appended to
  # one copy — a real drift — would compare equal and read green.
  if cmp -s <(sed 's/orca-crew/herdr-crew/g' "$ORCA_PINS") "$HERDR_PINS"; then
    pass "herdr-crew/tests/test-fidelity-pins.sh is orca-crew's apart from the plugin name"
  else
    fail "tests/test-fidelity-pins.sh drifted from orca-crew's copy — re-copy it, or land the same edit in both; only the plugin name may differ"
  fi
fi

ORCA_DSH="$ROOT/orca-crew/skills/orchestrate/references/dsh-driver.md"
HERDR_DSH="$ROOT/herdr-crew/skills/orchestrate/references/dsh-driver.md"
for f in "$ORCA_DSH" "$HERDR_DSH"; do
  rel="${f#"$ROOT"/}"
  if [[ ! -f "$f" ]]; then fail "$rel exists"
  elif [[ ! -s "$f" ]]; then fail "$rel is non-empty"
  else pass "$rel exists and is non-empty"; fi
done
if [[ -s "$ORCA_DSH" && -s "$HERDR_DSH" ]]; then
  if cmp -s <(sed 's/orca-crew/herdr-crew/g' "$ORCA_DSH") "$HERDR_DSH"; then
    pass "herdr-crew's dsh-driver.md is orca-crew's apart from the plugin name"
  else
    fail "dsh-driver.md drifted between orca-crew and herdr-crew — land the same edit in both; only the plugin name may differ"
  fi
fi

OSSIFY_LIB="$ROOT/ossify/tests/eval/lib/aggregate-scores.sh"
HERDR_LIB="$ROOT/herdr-crew/tests/eval/lib/aggregate-scores.sh"

for f in "$OSSIFY_LIB" "$HERDR_LIB"; do
  rel="${f#"$ROOT"/}"
  if [[ ! -f "$f" ]]; then fail "$rel exists"
  elif [[ ! -s "$f" ]]; then fail "$rel is non-empty"
  else pass "$rel exists and is non-empty"; fi
done

# The body is everything from the first `set ` line to EOF, in both copies: the
# headers are per-copy by design (herdr-crew's carries the porting note), and
# everything below them is not. The extraction is measured BEFORE it is compared,
# because an absent marker yields an empty body and two empty bodies are
# byte-identical — the pin would read green over a library neither copy has.
o_body="$(awk '/^set /{f=1} f' "$OSSIFY_LIB" | wc -l | tr -d ' ')"
h_body="$(awk '/^set /{f=1} f' "$HERDR_LIB" | wc -l | tr -d ' ')"
if [[ "$o_body" -eq 0 || "$h_body" -eq 0 ]]; then
  fail "both aggregate-scores.sh copies carry a set-line body to compare — an empty body compares equal to another"
elif cmp -s <(awk '/^set /{f=1} f' "$OSSIFY_LIB") <(awk '/^set /{f=1} f' "$HERDR_LIB"); then
  pass "herdr-crew/tests/eval/lib/aggregate-scores.sh is ossify's below its header"
else
  fail "tests/eval/lib/aggregate-scores.sh drifted from ossify's below its header — re-copy it; editing it is how the two stop agreeing"
fi

# The Claude manifest restates the marketplace entry's description. Nothing
# asserted they agree, so a description edit that landed in one and not the other
# shipped two different claims about the same plugin.
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
MANIFEST="$ROOT/herdr-crew/.claude-plugin/plugin.json"
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
  mkt="$(jq -r '.plugins[] | select(.name == "herdr-crew") | .description' "$MARKETPLACE")"
  man="$(jq -r '.description' "$MANIFEST")"
  if [[ -z "$mkt" || -z "$man" ]]; then
    fail "the marketplace entry and the manifest both carry a description — empty on one side, and an empty string equals no other claim"
  elif cmp -s <(jq -r '.plugins[] | select(.name == "herdr-crew") | .description' "$MARKETPLACE") \
              <(jq -r '.description' "$MANIFEST"); then
    pass "the marketplace entry's description matches the plugin manifest's"
  else
    fail "the marketplace entry's description matches the plugin manifest's — the plugin is described two ways"
  fi
fi

# herdr-crew's Codex prompts, and the collision they exist to avoid (#535). The
# `interface.defaultPrompt` array is a user-facing surface — the suggested actions on
# the Codex plugin page, where the string is actually clickable — and it carried
# orca-crew's three generic prompts verbatim while both plugins are installed. The
# whole-branch review then measured that the herdr-specific replacement can be
# reverted with every suite and this file still green, so it was silently revertible
# on the very surface the fix was for. The pin has two halves and they sit together,
# the shape herdr-crew's own suite uses for the `mv` cross-file truth: herdr-crew's
# own text, and the two-tree fact that makes it a fix — no prompt she offers is one
# orca-crew offers, which is exactly the claim a plugin suite cannot see. (This file
# reads the Claude manifest above; the Codex one is read here for the first time.)
# `cmp` over the jq streams rather than `[[ == ]]` on command substitution, for the
# reason the description pin above states: `$( )` strips trailing newlines from both
# sides.
CODEX_HERDR="$ROOT/herdr-crew/.codex-plugin/plugin.json"
CODEX_ORCA="$ROOT/orca-crew/.codex-plugin/plugin.json"
if [[ ! -f "$CODEX_HERDR" || ! -f "$CODEX_ORCA" ]]; then
  fail "both plugins' Codex manifests exist — a missing one makes the prompt counts vacuous"
else
  expected_prompts='Start a herdr orchestrator session for this objective.
Dispatch a herdr worker seat for this task.
Review PR 123 in a fresh herdr seat.'
  if cmp -s <(jq -r '.interface.defaultPrompt[]' "$CODEX_HERDR") <(printf '%s\n' "$expected_prompts"); then
    pass "herdr-crew's Codex prompts are the herdr-specific three"
  else
    fail "herdr-crew's Codex prompts are the herdr-specific three — read: $(jq -r '.interface.defaultPrompt[]' "$CODEX_HERDR" | tr '\n' '|')"
  fi

  # Half two, whole-line matches: a substring test would call a prompt shared whenever
  # one merely CONTAINS another, and a count over an empty read certifies nothing, so
  # the read is asserted non-empty before the comparison is believed.
  shared=0
  checked=0
  while IFS= read -r prompt; do
    [[ -n "$prompt" ]] || continue
    checked=$((checked + 1))
    n="$(jq -r '.interface.defaultPrompt[]' "$CODEX_ORCA" | awk -v p="$prompt" '$0 == p { n++ } END { print n+0 }')"
    shared=$((shared + n))
  done < <(jq -r '.interface.defaultPrompt[]' "$CODEX_HERDR")
  if [[ "$checked" -eq 0 ]]; then
    fail "no prompt herdr-crew offers is one orca-crew offers — read no prompts at all"
  elif [[ "$shared" -eq 0 ]]; then
    pass "no prompt herdr-crew offers is one orca-crew offers (checked $checked)"
  else
    fail "no prompt herdr-crew offers is one orca-crew offers — $shared shared with orca-crew"
  fi
fi

printf '\nPassed: %d  Failed: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
