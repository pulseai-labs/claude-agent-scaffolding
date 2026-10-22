// The texts a session reads from molt. The operator's copies under ~/.claude/molt/
// win; these are written there on first start and used when a copy cannot be read.

// molt 0.1.0's default, byte for byte: a copy of it on disk is replaced on first start.
export const OLD_DEFAULT_INSTRUCTIONS = `Context is at {{percent}}% of the window (molt's soft threshold is {{soft}}%). Finish the step you are on and start no new one, then write a session handoff.

- If the ossify:handoff skill is available, use it.
- Otherwise write a handoff file with these sections: Work in progress; Decisions; Assumptions to verify; Dead ends; Last request and whether it was answered; Next step.
- Record every path, id and live background wait that your brief or your parent expects you to keep.

Commit the handoff where your project's rules say handoffs are committed. Then end your reply with one line, exactly:
MOLT-HANDOFF: <absolute path of the handoff file>

molt then clears this session and resumes it from that file in the same pane.`

export const DEFAULT_INSTRUCTIONS = `Context is at {{percent}}% of the window, past molt's handoff threshold ({{command}}%). Finish the step in hand, start no new one, and write a session handoff now.

- If your brief says where your handoff goes, follow it.
- Otherwise, if the ossify:handoff skill is available, use it.
- Otherwise write a handoff file with these sections: Work in progress; Decisions; Assumptions to verify; Dead ends; Last request and whether it was answered; Next step.
- Record every path, id and live background wait that your brief or your parent expects you to keep.

Then end your reply with one line, exactly:
MOLT-HANDOFF: <absolute path of the handoff file>`

export const DEFAULT_WARNING = `Context is at {{percent}}% of the window. This is molt's {{stage}} warning; its handoff threshold is {{command}}%. Keep working, and find a good point to hand off: the end of the step or unit in hand. Hand off there, before {{command}}%: write a session handoff and end that reply with MOLT-HANDOFF: <absolute path of the handoff file>.`

export const ROOT_NOTE = 'molt then clears this session and resumes it from that file in the same pane.'
export const CHILD_NOTE = 'molt does not clear a child session: return the handoff to your parent as your brief says, then stop.'
export const CHILD_WARNING = 'Your parent dispatched you: tell your parent now, as your brief says, and hand off at the point your brief names.'

export const BLOCK_NOTE = `Context is past molt's block threshold ({{block}}%). Only Write, Edit, Skill, git add and git commit run now; use git -C <dir>, not cd. Write the handoff and end your reply with the MOLT-HANDOFF line.`

export const DEFAULT_SEED = `↪ molt: this session continues from the handoff at {{path}}. If the ossify:handoff-resume skill is available, use it on that file. Otherwise read the file, check its claims against the repository, and follow its next step.`

export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole))
}

export function expandHome(path: string, home: string): string {
  return path.startsWith('~/') ? `${home}/${path.slice(2)}` : path
}

// Shared operator notices and status records, used by both host glues.
export const SESSION_OFF = "molt is off for this session. The crew context-ceiling hooks speak again here."
export const SESSION_ON = "molt is on for this session."
export const COMMAND_USAGE = "usage: /molt now | off | on | status"
export const STATUS_OFF = "molt: off"
export const STATUS_PAUSED = "molt: paused"
export const HANDOFF_REQUIRED = "handoff required"
export const HANDED_OFF = "handed-off {{path}}"
export const PARENT_HANDOFF = "molt: handed off to the parent — {{path}}"
export const HANDING_OFF = "molt: handing off at {{percent}}% — {{path}}"
export const RESUMED = "molt: resumed from {{path}}"
export const SEED_REJECTED = "molt: the seed was rejected. Resume by hand from {{path}}."
export const CONFIG_PROBLEMS = "molt: {{problems}}"
export const SETTINGS_PROBLEMS = "settings: {{problems}}"
export const SESSION_STATUS = "molt is {{state}} for this session."
export const FILL_STATUS = "fill: {{percent}} — warnings {{warn}}% and {{warnAgain}}%, handoff {{command}}%, block {{block}}%, fallback {{fallback}}%"
export const MODE_STATUS = "mode (autonomic's record): {{mode}}"
export const WARNED = "warned {{percent}}"
export const PAUSED_UNATTENDED = "molt paused: {{count}} molts in a row with no message from you. Send a message to resume; the handoff is at {{path}}."
export const PAUSED_AGENT = "molt: the handoff did not happen. This session was not cleared, because molt is paused: {{reason}} Tell the operator to send any message to resume molt."
export const PAUSED_NO_PROGRESS = "molt paused: no progress since the last molt (no Write, Edit or commit). Autopilot stops here; the handoff is at {{path}}."
export const MISSING_HANDOFF = "molt: the MOLT-HANDOFF line names {{path}}, but {{path}} does not exist or is not a readable file. Write the handoff file, then end your reply with MOLT-HANDOFF: <its absolute path>."
export const STATUS_METER = "molt {{percent}}%/{{command}}%"
