#!/usr/bin/env bash
#
# herdr-crew — every launch-verb site in the shipped prose carries a seat-mods
# marking clause (#663).
#
# WHAT THIS GUARDS. The seat-mods marking (a guarded role + `SEAT_MODS_ALLOW`, or
# `coordinator`, or `orchestrator`) is stated in prose at every launch site, by
# reference to `herdr-mechanics.md` step 2. Pinned suites catch a site that LOSES its
# clause; nothing caught a NEW launch site added without one. This suite selects the
# launch sites by the rule below and fails when a selected site's own region carries
# no marking clause — the #651 recurrence shape.
#
# THE SITE RULE (A2). A *region* is a markdown list item (its marker line through its
# deeper-indented continuation lines) when the text sits in one, else a
# blank-line-delimited paragraph. YAML frontmatter (a region starting at line 1 with
# `---`) and heading lines are skipped. A region is a launch site when its
# whitespace-squeezed text matches any of:
#
#   1. `herdr tab create`
#   2. `herdr worktree create` with `--path` in the same region (the flag that names
#      the seat's new tree; a bare mention that defers its flags elsewhere is not one)
#   3. `herdr workspace create` with no `run:` in the region (the run's own workspace
#      is not a seat launch)
#   4. `launch(ed|es|ing)? [**] {a|an|the|its|each|every|from|as|it|to|at} <0-40 chars,
#      sentence- and paren-bounded> seat(s)` — "launched from the project file's
#      close-session seat", "Launch it as the seat launch", "launches each writer as a
#      guarded seat", the `SEATS row(s)` spellings included
#   5. `launch(ed|es|ing)? from {those|them|these}`
#   6. `{launch(es|ed)?|dispatch(es|ed)?|create[sd]?|respawn(s|ed)?} [det] [**]
#      {fresh|new} <0-20 chars, sentence- and paren-bounded> {seat(s)|pair|
#      implementer|verifier|reviewer|writer|spine session|work-PR session}`
#   7. `{fresh|new} <0-20> {seat(s)|pair} <0-20> {you create|you dispatch|you launch|
#      you spawn|to resume}`
#   8. `respawn`
#
# A site carries a marking clause when its own region contains any of:
# `SEAT_MODS_ROLE=`, `guarded`, `coordinator`, `orchestrator`, `step 2`, `Seat marking`.
#
# COVERED: the three placement commands; "launch(ed) from the … seat"; "launch
# a/the/its … [fresh|new] seat|pair|…" including bold spans and the
# create/dispatch/respawn verb forms; "launched from the … SEATS row(s)"; "every
# respawn … is launched from the same row"; "a fresh seat you create"; "a fresh seat
# to resume"; bare `respawn`.
#
# NOT COVERED — a new site in one of these shapes still passes, and that residual is
# accepted (naming it is the point): the bare noun "the seat launch" (it collides with
# SKILL.md §1's router sentence, which is a pointer and needs no clause); "launched at
# its point or on demand" (operator roles); a marking directive with no launch verb
# ("Mark it `coordinator` before its command", "is a guarded `implementer`"); router and
# depth descriptions ("drives a fresh tab and pane per item seat", "launches item
# sessions of its own", "launched by seat name", "start one spine session"); a launch
# written only inside a `kind: dsh-spine-driver` session (not a pane — it is never
# marked); headings and frontmatter.
#
# CLAUSE-SIDE LOOSENING, stated: any bare mention of the clause tokens in the region
# satisfies the check (e.g. a site beside the words "the coordinator seats" passes
# without stating the marking), and `step 2` is also lifecycle's own step 2 — a site
# next to such a mention passes. That direction is deliberate: it keeps today's correct
# sites green, and the pins in the sibling suites hold the clause texts themselves.
#
# CONTROLS, beside the assertions they protect:
#   - B2 (red/green): a fixture copy of the shipped tree with ONE added unmarked
#     launch site must fail, naming file, line and the site text; the same site with a
#     clause must pass. The fixture lives under mktemp, never in a shipped file.
#   - B4 (floor): the number of sites selected is printed and pinned at today's count;
#     a grammar change that silently selects fewer sites fails. Its adjacent control is
#     a fixture the same predicate must refuse: a tree below the floor is not accepted.
#
# Usage: bash herdr-crew/tests/test-launch-site-marking.sh
# Env:   HERDR_CREW_PROSE_ROOT=<dir>  scan that tree instead of the plugin's — the
#        red/green runs above use it; the suite's own controls always build their own
#        fixtures.
# Deps:  bash 3.2+, awk (POSIX ERE), mktemp.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCAN_ROOT="${HERDR_CREW_PROSE_ROOT:-$PLUGIN_ROOT}"

# 24 — measured on the tree this suite ships with (2026-10-09, #663): the count the
# A2 rule selects after roles.md's activated-spine rows and ossify-briefs.md's item
# verifier intro gained their citing clauses. A grammar change that selects fewer must
# fail the floor below; adding sites raises this constant deliberately.
SITE_FLOOR=24

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

# ── the check ────────────────────────────────────────────────────────────────
#
# Reads every .md under <root>/skills/** and <root>/commands/** — herdr-crew's shipped
# prose — and prints, one per line:
#   FAIL <file>:<line> :: <site text>   for each selected site with no clause
#   SITES <n>                           the number of sites selected, always last
# The caller asserts on the stream; a missing `SITES` line is a failed scan, never a
# clean one. `line` is the first line of the region that itself carries a launch token,
# so the pointer lands on the sentence, not the paragraph's first line; the printed
# site text is the whole joined region, capped at 400 characters.
scan_launch_sites() { # <root>
  _root="${1:-}"
  if [ ! -d "$_root/skills" ] || [ ! -d "$_root/commands" ]; then
    printf 'SCAN-ERROR: %s needs skills/ and commands/ directories\n' "$_root"
    return 0
  fi
  _files="$(find "$_root/skills" "$_root/commands" -name '*.md' | sort)"
  if [ -z "$_files" ]; then
    printf 'SCAN-ERROR: no .md files under %s/skills or %s/commands\n' "$_root" "$_root"
    return 0
  fi
  printf '%s\n' "$_files" | while IFS= read -r _f; do
    awk -v file="$_f" '
      function indent(s,   n) { n = 0; while (substr(s, n+1, 1) == " ") n++; return n }
      function is_marker(s,   t) {
        t = s; sub(/^ +/, "", t)
        return (t ~ /^[-*+] / || t ~ /^[0-9]+[.)] /)
      }
      function is_heading(s,   t) { t = s; sub(/^ +/, "", t); return t ~ /^#+ / }
      # the A2 site predicate, on the region text (whitespace already squeezed)
      function is_site(region) {
        if (region ~ /herdr tab create/) return 1
        if (region ~ /herdr worktree create/ && region ~ /--path/) return 1
        if (region ~ /herdr workspace create/ && region !~ /run:/) return 1
        if (region ~ /[Ll]aunch(ed|es|ing)?[[:space:]]+[*]{0,2}(a|an|the|its|each|every|from|as|it|to|at)[[:space:]][^.;()]{0,40}[Ss][Ee][Aa][Tt][Ss]?([^A-Za-z]|$)/) return 1
        if (region ~ /[Ll]aunch(ed|es|ing)? from (those|them|these)([^A-Za-z]|$)/) return 1
        if (region ~ /(launch(es|ed)?|dispatch(es|ed)?|create[sd]?|respawn(s|ed)?)[[:space:]]+((a|an|the|its|their|another)[[:space:]]+|(that|the) item.s[[:space:]]+)?[*]{0,2}(fresh|new)([^A-Za-z]|$)[^.;()]{0,20}([Ss][Ee][Aa][Tt][Ss]?([^A-Za-z]|$)|pair([^A-Za-z]|$)|implementer|verifier|reviewer|writer|spine session|work-PR session)/) return 1
        if (region ~ /(fresh|new)[^.;()]{0,20}([Ss][Ee][Aa][Tt][Ss]?([^A-Za-z]|$)|pair([^A-Za-z]|$))[^.;()]{0,20}(you (create|dispatch|launch|spawn)|to resume)/) return 1
        if (region ~ /respawn/) return 1
        return 0
      }
      # the clause forms; the FIRST that matches names the kind in the failure line
      function clause_kind(region) {
        if (region ~ /SEAT_MODS_ROLE=/) return "SEAT_MODS_ROLE"
        if (region ~ /guarded/) return "guarded"
        if (region ~ /coordinator/) return "coordinator"
        if (region ~ /orchestrator/) return "orchestrator"
        if (region ~ /step 2/) return "step 2"
        if (region ~ /Seat marking/) return "Seat marking"
        return ""
      }
      function emit(a, b,   k, region, line, text, cl) {
        region = ""
        for (k = a; k <= b; k++) region = region " " L[k]
        gsub(/[[:space:]]+/, " ", region)
        sub(/^ /, "", region)
        if (is_heading(L[a])) return
        if (a == 1 && L[1] == "---") return
        if (!is_site(region)) return
        sites++
        cl = clause_kind(region)
        if (cl != "") return
        line = a
        for (k = a; k <= b; k++) {
          if (L[k] ~ /[Ll]aunch/ || L[k] ~ /respawn/ || L[k] ~ /herdr (tab|worktree|workspace) create/) { line = k; break }
        }
        text = region
        if (length(text) > 400) text = substr(text, 1, 400) " …"
        printf "FAIL %s:%d :: %s\n", file, line, text
      }
      { L[NR] = $0 }
      END {
        n = NR
        i = 1
        while (i <= n) {
          if (L[i] ~ /^[[:space:]]*$/) { i++ }
          else if (is_marker(L[i])) {
            ind = indent(L[i]); j = i + 1; last = i
            while (j <= n) {
              if (L[j] ~ /^[[:space:]]*$/) { j++ }
              else if (indent(L[j]) <= ind) { break }
              else { last = j; j++ }
            }
            emit(i, last); i = last + 1
          } else {
            j = i
            while (j <= n && L[j] !~ /^[[:space:]]*$/ && !is_marker(L[j])) j++
            emit(i, j - 1); i = j
          }
        }
        printf "SITES %d\n", sites
      }
    ' "$_f"
  done
}

# The floor, as one predicate the real tree and its control both go through.
sites_meet_floor() { # <n>
  [ "${1:-0}" -ge "$SITE_FLOOR" ] 2>/dev/null
}

# The count from a scan stream: one `SITES <n>` line per scanned file, summed. Empty
# (`0`) is a failed scan unless a SITES line was printed at all — the caller asserts
# that separately, so a scan that never finished cannot read as a clean zero.
sites_count() { # <scan output>
  printf '%s\n' "$1" | awk '$1 == "SITES" { n += $2 } END { print n+0 }'
}

sites_lines() { # <scan output>
  printf '%s\n' "$1" | awk '$1 == "SITES" { c++ } END { print c+0 }'
}

scan_fails() { # <scan output>
  printf '%s\n' "$1" | awk '$1 == "FAIL"'
}

printf '%slaunch-site marking (#663)%s\n\n' "$DIM" "$RST"

section "the rule scans the shipped prose"

scan="$(scan_launch_sites "$SCAN_ROOT")"
case "$scan" in
  SCAN-ERROR*)
    fail "the scan ran over $SCAN_ROOT" "$scan"
    report; exit $?
    ;;
esac

if [ "$(sites_lines "$scan")" -eq 0 ]; then
  fail "the scan reports the number of sites it selected" \
    "no SITES line — a scan that did not finish must not read as a clean one: $scan"
  report; exit $?
fi
sites="$(sites_count "$scan")"

fails="$(scan_fails "$scan")"
if [ -z "$fails" ]; then
  pass "every selected site carries a marking clause ($sites sites in $SCAN_ROOT)"
else
  n_fail="$(printf '%s\n' "$fails" | awk 'END { print NR }')"
  fail "every selected site carries a marking clause" \
    "$n_fail site(s) with no clause in their own paragraph or list item:"
  printf '%s\n' "$fails" | while IFS= read -r l; do
    printf '      %s%s%s\n' "$DIM" "$l" "$RST"
  done
fi

if sites_meet_floor "$sites"; then
  pass "the scan selects at least $SITE_FLOOR sites (selected $sites)"
else
  fail "the scan selects at least $SITE_FLOOR sites" \
    "selected $sites — the grammar stopped selecting sites it used to; the floor is today's count, not slack"
fi

section "controls beside the assertions"

# B2, red: a fixture copy with ONE added unmarked site must fail, naming file, line and
# the site text. The fixture is a temp copy; no shipped file is ever edited to stage it.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -R "$PLUGIN_ROOT/skills" "$tmp/skills"
cp -R "$PLUGIN_ROOT/commands" "$tmp/commands"
planted="When the operator asks for a second opinion, launch a fresh reviewer seat from the project file's reviewer seat."
printf '\n%s\n' "$planted" >> "$tmp/skills/orchestrate/references/roles.md"

red="$(scan_launch_sites "$tmp")"
red_fails="$(scan_fails "$red")"
red_n="$(printf '%s\n' "$red_fails" | awk 'END { print NR }')"
red_sites="$(sites_count "$red")"
if [ "$red_n" -eq 1 ] \
   && printf '%s\n' "$red_fails" | awk -v f="$tmp/skills/orchestrate/references/roles.md" -v t="$planted" \
        '$1 == "FAIL" && index($2, f ":") == 1 && index($0, t) > 0 { hit = 1 } END { exit(hit ? 0 : 1) }'; then
  pass "control: an added unmarked launch site fails, named with file, line and text ($red_sites sites, 1 failure)"
else
  fail "control: an added unmarked launch site fails, named with file, line and text" \
    "expected exactly one failure naming $(basename "$tmp")/skills/orchestrate/references/roles.md and the planted text; got: $red"
fi

# B2, green: the same site with a clause passes, so the check fails on the missing
# clause and not on the paragraph's shape.
printf 'Mark it a guarded `reviewer` before its command (`herdr-mechanics.md` step 2).\n' \
  >> "$tmp/skills/orchestrate/references/roles.md"
green="$(scan_launch_sites "$tmp")"
green_fails="$(scan_fails "$green")"
green_sites="$(sites_count "$green")"
if [ -z "$green_fails" ] && [ "$green_sites" -eq "$red_sites" ]; then
  pass "control: the same site with a clause passes ($green_sites sites, 0 failures)"
else
  fail "control: the same site with a clause passes" \
    "expected 0 failures over $red_sites sites; got: $green"
fi

# B4's adjacent control: the floor predicate must refuse a tree that selects fewer
# sites — a floor that cannot fail holds nothing.
tmp2="$(mktemp -d)"
mkdir -p "$tmp2/tree/skills/orchestrate/references" "$tmp2/tree/commands"
cp "$PLUGIN_ROOT/skills/orchestrate/references/roles.md" "$tmp2/tree/skills/orchestrate/references/roles.md"
small="$(scan_launch_sites "$tmp2/tree")"
small_n="$(sites_count "$small")"
if [ "$small_n" -gt 0 ] && [ "$small_n" -lt "$SITE_FLOOR" ] && ! sites_meet_floor "$small_n"; then
  pass "control: a tree below the floor is refused (selected $small_n, floor $SITE_FLOOR)"
else
  fail "control: a tree below the floor is refused" \
    "the floor predicate accepted $small_n sites at SITE_FLOOR=$SITE_FLOOR; lower SITE_FLOOR to the tree it is meant to hold"
fi
rm -rf "$tmp2"

# #514, L1: the shape, asserted rather than assumed — a counter re-copied into any
# suite shadows the hoisted one and keeps passing.
section "the hoisted counters are not re-copied"
assert_hoisted_counters

report
