#!/usr/bin/env bash
#
# crew — the layer boundary, mechanical facts only.
#
# The anti-goal this file exists for (spec §2, §4.1): a herdr command left in a shared file,
# where the next layer would inherit it as an instruction. So the sweep is the point, and it
# prints EVERY hit — a truncated list reads as a shorter job than the one actually left.
#
# Two facts:
#   1. no shared `.md` under skills/orchestrate/ names a layer's commands (`herdr <word>`,
#      `HERDR_`, `orca <word>`) — `references/layers/*` is where those live, and is exempt;
#   2. `references/layers/herdr.md` carries the thirteen step headings, in order.
#
# The exemptions are a LIST with a label each, so a task that is done shrinks it rather than
# leaving a hole nobody can see:
#
#   PERMANENT  SKILL.md's frontmatter `description:` line — the trigger words an operator
#              actually types ("the herdr orchestrator session"). Not a command, and the
#              operator's own words are not something a task removes.
#   T4         the brief envelope: `PING: `, `MOLT: `, and the `NOTIFY_RUN=` clause inside the
#              `REPORT_PATH=…` lines. Task 4 names the layer's Send there.
#   T5         the orchestrator's identity reads: `HERDR_PANE_ID`, `HERDR_WORKSPACE_ID`,
#              `herdr pane get`. Task 5 moves them behind the layer's Identity.
#
# Tasks 4 and 5 shrink their entries to nothing; the PERMANENT one stays.
#
# Usage:   bash crew/tests/test-layer-boundary.sh
# Exit:    0 if every mechanical fact holds; 1 otherwise.
# Deps:    bash 3.2+, find, awk.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="$PLUGIN_ROOT/skills/orchestrate"
LAYER_MD="$REF/references/layers/herdr.md"

# The thirteen steps, in the order every layer file carries them.
STEPS='Health
Identity
Run workspace
Seat worktree
Seat launch
Readiness
Send
Read
Wait
Completion signal
Teardown
Machines
Host: OMP'

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

# ── the sweep ───────────────────────────────────────────────────────────────
#
# Case patterns rather than `grep -q` in a pipeline: `grep -q` exits at the first match and
# the producer takes SIGPIPE if it writes again, which fails intermittently on a true match.
# The sweep takes its root so the controls below can run it over a fixture tree.
sweep_findings() { # <skills/orchestrate dir>
  local dir="$1" f n line
  find "$dir" -name '*.md' | sort | while IFS= read -r f; do
    case "$f" in */references/layers/*) continue ;; esac
    n=0
    while IFS= read -r line; do
      n=$((n + 1))
      case "$line" in
        *"herdr "[a-z]*|*"HERDR_"*|*"orca "[a-z]*) ;;
        *) continue ;;
      esac
      # PERMANENT — the frontmatter triggers of SKILL.md, and that line only.
      case "${f##*/}:$line" in
        SKILL.md:description:*) continue ;;
      esac
      # T4 — the brief envelope.
      case "$line" in
        "PING: "*|"MOLT: "*|*"NOTIFY_RUN="*) continue ;;
      esac
      # T5 — the orchestrator's identity reads.
      case "$line" in
        *"HERDR_PANE_ID"*|*"HERDR_WORKSPACE_ID"*|*"herdr pane get"*) continue ;;
      esac
      printf '%s:%s:%s\n' "$f" "$n" "$line"
    done < "$f"
  done
}

printf '%screw layer boundary%s\n\n' "$DIM" "$RST"

section "no shared file names a layer's commands"
findings="$(sweep_findings "$REF")"
if [ -z "$findings" ]; then
  pass "no herdr command or HERDR_ name in a shared file"
else
  fail "no herdr command or HERDR_ name in a shared file ($(printf '%s\n' "$findings" | wc -l | tr -d ' ') line(s)):"
  printf '%s\n' "$findings" | sed 's/^/        /'
fi

# Controls: the sweep reads a tree, so plant a tree. The clean fixture is the adjacent
# control — a sweep that reported something for everything would pass the planted one alone.
ctl="$(mktemp -d)"
mkdir -p "$ctl/references"
printf '# Roles\n\nThe seat launch is the layer step, named, never typed here.\n' > "$ctl/references/roles.md"
out="$(sweep_findings "$ctl")"
if [ -z "$out" ]; then
  pass "control: the sweep passes a shared file with no layer command"
else
  fail "control: the sweep passes a shared file with no layer command" "$out"
fi
printf 'herdr pane run x\n' >> "$ctl/references/roles.md"
out="$(sweep_findings "$ctl")"
if [ "$(printf '%s\n' "$out" | grep -c .)" -eq 1 ] && printf '%s' "$out" | grep -F 'herdr pane run x' >/dev/null; then
  pass "control: one planted layer command is caught, by name and line"
else
  fail "control: one planted layer command is caught, by name and line" "got: ${out:-<none>}"
fi
# The layer files themselves are exempt: the same line there is not a finding.
mkdir -p "$ctl/references/layers"
mv "$ctl/references/roles.md" "$ctl/references/layers/herdr.md"
out="$(sweep_findings "$ctl")"
if [ -z "$out" ]; then
  pass "control: the same line inside references/layers/ is exempt"
else
  fail "control: the same line inside references/layers/ is exempt" "$out"
fi
rm -rf "$ctl"
if [ ! -e "$ctl" ]; then
  pass "control: the sweep controls leave no fixture behind"
else
  fail "control: the sweep controls leave no fixture behind" "$ctl survived its cleanup"
fi

section "the layer file carries the thirteen steps, in order"
if [ ! -f "$LAYER_MD" ]; then
  fail "$LAYER_MD exists" "no such file — the thirteen headings cannot be read from a file that is not there"
else
  got="$(sed -n 's/^## //p' "$LAYER_MD")"
  n_got="$(printf '%s\n' "$got" | grep -c .)"
  if [ "$n_got" -eq 0 ]; then
    fail "herdr.md has headings to compare" "the read returned nothing, and two empty lists compare equal"
  elif cmp -s <(printf '%s\n' "$got") <(printf '%s\n' "$STEPS"); then
    pass "herdr.md carries the thirteen step headings, in order ($n_got)"
  else
    fail "herdr.md carries the thirteen step headings, in order" "got: $(printf '%s' "$got" | tr '\n' '|')"
  fi
fi

report
