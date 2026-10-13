import { describe, test, expect } from 'claude-code/testing'
import * as templates from '../hooks/templates'
import * as gate from '../hooks/gate'

// Catch a rule copied back into either runtime glue, and pin the emitted bytes.
const texts: Record<string, string> = {
  "SESSION_OFF": "molt is off for this session. The crew context-ceiling hooks speak again here.",
  "SESSION_ON": "molt is on for this session.",
  "COMMAND_USAGE": "usage: /molt now | off | on | status",
  "STATUS_OFF": "molt: off",
  "STATUS_PAUSED": "molt: paused",
  "HANDOFF_REQUIRED": "handoff required",
  "HANDED_OFF": "handed-off {{path}}",
  "PARENT_HANDOFF": "molt: handed off to the parent — {{path}}",
  "HANDING_OFF": "molt: handing off at {{percent}}% — {{path}}",
  "RESUMED": "molt: resumed from {{path}}",
  "SEED_REJECTED": "molt: the seed was rejected. Resume by hand from {{path}}.",
  "CONFIG_PROBLEMS": "molt: {{problems}}",
  "SETTINGS_PROBLEMS": "settings: {{problems}}",
  "SESSION_STATUS": "molt is {{state}} for this session.",
  "FILL_STATUS": "fill: {{percent}} — warnings {{warn}}% and {{warnAgain}}%, handoff {{command}}%, block {{block}}%, fallback {{fallback}}%",
  "MODE_STATUS": "mode (autonomic's record): {{mode}}",
  "WARNED": "warned {{percent}}",
  "PAUSED_UNATTENDED": "molt paused: {{count}} molts in a row with no message from you. Send a message to resume; the handoff is at {{path}}.",
  "PAUSED_NO_PROGRESS": "molt paused: no progress since the last molt (no Write, Edit or commit). Autopilot stops here; the handoff is at {{path}}.",
  "MISSING_HANDOFF": "molt: the MOLT-HANDOFF line names {{path}}, but {{path}} does not exist or is not a readable file. Write the handoff file, then end your reply with MOLT-HANDOFF: <its absolute path>.",
  "STATUS_METER": "molt {{percent}}%/{{command}}%"
}
const exported = templates as unknown as Record<string, unknown>
describe('shared glue rules live in the pure modules', () => {
  test('the Stop guard cap is exported by gate', () => {
    expect((gate as unknown as Record<string, unknown>).MAX_STOP_BLOCKS).toBe(2)
  })
  for (const [name, text] of Object.entries(texts)) {
    test(`${name} preserves its emitted bytes`, () => {
      expect(exported[name]).toBe(text)
    })
  }
})
