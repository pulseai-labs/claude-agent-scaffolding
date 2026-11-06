import { describe, test, expect } from 'claude-code/testing'
import { killRule } from '../hooks/rules'

// The kill rail (#1099). Strings only: every row is text handed to killRule, and nothing here runs a command.
// Each refuse row has a near-miss control beside it that must stay allowed; each known limit asserts `undefined`
// so a later widening shows up as a changed row.

// [command, near-miss control]
const REFUSE: ReadonlyArray<readonly [string, string]> = [
  // the 2026-11-05 incident, and the listing forms
  ['kill $(ps -eo pid,args 2>/dev/null) 2>/dev/null; true', 'kill $(cat /tmp/job.pid)'],
  ['kill `pgrep -f herdr`', 'kill `cat /tmp/job.pid`'],
  ['kill "$(pgrep -u dev)"', 'kill "$(cat /tmp/job.pid)"'],
  ['kill -9 $(pidof node)', 'kill -9 12345'],
  ["kill $(ls /proc | grep -E '^[0-9]+$')", 'kill $(ls /tmp | head -1)'],
  ['ps -eo pid | xargs kill', 'echo 12345 | xargs kill'],
  ['pgrep -u dev | xargs -r kill -9', "printf '%s\\n' 1 2 | xargs -r kill -9"],
  ["ps aux | awk '{print $2}' | xargs kill", "awk '{print $2}' pids.txt | xargs kill"],
  ['ps -eo pid | xargs -n 1 kill -TERM', 'echo 12345 | xargs -n 1 kill -TERM'],
  ['for p in $(pgrep node); do kill $p; done', 'for p in 11 22; do kill $p; done'],
  ['P=$(pgrep x); kill $P', 'P=$(cat /tmp/job.pid); kill $P'],
  ['echo "$(kill $(pgrep x))"', 'echo "$(kill $(cat /tmp/job.pid))"'],
  // a signal to everything: -1, a negative operand with $, 0
  ['kill -1', 'kill -HUP 123'],
  ['kill -- -1', 'kill -- 123'],
  ['kill -9 -1', 'kill -9 -12'],
  ['kill -TERM -1', 'kill -TERM 123'],
  ['kill -s KILL -1', 'kill -s KILL 123'],
  ['kill -9 -$PGID', 'kill -9 -4242'],
  ['kill -- -"$PGID"', 'kill -- 4242'],
  ['kill -${PGID}', 'kill -9 "$PID"'],
  ['kill -9 -$((1))', 'kill -9 -4241'],
  ['kill 0', 'kill 10'],
  ['kill -- 0', 'kill -0 123'],
  ['kill -9 0', 'kill -s 0 123'],
  // pkill and killall: a user, no pattern, a pattern that matches everything
  ['pkill -u dev', "pkill -f 'herdr agent wait --pane wCH:p1'"],
  ['pkill -u "$USER" node', 'pkill node'],
  ['pkill -U 1000 node', 'pkill -USR2 node'],
  ['pkill -HUP .', 'pkill -HUP node'],
  ['pkill -U $(id -u) node', 'pkill -USR1 node'],
  ['pkill -fu dev node', 'pkill -f node'],
  ['pkill --euid 0 node', 'pkill -HUP node'],
  ['pkill --uid=0 node', 'pkill --full node'],
  ['killall -u dev', 'killall node'],
  ['killall --user dev node', 'killall -s USR1 node'],
  ['pkill .', 'pkill node'],
  ["pkill -f '.*'", "pkill -f 'herdr agent wait'"],
  ["pkill ''", 'pkill -x x'],
  ['pkill "[a-z]"', 'pkill "^herdr"'],
  ["pkill -x '.*'", "pkill -x 'bash -x'"],
  ['pkill -9', 'pkill -9 node'],
  ['pkill', 'pkill node'],
  ["killall -r '.*'", 'killall node'],
  ['killall -r .', 'killall -r "^herdr"'],
  ['killall', 'killall node'],
  // beyond #1099
  ['killall5', 'killall node'],
  ['killall5 -9', 'killall -9 node'],
  ['systemctl --user exit', 'systemctl --user status foo.service'],
  ['systemctl --user stop default.target', 'systemctl --user stop foo.service'],
  ['systemctl stop --user default.target', 'systemctl stop default.service'],
  ['systemctl --user isolate rescue.target', 'systemctl --user restart foo.service'],
  ['systemctl --user kill foo.service', 'systemctl kill foo.service'],
  ['XDG_RUNTIME_DIR=/run/user/1000 systemctl --user exit', 'XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status x'],
  ['loginctl terminate-user dev', 'loginctl show-user dev'],
  ['loginctl kill-user dev', 'loginctl list-users'],
  ['loginctl terminate-session 3', 'loginctl show-session 3'],
  ['loginctl kill-session 3', 'loginctl list-sessions'],
  // how the command word is spelled, and what runs it
  ['/bin/kill -1', '/bin/kill 123'],
  ['command kill -1', 'command kill 123'],
  ['env kill -1', 'env kill 123'],
  ['env -i A=b kill -1', 'env -i A=b kill 123'],
  ['builtin kill -1', 'builtin kill 123'],
  ['exec kill -1', 'exec kill 123'],
  ['nohup kill -1', 'nohup kill 123'],
  ['time kill -1', 'time kill 123'],
  ['\\kill -1', '\\kill 123'],
  ["'kill' -1", "'kill' 123"],
  ['"kill" -1', '"kill" 123'],
  ['k""ill -1', 'k""ill 123'],
  ['timeout 5 kill -9 -1', 'timeout 5 kill -9 123'],
  ['timeout -s KILL 5 kill -1', 'timeout -s KILL 5 kill 123'],
  ['setsid kill -1', 'setsid kill 123'],
  ['nice -n 5 kill -1', 'nice -n 5 kill 123'],
  ['nice -5 kill -1', 'nice -5 kill 123'],
  ['ionice -c3 kill -1', 'ionice -c3 kill 123'],
  ['ionice -c 3 -n 7 kill -1', 'ionice -c 3 -n 7 kill 123'],
  ['stdbuf -oL kill -1', 'stdbuf -oL kill 123'],
  ['chrt 10 kill -1', 'chrt 10 kill 123'],
  ['taskset 1 kill -1', 'taskset 1 kill 123'],
  ['taskset -c 0,1 kill -1', 'taskset -c 0,1 kill 123'],
  ['flock /tmp/l kill -1', 'flock /tmp/l kill 123'],
  ['sudo kill -1', 'sudo kill 123'],
  ['sudo -n kill -1', 'sudo -n kill 123'],
  ['sudo -u dev kill -9 -1', 'sudo -u dev kill -9 123'],
  ['sudo --user=dev kill -1', 'sudo --user=dev kill 123'],
  ['sudo -nu dev kill -1', 'sudo -nu dev kill 123'],
  ['timeout 5 sudo -u dev nice -n 5 kill -1', 'timeout 5 sudo -u dev nice -n 5 kill 123'],
  ['{ kill -1; }', '{ kill 123; }'],
  ['( kill -1 )', '( kill 123 )'],
  ['if true; then kill -1; fi', 'if true; then kill 123; fi'],
  ['true && kill -1', 'true && kill 123'],
  ['kill -1 # note', 'kill 123 # note'],
  ['kill -1 2>/dev/null', 'kill 123 2>/dev/null'],
  ['xargs kill -1', 'xargs kill 123'],
  ['echo 1 | xargs -r -n1 kill -1', 'echo 1 | xargs -r -n1 kill 123'],
  // a literal eval or shell -c string is read once, as a command
  ["eval 'kill $(ps -eo pid)'", "eval 'echo $(ps -eo pid)'"],
  ['eval "kill -1"', 'eval "kill 123"'],
  ['eval kill -1', 'eval echo -1'],
  ["sh -c 'kill $(pgrep x)'", "sh -c 'kill $(cat /tmp/job.pid)'"],
  ['bash -c "kill -1"', 'bash -c "kill 123"'],
  ["zsh -c 'kill -1'", "zsh -c 'kill 123'"],
  ["dash -c 'kill -9 -1'", "dash -c 'kill -9 123'"],
  ["bash -lc 'kill -1'", "bash -lc 'kill 123'"],
  ["/bin/bash -c 'kill -1'", "/bin/bash -c 'kill 123'"],
  ["sudo bash -c 'kill -1'", "sudo bash -c 'kill 123'"],
  ["timeout 9 sh -c 'pkill -u dev'", "timeout 9 sh -c 'pkill node'"],
  ["xargs sh -c 'kill -1'", "xargs sh -c 'kill 123'"],
  // a call that both lists and signals is refused whichever way they are joined (a deliberate false stop)
  ['ps aux; kill 123', 'ps aux; echo 123'],
  ['pgrep -f foo && kill 123', 'pgrep -f foo && echo 123'],
]

// What a seat does legitimately, and text that only mentions kill.
const ALLOW: readonly string[] = [
  'kill %1', 'kill 12345', 'kill -TERM 12345 12346', 'kill -0 12345', 'kill -9 12345', 'kill $!', 'kill "$PID"',
  'kill -s TERM "$PID"', 'kill --signal=$SIG 123', 'kill -s$SIG 123', 'kill -n$N 123',
  "pkill -x '[a-z]'", "killall '.*'", 'killall .', 'pkill -KILL node', 'pkill -SIGHUP node', 'kill -s TERM -- 12345', 'kill -l', 'kill -L',
  'kill $(cat /tmp/job.pid)', 'kill -9 $(cat /tmp/job.pid)',
  "pkill -f 'herdr agent wait --pane wCH:p1'", 'pkill -USR1 myapp', 'pkill -x node', 'pkill bash', 'killall node', 'killall -9 node',
  "echo 'kill $(ps -eo pid)'", 'echo "kill -1"', 'echo kill -1', 'git commit -m "no longer kill -1 on exit"',
  'ps aux | grep node', 'pgrep -f herdr', 'pidof node', 'ls /proc/self', 'ls /tmp',
  "cat <<'EOF'\nkill -1\nEOF", 'printf %s "kill x" > /dev/null',
  'git push origin HEAD', 'systemctl --user status foo.service', 'systemctl stop foo.service', 'loginctl list-sessions',
  'timeout 5 sleep 1', 'nice -n 5 make', 'sudo -u dev ls', 'bash -c "echo hi"', "sh -c 'ls /tmp'", 'eval "echo hi"', 'command -v kill',
  'exec bash', 'xargs echo', 'echo 123 | xargs kill',
]

// Known limits: forms the rail does not read. Each is allowed here, and the README names it. A later
// widening changes one of these rows.
const LIMITS: ReadonlyArray<readonly [string, string]> = [
  ["python3 -c 'import os; os.kill(-1, 9)'", 'an interpreter'],
  ["node -e 'process.kill(-1)'", 'an interpreter'],
  ["perl -e 'kill 9, -1'", 'an interpreter'],
  ['K=kill; $K -1', 'a command word from a variable'],
  ['kill${IFS}-1', 'expansion glue in the command word'],
  ['alias k=kill; k -1', 'an alias'],
  ['k(){ kill "$@"; }; k -1', 'a function'],
  ["bash <<'X'\nkill -1\nX", 'a heredoc fed to a shell'],
  ["printf 'kill -1' > /tmp/s.sh; sh /tmp/s.sh", 'a script written, then run'],
  ['sh /tmp/s.sh', 'a script from an earlier call'],
  ['k\\\nill -1', 'a command word split by a continuation'],
  ["bash -c 'bash -c \"kill -1\"'", 'a shell string inside a shell string (one level only)'],
  ['eval "$CMD"', 'eval of a variable'],
  ['watch -n1 kill -1', 'watch'],
  ['ssh host kill -1', 'ssh'],
  ["su -c 'kill -1'", 'su -c'],
  ['parallel kill ::: 1', 'parallel'],
  ['systemd-run --user kill -1', 'systemd-run'],
  ["find /proc -maxdepth 1 -exec kill {} +", 'find -exec'],
  ['pgrep -u dev > /tmp/p', 'a PID list kept across calls (the listing half)'],
  ['kill -9 $NEG', 'a variable whose value is -1'],
  ['fuser -k /tmp/x', 'fuser -k'],
  ['pkill -s 0', 'pkill -s'],
  ['pkill -g 0', 'pkill -g'],
  ['pkill -P 1', 'pkill -P'],
  ['pkill -t pts/0', 'pkill -t'],
  ['sudo systemctl stop user@1001.service', 'system-scope systemctl stop user@<uid>'],
  ['pkill -v node', 'pkill -v (inverted match)'],
  ['pkill s', 'a pattern the probe set does not all match'],
  ['pkill "$PATTERN"', 'a pattern held in a variable'],
  ['pkill "foo("', 'a pattern that is not a regular expression'],
  ['script -c "kill -1" /dev/null', 'script -c'],
]

describe('killRule: refuse, with a near-miss control beside each row', () => {
  for (const [command, control] of REFUSE) {
    test(`refuses ${JSON.stringify(command)}`, () => {
      const deny = killRule(command)
      expect(deny).toBeDefined()
      expect(deny).toContain('kill rail')
    })
    test(`control: allows ${JSON.stringify(control)}`, () => {
      expect(killRule(control)).toBeUndefined()
    })
  }
})

describe('killRule: what a seat does legitimately stays allowed', () => {
  for (const command of ALLOW) test(`allows ${JSON.stringify(command)}`, () => { expect(killRule(command)).toBeUndefined() })
})

describe('killRule: known limits are not read (each is in the README)', () => {
  for (const [command, why] of LIMITS) test(`${why}: ${JSON.stringify(command)} is allowed`, () => { expect(killRule(command)).toBeUndefined() })
})

describe('killRule: the deny text says what to do instead', () => {
  const text = killRule('kill $(ps -eo pid,args 2>/dev/null) 2>/dev/null; true')!
  test('list first, read the PIDs, kill by literal PID', () => {
    expect(text).toContain('list')
    expect(text).toContain('literal PID')
  })
  test('names the job stop on each host', () => {
    expect(text).toContain('proc://<id>/kill')
    expect(text).toContain('TaskStop')
  })
  test('names the reason in its own words', () => {
    expect(killRule('kill -1')).toContain('-1')
    expect(killRule('pkill -u dev')).toContain('-u')
  })
})
