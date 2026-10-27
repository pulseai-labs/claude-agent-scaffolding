#!/usr/bin/env bash
# A glue-local rule copy is a regression even when today's emitted bytes agree.
# The probes match each text's distinguishing literal as the glues spelled it; a copy re-added in another
# spelling (other quotes, string concatenation) is not caught. shared-glue.test.ts pins the exported bytes.
set -euo pipefail
command -v python3 >/dev/null 2>&1 || { printf 'molt: python3 not found; tests/shared-glue.test.sh needs it\n' >&2; exit 1; }
root="$(cd "$(dirname "$0")/../.." && pwd)"
python3 - "$root" <<'PY'
import re
import sys
from pathlib import Path
root = Path(sys.argv[1])
templates = (root / 'molt/hooks/templates.ts').read_text()
# Export names and distinguishing literal prefixes: no runtime glue owns these rules.
texts = {
    'SESSION_OFF': 'molt is off for this session. The crew context-ceiling hooks speak again here.',
    'SESSION_ON': 'molt is on for this session.',
    'COMMAND_USAGE': 'usage: /molt now | off | on | status',
    'STATUS_OFF': 'molt: off',
    'STATUS_PAUSED': 'molt: paused',
    'HANDOFF_REQUIRED': "'handoff required'",
    'HANDED_OFF': '`handed-off ',
    'PARENT_HANDOFF': 'molt: handed off to the parent — ',
    'HANDING_OFF': 'molt: handing off at ',
    'RESUMED': 'molt: resumed from ',
    'SEED_REJECTED': 'molt: the seed was rejected. Resume by hand from ',
    'CONFIG_PROBLEMS': '`molt: ${cfg.problems',
    'SETTINGS_PROBLEMS': '`settings: ',
    'SESSION_STATUS': '`molt is ${',
    'FILL_STATUS': 'fill: ',
    'MODE_STATUS': "mode (autonomic's record): ",
    'WARNED': '`warned ',
    'PAUSED_UNATTENDED': ' molts in a row with no message from you. ',
    'PAUSED_NO_PROGRESS': 'molt paused: no progress since the last molt ',
    'MISSING_HANDOFF': 'molt: the MOLT-HANDOFF line names ',
    'STATUS_METER': '`molt ${Math.round',
    'PAST_LEAD': "Context is at {{percent}}% of the window, past molt's handoff threshold",
    'OPERATOR_LEAD': 'and the operator asked for a handoff now',
}
failures = []
for glue in ['molt/omp/core.ts', 'molt/hooks/register.tsx']:
    source = (root / glue).read_text()
    if re.search(r'const\s+MAX_STOP_BLOCKS\b', source):
        failures.append(f'{glue}: local MAX_STOP_BLOCKS')
    if not re.search(r"import\s*\{[^}]*\bMAX_STOP_BLOCKS\b[^}]*\}\s*from\s*['\"][^'\"]*gate['\"]", source):
        failures.append(f'{glue}: missing gate import of MAX_STOP_BLOCKS')
    for name, prefix in texts.items():
        if prefix in source:
            failures.append(f'{glue}: local text {name}')
        if not re.search(r"import\s*\{[^}]*\b" + name + r"\b[^}]*\}\s*from\s*['\"][^'\"]*templates['\"]", source):
            failures.append(f'{glue}: missing templates import of {name}')
for name in texts:
    if not re.search(r'export const ' + name + r'\b', templates):
        failures.append(f'templates.ts: missing export {name}')
if failures:
    print('\n'.join('FAIL: ' + failure for failure in failures))
    sys.exit(1)
print('PASS: both glues import the Stop cap and all 23 shared texts from the pure modules')
PY
