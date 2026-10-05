import { describe, test, expect } from 'claude-code/testing'
import { askPrompt, permissionPrompt, scopeMessage, turnEndPrompt } from '../hooks/prompts'

describe('fork prompts', () => {
  test('the turn-end prompt carries the policy, the tail, every case and the molt rule', () => {
    const p = turnEndPrompt('…Shall I proceed?', 'POLICY-TEXT')
    for (const s of ['POLICY-TEXT', '…Shall I proceed?', '"covered"', '"stalled"', '"waiting"', '"done"', '"pain"', '40%', '65%'])
      expect(p).toContain(s)
  })
  test('the ask prompt lists every question and its labels', () => {
    const p = askPrompt([{ question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] }], 'POL')
    for (const s of ['POL', 'Which colour?', '"Red"', '"Blue"']) expect(p).toContain(s)
  })
  test('the permission prompt names the tool and caps the input', () => {
    const p = permissionPrompt('Bash', { command: 'x'.repeat(10_000) }, 'POL')
    expect(p).toContain('<tool>Bash</tool>')
    expect(p.length).toBeLessThan(6000)
  })
  test('the scope message lists each doc', () => {
    expect(scopeMessage(['/a.md', '/b.md'])).toContain('- /a.md\n- /b.md')
  })
})
