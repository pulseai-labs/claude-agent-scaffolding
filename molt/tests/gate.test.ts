import { describe, test, expect } from 'claude-code/testing'
import { gateAllows, takeRequest, waitsIn } from '../hooks/gate'
import type { Request } from '../hooks/gate'
import { gitSubcommands } from '../hooks/shell'
import * as shell from '../hooks/shell'

// The 0.2.3 tag and the round-1 head predate the round-2 exports (the walk sets);
// reading them through a lookup keeps this file loadable there,
// so the rows fail as tests rather than as one file error.
const walked = shell as unknown as {
  HEAD_WORDS?: Set<string>
  CLOSERS?: Set<string>
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
    // the path counts wherever it stands among the wrappers
    expect(gitSubcommands('./env env git add f')).toEqual([undefined])
    expect(gitSubcommands('env ./env git add f')).toEqual([undefined])
    // controls: the bare wrapper, an absolute path to it, a slash in an assignment, and a
    // path-qualified git itself, still read as git
    expect(gitSubcommands('FOO=./x env git add f')).toEqual(['add'])
    expect(bash('env git add f')).toBe(true)
    expect(gitSubcommands('/usr/bin/env git add f')).toEqual(['add'])
    expect(gitSubcommands('/usr/bin/git add f')).toEqual(['add'])
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

// Batch 5, C2 (#724 A3/A9/A11, #702 B3/B10/B10b/B11): heredocs read as Bash reads them.
// Each opener is a commit the gate allows, so only the reading of what follows decides.
describe('batch 5: heredocs', () => {
  const CLOSES = ['\\EOF', 'E\\OF', '\\E\\O\\F', "E'OF'", 'E"OF"', "'E'OF", '"E"OF', 'E\\O"F"', "\\E'OF'"]
  test('C2a: the opener line after the delimiter word runs', () => {
    expect(bash('git commit -F - <<EOF; cat huge.log\nmsg\nEOF')).toBe(false)
    expect(bash('git commit -F - <<EOF & cat huge.log\nmsg\nEOF')).toBe(false)
    // control
    expect(bash('git commit -F - <<EOF; git add f\nmsg\nEOF')).toBe(true)
    expect(bash('git commit -F - <<EOF; git add f\ncat huge.log\nEOF')).toBe(true)
  })
  test('C2b: a << in arithmetic or in a comment opens no heredoc', () => {
    expect(bash('git add $((1<<c))\ncat huge.log')).toBe(false)
    expect(bash('git add f # <<EOF\ncat huge.log')).toBe(false)
    // control: the line after is read, and allowed when it is git add
    expect(bash('git add $((1<<c))\ngit add g')).toBe(true)
    expect(bash('git add f # <<EOF\ngit add g')).toBe(true)
  })
  test('C2c: the delimiter is its word after quote removal', () => {
    for (const d of [...CLOSES, '-\\EOF']) {
      const end = d.startsWith('-') ? '\tEOF' : 'EOF'
      expect(bash(`git commit -F - <<${d}\nmsg\n${end}\ncat huge.log`)).toBe(false)
      expect(bash(`git commit -F - <<${d}\nmsg\n${end}\ngit add f`)).toBe(true)
    }
    expect(bash('git commit -F - 2<<\\EOF\nmsg\nEOF\ncat huge.log')).toBe(false)
    expect(bash('git commit -F - 2<<\\EOF\nmsg\nEOF\ngit add f')).toBe(true)
    // E"O\F" never closes at EOF (Bash's delimiter is EO\F): the cat is message text
    expect(bash('git commit -F - <<E"O\\F"\nmsg\nEOF\ncat huge.log')).toBe(true)
    // B10b: a body line E does not close <<E'OF' early
    expect(bash("git commit -F - <<E'OF'\nE\ncat huge.log\nEOF")).toBe(true)
  })
  test('B11: a quoted body line ending in a backslash is not folded into the closing line', () => {
    expect(bash("git commit -F - <<'EOF'\ny\\\nEOF\ncat huge.log")).toBe(false)
    expect(bash("git commit -F - <<'EOF'\ny\\\nEOF\ngit add f")).toBe(true)
  })
  test('Review Focus 5: two heredocs on one line close in order', () => {
    expect(bash("git commit -F - <<A <<'B'\na\nA\nb\nB\ncat huge.log")).toBe(false)
    expect(bash("git commit -F - <<A <<'B'\na\nA\nb\nB\ngit add f")).toBe(true)
  })
  test('control: the standard commit form stays allowed', () => {
    expect(bash("git commit -m \"$(cat <<'EOF'\nfix: x\n\ncat huge.log and git push are words here\nEOF\n)\"")).toBe(true)
  })
})

// Task 2 review R1: quotes in the text after an unquoted opener, or in a comment, pair as
// in Bash; one left unpaired would pair across the body and hide a read after it.
describe('batch 5: quotes in a heredoc tail or a comment pair as in Bash', () => {
  test('a quote in a # comment pairs with nothing', () => {
    expect(bash("git commit -F - <<'EOF' # don't sign\nmsg\nEOF\ncat 'huge.log'")).toBe(false)
    expect(bash("git add f # don't\ncat 'huge.log'")).toBe(false)
    // control
    expect(bash("git commit -F - <<'EOF' # don't sign\nmsg\nEOF\ngit add 'f'")).toBe(true)
    expect(bash("git commit -F - <<'EOF' # don't sign\ncat 'huge.log'\nEOF")).toBe(true)
    expect(bash("git add f # don't\ngit add 'g'")).toBe(true)
  })
  test('a quoted string in the tail that spans lines ends the opener line after it', () => {
    expect(bash('git commit -F - <<EOF -m "a\nb"\nbody\nEOF\ncat huge.log "x"')).toBe(false)
    // control
    expect(bash('git commit -F - <<EOF -m "a\nb"\nbody\nEOF\ngit add f "x"')).toBe(true)
    expect(bash('git commit -F - <<EOF -m "a\nb"\ncat huge.log "x"\nEOF')).toBe(true)
  })
  test('an escaped quote in the tail opens nothing past the line', () => {
    expect(bash("git commit -F - <<EOF it\\'s\nmsg\nEOF\ncat 'huge.log'")).toBe(false)
    // control
    expect(bash("git commit -F - <<EOF it\\'s\nmsg\nEOF\ngit add 'f'")).toBe(true)
  })
  test('an opener inside "$(…)" keeps its line in the piece', () => {
    expect(bash('git commit -m "$(cat <<EOF | grep "it\'s"\nit\'s\nEOF\n)" && cat \'huge.log\'')).toBe(false)
  })
})

// Task 2 review R2 (Rulings 13, 14): an opener line holding a substitution after the word
// reads as in 0.9.0; `$$` is the PID; a quoted `<<` with no substitution before it is text.
describe('batch 5: an opener line holding a substitution reads as in 0.9.0', () => {
  test('a substitution with an odd inner quote in the tail no longer hides a read', () => {
    expect(bash('git commit -F - <<EOF -m "$(echo "don\'t")"\nmsg\nEOF\ncat \'huge.log\' \'x\'')).toBe(false)
    // control
    expect(bash('git commit -F - <<EOF -m "$(echo "don\'t")"\nmsg\nEOF\ngit add \'f\' \'x\'')).toBe(true)
  })
  test('a quoted body after such a tail is not read as commands', () => {
    expect(bash('git commit -F - <<\'EOF\' --author="$(echo "Bob O\'Neil")"\nfix: x\n\ncat words\nEOF')).toBe(true)
  })
  test('a heredoc opened inside a substitution in the tail does not take the first one\'s place', () => {
    expect(bash('git commit -F - <<A $(cat <<B\nb\nB\n)\na\nA\ncat huge.log')).toBe(false)
    expect(bash('git commit -F - <<A $(cat <<B\nb\nB\n)\na\nA\ngit add f')).toBe(true)
  })
  test('control: a tail without a substitution is still command text', () => {
    expect(bash('git commit -F - <<EOF; cat huge.log\nmsg\nEOF')).toBe(false)
  })
  test('$$ is the PID: the quote after it is a single quote', () => {
    expect(bash("git add $$'a\\' ; cat huge.log ; git add 'b'")).toBe(false)
    expect(bash("git add $$'a\\' ; git add 'b'")).toBe(true)
    expect(bash("git commit -F - <<EOF $$'a\\'\nmsg\nEOF\ncat 'huge.log'")).toBe(false)
    expect(bash("git commit -F - <<EOF $$'a\\'\nmsg\nEOF\ngit add 'f'")).toBe(true)
  })
  test('a quoted << with no substitution before it on its line is text', () => {
    expect(bash('git add "<<EOF" && cat huge.log\ngit add f')).toBe(false)
    expect(bash('git add "<<EOF" && git add g\ngit add f')).toBe(true)
    // control: the commit form keeps its line in the piece, whatever quotes that line holds
    expect(bash("git commit -m \"$(cat <<'EOF' | echo '\"'\nfix: x\n\ncat words\nEOF\n)\"")).toBe(true)
    // C1 (Task 3): the substitution's own commands are read, and `tr` is outside the inner set
    expect(bash("git commit -m \"$(cat <<'EOF' | tr -d '\"'\nfix: x\n\ncat words\nEOF\n)\"")).toBe(false)
  })
})

// Batch 5, C1 (#724 A1, A2): past the hard threshold a substitution runs only what builds the
// handoff's commit message: git add or git commit, cat of its stdin alone (a heredoc is stdin),
// date, printf and echo. Anything else in a `$(…)` or backtick span refuses the call.
describe('batch 5: substitutions', () => {
  // n levels of `$(echo …)` around `inner`, which is itself level n
  const nest = (n: number, inner: string) => 'git commit -m "' + '$(echo '.repeat(n - 1) + '$(' + inner + ')'.repeat(n) + '"'
  test('a read inside a substitution refuses; the commit form and a date stay allowed', () => {
    expect(bash('git commit -m "$(cat huge.log)"')).toBe(false)
    expect(bash('git commit -m `cat huge.log`')).toBe(false)
    expect(bash("git commit -m \"$(cat <<'EOF'\nhandoff\nEOF\n)\"")).toBe(true)
    expect(bash('git commit -m "handoff $(date +%F)"')).toBe(true)
    // a backtick span of several such commands runs; one other command in it refuses
    expect(bash('git commit -m `date +%F; echo handoff`')).toBe(true)
    expect(bash('git commit -m `date +%F; cat huge.log`')).toBe(false)
  })
  test('cat reads only its stdin: `-` or no operand, a heredoc, no input redirection', () => {
    expect(bash("git commit -m \"$(cat - <<'EOF'\nhandoff\nEOF\n)\"")).toBe(true)
    expect(bash("git commit -m \"$(cat<<'EOF'\nhandoff\nEOF\n)\"")).toBe(true)
    expect(bash('git commit -m "$(cat)"')).toBe(true)
    // controls: a file operand, quoted or beside `-`, an input redirection, an option
    expect(bash('git commit -m "$(cat "huge.log")"')).toBe(false)
    expect(bash("git commit -m \"$(cat huge.log - <<'EOF'\nhandoff\nEOF\n)\"")).toBe(false)
    expect(bash('git commit -m "$(cat < huge.log)"')).toBe(false)
    expect(bash('git commit -m "$(cat -n)"')).toBe(false)
  })
  test('date, printf, echo, git add and git commit run; other commands refuse', () => {
    expect(bash("git commit -m \"$(printf 'fix: x\\n\\nbody')\"")).toBe(true)
    expect(bash('git commit -m "$(echo handoff)"')).toBe(true)
    expect(bash('git add "$(echo f)"')).toBe(true)
    // controls
    expect(bash('git commit -m "$(git log -1 --format=%s)"')).toBe(false)
    expect(bash('git commit -m "$(head -1 huge.log)"')).toBe(false)
    expect(bash('git commit -m "$(./env date)"')).toBe(false)
    expect(bash('git commit -m "$(env date)"')).toBe(true)
    // a command word reached by a relative path may be any local program; an absolute one is the program
    expect(bash('git commit -m "$(./date)"')).toBe(false)
    expect(bash('git commit -m "$(bin/echo x)"')).toBe(false)
    expect(bash('git commit -m "$(/bin/date)"')).toBe(true)
  })
  test('nested spans and unquoted heredoc bodies are read; quoted bodies and plain text are not', () => {
    expect(bash('git commit -m "$(echo $(cat huge.log))"')).toBe(false)
    expect(bash('git commit -m "$(echo $(date))"')).toBe(true)
    expect(bash('git commit -F - <<EOF\n$(cat huge.log)\nEOF')).toBe(false)
    expect(bash('git commit -F - <<EOF\n`cat huge.log`\nEOF')).toBe(false)
    expect(bash("git commit -F - <<EOF\nit's $(cat huge.log)\nEOF")).toBe(false)
    // controls
    expect(bash("git commit -F - <<'EOF'\n$(cat huge.log)\nEOF")).toBe(true)
    expect(bash('git commit -F - <<EOF\nplease cat huge.log later\nEOF')).toBe(true)
    expect(bash("git commit -m '$(cat huge.log)'")).toBe(true)
  })
  test('a substitution nested more than 8 deep refuses (Ruling 3)', () => {
    expect(bash('git commit -m "' + '$('.repeat(9) + 'date' + ')'.repeat(9) + '"')).toBe(false)
    expect(bash(nest(9, 'date'))).toBe(false)
    // control: 8 deep is read level by level, and allowed when every level is
    expect(bash(nest(8, 'date'))).toBe(true)
    expect(bash(nest(8, 'cat huge.log'))).toBe(false)
    // far deeper than the walk follows: refused, with no stack overflow (the host allows on a throw)
    expect(bash('git commit -m "' + '$('.repeat(20000) + 'date' + ')'.repeat(20000) + '"')).toBe(false)
  })
  test('inner quotes in a double-quoted $(…) pair inside it, as in Bash', () => {
    expect(bash('git commit -m "$(echo "it\'s")" && cat \'huge.log\'')).toBe(false)
    expect(bash('git commit -m "$(echo "a;b")"')).toBe(true)
    expect(bash('git commit -m "$(echo a # it\'s )\n)"')).toBe(true)
    // controls
    expect(bash('git commit -m "$(echo "a;b")" && cat \'huge.log\'')).toBe(false)
    expect(bash('git commit -m "$(echo a # it\'s )\ncat huge.log)"')).toBe(false)
  })
  test('a span holding a heredoc keeps its opener line before the body (Task 3 review C1)', () => {
    expect(bash("git commit -m `cat <<'EOF' ; cat huge.log\nhandoff\nEOF\n`")).toBe(false)
    expect(bash("git commit -m `cat <<EOF | cat huge.log\nhandoff\nEOF\n`")).toBe(false)
    // control
    expect(bash("git commit -m `cat <<'EOF'\nhandoff\nEOF\n`")).toBe(true)
  })
  test('an opener line kept whole in the 0.9.0 reading is read inside a substitution (Ruling 18b)', () => {
    expect(bash("git commit -m \"$(cat <<'EOF' $(date); cat huge.log\nhandoff\nEOF\n)\"")).toBe(false)
    expect(bash("git commit -m `cat <<'EOF' $(date) ; cat huge.log\nhandoff\nEOF\n`")).toBe(false)
    expect(bash("git commit -m \"$(cat <<'EOF'; echo \"$(date)\"; cat huge.log\nhandoff\nEOF\n)\"")).toBe(false)
    // control: the line runs only what the inner rule allows
    expect(bash("git commit -m \"$(cat <<'EOF'; echo \"$(date)\"\nhandoff\nEOF\n)\"")).toBe(true)
    // the line keeps its command: echo's argument is an argument, head's is a read
    expect(bash("git commit -m \"$(echo <<'EOF' \"$(date)\"\nx\nEOF\n)\"")).toBe(true)
    expect(bash("git commit -m \"$(head <<'EOF' \"$(date)\"\nx\nEOF\n)\"")).toBe(false)
  })
  test('$(<file) is Bash\'s own read of the file (Task 3 review I2)', () => {
    for (const read of ['"$(<huge.log)"', '"$(< huge.log)"', '`<huge.log`', '"$(echo $(<huge.log))"'])
      expect(bash(`git commit -m ${read}`)).toBe(false)
    // control: a redirection that only writes reads nothing
    expect(bash('git commit -m "$(echo handoff 2>/dev/null)"')).toBe(true)
  })
  test('date -f reads a file: refused in each spelling (Ruling 17)', () => {
    for (const read of ['-f huge.log', '-fhuge.log', '--file=huge.log', '--file huge.log', '-uf huge.log', '--fi=huge.log', '"-f" huge.log'])
      expect(bash(`git commit -m "$(date ${read})"`)).toBe(false)
    // controls: date with a format, -u, or a -d value that holds an f
    for (const ok of ['+%F', '-u +%F', '-dfriday +%F', '-d friday'])
      expect(bash(`git commit -m "$(date ${ok})"`)).toBe(true)
  })
  test('an unquoted $(…) is still split by the parentheses, so its command is a segment of its own', () => {
    // as at 0.3.7: the gate reads `date` as a segment, which is not git add or git commit
    expect(bash('git commit -m $(date +%F)')).toBe(false)
    // control: the quoted form is a commit message
    expect(bash('git commit -m "$(date +%F)"')).toBe(true)
  })
})

// The kit runs a plugin's own submit as soon as the hook that made it returns, so it cannot
// leave a request accepted but never run. These pin the two decisions instead (#933).
describe('turn-end requests waiting to run (#933)', () => {
  test("a request waiting in another session does not stop this session's", () => {
    expect(waitsIn([{ sessionId: 's1', text: 'a' }], 's2')).toBe(false)
  })
  test('a request waiting in the same session stops a second one (control)', () => {
    expect(waitsIn([{ sessionId: 's2', text: 'a' }, { sessionId: 's1', text: 'a' }], 's1')).toBe(true)
    expect(waitsIn([], 's1')).toBe(false)
  })
  test("a session's own request is taken first, though a stale one with the same text is older (#936 review)", () => {
    const asked: Request[] = [{ sessionId: 's1', text: 'ask' }, { sessionId: 's2', text: 'ask' }]
    expect(takeRequest(asked, 'ask', 's2')).toEqual({ sessionId: 's2', text: 'ask' })
    expect(asked).toEqual([{ sessionId: 's1', text: 'ask' }])
  })
  test('a stale request that arrives later is still known, so it is dropped, not run as a new prompt', () => {
    const asked: Request[] = [{ sessionId: 's1', text: 'ask' }]
    expect(takeRequest(asked, 'ask', 's2')).toEqual({ sessionId: 's1', text: 'ask' })
    expect(takeRequest(asked, 'ask', 's2')).toBeUndefined()
  })
  test('with no session id, the oldest request with the text is taken', () => {
    const asked: Request[] = [{ sessionId: 's1', text: 'ask' }, { sessionId: 's2', text: 'ask' }]
    expect(takeRequest(asked, 'ask', undefined)).toEqual({ sessionId: 's1', text: 'ask' })
  })
  test('a prompt with other text takes nothing (control)', () => {
    const asked: Request[] = [{ sessionId: 's1', text: 'ask' }]
    expect(takeRequest(asked, 'other', 's1')).toBeUndefined()
    expect(asked).toHaveLength(1)
  })
})
