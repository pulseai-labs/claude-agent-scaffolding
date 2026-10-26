import { describe, test, expect } from 'claude-code/testing'
import { gateAllows, isProgress } from '../hooks/gate'
import { gitSubcommands, gitSubcommandsThatRun } from '../hooks/shell'

// Batch 5 acceptance (#724, #702), molt's half: the re-walk of the shell reader at 4d4a20b5.
//
// molt's gate approves a Bash call past the hard threshold only when it is made of git add and git commit, so a command the
// reader mis-reads as one of those is a read that overflows a nearly full window. Each row of the probe is a command whose
// result the walk recorded at 4d4a20b5. The goal rows (clusters C1, C2a, C2b, C2c, C3, C4) are refused now when a ruled
// command (here: a read, `cat huge.log`) follows or hides in them. Every other row (C5, C6, C7 and the controls) asserts
// the result it had at 4d4a20b5, so a non-goal row that moves is a regression the suite names. Amended rows: 702-B10b
// (`<<E'OF'` with a body line `E`) was refused and is allowed; 724-A7 and 724-A7b (a redirect after the group or the `fi`)
// are allowed (Ruling 8). Each loosening has a control beside it that must still be refused. isProgress is asserted for every
// row at its 4d4a20b5 value: this batch changes the gate, not the progress count.

const gate = (command: string) => gateAllows('Bash', { command })
const progress = (command: string) => isProgress('Bash', { command })

describe('batch 5 walk: a read hidden in the command is refused', () => {
  // [id, command, isProgress]. molt's A11 failed closed at 4d4a20b5 (the false heredoc swallowed nothing the gate approved);
  // it stays refused, and the ruled-command form is the one asserted.
  const REFUSED: Array<[string, string, boolean]> = [
    ['724-A1 backtick (C1)', 'git commit -m `cat huge.log`', true],
    ['724-A2 dq-subst (C1)', 'git commit -m "$(cat huge.log)"', true],
    ['724-A3 opener-tail (C2a)', 'git commit -F - <<EOF; cat huge.log\nmsg\nEOF', true],
    ['724-A9 lone-amp-opener (C2a)', 'git commit -F - <<EOF & cat huge.log\nmsg\nEOF', true],
    ['724-A11 arith-shift (C2b)', 'git add $((1<<c))\ncat huge.log', false],
    ['702-B3 comment-heredoc (C2b)', 'git add f # <<EOF\ncat huge.log', false],
    ['702-B7 ./env (C3)', './env git add f', false],
    ['702-B11 quoted-heredoc-bs (C2c)', "git commit -F - <<'EOF'\ny\\\nEOF\ncat huge.log", true],
  ]
  for (const [id, command, counts] of REFUSED) {
    test(id, () => {
      expect(gate(command)).toBe(false)
      expect(progress(command)).toBe(counts)
    })
  }
  // 702-B7 and its control: a wrapper named by a relative path may be any local program; the system one, named by an
  // absolute path, is still env (pinned in gate.test.ts since 4d4a20b5).
  test('702-B7 control: /usr/bin/env git add f is still allowed', () => {
    expect(gate('/usr/bin/env git add f')).toBe(true)
    expect(gate('./env cat huge.log')).toBe(false)
  })
})

describe('702-B10: a heredoc delimiter spelled with quotes or escapes closes as Bash closes it (C2c)', () => {
  // Ten spellings of the word EOF close on the line EOF, so the read after it runs.
  const CLOSING = ['\\EOF', 'E\\OF', '\\E\\O\\F', '-\\EOF', "E'OF'", 'E"OF"', "'E'OF", '"E"OF', 'E\\O"F"', "\\E'OF'"]
  for (const d of CLOSING) {
    test(`<<${d}`, () => {
      const command = `git commit -F - <<${d}\nmsg\nEOF\ncat huge.log`
      expect(gate(command)).toBe(false)
      expect(progress(command)).toBe(true)
    })
    // The control beside it: the body of the same spelling is text, whatever it names.
    test(`<<${d} body stays text`, () => {
      expect(gate(`git commit -F - <<${d}\ncat huge.log\nEOF`)).toBe(true)
    })
  }

  // The eleventh spelling: Bash reads the delimiter E"O\F" as the word EO\F, which no line EOF closes, so the read after EOF is
  // body text. A correct allow at 4d4a20b5, and it stays one.
  test('E"O\\F" never closes at EOF: the line after it is text', () => {
    const command = 'git commit -F - <<E"O\\F"\nmsg\nEOF\ncat huge.log'
    expect(gate(command)).toBe(true)
    expect(progress(command)).toBe(true)
  })
  // The control: a line that is the word EO\F does close it, and the read after it runs.
  test('E"O\\F" closed by the line EO\\F: the next line is read', () => {
    expect(gate('git commit -F - <<E"O\\F"\nmsg\nEO\\F\ncat huge.log')).toBe(false)
  })

  // 702-B10b, the one false refusal the batch removes: the delimiter E'OF' is EOF, the body line `E` closes nothing, and the
  // read is body text.
  test('702-B10b E\'OF\' early close is allowed', () => {
    const command = "git commit -F - <<E'OF'\nE\ncat huge.log\nEOF"
    expect(gate(command)).toBe(true)
    expect(progress(command)).toBe(true)
  })
  // The control: the same heredoc closed by a real EOF line before the read, which then runs.
  test('702-B10b control: EOF closes it, and the read after it is refused', () => {
    expect(gate("git commit -F - <<E'OF'\nE\nEOF\ncat huge.log")).toBe(false)
    expect(gate("git commit -F - <<E'OF'\nEOF\ncat huge.log")).toBe(false)
  })
})

// The walk's rows for clusters C3 and C4 in molt are an honest `git add`: Bash runs it, and the gate allows what it runs, as
// it allows `git add f`. The refusals these clusters ask for are the ruled siblings, a read behind the same spelling.
describe('batch 5 walk: git add behind a redirection or an escape is read as git add', () => {
  // [id, command, its ruled sibling]. isProgress is false: an add is not a commit.
  const HONEST: Array<[string, string, string]> = [
    ['724-A10 glued redirect (C4)', 'git add f>/dev/null', 'git add f>/dev/null; cat huge.log'],
    // The seat-mods A10 spellings (`>&2`, `&>f`), which the molt probe did not carry (an `&` that belongs to a redirection
    // separates nothing), and one glued to the subcommand itself, which only the glued-redirection cut reads as `add`.
    ['724-A10 glued >&2 (C4)', 'git add f>&2', 'git add f>&2; cat huge.log'],
    ['724-A10 glued &>f (C4)', 'git add f&>/dev/null', 'git add f&>/dev/null; cat huge.log'],
    ['724-A10 glued to the subcommand (C4)', 'git add>/dev/null f', 'git add>/dev/null f; cat huge.log'],
    ['702-B2 named-fd (C3)', '{log}>/tmp/f git add f', '{log}>/tmp/f cat huge.log'],
    ['702-B8 escaped-git (C3)', '\\git add f', '\\cat huge.log'],
  ]
  for (const [id, command, sibling] of HONEST) {
    test(id, () => {
      expect(gitSubcommands(command)).toEqual(['add'])
      expect(gitSubcommandsThatRun(command)).toEqual(['add'])
      expect(gate(command)).toBe(true)
      expect(progress(command)).toBe(false)
    })
    test(`${id}: the ruled sibling is refused`, () => {
      expect(gate(sibling)).toBe(false)
      expect(progress(sibling)).toBe(false)
    })
  }
  test('702-B2 and 702-B8 siblings in one list: a read behind either prefix is refused', () => {
    expect(gate('{log}>/tmp/f git add f; cat huge.log')).toBe(false)
    expect(gate('\\git add f; \\cat huge.log')).toBe(false)
  })
})

// Ruling 8: a redirect after the brace group or the `fi` is not a command, so the group still holds only add and commit.
describe('batch 5 walk: 724-A7 and 724-A7b (C6) are allowed (Ruling 8)', () => {
  test('724-A7 brace-redirect', () => {
    const command = '{ git add f; git commit -m m; } >/tmp/log'
    expect(gate(command)).toBe(true)
    expect(progress(command)).toBe(true)
  })
  test('724-A7b fi-redirect', () => {
    const command = 'if git add f; then git commit -m m; fi 2>/tmp/e'
    expect(gate(command)).toBe(true)
    expect(progress(command)).toBe(false)
  })
  // The controls: a read inside the same group or `if` is refused, redirect or not.
  test('724-A7 and 724-A7b controls: a read inside the group is refused', () => {
    expect(gate('{ git add f; cat huge.log; } >/tmp/log')).toBe(false)
    expect(gate('if git add f; then cat huge.log; fi 2>/tmp/e')).toBe(false)
    expect(gate('{ git add f; git commit -m m; } >/tmp/log; cat huge.log')).toBe(false)
  })
  // And a redirect on the read itself hides nothing: only a segment that is a redirection alone names no command.
  test('724-A7 and 724-A7b controls: a redirect on a read does not hide it', () => {
    expect(gate('git add f; cat huge.log >/tmp/x')).toBe(false)
    expect(gate('{ git add f; cat huge.log >/tmp/x; } >/tmp/log')).toBe(false)
    expect(gate('if git add f; then cat huge.log 2>/tmp/e; fi 2>/tmp/e')).toBe(false)
  })
})

// The rows of clusters the batch leaves alone (non-goals). Each asserts what the walk recorded at 4d4a20b5 for the row.
describe('batch 5 walk: rows the batch does not change keep their 4d4a20b5 result', () => {
  // [id, command, gate, isProgress, gitSubcommands, gitSubcommandsThatRun]
  type Pinned = [string, string, boolean, boolean, Array<string | undefined>, Array<string | undefined>]
  const PINNED: Pinned[] = [
    // C6, grammar not modelled: loops, `case`, `[[`, `((` and `:` are refused on purpose (the hard threshold is for wrapping
    // up), and an `if` around a no-op is refused with them.
    ['724-A4 if-then-colon (C6)', 'if git commit -m m; then :; fi', false, false, ['commit', undefined], []],
    ['724-A4 for (C6)', 'for f in a b; do git add $f; done', false, false, [undefined, undefined, undefined], [undefined, undefined, undefined]],
    ['724-A4 select (C6)', 'select f in a; do git add $f; break; done', false, false, [undefined, undefined, undefined, undefined], [undefined, undefined, undefined, undefined]],
    ['724-A4 case (C6)', 'case x in x) git add f;; esac', false, false, [undefined, 'add', undefined], [undefined, 'add', undefined]],
    ['724-A4 [[ (C6)', '[[ -n x ]] && git add f', false, false, [undefined, 'add'], [undefined, 'add']],
    ['724-A4 (( (C6)', '(( 1 )) && git add f', false, false, [undefined, 'add'], [undefined, 'add']],
    ['724-A4 coproc (C6)', 'coproc git add f', false, false, [undefined], [undefined]],
    ['724-A4 colon (C6)', 'git add f; :', false, false, ['add', undefined], ['add', undefined]],
    // C6, a syntax error: Bash runs nothing, and the gate allows it. Accepted, harmless.
    ['724-A5 unclosed-if (C6)', 'if git add f; git commit -m m', true, true, ['add', 'commit'], ['commit']],
    ['724-A5 stray-fi (C6)', 'git add f; fi; git commit -m m', true, true, ['add', 'commit'], ['add', 'commit']],
    // C7, the progress count reads the string, not control flow: the commit is counted though it does not run (known miscounts).
    ['724-A6 short-circuit (C7)', 'time false && git commit -m m', false, true, [undefined, 'commit'], [undefined, 'commit']],
    ['724-A6b short-circuit plain (C7)', 'false && git commit -m m', false, true, [undefined, 'commit'], [undefined, 'commit']],
    ['724-A8 or-add (C7)', 'git commit -m m || git add f', true, true, ['commit', 'add'], ['commit', 'add']],
    // C5, `&` inside a word: in each row Bash reads the `&` as part of a word and runs no read; the reader splits there and
    // refuses (a known false refusal).
    ['724-A12 backtick-in-${} (C5)', 'git add ${x:-`echo }` & cat huge.log }', false, false, ['add', undefined], ['add', undefined]],
    ['724-A13 assoc-subscript (C5)', 'a[foo&git add f ]=x', false, false, [undefined, 'add'], [undefined, 'add']],
    ['724-A14 extglob (C5)', 'git add @(a&cat huge.log )', false, false, ['add', undefined, undefined], ['add', undefined, undefined]],
    // C6, a function body: defining it runs nothing, and the reader refuses the definition.
    ['702-B6 fn-body (C6)', 'f() { git commit -m m; }', false, false, [undefined, 'commit'], [undefined]],
    // The controls.
    ['control add+commit', 'git add f && git commit -m m', true, true, ['add', 'commit'], ['add', 'commit']],
    ['control cat', 'cat huge.log', false, false, [undefined], [undefined]],
  ]
  for (const [id, command, allowed, counts, subs, run] of PINNED) {
    test(id, () => {
      expect(gate(command)).toBe(allowed)
      expect(progress(command)).toBe(counts)
      expect(gitSubcommands(command)).toEqual(subs)
      expect(gitSubcommandsThatRun(command)).toEqual(run)
    })
  }
})

// The anti-goal of the design: a session at its threshold must still commit its handoff.
describe('batch 5 walk: honest commit forms stay allowed', () => {
  test('the standard commit form, a heredoc inside a substitution', () => {
    const command = "git commit -m \"$(cat <<'EOF'\nfeat: x\n\ncat huge.log is refused.\nEOF\n)\""
    expect(gate(command)).toBe(true)
    expect(progress(command)).toBe(true)
  })
  test('an honest substitution in a commit message', () => {
    expect(gate('git commit -m "release $(date +%F)"')).toBe(true)
  })
  test('plain text in a heredoc body, quoted or not, is not read as commands', () => {
    expect(gate("git commit -F - <<'EOF'\nmsg\nEOF")).toBe(true)
    expect(gate('git commit -F - <<EOF\ncat huge.log\nEOF')).toBe(true)
  })
})

// Final fix wave, I1 (ledger 117): inside a `$(…)` Bash 5.3 also ends a heredoc at a body line that starts with the
// delimiter and holds a `)` after it, and reads the rest of that line as command text. The honest `EOF)` commit form is
// allowed now; a read after it is refused, and the reader sees the git command after it.
describe('batch 5 fix wave: a heredoc in a $(…) closes at a line that starts with its delimiter and holds a `)`', () => {
  test('the honest `EOF)` commit form is allowed', () => {
    expect(gate("git commit -m \"$(cat <<'EOF'\nmsg\nEOF)\"")).toBe(true)
    expect(gate("git add f && git commit -m \"$(cat <<'EOF'\nmsg\nEOF)\"")).toBe(true)
  })
  test('a command after the `EOF)` line is read', () => {
    expect(gitSubcommands("git commit -m \"$(cat <<'EOF'\nmsg\nEOF)\" && git push --force")).toEqual(['commit', 'push'])
    expect(gate("git commit -m \"$(cat <<'EOF'\nmsg\nEOF)\" && git push --force")).toBe(false)
    expect(gitSubcommands("git commit -m \"$(cat <<'EOF'\nmsg\nEOF)\" && rm -rf /etc/x")).toEqual(['commit', undefined])
    expect(gate("git commit -m \"$(cat <<'EOF'\nmsg\nEOF)\" && cat huge.log")).toBe(false)
    // Bash runs the rest of the closing line inside the substitution
    expect(gate("git commit -m \"$(cat <<'EOF'\nmsg\nEOF cat huge.log)\"")).toBe(false)
  })
  test('control: the standard form, and a body line that only starts with the delimiter', () => {
    expect(gate("git commit -m \"$(cat <<'EOF'\nmsg\nEOF\n)\"")).toBe(true)
    expect(gate("git commit -m \"$(cat <<'EOF'\nEOFs are fine\nEOF\n)\"")).toBe(true)
    expect(gate('git commit -F - <<EOF\nEOFs are fine\nEOF')).toBe(true)
    expect(gate('git commit -F - <<EOF\nEOF) && cat huge.log\nEOF')).toBe(true)
  })
})
