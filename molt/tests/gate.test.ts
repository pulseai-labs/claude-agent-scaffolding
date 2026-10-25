import { describe, test, expect } from 'claude-code/testing'
import { gateAllows, isProgress } from '../hooks/gate'
import { gitSubcommands } from '../hooks/shell'
import * as shell from '../hooks/shell'

// The 0.2.3 tag and the round-1 head predate the round-2 exports (the walk sets and
// the run-only reader); reading them through a lookup keeps this file loadable there,
// so the rows fail as tests rather than as one file error.
const walked = shell as unknown as {
  HEAD_WORDS?: Set<string>
  CLOSERS?: Set<string>
  gitSubcommandsThatRun?: (command: string) => Array<string | undefined>
}

const bash = (command: string) => gateAllows('Bash', { command })

describe('gitSubcommands', () => {
  test('one entry per command segment', () => {
    expect(gitSubcommands('git add a && git commit -F m')).toEqual(['add', 'commit'])
    expect(gitSubcommands('git -C /r commit -m x; ls')).toEqual(['commit', undefined])
  })
  test('quoted text and heredoc bodies are not commands', () => {
    expect(gitSubcommands(`git commit -m "fix; cat secrets"`)).toEqual(['commit'])
    expect(gitSubcommands('git commit -F - <<EOF\nrm -rf /\nEOF')).toEqual(['commit'])
  })
})

describe('gateAllows past the hard threshold', () => {
  test('the handoff tools run', () => {
    expect(gateAllows('Write', { file_path: '/r/h.md', content: 'x' })).toBe(true)
    expect(gateAllows('Edit', { file_path: '/r/h.md' })).toBe(true)
    expect(gateAllows('Skill', { skill: 'ossify:handoff' })).toBe(true)
    expect(bash('git add docs/h.md && git commit -F /tmp/m')).toBe(true)
    expect(bash('git -C /r add h.md')).toBe(true)
  })
  test('reads and everything else are refused', () => {
    expect(gateAllows('Read', { file_path: '/r/a' })).toBe(false)
    expect(gateAllows('Grep', { pattern: 'x' })).toBe(false)
    expect(bash('cat huge.log')).toBe(false)
    expect(bash('git log -p')).toBe(false)
  })
  test('a read hidden behind a commit is refused (review focus 5)', () => {
    expect(bash('git add a && cat huge.log')).toBe(false)
    expect(bash('cd docs && git commit -m x')).toBe(false)
    expect(bash('git commit -m x | tee out')).toBe(false)
  })
  test('an empty or missing command is refused', () => {
    expect(bash('')).toBe(false)
    expect(gateAllows('Bash', {})).toBe(false)
  })
})

describe('isProgress', () => {
  test('a file written or a commit made', () => {
    expect(isProgress('Write', { file_path: '/r/a' })).toBe(true)
    expect(isProgress('Edit', { file_path: '/r/a' })).toBe(true)
    expect(isProgress('Bash', { command: 'git add a && git commit -F m' })).toBe(true)
  })
  test('reads and other commands are not progress', () => {
    expect(isProgress('Read', { file_path: '/r/a' })).toBe(false)
    expect(isProgress('Bash', { command: 'git status' })).toBe(false)
    expect(isProgress('Bash', { command: 'echo git commit' })).toBe(false)
  })
})

// Pins for the shared reader changes shipped in molt 0.2.2 / seat-mods 0.3.0.
describe('shared shell reader pins (#702 item 4)', () => {
  test('herestring leaves later commands visible beside inert heredoc text', () => {
    const command = 'git add a <<<EOF\ncat huge.log\nEOF'
    expect(gitSubcommands(command)).toEqual(['add', undefined, undefined])
    expect(bash(command)).toBe(false)
    const heredoc = 'git add a <<EOF\ncat huge.log\nEOF'
    expect(gitSubcommands(heredoc)).toEqual(['add'])
    expect(bash(heredoc)).toBe(true)
  })
  test('path-qualified wrapper matches bare wrapper beside a non-git command', () => {
    expect(gitSubcommands('/usr/bin/env git add h.md')).toEqual(['add'])
    expect(bash('/usr/bin/env git add h.md')).toBe(true)
    expect(gitSubcommands('env git add h.md')).toEqual(['add'])
    expect(bash('env git add h.md')).toBe(true)
    expect(gitSubcommands('/usr/bin/env cat huge.log')).toEqual([undefined])
    expect(bash('/usr/bin/env cat huge.log')).toBe(false)
  })
})

// #711: the reserved head walk. A head-wrapped git add / git commit runs past the
// hard threshold; each acceptance sits beside a case the fix must keep refusing.
describe('reserved head words past the hard threshold (#711)', () => {
  test('if git add f; then git commit -m m; fi is allowed', () => {
    expect(bash('if git add f; then git commit -m m; fi')).toBe(true)
  })
  test('! git commit -m m is allowed', () => {
    expect(bash('! git commit -m m')).toBe(true)
  })
  test('{ git add f; git commit -m m; } is allowed', () => {
    expect(bash('{ git add f; git commit -m m; }')).toBe(true)
  })
  test('a path-qualified or quoted head word is a program, not a head word', () => {
    expect(bash('/x/if git commit -m m')).toBe(false)
    expect(bash('"if" git commit -m m')).toBe(false)
  })
  test('the walk exposes the non-git command it finds, and the gate still refuses it', () => {
    expect(bash('if rm -rf x; then git commit -m m; fi')).toBe(false)
    expect(bash('if git add f; then cat x; fi')).toBe(false)
    expect(bash('then rm -rf x')).toBe(false)
    expect(bash('if git add f; then git commit -m m; fi; cat x')).toBe(false)
  })
  test('builtin is an execution prefix, not a head word (A1 decision)', () => {
    expect(bash('builtin git add f')).toBe(false)
    expect(bash('builtin git commit -m m')).toBe(false)
  })
  test('a closer with arguments is not a bare closer', () => {
    expect(bash('fi git commit -m m')).toBe(false)
    expect(bash('} git commit -m m')).toBe(false)
    expect(bash('fi foo')).toBe(false)
  })
  // Walk rows 724-A7 and 724-A7b were false denies at 4d4a20b5: the closer's redirection made
  // `}` / `fi` a command. The redirection is a shell word now, and Bash runs only add and commit.
  test('a closer with a redirection names no command: the block is allowed (724-A7, 724-A7b)', () => {
    expect(bash('{ git add f; git commit -m m; } >/tmp/log')).toBe(true)
    expect(bash('if git add f; then git commit -m m; fi 2>/tmp/e')).toBe(true)
    // controls: a command after the redirected closer, or an argument to the closer, is still refused
    expect(bash('{ git add f; git commit -m m; } >/tmp/log; cat x')).toBe(false)
    expect(bash('if git add f; then git commit -m m; fi 2>/tmp/e cat x')).toBe(false)
  })
  test('a loop head and its closer are not skipped: the loop stays refused (#711 review R5)', () => {
    expect(bash('while git add f; do git commit -m m; done')).toBe(false)
    expect(bash('until git add f; do git commit -m m; done')).toBe(false)
    expect(bash('do git commit -m m')).toBe(false)
    expect(bash('done git commit -m m')).toBe(false)
  })
  test('a command of only head words or closers names no command: refused (control)', () => {
    expect(bash('fi')).toBe(false)
    expect(bash('!')).toBe(false)
    expect(bash('then')).toBe(false)
    expect(bash('{ }')).toBe(false)
  })
  test('a command of only head words or closers returns no segment, so nothing can be allowed from it', () => {
    expect(gitSubcommands('fi')).toEqual([])
    expect(gitSubcommands('!')).toEqual([])
    expect(gitSubcommands('then')).toEqual([])
    expect(gitSubcommands('{ }')).toEqual([])
  })
  test('a bare git commit -m m is still allowed (control)', () => {
    expect(bash('git commit -m m')).toBe(true)
  })
})

// #711 review R2/RR1: a commit counts as progress only where the line runs it for
// sure — bare, or behind `time`. A commit behind a conditional or negating head may
// not run; a `{ … }` body cannot be told from a function definition's, which runs
// no commit.
describe('isProgress with reserved head words (#711 review R2/RR1)', () => {
  test('a bare commit or one behind time counts', () => {
    expect(isProgress('Bash', { command: 'git commit -m m' })).toBe(true)
    expect(isProgress('Bash', { command: 'time git commit -m m' })).toBe(true)
  })
  test('a commit behind a conditional or negating head does not count', () => {
    expect(isProgress('Bash', { command: 'if git add missing.lock; then git commit -m m; fi' })).toBe(false)
    expect(isProgress('Bash', { command: 'then git commit -m m' })).toBe(false)
    expect(isProgress('Bash', { command: '! git commit -m m' })).toBe(false)
  })
  test('a commit behind { or a function definition does not count (RR1)', () => {
    expect(isProgress('Bash', { command: '{ git commit -m m; }' })).toBe(false)
    expect(isProgress('Bash', { command: '{ time git commit -m m; }' })).toBe(false)
    expect(isProgress('Bash', { command: 'f() { git commit -m m; }' })).toBe(false)
    expect(isProgress('Bash', { command: 'function f { git commit -m m; }' })).toBe(false)
  })
  // Progress at 4d4a20b5 and now alike (724-A7, 724-A7b): the commit of the first stands in its
  // own segment; the second sits behind `then`.
  test('a redirected closer leaves the progress reading as it was', () => {
    expect(isProgress('Bash', { command: '{ git add f; git commit -m m; } >/tmp/log' })).toBe(true)
    expect(isProgress('Bash', { command: 'if git add f; then git commit -m m; fi 2>/tmp/e' })).toBe(false)
  })
  test('the run-only reader sees only a bare commit or one behind time', () => {
    expect(walked.gitSubcommandsThatRun?.('git commit -m m')).toEqual(['commit'])
    expect(walked.gitSubcommandsThatRun?.('time git commit -m m')).toEqual(['commit'])
    expect(walked.gitSubcommandsThatRun?.('{ git commit -m m; }')).toEqual([])
    expect(walked.gitSubcommandsThatRun?.('if git commit -m m')).toEqual([])
    expect(walked.gitSubcommandsThatRun?.('! git commit -m m')).toEqual([])
  })
  test('a path-qualified or builtin-wrapped commit is not progress (control)', () => {
    expect(isProgress('Bash', { command: '/x/if git commit -m m' })).toBe(false)
    expect(isProgress('Bash', { command: 'builtin git commit -m m' })).toBe(false)
  })
  test('a command of only head words or closers is not progress (control)', () => {
    expect(isProgress('Bash', { command: 'fi' })).toBe(false)
    expect(isProgress('Bash', { command: '!' })).toBe(false)
  })
})

// #711 review R1: a lone `&` is Bash's third list separator. Without the split the
// head walk lets `! git commit -m m & evil` and its siblings run `evil` past the
// block; `&&` and the redirections that carry `&` are not boundaries.
describe('a lone & splits commands (#711 review R1)', () => {
  for (const command of [
    'git add f & evil',
    '! git commit -m m & evil',
    '{ git add f & evil; }',
    'if git add f & evil; then git commit -m m; fi',
    'git add f &evil',
    'git add f& evil',
  ]) {
    test(`${command}: refused`, () => {
      expect(bash(command)).toBe(false)
    })
  }
  test('redirections and && keep their meaning; a trailing & on git alone runs only git', () => {
    expect(bash('git commit -m m 2>&1')).toBe(true)
    expect(bash('git commit -m m &>/dev/null')).toBe(true)
    expect(bash('git commit -m m >&2')).toBe(true)
    expect(bash('git add f && git commit -m m')).toBe(true)
    // The only command a trailing `&` runs is the git one it backgrounds — the tag
    // allowed both, and the split must not start refusing them.
    expect(bash('git add f &')).toBe(true)
    expect(bash('git commit -m m &')).toBe(true)
  })
})

// #711 review R4: the walk is deliberately a subset of seat-mods' (loops stay
// refused past the block) and no longer parity-held, so molt pins its own sets.
describe('the walk and closer sets (#711 review R4)', () => {
  test('are exactly the words molt ships', () => {
    expect([...(walked.HEAD_WORDS ?? [])]).toEqual(['if', 'then', 'elif', 'else', '!', '{', 'time'])
    expect([...(walked.CLOSERS ?? [])]).toEqual(['fi', '}'])
  })
})

// Batch 5, C3 and C4 (#702 B7/B8, #724 A10): the command word is read as Bash reads it
// after quote removal; a wrapper reached by a path may be any local program.
describe('batch 5: command word', () => {
  test('an escaped command word is the command it spells', () => {
    expect(bash('\\git add f')).toBe(true)
    expect(gitSubcommands('\\git add f')).toEqual(['add'])
    // controls: the escape does not make a refused command allowed
    expect(bash('\\git push origin main')).toBe(false)
    expect(bash('\\cat huge.log')).toBe(false)
    expect(bash('\\\\git add f')).toBe(false)
    for (const word of ['if', 'then', 'elif', 'else'])
      expect(bash(`\\${word} git commit -m m`)).toBe(false)
    expect(bash('git add f; \\fi')).toBe(false)
    expect(bash('if git add f; then git commit -m m; fi')).toBe(true)
  })
  test('a wrapper reached by a relative path may be any local program: not git', () => {
    expect(bash('./env git add f')).toBe(false)
    expect(gitSubcommands('./env git add f')).toEqual([undefined])
    expect(bash('bin/env git add f')).toBe(false)
    expect(gitSubcommands('bin/env git add f')).toEqual([undefined])
    expect(gitSubcommands('FOO=1 ./sudo git commit -m m')).toEqual([undefined])
    expect(walked.gitSubcommandsThatRun?.('./env git commit -m m')).toEqual([undefined])
    expect(isProgress('Bash', { command: './env git commit -m m' })).toBe(false)
    // the path counts wherever it stands among the wrappers
    expect(gitSubcommands('./env env git add f')).toEqual([undefined])
    expect(gitSubcommands('env ./env git add f')).toEqual([undefined])
    // controls: the bare wrapper, an absolute path to it, a slash in an assignment, and a
    // path-qualified git itself, still read as git
    expect(gitSubcommands('FOO=./x env git add f')).toEqual(['add'])
    expect(bash('env git add f')).toBe(true)
    expect(gitSubcommands('/usr/bin/env git add f')).toEqual(['add'])
    expect(walked.gitSubcommandsThatRun?.('/usr/bin/env git commit -m m')).toEqual(['commit'])
    expect(gitSubcommands('/usr/bin/git add f')).toEqual(['add'])
    expect(walked.gitSubcommandsThatRun?.('env git commit -m m')).toEqual(['commit'])
    expect(isProgress('Bash', { command: 'env git commit -m m' })).toBe(true)
  })
  test('a redirection before the command does not hide it', () => {
    expect(bash('{log}>/tmp/f git add f')).toBe(true)
    expect(gitSubcommands('{log}>/tmp/f git add f')).toEqual(['add'])
    expect(bash('> /tmp/f git add f')).toBe(true)
    expect(bash('< /tmp/f git add f')).toBe(true)
    // controls: what the redirection precedes is still judged
    expect(bash('{log}>/tmp/f cat huge.log')).toBe(false)
    expect(bash('> /tmp/f cat huge.log')).toBe(false)
    expect(bash('{log}>/tmp/f git push origin main')).toBe(false)
  })
  test('a segment of only a redirection names no command; one that names a command is still judged', () => {
    expect(bash('git add f; > out')).toBe(true)
    expect(gitSubcommands('git add f; > out')).toEqual(['add'])
    // control
    expect(bash('git add f; cat out')).toBe(false)
    expect(bash('git add f; > out cat out')).toBe(false)
  })
  test('a redirection glued to the subcommand is cut off it', () => {
    expect(bash('git add f 2>&1')).toBe(true)
    expect(bash('git add>/tmp/log f')).toBe(true)
    expect(gitSubcommands('git commit>/dev/null -m m')).toEqual(['commit'])
    // controls
    expect(bash('git push>/tmp/log origin main')).toBe(false)
    expect(bash('git add f 2>&1; cat huge.log')).toBe(false)
  })
})
