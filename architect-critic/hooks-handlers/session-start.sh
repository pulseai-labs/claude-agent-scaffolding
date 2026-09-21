#!/usr/bin/env bash
# session-start.sh — fail-open ambient status for architect-critic.
# Output: ~50 tokens, 1–2 lines. NEVER fails (always exit 0).
#
# v0.1.3 cleared stale in_flight markers. v0.2 dropped the in_flight field (no
# async). v0.3 (#39) re-introduces a DURABLE async job record (external_runs[]) —
# these are real background audits the user dispatched, not stale per-request
# markers — so the hook surfaces a read-only in-flight count.

set +e

PRINCIPLES_PATH="${HOME}/.claude/architect-critic/principles.md"
if [[ -f "$PRINCIPLES_PATH" ]]; then
  echo "architect-critic installed; principles loaded from ${PRINCIPLES_PATH}"
else
  echo "architect-critic installed; principles loaded from (shipped defaults only)"
fi

# In-flight async audits (read-only count; never fail the hook).
ARC_BIN="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)}/bin/arc"
if [[ -x "$ARC_BIN" ]] && command -v jq >/dev/null 2>&1; then
  RUNNING="$(bash "$ARC_BIN" state_external_run_list --status running 2>/dev/null | jq 'length' 2>/dev/null || echo 0)"
  if [[ "${RUNNING:-0}" =~ ^[0-9]+$ ]] && [[ "${RUNNING:-0}" -gt 0 ]]; then
    echo "architect-critic: ${RUNNING} background audit(s) in flight — /critique-jobs to inspect/resume"
  fi
fi

exit 0
