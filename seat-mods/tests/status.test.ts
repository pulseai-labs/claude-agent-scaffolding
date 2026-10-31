import { describe, test, expect } from 'claude-code/testing'
import { checkBlock, classifyPrompt, isCrewTagged, hasMoltHandoff, isIdleStop, moltActs, redoDrop, IDLE_REASON, IDLE_WARNING, STATUS_CONTEXT } from '../hooks/status'
import { moltStagePath } from '../hooks/records'

const BLOCK = '**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** b\n**Waiting on (seats live):** none\n**Waiting on operator:** none'

describe('checkBlock', () => {
  test('the block passes, bold or plain', () => {
    expect(checkBlock(BLOCK)).toEqual({ ok: true })
    expect(checkBlock(BLOCK.replaceAll('**', ''))).toEqual({ ok: true })
  })
  test('blank lines between fields pass (#879)', () => {
    expect(checkBlock(BLOCK.replaceAll('\n', '\n\n'))).toEqual({ ok: true })
  })
  test('the old label in field 5 now fails (pinned control, #879)', () => {
    expect(checkBlock(BLOCK.replace('**Waiting on operator:** none', '**Operator decision pending:** none')))
      .toEqual({ ok: false, failed: '**Waiting on operator:** is missing' })
  })
  test('narration before the block fails', () => {
    expect(checkBlock('Done.\n' + BLOCK)).toEqual({ ok: false, failed: 'Text comes before **What I ruled:**' })
  })
  test('a missing or empty field fails', () => {
    expect(checkBlock(BLOCK.replace('**Next steps:** b\n', ''))).toEqual({ ok: false, failed: '**Next steps:** is missing' })
    expect(checkBlock(BLOCK.replace('**Next steps:** b', '**Next steps:**'))).toEqual({ ok: false, failed: '**Next steps:** has no content' })
    expect(checkBlock('')).toEqual({ ok: false, failed: 'The reply is empty' })
  })
  test('an empty first field fails too, bold or plain', () => {
    expect(checkBlock(BLOCK.replace('**What I ruled:** a', '**What I ruled:**')))
      .toEqual({ ok: false, failed: '**What I ruled:** has no content' })
    expect(checkBlock(BLOCK.replaceAll('**', '').replace('What I ruled: a', 'What I ruled:')))
      .toEqual({ ok: false, failed: '**What I ruled:** has no content' })
  })
  test('a field in the wrong position is out of order', () => {
    const swapped = BLOCK.replace(
      '**What the PR(s) will carry:** none\n**Next steps:** b',
      '**Next steps:** b\n**What the PR(s) will carry:** none',
    )
    expect(checkBlock(swapped)).toEqual({ ok: false, failed: '**What the PR(s) will carry:** is out of order' })
  })
  test('a half-bold label fails on line 1', () => {
    // Only a fully bold or a fully plain label is a label (AI PR #180 round 3).
    expect(checkBlock('**What I ruled: a')).toEqual({ ok: false, failed: 'Text comes before **What I ruled:**' })
    expect(checkBlock('What I ruled:** a')).toEqual({ ok: false, failed: 'Text comes before **What I ruled:**' })
  })
  test('a line after `none` in the last field fails; trailing whitespace passes', () => {
    expect(checkBlock(BLOCK + '\n\nAlso, I checked the logs.')).toEqual({ ok: false, failed: 'Text comes after **Waiting on operator:**' })
    expect(checkBlock(BLOCK + '\n\n')).toEqual({ ok: true })
  })
  test('a field holds the lines up to the next label (#994)', () => {
    const multi = BLOCK
      .replace('**What I ruled:** a', '**What I ruled:**\n- one\n- two')
      .replace('**Next steps:** b', '**Next steps:** first\n| a | b |\n|---|---|\n| 1 | 2 |')
      .replace('**Waiting on operator:** none', '**Waiting on operator:** decision:\n1. Merge? Options: yes, no. Recommended: yes.\n2. Tag? Options: yes, no. Recommended: no.')
    expect(checkBlock(multi)).toEqual({ ok: true })
  })
  test('a label alone with lines under it has content; a label with none does not (#994)', () => {
    expect(checkBlock(BLOCK.replace('**Next steps:** b', '**Next steps:**\n- b'))).toEqual({ ok: true })
    expect(checkBlock(BLOCK.replace('**Next steps:** b', '**Next steps:**\n\n'))).toEqual({ ok: false, failed: '**Next steps:** has no content' })
  })
  test('controls: a repeated label is out of order, text before the block still fails (#994)', () => {
    expect(checkBlock(BLOCK + '\n**Next steps:** again')).toEqual({ ok: false, failed: '**Next steps:** is out of order' })
    expect(checkBlock('- a list\n' + BLOCK)).toEqual({ ok: false, failed: 'Text comes before **What I ruled:**' })
  })
})

describe('classifyPrompt', () => {
  test('notifications, peers and schedules are status', () => {
    for (const kind of ['task-notification', 'peer', 'peer-send-message', 'scheduled-trigger', 'auto-continuation'])
      expect(classifyPrompt({ kind }, 'x')).toBe('status')
    expect(classifyPrompt({ kind: 'plugin' }, 'x')).toBe('status')
  })
  test('typing is the operator unless it carries a crew tag', () => {
    expect(classifyPrompt({ kind: 'composer' }, 'consider slice 1 done')).toBe('operator')
    expect(classifyPrompt({ kind: 'composer' }, '[crew report implementer] T1 final /r.md')).toBe('status')
    expect(classifyPrompt({ kind: 'composer' }, 'REPORT READY: T1 final /r.md')).toBe('status')
    expect(classifyPrompt({ kind: 'composer' }, 'MOLT WARNING 62% T1')).toBe('status')
    expect(classifyPrompt({ kind: 'plugin', name: 'auto' + 'nomic' }, 'x')).toBe('status')
    expect(classifyPrompt({ kind: 'plugin', name: 'other-mod' }, 'x')).toBe('status')
    for (const kind of ['projects-relay', 'coordinator', 'observer', 'observer-activity'])
      expect(classifyPrompt({ kind }, 'x')).toBe('status')
    expect(classifyPrompt({ kind: 'unclassified' }, 'x')).toBe('operator')
  })
  // Every remaining kind in the installed PromptOrigin (Claude Code 2.1.302) is
  // placed explicitly. sdk is the operator's unless tagged: a claude -p turn may
  // be typed by the operator, and the anti-goal on typed turns outranks goal 1.
  test('the remaining installed kinds are placed', () => {
    for (const kind of ['bridge', 'channel', 'slack-ping', 'sdk']) {
      expect(classifyPrompt({ kind }, 'x')).toBe('operator')
      expect(classifyPrompt({ kind }, '[crew report implementer] T1 final /r.md')).toBe('status')
    }
    expect(classifyPrompt({ kind: 'sdk' }, 'x')).toBe('operator')
    expect(classifyPrompt({ kind: 'sdk' }, '[crew report implementer] T1 final /r.md')).toBe('status')
    // Unknown kinds — and unclassified — stay on the operator fallback, untagged.
    expect(classifyPrompt({ kind: 'some-future-kind' }, '[crew report implementer] T1')).toBe('operator')
  })
})

test('isCrewTagged rejects look-alikes', () => {
  expect(isCrewTagged('[crew deploy implementer] x')).toBe(false)
  expect(isCrewTagged('see [crew report implementer]')).toBe(false)
})
test('hasMoltHandoff only at the end', () => {
  expect(hasMoltHandoff('x\nMOLT-HANDOFF: /h.md\n')).toBe(true)
  expect(hasMoltHandoff('MOLT-HANDOFF: /h.md\nAdditional narration')).toBe(false)
})
test('rotation resumes are status', () => {
  expect(classifyPrompt({ kind: 'composer' }, '/ossify:handoff-resume /h.md')).toBe('status')
  expect(classifyPrompt({ kind: 'composer' }, 'skill://handoff-resume /h.md')).toBe('status')
})

describe('isIdleStop (#876)', () => {
  test('reads the first line of a multi-line field (#994)', () => {
    const build = (next: string, seats: string, op: string): string =>
      `**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** ${next}\n**Waiting on (seats live):** ${seats}\n**Waiting on operator:** ${op}`
    expect(isIdleStop(build('merge\n- then tag', 'none', 'none'))).toBe(true)
    expect(isIdleStop(build('merge', 'none\n- none live', 'none'))).toBe(true)
    expect(isIdleStop(build('merge', 'none', 'decision:\n1. Merge?'))).toBe(false)
    expect(isIdleStop(build('merge', '- seat a\n- seat b', 'none'))).toBe(false)
    // A list marker before `none` still reads as none (the idle check is not dodged by a bullet);
    // controls: a marker before other text, and `none` as a word prefix, do not.
    expect(isIdleStop(build('merge', '- none', '1. none'))).toBe(true)
    expect(isIdleStop(build('merge', 'none', '- None'))).toBe(true)
    expect(isIdleStop(build('- none', 'none', 'none'))).toBe(false)
    expect(isIdleStop(build('merge', '- nonetheless a seat', 'none'))).toBe(false)
    expect(isIdleStop(build('merge', '- seat none', 'none'))).toBe(false)
  })
  // Blocks built from the five labels with given contents; the plain variant
  // strips the markers, since a label counts bold or plain.
  const fb = (next: string, waiting: string, operator: string) =>
    `**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** ${next}\n**Waiting on (seats live):** ${waiting}\n**Waiting on operator:** ${operator}`

  test('both wait fields none with work in Next steps is idle, bold or plain', () => {
    const idle = fb('do X', 'none', 'none')
    expect(isIdleStop(idle)).toBe(true)
    expect(isIdleStop(idle.replaceAll('**', ''))).toBe(true)
  })

  test('the lenient none reading: the word at the start counts, whatever follows', () => {
    expect(isIdleStop(fb('open the PR', 'none. No seats are live.', 'None'))).toBe(true)
  })

  test('Next steps none is the finished run: not idle', () => {
    expect(isIdleStop(fb('none', 'none', 'none'))).toBe(false)
    // A false none in Next steps only skips the nudge: lenient by design.
    expect(isIdleStop(fb('none on #867. #876 is queued and needs a design.', 'none', 'none'))).toBe(false)
  })

  test('either wait field naming something is not idle', () => {
    expect(isIdleStop(fb('open the PR', 'reviewer wED:p1 is reviewing', 'none'))).toBe(false)
    expect(isIdleStop(fb('open the PR', 'none', 'choose the next line'))).toBe(false)
    expect(isIdleStop(fb('open the PR', 'nonetheless a seat', 'none'))).toBe(false)
  })

  test('a field-5 action: wait with no seat is not idle (#879)', () => {
    const action = fb('open the PR', 'none', 'action: start a fresh session')
    expect(checkBlock(action)).toEqual({ ok: true })
    expect(isIdleStop(action)).toBe(false)
  })

  test('control for the action wait: the same block with field 5 none is idle (#879)', () => {
    expect(isIdleStop(fb('open the PR', 'none', 'none'))).toBe(true)
  })

  test('a malformed reply is not idle', () => {
    expect(isIdleStop('Done.')).toBe(false)
  })

  test('the context sentence and the idle copy are the plan\'s verbatim', () => {
    expect(STATUS_CONTEXT.endsWith('do that work first.')).toBe(true)
    // The context teaches the new field and its forms (#879).
    expect(STATUS_CONTEXT).toContain('**Waiting on operator:**')
    expect(STATUS_CONTEXT).toContain('"decision: <question>" or "action: <what the operator must do>"')
    expect(IDLE_REASON).toBe('seat-mods (orchestrator): the status block says nothing waits, but Next steps names work. Do the next step now, or name the seat, wake, or operator decision or action you wait on.')
    expect(IDLE_WARNING).toBe('⚠ seat-mods: status block says nothing waits, but Next steps names work.')
  })
})

describe('the redo turn (#929)', () => {
  test("molt's handoff requests are not status turns; its seed and seat-mods' own redo are", () => {
    expect(classifyPrompt({ kind: 'plugin', name: 'molt' }, 'Write the handoff, then end your reply with MOLT-HANDOFF: <path>.')).toBe('operator')
    expect(classifyPrompt({ kind: 'plugin', name: 'molt' }, '↪ molt: this session continues from the handoff at /h.md.')).toBe('status')
    expect(classifyPrompt({ kind: 'plugin', name: 'molt' }, '[crew report implementer] T1 final /r.md')).toBe('status')
    expect(classifyPrompt({ kind: 'plugin', name: 'seat-mods' }, 'x')).toBe('status')
  })
  test("moltStagePath is molt's stage file", () => {
    expect(moltStagePath('/home/u', 's1')).toBe('/home/u/.claude/state/molt/stage/s1')
  })
  test('moltActs: command, block and fallback act; anything else does not', () => {
    for (const stage of ['command', 'block', 'fallback']) expect(moltActs(`{"stage":"${stage}","percent":70}\n`)).toBe(true)
    for (const stage of ['below', 'warn', 'warnAgain', 'off']) expect(moltActs(`{"stage":"${stage}"}`)).toBe(false)
    for (const text of [undefined, '', 'not json', '[]', '{"stage":3}']) expect(moltActs(text)).toBe(false)
  })
  test('redoDrop: the redo runs only in its own session, first in line, with molt idle', () => {
    const base = { pendingSession: 's1', currentSession: 's1', superseded: false, moltStage: undefined }
    expect(redoDrop(base)).toBeUndefined()
    expect(redoDrop({ ...base, currentSession: 's2' })).toBe('seat-mods: the status rewrite was dropped: the session changed')
    expect(redoDrop({ ...base, superseded: true })).toBe('seat-mods: the status rewrite was dropped: another prompt came first')
    expect(redoDrop({ ...base, moltStage: '{"stage":"command"}' })).toBe('seat-mods: the status rewrite was dropped: molt is handing off')
    expect(redoDrop({ ...base, moltStage: '{"stage":"warnAgain"}' })).toBeUndefined()
  })
})
