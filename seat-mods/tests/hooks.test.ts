import { describe, test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { STATUS_CONTEXT, STATUS_WARNING, rewriteReason, IDLE_REASON, IDLE_WARNING } from '../hooks/status'

// The world beneath the plugin. The test kit routes $.fs, $.process and
// $.session.cwd as events the test answers, so this is a small file system:
// a git worktree at /w (the session runs in /w/seat-mods), and three plain
// folders outside it. The test's own tool.call hook stands for the engine: a
// call that reaches it answers `ran`; a denied call resolves with { deny }
// carrying the deny text. A mocked call answers { value }, or { deny } for a
// missing path, as the kit requires.
const DIRS = new Set(['/', '/w', '/w/seat-mods', '/w/seat x', '/etc', '/var', '/reports', '/reports/sub', '/w/build', '/w/seat-mods/sub', '/w/seat-mods/build', '/tmp', '/tmp/wt', '/private', '/private/tmp', '/private/tmp/wt', '/home', '/home/seat', '/home/u', '/home/u/scratch'])
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

// Extra files and a bell for the #873 tests: the autonomic record's text under its path,
// the session id the record is keyed by, and the exit a bell command answers with.
type WorldExtra = { files?: Record<string, string>; sessionId?: string; bellExit?: number; links?: Record<string, string> }

function world(on: On, env: Record<string, string>, gitRepo = true, cwd = '/w/seat-mods', cwdFailure = false, extra: WorldExtra = {}) {
  const runs: string[][] = []
  const bellRuns: string[][] = []
  mock.env(on, env)
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('session.id', () => ({ value: extra.sessionId ?? 's1' }) as never)
  on('session.cwd', () => cwdFailure ? { deny: 'cwd unavailable' } : { value: cwd })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    // The autopilot bell, `sh -c 'AUTONOMIC_MESSAGE="$1"; …'` (#873): its message is the
    // last argument, as molt's world answers it. A bell that exits non-zero resolves.
    if (typeof e.argv[2] === 'string' && e.argv[2].includes('AUTONOMIC_MESSAGE')) {
      bellRuns.push([...e.argv])
      return { value: { exitCode: extra.bellExit ?? 0, stdout: '', stderr: '', isStdoutTruncated: false } } as never
    }
    return { value: e.argv.includes('rev-parse')
      ? (gitRepo
        ? { exitCode: 0, stdout: '/w\n', stderr: '', isStdoutTruncated: false }
        : { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false })
      : { exitCode: 1, stdout: '', stderr: 'unmocked', isStdoutTruncated: false } } as never
  })
  on('fs.stat', (_$, e) => {
    let path = normal(e.path)
    const targets: Record<string, string> = { '/w/outside': '/var', '/w/inside': '/w/build', '/var/inside': '/w/build', ...extra.links }
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
    const text = path === undefined ? undefined : extra.files?.[path] ?? FILES.get(path)
    if (text === undefined) return { deny: `ENOENT: ${e.path}` } as never
    return { value: text } as never
  })
  return { runs, bellRuns }
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
      ['outside glob incident', 'rm -f /var/tmp.*', `rm -f ${inside}/*.o`],
      ['question glob', 'rm -f /var/tmp.?', `rm -f ${inside}/x?.o`],
      ['bracket glob', 'rm -f /var/tmp.[ab]', `rm -f ${inside}/x[ab].o`],
      ['glob in directory', 'rm -rf /w*/build', `rm -f ${inside}/b*/*.o`],
      ['worktree root', 'rm -rf /w', `rm -rf ${inside}/child`],
      ['allow root', 'rm -rf /reports', 'rm -f /reports/x.log'],
      ['ancestor of allow', 'rm -rf /', 'rm -f /reports/x.log'],
      ['ancestor inside worktree', 'rm -rf /w/build', 'rm -f /w/build/reports/x.log'],
      ['parent symlink outside', 'rm -f /w/outside/x', `rm -f ${inside}/x`],
      ['link then dotdot (#781)', 'rm -f /w/outside/../x', inside === '/reports' ? 'rm -f /reports/x.log' : 'rm -f /w/inside/../build/x'],
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
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -f /var/tmp.*', ...extra })).deny).toBeDefined()
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

// Batch 5, Task 4: /tmp and $TMPDIR are writable places for the guarded roles (real baton workers hit six false stops
// on scratch files). A worker may write and remove DESCENDANTS of them; the directory itself and its ancestors stay
// protected from rm, and a path outside every allowed place stays refused. The accepted cost: a worker can remove
// another session's file in /tmp.
describe('scratch directories: /tmp and $TMPDIR (batch 5)', () => {
  const writeDeny = async ($: any, file_path: string) => ($.tool.call({ tool: 'Write', file_path, content: 'x' })).then((r: any) => r.deny)
  const bashDeny = async ($: any, command: string) => ($.tool.call({ tool: 'Bash', command })).then((r: any) => r.deny)
  for (const role of ['implementer', 'verifier', 'reviewer'] as const) {
    test(`${role}: Write and Edit inside /tmp pass; a write outside every allowed place is still refused`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role })
      for (const path of ['/tmp/r3s2w3-redgate.sh', '/tmp/x', '/tmp/new/dir/y']) expect(await writeDeny($, path)).toBeUndefined()
      expect((await $.tool.call({ tool: 'Edit', file_path: '/tmp/x', old_string: 'a', new_string: 'b' })).deny).toBeUndefined()
      // adjacent controls: a path outside, a sibling that shares the prefix, another folder named tmp, and a .. out of /tmp
      for (const path of ['/etc/x', '/tmpfoo/x', '/var/tmp/x', '/tmp/../etc/x', '/tmp/../x'])
        expect(await writeDeny($, path)).toContain('no writes outside')
    })
    test(`${role}: rm of /tmp descendants passes; /tmp itself and its ancestors are refused (Review Focus 3)`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role })
      // rm /tmp/* is the accepted cost: one session can remove another's scratch files
      for (const command of ['rm /tmp/status.py.bak', 'rm -f /tmp/r3s2w3-redgate.sh', 'rm -rf /tmp/x/y', 'rm -rf /tmp/*', 'rm -f /tmp/tmp.*'])
        expect(await bashDeny($, command)).toBeUndefined()
      for (const command of ['rm -rf /tmp', 'rm -rf /tmp/', 'rm -rf /tmp//', 'rm -rf /tmp/.', 'rm -rf /', 'rm -rf /*'])
        expect(await bashDeny($, command)).toContain('roots or ancestors')
      // adjacent controls: outside, a shared prefix, another folder named tmp, a .. out of /tmp, and one operand in a mixed list
      for (const command of ['rm /etc/x', 'rm /tmpfoo/x', 'rm -rf /var/tmp/x', 'rm /tmp/../etc/x', 'rm /tmp/x /etc/x'])
        expect(await bashDeny($, command)).toContain('no rm outside')
    })
    test(`${role}: $TMPDIR is a scratch place too, beside /tmp`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: role, TMPDIR: '/home/u/scratch/' })
      for (const path of ['/home/u/scratch/f', '/home/u/scratch/new/g', '/tmp/f']) expect(await writeDeny($, path)).toBeUndefined()
      for (const command of ['rm /home/u/scratch/f', 'rm -rf /home/u/scratch/*', 'rm /tmp/f']) expect(await bashDeny($, command)).toBeUndefined()
      // its own path and its ancestors are protected like /tmp's
      for (const command of ['rm -rf /home/u/scratch', 'rm -rf /home/u/scratch/', 'rm -rf /home/u', 'rm -rf /home'])
        expect(await bashDeny($, command)).toContain('roots or ancestors')
      // adjacent controls: its sibling and another home
      for (const path of ['/home/u/other', '/home/seat/x', '/etc/x']) expect(await writeDeny($, path)).toContain('no writes outside')
      expect(await bashDeny($, 'rm /home/u/other')).toContain('no rm outside')
    })
    // a TMPDIR that names no directory below the root opens nothing: `/` would put every absolute path inside
    for (const TMPDIR of ['/', '//', 'scratch', '']) {
      test(`${role}: TMPDIR=${JSON.stringify(TMPDIR)} opens nothing beyond /tmp`, async ($, on) => {
        world(on, { SEAT_MODS_ROLE: role, TMPDIR })
        for (const path of ['/etc/x', '/scratch/x', '/var/x']) expect(await writeDeny($, path)).toContain('no writes outside')
        for (const command of ['rm /etc/x', 'rm /scratch/x']) expect(await bashDeny($, command)).toContain('no rm outside')
        expect(await writeDeny($, '/tmp/x')).toBeUndefined()
      })
    }
  }
  test('a symlinked /tmp (macOS: /tmp -> /private/tmp): the resolved path and the given one are both inside (Review Focus 4)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' }, true, '/w/seat-mods', false, { links: { '/tmp': '/private/tmp' } })
    for (const path of ['/private/tmp/x', '/tmp/x', '/private/tmp/new/y']) expect(await writeDeny($, path)).toBeUndefined()
    for (const command of ['rm /private/tmp/x', 'rm /tmp/x', 'rm -rf /private/tmp/*', 'rm -rf /tmp/*']) expect(await bashDeny($, command)).toBeUndefined()
    // the link, its target and the target's parent are the directory's own path and its ancestor: protected
    for (const command of ['rm -rf /private/tmp', 'rm -rf /private/tmp/', 'rm -rf /tmp', 'rm -rf /tmp/', 'rm -rf /private'])
      expect(await bashDeny($, command)).toContain('roots or ancestors')
    // adjacent controls: a sibling under /private, and a path outside
    for (const path of ['/private/etc/x', '/etc/x']) expect(await writeDeny($, path)).toContain('no writes outside')
    expect(await bashDeny($, 'rm /private/etc/x')).toContain('no rm outside')
    // the deny names both spellings, so the worker sees where its scratch files may go
    expect(await writeDeny($, '/etc/x')).toContain('go in /tmp, /private/tmp.')
  })
  test('the deny names the scratch places after the SEAT_MODS_ALLOW ones, each once', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports:/tmp', TMPDIR: '/home/u/scratch' })
    expect(await writeDeny($, '/etc/x')).toContain('go in /reports, /tmp, /home/u/scratch.')
  })
  // placeOf lets an allow directory outrank the worktree, so a /tmp that held the worktree would hand a reviewer its edits
  for (const link of [false, true]) {
    const extra = link ? { links: { '/tmp': '/private/tmp' } } : {}
    test(`a worktree under /tmp${link ? ' (a link to /private/tmp)' : ''}: /tmp adds no place, so the reviewer still cannot edit it`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: 'reviewer' }, false, '/tmp/wt', false, extra)
      expect(await writeDeny($, '/tmp/wt/a.ts')).toContain('no edits in the worktree')
      expect(await bashDeny($, 'rm /tmp/wt/a.ts')).toContain('no rm outside')
      // the seat keeps today's refusals for the rest of /tmp
      expect(await writeDeny($, '/tmp/other')).toContain('no writes outside')
      expect(await bashDeny($, 'rm /tmp/other')).toContain('no rm outside')
    })
    test(`a worktree under /tmp${link ? ' (a link to /private/tmp)' : ''}: the implementer edits it as ever, and /tmp adds no place`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: 'implementer' }, false, '/tmp/wt', false, extra)
      expect(await writeDeny($, '/tmp/wt/a.ts')).toBeUndefined()
      expect(await bashDeny($, 'rm /tmp/wt/a.ts')).toBeUndefined()
      expect(await writeDeny($, '/tmp/other')).toContain('no writes outside')
      expect(await bashDeny($, 'rm -rf /tmp/wt')).toContain('roots or ancestors')
    })
  }
  test('a TMPDIR that does not resolve (a dangling link) is dropped, as given or resolved', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'reviewer', TMPDIR: '/w/link' })
    expect(await writeDeny($, '/w/link/x')).toContain('go in /tmp.')
  })
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

// Fix task 1: /if and /do execute ordinary programs; their argv is not shell syntax.
describe('head-name executable controls', () => {
  for (const role of ['implementer', 'verifier', 'reviewer', undefined, ''] as const) {
    const label = role || 'default'
    for (const prefix of ['/fixtures/if', '/fixtures/do', 'A=1 if', 'env if', 'command if', 'time env if']) {
      for (const payload of ['git push --force', 'gh pr merge 1', 'rm /var/x']) {
        const bare = prefix.endsWith('do') ? `while true; do ${payload}; break; done` : `if ${payload}; then :; fi`
        test(`${label}: ${prefix} ${payload} allowed beside bare denial`, async ($, on) => {
          world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
          expect((await $.tool.call({ tool: 'Bash', command: bare })).deny).toBeDefined()
          expect((await $.tool.call({ tool: 'Bash', command: `${prefix} ${payload}` })).deny).toBeUndefined()
        })
      }
    }
  }
})

// These hook allowances, unlike a plain implementer heredoc, are genuinely red
// on 0.3.0: its bogus operand is unwritable, expands, or follows a same-call cd.
describe('heredoc allowances with real tag denial provenance', () => {
  for (const opener of ['<<EOF', '<<-EOF', "<<'EOF'"]) {
    const ending = opener === '<<-EOF' ? '\tEOF' : 'EOF'
    for (const gap of [' ', '']) {
      for (const [label, role, prefix, body] of [
        ['reviewer unwritable phantom', 'reviewer', '', 'y'],
        ['implementer dollar in input', 'implementer', '', '$CONFIRM'],
        ['implementer earlier cd', 'implementer', 'cd /var; ', 'y'],
      ] as const) {
        // Attached plain inputs already pass on the tag; only add pins with a real RED.
        if (gap === '' && label !== 'implementer dollar in input') continue
        const input = `${opener}\n${body}\n${ending}`
        test(`${label}: ${gap === '' ? 'attached' : 'separate'} ${opener} allowed beside outside deny`, async ($, on) => {
          world(on, { SEAT_MODS_ROLE: role, SEAT_MODS_ALLOW: '/reports' })
          expect((await $.tool.call({ tool: 'Bash', command: `${prefix}rm -i /var/x${gap}${input}` })).deny).toContain('no rm')
          expect((await $.tool.call({ tool: 'Bash', command: `${prefix}rm -i /reports/x${gap}${input}` })).deny).toBeUndefined()
        })
      }
    }
  }
})

// Review round 1: opener-line argv must not vanish with a heredoc piece.
describe('rm heredoc opener boundaries', () => {
  for (const opener of ['<<EOF', "<<'EOF'", '<<-EOF']) {
    for (const operand of ['/etc/passwd', '/reports/x', '/reports/x; rm /etc/passwd']) {
      test(`${opener} followed by ${operand}: opener-line operands beside ordinary input`, async ($, on) => {
        world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports' })
        const result = await $.tool.call({ tool: 'Bash', command: `rm -i ${opener} ${operand}\ny\nEOF` })
        if (operand === '/reports/x') expect(result.deny).toBeUndefined()
        else expect(result.deny).toContain('no rm')
        expect((await $.tool.call({ tool: 'Bash', command: `rm -i /reports/x ${opener}\ny\nEOF` })).deny).toBeUndefined()
        expect((await $.tool.call({ tool: 'Bash', command: `cat ${opener} > /reports/x\ny\nEOF` })).deny).toBeUndefined()
      })
    }
    test(`${opener} on fd 2: inside operand alone beside outside denial`, async ($, on) => {
      world(on, { SEAT_MODS_ROLE: 'reviewer', SEAT_MODS_ALLOW: '/reports' })
      expect((await $.tool.call({ tool: 'Bash', command: `rm -i /var/x 2${opener}\ny\nEOF` })).deny).toContain('no rm')
      expect((await $.tool.call({ tool: 'Bash', command: `rm -i /reports/x 2${opener}\ny\nEOF` })).deny).toBeUndefined()
    })
  }
})

// Last round: restore opener-line words before quotes and redirections are parsed.
describe('heredoc opener line retains rm operands and redirections', () => {
  const insideShapes = [
    'rm -i <<EOF /reports/x',
    'rm -i /reports/x <<EOF > /reports/log',
    'rm -i /reports/x <<EOF 2>/reports/log',
    'rm -i 2<<EOF /reports/x',
    "rm -i <<'EOF' /reports/x",
    "rm -i 2<<'EOF' /reports/x",
    'rm -i <<"EOF" /reports/x',
    'rm -i 2<<"EOF" /reports/x',
    'rm -i <<-EOF /reports/x',
    'rm -i 2<<-EOF /reports/x',
  ]
  for (const role of ['implementer', 'verifier', undefined, '']) {
    for (const shape of insideShapes) {
      test(`${role ?? 'unset'}: ${shape} allowed beside outside operand`, async ($, on) => {
        world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
        const input = shape.includes('<<-') ? '\n\ty\n\tEOF' : '\ny\nEOF'
        expect((await $.tool.call({ tool: 'Bash', command: shape.replace('/reports/x', '/etc/passwd') + input })).deny).toContain('no rm')
        expect((await $.tool.call({ tool: 'Bash', command: shape + input })).deny).toBeUndefined()
      })
    }
  }
  for (const role of ['implementer', 'verifier', 'reviewer', undefined, '']) {
    for (const shape of [
      'rm -i >/reports/log<<EOF /etc/passwd',
      'rm -i </dev/null<<EOF /etc/passwd',
      'rm -i /reports/x >/reports/log<<EOF /etc/passwd',
    ]) {
      test(`${role ?? 'unset'}: ${shape} denied beside inside operand`, async ($, on) => {
        world(on, { ...(role === undefined ? {} : { SEAT_MODS_ROLE: role }), SEAT_MODS_ALLOW: '/reports' })
        expect((await $.tool.call({ tool: 'Bash', command: shape + '\ny\nEOF' })).deny).toContain('no rm')
        expect((await $.tool.call({ tool: 'Bash', command: shape.replace('/etc/passwd', '/reports/y') + '\ny\nEOF' })).deny).toBeUndefined()
        expect((await $.tool.call({ tool: 'Bash', command: "cat <<'EOF' > /reports/log\ny\nEOF" })).deny).toBeUndefined()
      })
    }
  }
})

// A heredoc tail in cat must not contaminate a later rm segment.
test('cat heredoc opener tail leaves a clean rm segment allowed beside outside denial', async ($, on) => {
  world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports' })
  const prefix = 'cat <<EOF foo\ny\nEOF\n'
  expect((await $.tool.call({ tool: 'Bash', command: prefix + 'rm /etc/passwd' })).deny).toContain('no rm')
  expect((await $.tool.call({ tool: 'Bash', command: prefix + 'rm /reports/x' })).deny).toBeUndefined()
})

// #723: the shared split must reach the tool call itself — a command behind a
// lone `&` is denied exactly as bare, and every form the tag allowed stays allowed.
describe('a lone & reaches the hook rails (#723)', () => {
  test('implementer: a force-push behind a lone & is denied, spaced or glued', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    expect((await $.tool.call({ tool: 'Bash', command: 'true & git push origin b' })).deny).toBeUndefined()
    const spaced = await $.tool.call({ tool: 'Bash', command: 'true & git push --force' })
    expect(spaced.deny).toBeDefined()
    expect(spaced.deny).toContain('force-push')
    expect((await $.tool.call({ tool: 'Bash', command: 'true& git push --force' })).deny).toBeDefined()
  })
  test('implementer: a merge behind a lone & is denied beside the plain view', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    expect((await $.tool.call({ tool: 'Bash', command: 'true & gh pr view 12' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'true & gh pr merge 12' })).deny).toContain('no merges')
  })
  test('implementer: a trailer behind a lone & is denied, on the line and in the file', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    expect((await $.tool.call({ tool: 'Bash', command: 'true & git commit -F /w/README.md' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'echo & git commit -m "x\n\nCo-Authored-By: a"' })).deny).toContain('AI trailers')
    expect((await $.tool.call({ tool: 'Bash', command: 'true & git commit -F /w/msg-trailer.txt' })).deny).toContain('AI trailers')
  })
  test('control: redirections, &&, a trailing & and a |& pipe keep the line allowed', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer' })
    for (const command of [
      'git commit -m m 2>&1',
      'git push origin main >&2',
      'git push origin main &>/dev/null',
      'git push origin main <&0',
      'git add f && git commit -m m',
      'git commit -m m &',
      'git push origin main |& cat',
    ])
      expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
  })
  test('implementer: rm behind a lone & keeps its rm rail (control)', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports' })
    expect((await $.tool.call({ tool: 'Bash', command: 'true & rm -rf /var/x' })).deny).toContain('no rm')
    expect((await $.tool.call({ tool: 'Bash', command: 'true & rm -rf /w/build' })).deny).toBeUndefined()
  })
})

// #844: an operand the guard cannot read says how to make it readable; a write outside names the scratch folders.
describe('deny texts point at the way through (#844)', () => {
  test('implementer: rm "$S/x" is told to spell the path out; the literal path in the allow folder runs', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports' })
    const deny = (await $.tool.call({ tool: 'Bash', command: 'rm -rf "$S/shallow"' })).deny
    expect(deny).toContain('no rm with an operand the guard cannot resolve')
    expect(deny).toContain('spell its path out literally')
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /var/x' })).deny).not.toContain('literally')
    expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf /reports/shallow' })).deny).toBeUndefined()
  })
  test('implementer: a Write outside names the SEAT_MODS_ALLOW folder', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports' })
    const deny = (await $.tool.call({ tool: 'Write', file_path: '/var/commit-message.txt', content: 'x' })).deny
    expect(deny).toContain('no writes outside')
    expect(deny).toContain('go in /reports, /tmp.')
  })
})

// The orchestrator status-block check (#867). The engine has no stand-in for
// prompt.submit, classic.Stop or turn.complete in the kit, so each test answers
// them beneath (as world() answers fs and process). `stop` stands in for
// autonomic's push: it answers as the handler beneath the mod, called once per
// stop, and a returned block must pass through unchanged. `complete` replaces
// the beneath turn.complete result (the turn's own text by default). `submit`
// replaces the beneath prompt.submit answer (its text and context by default).
function statusWorld(on: On, env: Record<string, string>, stop?: (e: { last_assistant_message?: string }, call: number) => unknown, complete?: (e: { answer?: string }) => unknown, submit?: (e: { text: string; context?: readonly string[] }, call: number) => unknown, extra: WorldExtra = {}) {
  const w = world(on, env, true, '/w/seat-mods', false, extra)
  let calls = 0
  let submits = 0
  on('prompt.submit', (_$, e) => (submit === undefined ? { text: e.text, context: e.context } : submit(e, ++submits)) as never)
  on('classic.Stop', (_$, e) => (stop === undefined ? {} : stop(e, ++calls)) as never)
  on('turn.complete', (_$, e) => (complete === undefined ? { text: e.answer } : complete(e)) as never)
  return w
}

// The good block of the #867 describe: a stop that names what it waits on, so
// the #876 idle check leaves it alone (its contradiction shape is IDLE_BLOCK).
const STATUS_BLOCK = '**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** b\n**Waiting on (seats live):** reviewer wED:p1 is reviewing\n**Waiting on operator:** none'
const notify = () => ({ text: 'T2 final /r.md', origin: { kind: 'task-notification' as const }, wait: false })

describe('orchestrator status block (#867)', () => {
  test('1. a status turn adds the context line', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    const r = await $.prompt.submit(notify())
    expect(r.context).toContain(STATUS_CONTEXT)
  })

  test('2. an operator turn is free: no line, and its stop is not checked', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    const r = await $.prompt.submit({ text: 'consider slice 1 done', origin: { kind: 'composer' }, wait: false })
    expect(r.context ?? []).not.toContain(STATUS_CONTEXT)
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(s.block).toBeUndefined()
  })

  test('3. one rewrite per status turn, then the warning line', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(first.block).toBe(rewriteReason('Text comes before **What I ruled:**'))
    const second = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(second.block).toBeUndefined()
    const done = await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    // The beneath text is core's own (it repeats e.answer): the warning replaces it.
    expect(done.text).toBe(STATUS_WARNING)
  })

  test('4. a good block passes and adds no warning', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: STATUS_BLOCK })
    expect(s.block).toBeUndefined()
    const done = await $.turn.complete({ answer: STATUS_BLOCK, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(STATUS_BLOCK)
  })

  test('5. the operator typing mid-turn frees the turn (Review Focus 3)', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    await $.prompt.submit({ text: 'what is this?', origin: { kind: 'composer' }, turnId: 't1', wait: false })
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(s.block).toBeUndefined()
  })

  test("6. a beneath block is kept unchanged and is not seat-mods' rewrite (Review Focus 4)", async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' }, (_e, call) => (call === 1 ? { block: 'Autopilot: continue — x.' } : {}))
    await $.prompt.submit(notify())
    const kept = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(kept.block).toBe('Autopilot: continue — x.')
    const rewrite = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(rewrite.block).toBe(rewriteReason('Text comes before **What I ruled:**'))
  })

  test('7. a reply ending MOLT-HANDOFF: is exempt and adds no warning (Review Focus 5)', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    const reply = 'Done.\nMOLT-HANDOFF: /h.md'
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: reply })
    expect(s.block).toBeUndefined()
    const done = await $.turn.complete({ answer: reply, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(reply)
  })

  test('8. other roles are untouched: coordinator', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'coordinator' })
    const r = await $.prompt.submit(notify())
    expect(r.context ?? []).not.toContain(STATUS_CONTEXT)
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })).block).toBeUndefined()
  })

  test('8. other roles are untouched: unset role', async ($, on) => {
    statusWorld(on, {})
    const r = await $.prompt.submit(notify())
    expect(r.context ?? []).not.toContain(STATUS_CONTEXT)
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })).block).toBeUndefined()
  })

  test('9. a later good stop clears the warning line', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' }, (_e, call) => (call === 3 ? { block: 'Autopilot: continue — x.' } : {}))
    await $.prompt.submit(notify())
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })).block).toBe(rewriteReason('Text comes before **What I ruled:**'))
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Still done.' })).block).toBeUndefined()
    expect((await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Done.' })).block).toBe('Autopilot: continue — x.')
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: STATUS_BLOCK })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: STATUS_BLOCK, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(STATUS_BLOCK)
  })

  test('9. the molt exemption clears the warning line too', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' }, (_e, call) => (call === 3 ? { block: 'Autopilot: continue — x.' } : {}))
    await $.prompt.submit(notify())
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })).block).toBe(rewriteReason('Text comes before **What I ruled:**'))
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Still done.' })).block).toBeUndefined()
    expect((await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Done.' })).block).toBe('Autopilot: continue — x.')
    const reply = 'Done.\nMOLT-HANDOFF: /h.md'
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: reply })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: reply, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(reply)
  })

  test('10. a subagent completion is ignored and does not clear the turn', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })).block).toBe(rewriteReason('Text comes before **What I ruled:**'))
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })).block).toBeUndefined()
    const sub = await $.turn.complete({ answer: 'sub', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
    expect(sub.text).toBe('sub')
    const main = await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(main.text).toBe(STATUS_WARNING)
    const after = await $.turn.complete({ answer: 'sub2', durationMs: 1, isAborted: false, turnId: 't3', agentId: 'a1', reason: 'answer' })
    expect(after.text).toBe('sub2')
  })

  test('11. an empty beneath completion keeps only the warning line', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' }, undefined, () => ({ text: '' }))
    await $.prompt.submit(notify())
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    const done = await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(STATUS_WARNING)
  })

  test("12. a beneath text of its own survives, warning last", async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' }, undefined, () => ({ text: 'Beneath says so.' }))
    await $.prompt.submit(notify())
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    const done = await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe('Beneath says so.\n' + STATUS_WARNING)
  })

  test('13. a queued mid-turn prompt (wait: true) takes no context and does not free the status turn', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    const queued = await $.prompt.submit({ text: 'queued for later', origin: { kind: 'composer' }, turnId: 't1', wait: true })
    expect(queued.context ?? []).not.toContain(STATUS_CONTEXT)
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(s.block).toBe(rewriteReason('Text comes before **What I ruled:**'))
  })

  test('14. a dropped takeover prompt leaves the status turn checked', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' }, undefined, undefined, (e, call) => (call === 2 ? { drop: 'refused' } : { text: e.text, context: e.context }))
    await $.prompt.submit(notify())
    const dropped = await $.prompt.submit({ text: 'take it over', origin: { kind: 'composer' }, turnId: 't1', wait: false })
    expect(dropped.drop).toBe('refused')
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(s.block).toBe(rewriteReason('Text comes before **What I ruled:**'))
  })
})

// A valid block whose Next steps names work while both wait fields read none:
// the idle-stop contradiction (#876).
const IDLE_BLOCK = '**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** open the record PR\n**Waiting on (seats live):** none\n**Waiting on operator:** none'

describe('idle stop (#876)', () => {
  test('1. an idle block is nudged once, then the idle warning stands', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })
    expect(first.block).toBe(IDLE_REASON)
    const second = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })
    expect(second.block).toBeUndefined()
    const done = await $.turn.complete({ answer: IDLE_BLOCK, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(IDLE_WARNING)
  })

  test('2. a good non-idle block at the second stop clears the warning', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })
    const good = '**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** open the PR\n**Waiting on (seats live):** reviewer wED:p1 is reviewing\n**Waiting on operator:** none'
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: good })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: good, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(good)
  })

  test('3. the shape miss first, the idle nudge second: one block, the idle warning', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })).block).toBe(rewriteReason('Text comes before **What I ruled:**'))
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: IDLE_BLOCK, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(IDLE_WARNING)
  })

  test('4. the idle nudge first, the shape miss second: no rewrite, the shape warning', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })).block).toBe(IDLE_REASON)
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(STATUS_WARNING)
  })

  test('5. an operator turn ending on an idle block is free', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit({ text: 'consider it done', origin: { kind: 'composer' }, wait: false })
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: IDLE_BLOCK, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(IDLE_BLOCK)
  })

  test('6. a beneath block is not counted; the next stop gets the idle nudge (Review Focus 4)', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' }, (_e, call) => (call === 1 ? { block: 'Autopilot: continue — x.' } : {}))
    await $.prompt.submit(notify())
    const kept = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })
    expect(kept.block).toBe('Autopilot: continue — x.')
    const nudge = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })
    expect(nudge.block).toBe(IDLE_REASON)
  })

  test('7. a handoff reply after an idle nudge adds no warning (Review Focus 5)', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: IDLE_BLOCK })).block).toBe(IDLE_REASON)
    const reply = 'Done.\nMOLT-HANDOFF: /h.md'
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: reply })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: reply, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(reply)
  })

  test('8. a finished-run block (all none) ends the turn with no nudge or warning', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    const finished = '**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** none\n**Waiting on (seats live):** none\n**Waiting on operator:** none'
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: finished })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: finished, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(finished)
  })

  test('9. a field-5 action: wait is not an idle stop (#879)', async ($, on) => {
    statusWorld(on, { SEAT_MODS_ROLE: 'orchestrator' })
    await $.prompt.submit(notify())
    // Field 5 names an action only the operator can take, so the block waits.
    const action = '**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** open the record PR\n**Waiting on (seats live):** none\n**Waiting on operator:** action: start a fresh session'
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: action })).block).toBeUndefined()
    const done = await $.turn.complete({ answer: action, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(action)
  })
})

// The waiting-on-operator signal (#873): in autopilot, a status turn whose block hands the
// operator a decision or an action rings autonomic's bell from the record and shows the line
// in turn.complete. It adds a notification only — it never blocks, answers or approves.
const WAITING = '**What I ruled:** a\n**What the PR(s) will carry:** none\n**Next steps:** b\n**Waiting on (seats live):** none\n**Waiting on operator:** decision: merge #12 now?'
const NOTICE = 'seat-mods: waiting on operator — decision: merge #12 now?'
const RECORD = '/home/u/.claude/state/autonomic/sessions/s1.json'
const AUTOPILOT = { [RECORD]: '{"mode":"autopilot","bell":"notify-me"}' }
const sleep = (globalThis as unknown as { setTimeout: (f: (v?: unknown) => void, ms: number) => unknown }).setTimeout

describe('waiting on the operator rings the bell (#873)', () => {
  const waitingWorld = (on: On, files: Record<string, string> | undefined, bellExit?: number, role = 'orchestrator') =>
    statusWorld(on, { SEAT_MODS_ROLE: role, HOME: '/home/u' }, undefined, undefined, undefined, { files, bellExit })

  test('rings once with the notice when the block passes and reads decision:', async ($, on) => {
    const w = waitingWorld(on, AUTOPILOT)
    await $.prompt.submit(notify())
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: WAITING })
    expect(s.block).toBeUndefined()
    expect(w.bellRuns.length).toBe(1)
    expect(w.bellRuns[0]?.at(-1)).toBe(NOTICE)
    const done = await $.turn.complete({ answer: WAITING, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(`${WAITING}\n${NOTICE}`)
  })

  test('rings when the block is let through after its rewrite', async ($, on) => {
    const w = waitingWorld(on, AUTOPILOT)
    await $.prompt.submit(notify())
    const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
    expect(first.block).toBeDefined()
    expect(w.bellRuns.length).toBe(0)
    // The second stop fails the shape again and is let through; its last labelled line waits.
    const second = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.\nWaiting on operator: decision: merge #12 now?' })
    expect(second.block).toBeUndefined()
    expect(w.bellRuns.length).toBe(1)
    expect(w.bellRuns[0]?.at(-1)).toBe(NOTICE)
    const done = await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(`${STATUS_WARNING}\n${NOTICE}`)
  })

  test('quiet on none', async ($, on) => {
    const w = waitingWorld(on, AUTOPILOT)
    await $.prompt.submit(notify())
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: STATUS_BLOCK })
    expect(s.block).toBeUndefined()
    const done = await $.turn.complete({ answer: STATUS_BLOCK, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(w.bellRuns.length).toBe(0)
    expect(done.text).toBe(STATUS_BLOCK)
  })

  test('quiet in manual mode', async ($, on) => {
    const manual = waitingWorld(on, { [RECORD]: '{"mode":"manual","bell":"notify-me"}' })
    await $.prompt.submit(notify())
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: WAITING })
    const done = await $.turn.complete({ answer: WAITING, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(manual.bellRuns.length).toBe(0)
    expect(done.text).toBe(WAITING)
  })

  test('quiet with no record at all', async ($, on) => {
    const w = waitingWorld(on, undefined)
    await $.prompt.submit(notify())
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: WAITING })
    await $.turn.complete({ answer: WAITING, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(w.bellRuns.length).toBe(0)
  })

  test('quiet on a molt handoff', async ($, on) => {
    const w = waitingWorld(on, AUTOPILOT)
    await $.prompt.submit(notify())
    const handoff = 'Waiting on operator: decision: go?\nMOLT-HANDOFF: /h.md'
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: handoff })).block).toBeUndefined()
    await $.turn.complete({ answer: handoff, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(w.bellRuns.length).toBe(0)
  })

  test('quiet for a non-orchestrator role', async ($, on) => {
    const w = waitingWorld(on, AUTOPILOT, undefined, 'implementer')
    await $.prompt.submit(notify())
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: WAITING })
    await $.turn.complete({ answer: WAITING, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(w.bellRuns.length).toBe(0)
  })

  test('a failing bell does not hold the stop, and the log names the failure', async ($, on) => {
    const w = waitingWorld(on, AUTOPILOT, 3)
    await $.prompt.submit(notify())
    const s = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: WAITING })
    expect(s.block).toBeUndefined()
    const done = await $.turn.complete({ answer: WAITING, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(`${WAITING}\n${NOTICE}`)
    const wait = Promise.withResolvers<void>()
    sleep(wait.resolve, 10)
    await wait.promise
    expect(w.bellRuns.length).toBe(1)
    expect(w.runs.filter(argv => argv.join(' ').includes('bell failed exit=3')).length).toBe(1)
  })
})

// Task 5: rmTargets hands the glue an absolute path after a literal cd or variable; the glue joins no session
// directory to it, and walks its `..` through links as the kernel does (/w/outside is a link to /var).
describe('batch 5: rm after a literal cd or variable', () => {
  test('implementer: the resolved operand is placed where Bash removes it', async ($, on) => {
    world(on, { SEAT_MODS_ROLE: 'implementer', SEAT_MODS_ALLOW: '/reports' })
    const deny = async (command: string) => (await $.tool.call({ tool: 'Bash', command })).deny
    for (const command of ['cd /w/build && rm -f x', 'cd /w/build && rm -f ../x', 'cd /w; cd build && rm -f *.o',
      'S=/reports; rm -rf "$S/shallow"', 'WT=/w; cd "$WT"\nrm -rf build/x', 'cd /w/inside && rm -f ../x'])
      expect(await deny(command)).toBeUndefined()
    for (const command of ['cd /var && rm -f x', 'cd /w/build && rm -f ../../var/x', 'S=/var; rm -rf "$S/x"',
      'cd /w/outside && rm -f x', 'cd /w/outside && rm -f ../x'])
      expect(await deny(command)).toContain('no rm outside writable places')
    expect(await deny('cd /w && rm -rf ..')).toContain('roots or ancestors')
    expect(await deny('cd /w/build || true; rm -f x')).toContain('cannot resolve')
  })
})
