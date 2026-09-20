#!/usr/bin/env bash
# Per-work-item verification (spec §6). Deterministic mechanical facts only:
# did a command exit as declared, did the report account for every AC, did a
# recognized runner execute zero tests. Judgment - is this deviation acceptable,
# does this change violate a code pattern - stays in skill prose (D2).

# Extract `auto:` AC rows. `user:` rows belong to the close ceremony, not here.
# Backticks are stripped: an unstripped command reaches the caller as a command
# substitution and executes something other than what the spec declares.
oss_verify_parse_acs() { # $1=spec-file ; TSV label \t command \t expectation
  [ -f "$1" ] || { echo "oss: spec not found: $1" >&2; return 2; }
  { grep -E '^[[:space:]]*-[[:space:]]*\[[ xX]\][[:space:]]*AC-[0-9]+[[:space:]]+auto:' "$1" || true; } \
  | while IFS= read -r line; do
      local label cmd exp rest
      # Anchor the label extraction on the CHECKBOX, not on a case class. An
      # earlier form used `^[^A-Z]*(AC-[0-9]+)`, which silently breaks on the
      # `- [X]` checkbox this function's own grep accepts: [^A-Z]* halts at the
      # uppercase X, the anchored match fails, and sed passes the WHOLE LINE
      # through as the label - which report_cross_check then hunts for in the
      # report and never finds, failing a correct report.
      label="$(printf '%s' "$line" | sed -E 's/^.*\[[ xX]\][[:space:]]*(AC-[0-9]+).*/\1/')"
      rest="${line#*auto:}"
      cmd="$(printf '%s' "$rest" | sed -E 's/^[^`]*`([^`]*)`.*/\1/')"
      # If the sed did not match (no backtick pair in $rest), it passes $rest
      # through unchanged as cmd. That makes the whole tail of the line —
      # including `→ expected: exit 0` — the command, which the RED gate runs
      # as garbage and reads as RED = proceed. Detect the no-match instead:
      # when $rest contains no backtick, the AC is malformed — skip the row so
      # it produces zero output, which Gate 2's "visibly has AC lines but this
      # prints nothing" detector catches. (Codex P2 finding #4.)
      case "$rest" in *\`*) ;; *)
        echo "oss: AC line '$label' has no backticked command — skipping (malformed AC)" >&2; continue ;; esac
      exp="$(printf '%s' "$rest" | sed -E 's/.*→[[:space:]]*expected:[[:space:]]*//')"
      exp="${exp#"${exp%%[![:space:]]*}"}"; exp="${exp%"${exp##*[![:space:]]}"}"
      [ -n "$cmd" ] && printf '%s\t%s\t%s\n' "$label" "$cmd" "$exp"
    done
}

# Run one AC in $1 and check it. EVERY arm fails closed: an unrecognized or
# malformed expectation is rc 2, never a pass. This is the ledger.sh lesson -
# a `case` with no default arm counted an unknown expectation as green.
oss_verify_auto_step() { # $1=workdir $2=command $3=expectation ; 0 pass, 1 fail, 2 malformed
  local dir="$1" cmd="$2" exp="$3" out rc want
  case "$exp" in
    exit\ *)
      want="${exp#exit }"
      case "$want" in ''|*[!0-9]*)
        echo "oss: malformed expectation '$exp' ('exit' takes digits only)" >&2; return 2;; esac ;;
    output\ contains\ ?*) ;;
    *) echo "oss: unrecognized expectation '$exp' (grammar: 'exit <n>' | 'output contains <str>')" >&2; return 2 ;;
  esac
  # errexit guard, and it is on the NORMAL path — this function exists to run
  # commands that are EXPECTED to exit nonzero (a failing AC is the ordinary
  # case). Unguarded, `out="$(…)"` under bin/oss's `set -euo pipefail` aborts
  # the dispatcher before this function can return its documented rc, so a
  # failing AC produces no diagnostic at all. Verified by repro. The `if`
  # form is used rather than demo.sh's `set +e; …; set -e` toggle, which the
  # A→B handoff's gotcha list explicitly warns against as fragile.
  if out="$(cd "$dir" && bash -c "$cmd" 2>&1)"; then rc=0; else rc=$?; fi
  case "$exp" in
    exit\ *)
      # A silent `[ "$rc" -eq "$want" ] || { …; return 1; }` with no message
      # dumps only the (often-empty) captured output — a failing `false`
      # against `exit 0` produces no diagnostic at all, which reads as a
      # silent dispatcher death rather than a reported failure. Name the
      # actual vs. wanted rc explicitly, matching demo.sh's sibling arm.
      if [ "$rc" -ne "$want" ]; then
        echo "oss: rc=$rc, wanted $want" >&2
        printf '%s\n' "$out" | tail -5
        return 1
      fi ;;
    output\ contains\ ?*)
      # `if ! grep -Fq … <<<"$out"` — NOT `pipeline | { … return 1; }`. See the
      # idiom note below: a `return` inside the brace group would exit only the
      # subshell, and this function would fall through to `return 0`, passing a
      # demo line whose output does not contain the expected string. The
      # herestring also removes the second hazard: `printf … | grep -q` under
      # the dispatcher's pipefail lets grep exit on the first match while the
      # producer still has bytes to write, the producer takes SIGPIPE, and the
      # pipeline reports 141 — a TRUE match read as no match past ~64 KiB.
      if ! grep -Fq -- "${exp#output contains }" <<<"$out"; then
        echo "oss: output missing '${exp#output contains }'" >&2
        printf '%s\n' "$out" | tail -5
        return 1
      fi ;;
  esac
  # Vacuous green: only meaningful for a success expectation. Scoping matters -
  # a line legitimately expecting `exit 1` from a recognized runner is not
  # vacuous, and the unscoped form in demo.sh fails exactly that case.
  if [ "$exp" = "exit 0" ] && printf '%s' "$out" | oss_verify_zero_tests_guard "$cmd"; then
    echo "vacuous green: '$cmd' is a recognized test runner and executed zero tests" >&2
    return 1
  fi
  return 0
}

# rc 0 = vacuous. BOTH conditions required: the command must name a recognized
# runner AND the output must show a zero-tests result. Dropping the runner check
# would fail a legitimate demo line that merely prints a zero-tests phrase.
#
# IDIOM WARNING, and it is load-bearing here. `lib/id.sh:4-6` and the old
# `demo.sh:5,8` write this as `printf … | { grep -Eq … || return 1; }`, which is
# SAFE there only because the pipeline is the function's LAST command, so the
# function's exit status IS the pipeline's. It is NOT safe here: this function
# has two checks and a trailing `return 0`. The brace group is the last element
# of a pipeline and therefore runs in a SUBSHELL, so `return 1` exits the
# subshell, execution falls through, and the function returns 0 — reporting
# EVERY input as vacuous green and failing every `exit:0` demo line. Verified
# empirically. Use `grep … <<<"$x" || return 1` (the `||` binds outside any
# subshell). The herestring is load-bearing too: `printf … | grep -q` under
# the dispatcher's pipefail lets grep exit on the first match while the
# producer still has bytes to write, the producer takes SIGPIPE, and the
# pipeline reports 141 — a TRUE match read as no match past ~64 KiB.
oss_verify_zero_tests_guard() { # $1=command ; output on STDIN
  local out; out="$(cat)"
  grep -Eq 'pytest|cargo test|cargo nextest|npm test|npm run test|go test|jest|vitest|bash .*test|ctest|dotnet test' <<<"$1" || return 1
  grep -Eq 'collected 0 items|running 0 tests|0 passing|no tests to run|0 tests? ran|No tests? (files )?found|testing: warning: no tests to run|Tests +0 passed' <<<"$out" || return 1
  # A zero-marker means vacuous only when the output carries NO marker of real
  # execution - aggregate multi-suite output mixes both: cargo's empty
  # Doc-tests target prints `running 0 tests` beside real passes, a
  # `go test ./...` filter miss prints `no tests to run` beside `--- PASS:`,
  # one empty pytest package prints `collected 0 items` beside another's run.
  # The marker list is deliberately execution-shaped: `running [1-9]` and
  # `collected [1-9]` announce intent/collection rather than a result, and a
  # bare `ok` is ambiguous under go (a filter-missed package prints it too).
  # File counts are not test counts - vitest/jest print `Test Files  1 passed`
  # beside `Tests  0 passed` - so those summary lines are carved out of the
  # positive scan or the zero-marker can never fire on that shape.
  local scan; scan="$(grep -v -e 'Test Files' -e 'Test Suites' <<<"$out" || true)"
  grep -Eq -e '--- (PASS|FAIL):|[1-9][0-9]* (passed|passing|failed)' <<<"$scan" && return 1
  return 0
}

# rc 0 RED (proceed) | rc 1 already-GREEN (the ONLY hard block) | rc 2 errored
# (ADVISORY - usually the test file is not authored yet, which is the expected
# starting state, so blocking on it would make the gate unusable).
oss_verify_redgate() { # $1=workdir $2=command $3=expectation
  local dir="$1" cmd="$2" exp="$3" rc
  # Same errexit guard, same reason — a RED gate probe expects failure, so the
  # nonzero exit IS the success case and must not kill the dispatcher.
  if ( cd "$dir" && bash -c "$cmd" ) >/dev/null 2>&1; then rc=0; else rc=$?; fi
  case "$rc" in 126|127) echo "red-gate: '$cmd' is not invocable here (rc $rc) - advisory, not a block" >&2; return 2 ;; esac
  # auto_step's rc is THREE-valued and this gate must not flatten it: 0 = the
  # expectation is already satisfied, 1 = legitimately not satisfied (a real
  # RED), 2 = the expectation could not be PARSED. Folding 2 in with 1 answers
  # rc 0 = "proceed" for an AC whose command can never pass, and the worker
  # then runs the whole TDD loop against it - the failure only surfacing two
  # ceremonies later at the close gate, where the recovery menu points at code
  # that was never the problem. `step=0; … || step=$?` rather than `…; step=$?`
  # because bin/oss runs `set -euo pipefail`, under which the bare form aborts
  # the dispatcher before this function can return anything at all.
  local step=0
  oss_verify_auto_step "$dir" "$cmd" "$exp" >/dev/null 2>&1 || step=$?
  if [ "$step" -eq 2 ]; then
    echo "red-gate: malformed expectation '$exp' - not a RED (grammar: 'exit <n>' | 'output contains <str>')" >&2
    return 2
  fi
  if [ "$step" -eq 0 ]; then
    echo "red-gate: '$cmd' ALREADY satisfies '$exp' before any implementation" >&2
    return 1
  fi
  return 0
}

# Every `auto:` AC in the spec must be accounted for in the report. Names the
# missing ones - "the report is incomplete" is not actionable.
oss_verify_report_cross_check() { # $1=report-file $2=spec-file
  [ -f "$1" ] || { echo "oss: report not found: $1" >&2; return 2; }
  # The rows below arrive through a process substitution, whose rc is NOT
  # visible to this function. So an unreadable spec produced zero rows, the
  # accumulator kept its clean initial value, and the gate returned 0 = CLEAN
  # over a spec it never read. Parse once, up front, where the rc is checkable.
  local rows rc=0
  rows="$(oss_verify_parse_acs "$2")" || rc=$?
  [ "$rc" -eq 0 ] || { echo "oss: cannot read the spec '$2' - the cross-check would otherwise pass by reading nothing" >&2; return 2; }
  # A readable spec with no `auto:` rows is only VACUOUSLY clean. Say so: the
  # usual cause is a mis-derived path (the handoff, or last round's spec) or AC
  # grammar drift, and silence there is indistinguishable from a real pass.
  [ -n "$rows" ] || { echo "oss: the spec '$2' yields zero auto: ACs - nothing to cross-check; verify the spec path and the AC grammar" >&2; return 2; }
  local missing="" label
  while IFS="$(printf '\t')" read -r label _ _; do
    [ -n "$label" ] || continue
    # grep the file DIRECTLY. An earlier form piped the report into a `{ … }`
    # group - in bash the last element of a pipeline runs in a SUBSHELL, so
    # `missing` was mutated in a child and every accumulated label was lost:
    # the check reported "all ACs accounted for" no matter what the report said.
    # (Verified empirically: under bash the piped form yields missing=[]; under
    # zsh it yields the right answer, because zsh runs the last pipeline element
    # in the parent - which is exactly why run-all.sh forces `bash`.)
    # The trailing `|| assignment` is an OR-list and therefore errexit-exempt.
    grep -Eq "(^|[^A-Za-z0-9-])${label}([^0-9]|$)" "$1" || missing="$missing $label"
  done <<EOF
$rows
EOF
  [ -z "$missing" ] || { echo "oss: report does not account for:$missing" >&2; return 1; }
  return 0
}
