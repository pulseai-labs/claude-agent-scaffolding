import { describe, test, expect } from 'claude-code/testing'
import { ledgerLine, ledgerPathFor, oneLine } from '../hooks/ledger'

describe('the decision ledger (spec §1, D6)', () => {
  test('path: env wins; relative env resolves against the root; else the repo default', () => {
    expect(ledgerPathFor('/ai/.autonomic/l.md', '/repo')).toBe('/ai/.autonomic/l.md')
    expect(ledgerPathFor('notes/l.md', '/repo/')).toBe('/repo/notes/l.md')
    expect(ledgerPathFor('  ', '/repo')).toBe('/repo/.autonomic/ledger.md')
    expect(ledgerPathFor(undefined, '/repo')).toBe('/repo/.autonomic/ledger.md')
  })
  test('the line format, exactly', () => {
    expect(ledgerLine({ time: 'T', session: 's1', kase: 'covered', q: 'Proceed?', a: 'yes', why: 'plan step 3' }))
      .toBe('- T · s1 · covered · Q: Proceed? · A: yes · why: plan step 3')
  })
  test('usage is appended as fork cost', () => {
    const line = ledgerLine({ time: 'T', session: 's1', kase: 'stalled', q: 'q', a: 'a', why: 'w',
      usage: { input_tokens: 900, cache_creation_input_tokens: 100, cache_read_input_tokens: 50_000, output_tokens: 40 } })
    expect(line.endsWith(' · usage: in=1000 cached=50000 out=40')).toBe(true)
  })
  test('one line, always', () => {
    expect(oneLine('a\n  b\tc')).toBe('a b c')
    expect(oneLine('x'.repeat(400), 10)).toBe(`${'x'.repeat(9)}…`)
    expect(ledgerLine({ time: 'T', session: 's', kase: 'pain', q: 'a\nb', a: 'c', why: 'd' }).includes('\n')).toBe(false)
  })
})

describe('redaction (PR #681 round 4, condition 4)', () => {
  test('a credential never reaches a ledger line or a pain text', () => {
    const line = oneLine('Bash: git push -f https://user:ghp_SECRET@github.com/o/r.git feat/x && GH_TOKEN=abc123 gh pr list --token=xyz -H "Authorization: Bearer tok9"')
    for (const secret of ['ghp_SECRET', 'abc123', 'xyz', 'tok9']) expect(line).not.toContain(secret)
    expect(line).toContain('https://***@github.com/o/r.git')
  })
  test('quoted values, auth headers and known token shapes are redacted too (PR #681 round 5)', () => {
    const line = oneLine(`GITHUB_TOKEN="ghp_Q1" git push -f && X='y' API_KEY='k2' cmd --token "t3" --password 'p4' -H "Authorization: Bearer b5" -H 'Authorization: token a6' && curl -d github_pat_Z7abc && echo sk-ant-api03-Q8 xoxb-9-9 AKIAABCDEFGHIJKLMNOP`)
    for (const secret of ['ghp_Q1', 'k2', 't3', 'p4', 'b5', 'a6', 'github_pat_Z7abc', 'sk-ant-api03-Q8', 'xoxb-9-9', 'AKIAABCDEFGHIJKLMNOP']) expect(line).not.toContain(secret)
    expect(line).toContain('git push -f')
  })
  test('credential-bearing headers are redacted (PR #681 round 6)', () => {
    const line = oneLine(`curl -H 'X-API-Key: v1secret' -H "Cookie: sid=v2secret" -H 'Private-Token: v3secret' https://x && git push -f`)
    for (const secret of ['v1secret', 'v2secret', 'v3secret']) expect(line).not.toContain(secret)
    expect(line).toContain('git push -f')
  })
})

