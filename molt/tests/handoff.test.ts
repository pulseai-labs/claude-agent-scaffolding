import { describe, test, expect } from 'claude-code/testing'
import { extractFacts, factsBrief, isUsableSummary, markerPath, pickHandoff, resolvePath } from '../hooks/handoff'
import type { Message } from '../hooks/handoff'

describe('markerPath', () => {
  test('the last marker line wins, decorations stripped', () => {
    expect(markerPath('done\nMOLT-HANDOFF: /a/one.md\nmore\nMOLT-HANDOFF: `/a/two.md`')).toBe('/a/two.md')
    expect(markerPath('MOLT-HANDOFF: <docs/h.md>')).toBe('docs/h.md')
  })
  test('a marker mid-line is not a marker', () => {
    expect(markerPath('I will print MOLT-HANDOFF: /x later')).toBeUndefined()
  })
  test('no marker', () => {
    expect(markerPath('all done')).toBeUndefined()
    expect(markerPath('MOLT-HANDOFF:   ')).toBeUndefined()
  })
})

describe('resolvePath (review focus 4)', () => {
  test('Windows drive and UNC paths are absolute', () => {
    expect(resolvePath('C:\\repo\\h.md', 'C:\\work', 'C:\\Users\\u')).toBe('C:\\repo\\h.md')
    expect(resolvePath('C:/repo/h.md', 'C:\\work', 'C:\\Users\\u')).toBe('C:/repo/h.md')
    expect(resolvePath('\\\\server\\share\\h.md', 'C:\\work', 'C:\\Users\\u')).toBe('\\\\server\\share\\h.md')
  })
  test('absolute, home and relative', () => {
    expect(resolvePath('/x/h.md', '/repo', '/home/u')).toBe('/x/h.md')
    expect(resolvePath('~/h.md', '/repo', '/home/u')).toBe('/home/u/h.md')
    expect(resolvePath('docs/h.md', '/repo/', '/home/u')).toBe('/repo/docs/h.md')
  })
})

describe('pickHandoff', () => {
  test('marker first, then the last markdown written, else nothing', () => {
    expect(pickHandoff('/m.md', '/w.md')).toEqual({ path: '/m.md', source: 'marker' })
    expect(pickHandoff(undefined, '/w.md')).toEqual({ path: '/w.md', source: 'write' })
    expect(pickHandoff(undefined, undefined)).toBeUndefined()
  })
})

const MESSAGES: Message[] = [
  { role: 'user', text: 'fix #12 and #340', toolUses: [] },
  { role: 'assistant', text: 'working on it', toolUses: [
    { tool: 'Edit', input: { file_path: '/repo/a.ts' } },
    { tool: 'Write', input: { file_path: '/repo/b.md' } },
    { tool: 'Edit', input: { file_path: '/repo/a.ts' } },
    { tool: 'Bash', input: { command: 'git add a.ts && git commit -F /tmp/m\necho done' } },
    { tool: 'Bash', input: { command: 'git status' } },
  ] },
  { role: 'user', text: 'now the docs', toolUses: [] },
]

describe('extractFacts', () => {
  test('files once each, commits by first line, issues, last request', () => {
    const f = extractFacts(MESSAGES)
    expect(f.files).toEqual(['/repo/a.ts', '/repo/b.md'])
    expect(f.commits).toEqual(['git add a.ts && git commit -F /tmp/m'])
    expect(f.issues).toEqual(['#12', '#340'])
    expect(f.lastRequest).toBe('now the docs')
  })
})

describe('factsBrief', () => {
  test('facts only: every section, and the warning to check claims', () => {
    const text = factsBrief(extractFacts(MESSAGES), { sessionId: 's1', percent: 71.4 })
    expect(text).toContain('# molt fallback handoff — session s1')
    expect(text).toContain('71%')
    expect(text).toContain('check every claim')
    for (const h of ['## Files written or edited', '## Commits made', '## Issues mentioned', '## Last request', '## Next step'])
      expect(text).toContain(h)
  })
  test('with a summary: the summary is included', () => {
    const text = factsBrief(extractFacts([]), { sessionId: 's1', percent: undefined, summary: '## Next step\nship it' })
    expect(text).toContain('ship it')
    expect(text).toContain('an unknown')
    expect(text).toContain('- none recorded')
  })
})

describe('isUsableSummary', () => {
  test('needs a Next step heading', () => {
    expect(isUsableSummary('## Work in progress\nx\n## Next step\ny')).toBe(true)
    expect(isUsableSummary('Sure! Here is a summary.')).toBe(false)
  })
})
