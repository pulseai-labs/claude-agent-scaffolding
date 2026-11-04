#!/usr/bin/env bash
# tests/test-perf.sh — Performance benchmark for membrane.
# Reference machine: macOS Mac Mini M-series (Praveen's homelab).
# Budget: ≤10s ideal for a ~200-file workload; ≤30s hard fail threshold.

set -u
source "$(dirname "$0")/_helpers.sh"

# Shared CI runners have variable wall-clock, so the 30s hard-fail threshold below —
# calibrated for the homelab reference machine — can flake. Let CI opt out via
# CSA_SKIP_PERF (the benchmark still runs locally / on the homelab). A skip is a
# no-op pass so the run-tests.sh glob still counts this file. (#71)
if [[ -n "${CSA_SKIP_PERF:-}" ]]; then
  printf 'test-perf.sh: skipped (CSA_SKIP_PERF set)\n'
  exit 0
fi

_csa_failed=0

test_perf_200_file_workload_under_10s() {
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/csa-perf.XXXXXX")"
  trap "rm -rf '$tmp'" RETURN

  # Build a fake $HOME with 3 plugins, 50 files each (~150 plugin files).
  mkdir -p "$tmp/home/.claude/plugins/cache"
  local p i
  for p in plug1 plug2 plug3; do
    mkdir -p "$tmp/home/.claude/plugins/cache/$p/1.0.0"
    for i in $(seq 1 50); do
      printf 'benign content line %d\n' "$i" > "$tmp/home/.claude/plugins/cache/$p/1.0.0/file$i.sh"
    done
  done

  # Build project with 50 .claude/ files (~50 project files).
  mkdir -p "$tmp/project/.claude/agents"
  printf '{"enabledPlugins":["plug1","plug2","plug3"],"permissions":{"allow":[],"deny":[]}}\n' \
    > "$tmp/project/.claude/settings.json"
  for i in $(seq 1 50); do
    printf '%s\n' "---
name: agent$i
---
You are agent number $i." > "$tmp/project/.claude/agents/agent$i.md"
  done

  # Measure wall time (macOS: no %N nanoseconds — use seconds with bc fallback).
  local start_s end_s elapsed_ms
  start_s="$(date +%s)"

  HOME="$tmp/home" csa_audit_harness "$tmp/project" >/dev/null 2>&1

  end_s="$(date +%s)"
  elapsed_ms=$(( (end_s - start_s) * 1000 ))

  printf 'perf: %d ms for ~200-file workload\n' "$elapsed_ms"

  if [[ "$elapsed_ms" -gt 30000 ]]; then
    printf 'PERF FAIL: %d ms > 30000 ms hard-fail threshold\n' "$elapsed_ms" >&2
    return 1
  elif [[ "$elapsed_ms" -gt 10000 ]]; then
    printf 'PERF WARNING: %d ms > 10000 ms ideal budget (still under 30000 ms fail threshold)\n' "$elapsed_ms" >&2
    return 0
  fi
  return 0
}

csa_test_run test_perf_200_file_workload_under_10s || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
