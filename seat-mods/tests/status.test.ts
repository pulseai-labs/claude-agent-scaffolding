import { describe, test, expect } from 'claude-code/testing'
import { checkBlock, classifyPrompt, isCrewTagged, hasMoltHandoff } from '../hooks/status'

const BLOCK = '**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** b\n**Waiting on (seats live):** none\n**Operator decision pending:** none'

describe('checkBlock', () => {
  test('the block passes, bold or plain', () => {
    expect(checkBlock(BLOCK)).toEqual({ ok: true })
    expect(checkBlock(BLOCK.replaceAll('**', ''))).toEqual({ ok: true })
  })
  test('narration before the block fails', () => {
    expect(checkBlock('Done.\n' + BLOCK)).toEqual({ ok: false, failed: 'Text comes before **What I ruled:**' })
  })
  test('a missing or empty field fails', () => {
    expect(checkBlock(BLOCK.replace('**Next steps:** b\n', ''))).toEqual({ ok: false, failed: '**Next steps:** is missing' })
    expect(checkBlock(BLOCK.replace('**Next steps:** b', '**Next steps:**'))).toEqual({ ok: false, failed: '**Next steps:** has no content' })
    expect(checkBlock('')).toEqual({ ok: false, failed: 'The reply is empty' })
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
  test('a line after the block fails; trailing whitespace passes', () => {
    expect(checkBlock(BLOCK + '\n\nAlso, I checked the logs.')).toEqual({ ok: false, failed: 'Text comes after **Operator decision pending:**' })
    expect(checkBlock(BLOCK + '\n\n')).toEqual({ ok: true })
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
    expect(classifyPrompt({ kind: 'plugin', name: 'autonomic' }, 'Approve')).toBe('operator')
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
