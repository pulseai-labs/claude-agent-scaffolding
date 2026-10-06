import { describe, test, expect } from 'claude-code/testing'
import { shape } from '../hooks/shape'

// The never-approve path records a command's shape, never its values (PR #681 round 8):
// no credential can reach the ledger or a pain signal, however it is spelled.
describe('the command shape', () => {
  test('verb, git subcommand and flag names; values counted, never shown', () => {
    expect(shape('git push -f https://user:TOKEN@x.test/r.git feat/x')).toBe('git push -f (+2 args)')
    expect(shape('git push --force-with-lease=main:abc origin main')).toBe('git push --force-with-lease (+2 args)')
    expect(shape('rm -rf /tmp/x')).toBe('rm -rf (+1 args)')
    expect(shape('git commit -m x --no-verify')).toBe('git commit -m --no-verify (+1 args)')
  })
  test('segments keep their separators', () => {
    expect(shape('cd /repo && git push -f origin main; ls')).toBe('cd (+1 args) && git push -f (+2 args) ; ls')
  })
  test('no spelling of a secret survives', () => {
    const cases = [
      'SERVICE_TOKEN=alpha\\ beta git push -f origin main',
      `GITHUB_TOKEN="ghp_Q1 x" git push -f`,
      `curl -H 'X-API-Key: very secret value' -H "Cookie: a=1; session=s3cr3t" https://x && git push -f`,
      'mysql -pS3CR3TPASS -e x && git push -f',
      'git -c http.extraHeader="Authorization: Bearer b5" push -f',
      '/opt/ghp_TOKENISH/bin/git push -f',
    ]
    for (const c of cases) for (const secret of ['alpha', 'beta', 'ghp_', 'very', 'secret', 's3cr3t', 'S3CR3T', 'b5', 'TOKENISH']) expect([c, shape(c).includes(secret)]).toEqual([c, false])
  })
  test('an assignment keeps its name only; a long short-flag cluster is hidden', () => {
    expect(shape('GH_TOKEN=abc gh pr list')).toBe('GH_TOKEN= gh (+2 args)')
    expect(shape('mysql -pS3CR3TPASS')).toBe('mysql -? (+0 args)'.replace(' (+0 args)', ''))
  })
})
