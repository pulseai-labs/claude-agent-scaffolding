import { describe, test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

// The world beneath the plugin. The test kit routes $.fs, $.process and
// $.session.cwd as events the test answers, so this is a small file system:
// a git worktree at /w (the session runs in /w/seat-mods), and three plain
// folders outside it. The test's own tool.call hook stands for the engine: a
// call that reaches it answers `ran`; a denied call resolves with { deny }
// carrying the deny text. A mocked call answers { value }, or { deny } for a
// missing path, as the kit requires.
const DIRS = new Set(['/', '/w', '/w/seat-mods', '/w/seat x', '/etc', '/var', '/reports', '/reports/sub', '/w/build', '/w/seat-mods/sub', '/w/seat-mods/build', '/tmp', '/home', '/home/seat', '/home/u', '/home/u/scratch'])
// A dangling symbolic link: it exists, but resolving it fails.
const LINKS = new Set(['/w/link'])
const FILES = new Map<string, string>([
  ['/w/README.md', 'readme'],
  ['/w/msg-trailer.txt', 'fix: a thing\n\nCo-Authored-By: someone <x@y>\n'],
  ['/w/seat x/msg.txt', 'fix\n\nCo-Authored-By: someone <x@y>\n'],
])

// What realpath gives for the mock: `.` and `..` resolved, no links. Like
// realpath, `..` through a folder that does not exist fails (undefined).
function normal(path: string): string | undefined {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!DIRS.has('/' + parts.join('/'))) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return '/' + parts.join('/')
}

function world(on: On, env: Record<string, string>, gitRepo = true, cwd = '/w/seat-mods', cwdFailure = false) {
  mock.env(on, env)
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('session.cwd', () => cwdFailure ? { deny: 'cwd unavailable' } : { value: cwd })
  on('process.run', (_$, e) =>
    ({ value: e.argv.includes('rev-parse')
      ? (gitRepo
        ? { exitCode: 0, stdout: '/w\n', stderr: '', isStdoutTruncated: false }
        : { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false })
      : { exitCode: 1, stdout: '', stderr: 'unmocked', isStdoutTruncated: false } }) as never)
  on('fs.stat', (_$, e) => {
    let path = normal(e.path)
    const targets: Record<string, string> = { '/w/outside': '/var', '/w/inside': '/w/build', '/var/inside': '/w/build' }
    const link = Object.keys(targets).find(link => path === link || path?.startsWith(link + '/'))
    if (link !== undefined && path === link && !e.resolve)
      return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink: true } } as never
    if (link !== undefined && path !== undefined) path = targets[link] + path.slice(link.length)
    if (path !== undefined && LINKS.has(path) && !e.resolve)
      return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink: true } } as never
    if (path !== undefined && DIRS.has(path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: path } } as never
    if (path !== undefined && FILES.has(path)) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false, realPath: path } } as never
    return { deny: `ENOENT: ${e.path}` } as never
  })
  on('fs.read', (_$, e) => {
    const path = normal(e.path)
    const text = path === undefined ? undefined : FILES.get(path)
    if (text === undefined) return { deny: `ENOENT: ${e.path}` } as never
    return { value: text } as never
  })
}

describe('unset role: guarded as the default implementer', () => {
  test('unset: merge denied, a plain commit allowed, an outside write denied', async ($, on) => {
    world(on, {})
    const merge = await $.tool.call({ tool: 'Bash', command: 'git merge main' })
    expect(merge.deny).toContain('seat-mods (implementer): no merges')
    const commit = await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' })
    expect(commit.deny).toBeUndefined()
    const outside = await $.tool.call({ tool: 'Write', file_path: '/var/seat-mods-never', content: 'x' })
    expect(outside.deny).toBeDefined()
    expect(outside.deny).toContain('SEAT_MODS_ALLOW')
  })
  test('empty string: the same default', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: '' })
    const merge = await $.tool.call({ tool: 'Bash', command: 'git merge main' })
    expect(merge.deny).toBeDefined()
    const outside = await $.tool.call({ tool: 'Write', file_path: '/var/seat-mods-never', content: 'x' })
    expect(outside.deny).toBeDefined()
  })
  test('outside a git repo the session cwd is the worktree', async ($, on) => {
    world(on, {}, false)
    const inside = await $.tool.call({ tool: 'Write', file_path: '/w/seat-mods/notes.md', content: 'x' })
    expect(inside.deny).toBeUndefined()
    const sibling = await $.tool.call({ tool: 'Write', file_path: '/w/README.md', content: 'x' })
    expect(sibling.deny).toBeDefined()
    const outside = await $.tool.call({ tool: 'Write', file_path: '/etc/notes.md', content: 'x' })
    expect(outside.deny).toBeDefined()
  })
})

describe('free roles: no rails', () => {
  for (const role of ['orchestrator', 'coordinator']) {
    test(`${role}: merge, force-push and an outside write pass through`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role })
      const merge = await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })
      expect(merge.deny).toBeUndefined()
      const force = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
      expect(force.deny).toBeUndefined()
      const outside = await $.tool.call({ tool: 'Write', file_path: '/var/seat-mods-x', content: 'x' })
      expect(outside.deny).toBeUndefined()
    })
  }
})

describe('invalid role: fail closed', () => {
  test('every tool call is denied with the bad value', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementr' })
    const r = await $.tool.call({ tool: 'Read', file_path: '/w/README.md' })
    expect(r.deny).toBeDefined()
    expect(r.deny).toContain('"implementr"')
  })
  for (const value of ['orchestrater', 'Orchestrator', 'orchestrator ', 'Coordinator']) {
    test(`${value}: denied as invalid, not free`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: value })
      const r = await $.tool.call({ tool: 'Write', file_path: '/w/README.md', content: 'x' })
      expect(r.deny).toBeDefined()
      expect(r.deny).toContain(`"${value}"`)
    })
  }
})

describe('Bash guards', () => {
  test('implementer: merge denied, commit and push allowed', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const merge = await $.tool.call({ tool: 'Bash', command: 'git merge main' })
    expect(merge.deny).toBeDefined()
    expect(merge.deny).toContain('seat-mods (implementer): no merges')
    const ok = await $.tool.call({ tool: 'Bash', command: 'git commit -m "merge the fix" && git push origin b' })
    expect(ok.deny).toBeUndefined()
  })
  test('verifier: push denied', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'verifier' })
    const r = await $.tool.call({ tool: 'Bash', command: 'git push origin b' })
    expect(r.deny).toBeDefined()
  })
  test('a trailer in the -F message file is denied (Review Focus 1)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -F /w/msg-trailer.txt' })
    expect(r.deny).toBeDefined()
    expect(r.deny).toContain('AI trailers')
    const clean = await $.tool.call({ tool: 'Bash', command: 'git commit -F /w/README.md' })
    expect(clean.deny).toBeUndefined()
  })
  test('a trailer in a second -F file, or a quoted path with spaces, is denied (PR #644 review)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const second = await $.tool.call({ tool: 'Bash', command: 'git commit -F /w/README.md && git commit -F /w/msg-trailer.txt' })
    expect(second.deny).toContain('AI trailers')
    const spaced = await $.tool.call({ tool: 'Bash', command: 'git commit -F "/w/seat x/msg.txt"' })
    expect(spaced.deny).toContain('AI trailers')
  })
})

describe('write placement', () => {
  test('reviewer: worktree denied, SEAT_MODS_ALLOW allowed, outside denied', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', SEAT_MODS_ALLOW: '/reports' })
    const inside = await $.tool.call({ tool: 'Write', file_path: '/w/README.md', content: 'x' })
    expect(inside.deny).toBeDefined()
    expect(inside.deny).toContain('no edits in the worktree')
    const report = await $.tool.call({ tool: 'Write', file_path: '/reports/review.md', content: 'x' })
    expect(report.deny).toBeUndefined()
    const outside = await $.tool.call({ tool: 'Write', file_path: '/var/seat-mods-x', content: 'x' })
    expect(outside.deny).toBeDefined()
  })
  test('implementer: a new file in the worktree is allowed (Review Focus 3)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/w/seat-mods/not-there-yet.md', content: 'x' })
    expect(r.deny).toBeUndefined()
  })
  test('implementer: a .. path that leaves the worktree is denied (Review Focus 4)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Edit', file_path: '/w/seat-mods/../../escape.md', old_string: 'a', new_string: 'b' })
    expect(r.deny).toBeDefined()
  })
  test('implementer: a file in new nested folders inside the worktree is allowed (final review #1)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/w/newdir/sub/a.ts', content: 'x' })
    expect(r.deny).toBeUndefined()
  })
  test('implementer: .. under a folder that does not exist is denied, not appended as text', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/w/newdir/../../escape.md', content: 'x' })
    expect(r.deny).toBeDefined()
  })
  test('reviewer: a SEAT_MODS_ALLOW directory not created yet still allows its report', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', SEAT_MODS_ALLOW: '/reports/run-1' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/reports/run-1/review.md', content: 'x' })
    expect(r.deny).toBeUndefined()
  })
  test('implementer: a Write through a dangling symlink is denied (PR #644 round 4)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/w/link', content: 'x' })
    expect(r.deny).toBeDefined()
  })
  test('implementer with no SEAT_MODS_ALLOW: the report directory is denied, naming the variable', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const r = await $.tool.call({ tool: 'Write', file_path: '/reports/report.md', content: 'x' })
    expect(r.deny).toBeDefined()
    expect(r.deny).toContain('SEAT_MODS_ALLOW')
  })
})

// Each paired case catches an rm rail that either accepts an unsafe operand or
// rejects the closest safe spelling. Tool execution stays intercepted by world().
describe('rm placement: R1-R7', () => {
  for (const role of ['implementer', 'verifier', 'reviewer', undefined, ''] as const) {
    const label = role === undefined ? 'unset' : role === '' ? 'empty' : role
    const inside = role === 'reviewer' ? '/reports' : '/w/build'
    const cases: Array<[string, string, string]> = [
      ['outside', 'rm -rf /var/victim', `rm -rf ${inside}/victim`],
      ['all operands', `rm -f ${inside}/x /var/x`, `rm -f ${inside}/x ${inside}/y`],
      ['variable incident', 'rm -rf "$OLDPWD"', `rm -rf "${inside}/old"`],
      ['bare variable', 'rm -f $X', `rm -f '${inside}/$X'`],
      ['parameter expansion', 'rm -f "${X}"', "rm -f '" + inside + "/${X}'"],
      ['command substitution', 'rm -f $(printf /var/x)', `rm -f '${inside}/$(printf x)'`],
      ['quoted substitution', 'rm -f "$(printf /var/x)"', `rm -f '${inside}/$(printf x)'`],
      ['backticks', 'rm -f `printf /var/x`', "rm -f '" + inside + "/`literal`'"],
      ['quoted backticks', 'rm -f "`printf /reports/x`"', `rm -f ${inside}/literal`],
      ['named home', 'rm -f ~root/x', `rm -f ${inside}/~root`],
      ['home outside', 'rm -f ~/x', `rm -f ${inside}/x`],
      ['tmp glob incident', 'rm -f /tmp/tmp.*', `rm -f ${inside}/*.o`],
      ['question glob', 'rm -f /tmp/tmp.?', `rm -f ${inside}/x?.o`],
      ['bracket glob', 'rm -f /tmp/tmp.[ab]', `rm -f ${inside}/x[ab].o`],
      ['glob in directory', 'rm -rf /w*/build', `rm -f ${inside}/b*/*.o`],
      ['worktree root', 'rm -rf /w', `rm -rf ${inside}/child`],
      ['allow root', 'rm -rf /reports', 'rm -f /reports/x.log'],
      ['ancestor of allow', 'rm -rf /', 'rm -f /reports/x.log'],
      ['ancestor inside worktree', 'rm -rf /w/build', 'rm -f /w/build/reports/x.log'],
      ['parent symlink outside', 'rm -f /w/outside/x', `rm -f ${inside}/x`],
      ['terminal symlink outside', 'rm -rf /w/outside/', 'rm -f /reports/outside'],
      ['double slash root', 'rm -rf /reports///', 'rm -f /reports//x.log'],
      ['dot root', 'rm -rf /reports/.', 'rm -f /reports/./x.log'],
      ['dotdot root', 'rm -rf /w/build/..', 'rm -f /reports/sub/../x.log'],
      ['missing parent dotdot', 'rm -rf /w/missing/../../var/x', `rm -f ${inside}/new/sub/x`],
      ['wrapper/path', 'A=1 env command /bin/rm -f /var/x', `A=1 env command /bin/rm -f ${inside}/x`],
      ['after delimiter', 'rm -- -f /var/x', 'rm -- /reports/-f'],
    ]
    for (const [name, denied, allowed] of cases) {
      test(`${label}: ${name} denied beside safe control`, async ($, on) => {
        world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }),
          SEAT_MODS_ALLOW: name === 'ancestor inside worktree' ? '/reports:/w/build/reports' : '/reports', HOME: '/home/seat' })
        const bad = await $.tool.call({ tool: 'Bash', command: denied })
        expect(bad.deny).toContain(`seat-mods (${role || 'implementer'}): no rm`)
        const good = await $.tool.call({ tool: 'Bash', command: allowed })
        expect(good.deny).toBeUndefined()
      })
    }
    test(`${label}: worktree follows profile; terminal link is removed literally`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      for (const command of ['rm -rf /w/build', 'rm -f /w/outside', 'rm -f /w/link']) {
        const result = await $.tool.call({ tool: 'Bash', command })
        if (role === 'reviewer') expect(result.deny).toBeDefined()
        else expect(result.deny).toBeUndefined()
      }
      // A link outside the places remains outside even if its target is inside.
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /var/inside' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /reports/link' })).deny).toBeUndefined()
    })
    for (const change of ['cd', 'pushd', 'popd']) {
      test(`${label}: ${change} before relative rm denied; absolute allowed`, async ($, on) => {
        world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
        expect((await $.tool.call({ tool: 'Bash', command: `${change} /var && rm x` })).deny).toBeDefined()
        expect((await $.tool.call({ tool: 'Bash', command: `${change} /var && rm ${inside}/x` })).deny).toBeUndefined()
      })
    }
    test(`${label}: live cwd places relative operands and relative globs`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/w/seat-mods/sub/reports' }, true, '/w/seat-mods/sub')
      expect((await $.tool.call({ tool: 'Bash', command: 'rm reports/x' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm reports/*.log' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm ../../../var/x' })).deny).toBeDefined()
      const result = await $.tool.call({ tool: 'Bash', command: 'rm build/*.o' })
      if (role === 'reviewer') expect(result.deny).toBeDefined()
      else expect(result.deny).toBeUndefined()
    })
    test(`${label}: HOME tilde and literal quoted operand`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports', HOME: '/reports' })
      expect((await $.tool.call({ tool: 'Bash', command: 'rm ~' })).deny).toBeDefined()
      for (const command of ['rm ~/x', "rm '/reports/a b'", 'rm /reports/a\\ b', 'rm /reports/\\$X', 'rm -- -outside']) {
        const result = await $.tool.call({ tool: 'Bash', command })
        if (command === 'rm -- -outside' && role === 'reviewer') expect(result.deny).toBeDefined()
        else expect(result.deny).toBeUndefined()
      }
    })
    test(`${label}: rm after command text still counts; mentions do not`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      for (const command of ['echo "rm -rf /var"', "cat <<'EOF'\nrm -rf /var\nEOF", 'echo rm /var'])
        expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'echo "rm /reports/x"; rm /var/x' })).deny).toBeDefined()
    })
  }
  test('implementer: quoted commit message names rm without becoming rm', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "deny rm -rf /var"' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"; rm /var/x' })).deny).toBeDefined()
  })
  test('subagent-shaped event is guarded by its Bash tool', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', SEAT_MODS_ALLOW: '/reports' })
    const extra = { agent_id: 'general-purpose-child', parent_tool_use_id: 'Agent-call' }
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /tmp/tmp.*', ...extra })).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /reports/x.log', ...extra })).deny).toBeUndefined()
  })
  for (const role of ['orchestrator', 'coordinator']) {
    test(`${role}: every rm shape stays unguarded`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role })
      for (const command of ['rm -rf "$OLDPWD"', 'rm -f /tmp/tmp.*', 'cd /var; rm x', 'rm -rf /w', 'rm -rf /'])
        expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
    })
  }
})

describe('rm resolution controls', () => {
  for (const role of ['implementer', 'verifier', 'reviewer']) {
    test(`${role}: -- operand after cd is unresolvable beside option-only rm`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role, SEAT_MODS_ALLOW: '/reports' })
      expect((await $.tool.call({ tool: 'Bash', command: 'cd /var; rm -- -rf' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'cd /var; rm -rf' })).deny).toBeUndefined()
    })
    test(`${role}: missing HOME denies tilde beside literal absolute operand`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role, SEAT_MODS_ALLOW: '/reports' })
      expect((await $.tool.call({ tool: 'Bash', command: 'rm ~/x' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /reports/x' })).deny).toBeUndefined()
    })
    test(`${role}: link within allow unlinks literally; trailing slash follows its target`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role, SEAT_MODS_ALLOW: '/w', HOME: '/home/seat' })
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /w/outside' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /w/outside/' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /w/inside/' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /w/link' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /w/link/' })).deny).toBeDefined()
    })
  }
})

// Fix round 1: each finding has a failure case and its nearest allowed control.
describe('fix1 rm rail', () => {
  for (const role of ['implementer', 'verifier', 'reviewer', undefined, ''] as const) {
    const label = role || 'default'
    test(`${label}: F1 unquoted brace denied beside quoted literal`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /reports/{x,../var/y}' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: "rm '/reports/{x}'" })).deny).toBeUndefined()
    })
    test(`${label}: F2 redirects are not operands; unsafe removal still denied`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      for (const redirect of ['> /dev/null 2>&1', '>> /dev/null', '< /dev/null', '2> /dev/null', '&> /dev/null', '>| /dev/null', '7> /dev/null', '7>> /dev/null', '7< /dev/null', '>/dev/null', '2>/dev/null', '7>>/dev/null', '<"/dev/null"']) {
        expect((await $.tool.call({ tool: 'Bash', command: `rm -f /reports/x ${redirect}` })).deny).toBeUndefined()
        expect((await $.tool.call({ tool: 'Bash', command: `rm -f /etc/x ${redirect}` })).deny).toBeDefined()
      }
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /reports/x & echo done' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /etc/x & echo done' })).deny).toBeDefined()
      if (role !== 'reviewer')
        expect((await $.tool.call({ tool: 'Bash', command: 'rm -f build/x.o > /dev/null 2>&1' })).deny).toBeUndefined()
      // A quoted redirection glyph is a real rm operand, including after cd.
      expect((await $.tool.call({ tool: 'Bash', command: 'cd /var; rm ">"' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: "rm '/reports/>'" })).deny).toBeUndefined()
    })
    test(`${label}: F3 glob suffix dotdot denied beside ordinary suffix`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      for (const command of ['rm /reports/*/../../var/x', 'rm /reports/*/..', 'rm /reports/?/../x', 'rm /reports/[ab]/../x'])
        expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /reports/*/node_modules' })).deny).toBeUndefined()
      if (role !== 'reviewer')
        expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /w/*/node_modules' })).deny).toBeUndefined()
    })
    test(`${label}: F4 reserved heads and builtin expose rm`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      for (const prefix of ['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{', '(', 'time', 'builtin']) {
        expect((await $.tool.call({ tool: 'Bash', command: `${prefix} rm /etc/x` })).deny).toBeDefined()
        expect((await $.tool.call({ tool: 'Bash', command: `${prefix} rm /reports/x` })).deny).toBeUndefined()
      }
      for (const command of ['if test -e /var/v; then rm -rf /var/v; fi', '{ rm /etc/x; }', 'for f in a; do rm /etc/x; done'])
        expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeDefined()
      for (const change of ['builtin cd', '\\cd']) {
        expect((await $.tool.call({ tool: 'Bash', command: `${change} /var; rm x` })).deny).toBeDefined()
        expect((await $.tool.call({ tool: 'Bash', command: `${change} /var; rm /reports/x` })).deny).toBeUndefined()
      }
    })
    test(`${label}: F5 ancestor glob denied beside glob at root`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/w' }, false)
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /w/seat-*' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /w/seat-mods/*.log' })).deny).toBeUndefined()
    })
    test(`${label}: F6 forged marker denies beside ordinary quoted target`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      expect((await $.tool.call({ tool: 'Bash', command: 'rm "\u00000\u0000"' })).deny).toContain('command could not be checked')
      expect((await $.tool.call({ tool: 'Bash', command: 'rm "/reports/x"' })).deny).toBeUndefined()
    })
    test(`${label}: F6 resolution exception denies`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' }, true, undefined, true)
      expect((await $.tool.call({ tool: 'Bash', command: 'rm /reports/x' })).deny).toContain('command could not be checked')
    })
  }
})

// Last fix round: extending existing operator lists and root placement only.
describe('fix2 rm rail', () => {
  for (const role of ['implementer', 'verifier', 'reviewer', undefined, ''] as const) {
    const label = role === undefined ? 'unset' : role === '' ? 'empty' : role
    test(`${label}: G1 redirect family leaves safe rm operands intact`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      for (const redirect of ['<> /dev/null', '<>/dev/null', '2<> /dev/null', '2<>/dev/null', '&>> log', '&>>log', '<& 0', '<&0', '2<& 0', '2<&0', '>& 1', '>&1', '2>& 1', '2>&1', '<&-', '<& -', '2<&-', '>&-', '>& -', '2>&-']) {
        expect((await $.tool.call({ tool: 'Bash', command: `rm /reports/x ${redirect}` })).deny).toBeUndefined()
        expect((await $.tool.call({ tool: 'Bash', command: `rm /etc/x ${redirect}` })).deny).toBeDefined()
      }
      if (role !== 'reviewer')
        expect((await $.tool.call({ tool: 'Bash', command: 'rm /w/x &>> log' })).deny).toBeUndefined()
    })
    test(`${label}: G2 herestring is not an operand and exposes later rm`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /reports/f <<< x' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /reports/f <<< x\nrm -rf /etc/nginx' })).deny).toBeDefined()
      if (role !== 'reviewer')
        expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /w/f <<< x' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /reports/f <<<x' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'cat <<< x\nrm -rf /etc/nginx' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'cat <<< x' })).deny).toBeUndefined()
    })
    test(`${label}: G3 path-qualified wrappers expose rm`, async ($, on) => {
      world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
      for (const wrapper of ['/usr/bin/sudo', '/usr/bin/env']) {
        expect((await $.tool.call({ tool: 'Bash', command: `${wrapper} rm -rf /etc/x` })).deny).toBeDefined()
        expect((await $.tool.call({ tool: 'Bash', command: `${wrapper} rm -rf /reports/build` })).deny).toBeUndefined()
      }
      if (role !== 'reviewer')
        expect((await $.tool.call({ tool: 'Bash', command: '/usr/bin/sudo rm -rf /w/build' })).deny).toBeUndefined()
    })
  }
  for (const role of ['implementer', 'verifier']) {
    test(`${role}: G4 root worktree allows descendants but denies its own removal`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role }, false, '/')
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /tmp/x' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Write', file_path: '/tmp/x', content: 'x' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Edit', file_path: '/tmp/y', old_string: 'x', new_string: 'y' })).deny).toBeUndefined()
    })
  }
  test('G5 unknown Bash check is named without assuming rm', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    const result = await $.tool.call({ tool: 'Bash', command: 'git commit -m "\u00000\u0000"' })
    expect(result.deny).toContain('Bash command could not be checked')
    expect(result.deny).not.toContain('rm')
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix"' })).deny).toBeUndefined()
  })
})

describe('close-out HOME root expansion', () => {
  for (const operand of ['~', '~/*', '~/x']) {
    test(`HOME=/ denies ${operand} outside /w`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: 'implementer', HOME: '/' })
      expect((await $.tool.call({ tool: 'Bash', command: `rm -rf ${operand}` })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /w/build' })).deny).toBeUndefined()
    })
  }
  test('reviewer HOME subtree remains allowed by SEAT_MODS_ALLOW', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', HOME: '/home/u', SEAT_MODS_ALLOW: '/home/u/scratch' })
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -f ~/scratch/x' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -f ~/x' })).deny).toBeDefined()
  })
})

describe('globstar root protection', () => {
  test('implementer denies globstar beside ordinary glob and quoted literal controls', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /w/**' })).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'shopt -s globstar; rm -rf /w/**' })).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /w/build/*' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: "rm -f '**'" })).deny).toBeUndefined()
  })
  test('reviewer denies allow-root globstar beside ordinary glob and quoted literal controls', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', SEAT_MODS_ALLOW: '/reports' })
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /reports/**' })).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /reports/*' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: "rm -f '/reports/**'" })).deny).toBeUndefined()
  })
})

describe('dot-glob parent protection', () => {
  for (const command of ['rm -f /w/.?/victim', 'rm -rf /w/.*', 'rm -rf .*']) {
    test(`implementer denies ${command} beside literal-dot and ordinary-glob controls`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: 'implementer' }, true, '/w')
      expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeDefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /w/.cache/*' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /w/*.tmp' })).deny).toBeUndefined()
      expect((await $.tool.call({ tool: 'Bash', command: "rm -f '.*'" })).deny).toBeUndefined()
    })
  }
  test('reviewer denies dot-component bracket glob beside safe controls', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', SEAT_MODS_ALLOW: '/reports' })
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /reports/.[a-z]*' })).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /reports/.cache/*' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: "rm -f '/reports/.*'" })).deny).toBeUndefined()
  })
})

// 0.3.1: each new deny has its nearest allowed control in the same test.
describe('reserved heads reach role and commit-file rails (#701)', () => {
  for (const [denied, allowed, rule] of [
    ['if git push --force; then :; fi', 'if git status; then :; fi', 'force-push'],
    ['! git push --force', '! git diff --quiet', 'force-push'],
    ['{ git push --force; }', '{ git log -1; }', 'force-push'],
    ['if true; then git push -f; fi', 'if true; then git status; fi', 'force-push'],
    ['while true; do git merge x; done', 'while read l; do echo "$l"; done', 'no merges'],
    ['! gh pr merge 1', '! gh pr view 1', 'no merges'],
  ]) {
    test(`implementer: ${denied} denied beside safe control`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: 'implementer' })
      expect((await $.tool.call({ tool: 'Bash', command: denied })).deny).toContain(rule)
      expect((await $.tool.call({ tool: 'Bash', command: allowed })).deny).toBeUndefined()
    })
  }
  test('verifier: if commit denied beside if status', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'verifier' })
    expect((await $.tool.call({ tool: 'Bash', command: 'if git commit -m x; then :; fi' })).deny).toContain('no git commit')
    expect((await $.tool.call({ tool: 'Bash', command: 'if git status; then :; fi' })).deny).toBeUndefined()
  })
  test('implementer: if commit file trailer denied beside clean file', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    expect((await $.tool.call({ tool: 'Bash', command: 'if git commit -F /w/msg-trailer.txt; then :; fi' })).deny).toContain('AI trailers')
    expect((await $.tool.call({ tool: 'Bash', command: 'if git commit -F /w/README.md; then :; fi' })).deny).toBeUndefined()
  })
  test('implementer: plain if push allowed beside force push denial', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    expect((await $.tool.call({ tool: 'Bash', command: 'if git push --force; then :; fi' })).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'if git push; then :; fi' })).deny).toBeUndefined()
  })
  test('verifier: plain if push denied beside status', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'verifier' })
    expect((await $.tool.call({ tool: 'Bash', command: 'if git push; then :; fi' })).deny).toContain('no git push')
    expect((await $.tool.call({ tool: 'Bash', command: 'if git status; then :; fi' })).deny).toBeUndefined()
  })
})

describe('rm heredoc input stays out of operands (#702 item 1)', () => {
  for (const input of ['<<EOF\ny\nEOF', '<<-EOF\n\ty\n\tEOF', "<<'EOF'\ny\nEOF"]) {
    for (const gap of [' ', '']) {
      test(`implementer: ${gap === '' ? 'attached' : 'separate'} ${input.split('\n')[0]} inside allowed beside outside denial`, async ($, on) => {
        world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports' })
        expect((await $.tool.call({ tool: 'Bash', command: `rm -i /var/x${gap}${input}` })).deny).toContain('no rm')
        expect((await $.tool.call({ tool: 'Bash', command: `rm -i /reports/x${gap}${input}` })).deny).toBeUndefined()
      })
    }
  }
  test('literal << operand is checked beside its inside spelling', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports' })
    for (const command of ["rm /reports/x '/var/<<EOF'", 'rm /reports/x /var/\\<\\<EOF'])
      expect((await $.tool.call({ tool: 'Bash', command })).deny).toContain('no rm')
    for (const command of ["rm /reports/x '/reports/<<EOF'", 'rm /reports/x /reports/\\<\\<EOF'])
      expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
  })
})
