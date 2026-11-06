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
  // fix r0 B1: a user option inside a cluster (-U is found anywhere; a signal word such as -HUP or -SIGUSR1 is not an option)
  ['pkill -fU 1001', 'pkill -HUP node'],
  ['pkill -9U dev', 'pkill -SIGUSR1 x'],
  ['pkill -eU dev', 'pkill -HUP node'],
  ['pkill -cU dev', 'pkill -c node'],
  ['killall -qU dev', 'killall -q node'],
  // fix r0 B2: eval --, and shell options before or after -c
  ["eval -- 'kill -9 -1'", "eval -- 'kill -9 123'"],
  ["bash -c -- 'kill -9 -1'", "bash -c -- 'kill -9 123'"],
  ["sh -c -e 'kill -9 -1'", "sh -c -e 'kill -9 123'"],
  ["bash -c -- '-x; kill -1'", "bash -c -- '-x; kill 123'"],
  ["bash -c -x -o pipefail 'kill -1'", "bash -c -x -o pipefail 'kill 123'"],
  ["bash -c +O extglob 'kill -1'", "bash -c +O extglob 'kill 123'"],
  ["bash -O extglob -c 'kill -9 -1'", "bash -O extglob -c 'kill -9 123'"],
  ["bash +O extglob -c 'kill -9 -1'", "bash +O extglob -c 'kill -9 123'"],
  ["bash -o pipefail -c 'kill -1'", "bash -o pipefail -c 'kill 123'"],
  // fix r0 B3: time and builtin keep their options for the rail's own wrapper table
  ['time -p kill -1', 'time -p kill 123'],
  ['time -p pkill -u dev', 'time -p pkill node'],
  ['time -f %e kill -9 -1', 'time -f %e kill -9 123'],
  ['builtin -- kill -9 -1', 'builtin -- kill -9 123'],
  // fix r0 N1: other spellings of -1 and 0, and a backtick negative operand
  ['kill -9 -01', 'kill -9 -012'],
  ['kill -- -01', 'kill -- 123'],
  ['kill -9 " -1"', 'kill -9 " 12"'],
  ['kill 00', 'kill 10'],
  ['kill -- -0', 'kill -0 123'],
  ['kill -9 -`cat /tmp/pgid`', 'kill -9 `cat /tmp/pgid`'],
  ['kill -- -"`cat /tmp/pgid`"', 'kill -- "`cat /tmp/pgid`"'],
  // fix r0 N4: an unquoted substitution reads as the pattern `$` (refused); the quoted one is not
  ['pkill $(cat /tmp/name)', 'pkill "$(cat /tmp/name)"'],
  ['killall -r $(cat /tmp/name)', 'killall -r "$(cat /tmp/name)"'],
  // fix r0 N6: pins for the mutants that survived the review
  ["pkill '[[:alpha:]]'", "pkill -x '[[:alpha:]]'"],
  ["pkill -i 'X|S|N|B'", "pkill 'X|S|N|B'"],
  ["$'kill' -1", "$'kill' 123"],
  // fix r1 C1: operands after an unquoted substitution are still operands of the same command
  ['kill -s $(echo KILL) -1', 'kill -s $(echo KILL) 123'],
  ['kill -9 $(cat p) -1', 'kill -9 $(cat p) 123'],
  ['kill 123 $(cat p) 0', 'kill 123 $(cat p) 456'],
  ['kill $(echo 5) -- -1', 'kill $(echo 5) -- 123'],
  ['kill $((1+1)) -1', 'kill $((1+1)) 123'],
  ['xargs kill $(echo 1) -1', 'xargs kill $(echo 1) 123'],
  ['killall foo $(echo) -u dev', 'killall foo $(echo) bar'],
  // fix r1 C2: a cluster that ends in o takes the next word; --rcfile and --init-file take a value
  ["bash -euo pipefail -c 'kill -1'", "bash -euo pipefail -c 'kill 123'"],
  ["bash -eo pipefail -c 'kill -1'", "bash -eo pipefail -c 'kill 123'"],
  ["bash --rcfile /dev/null -c 'kill -1'", "bash --rcfile /dev/null -c 'kill 123'"],
  ["bash --init-file x -c 'kill -1'", "bash --init-file x -c 'kill 123'"],
  ["bash --norc -c 'kill -1'", "bash --norc -c 'kill 123'"],
  ["bash -ec 'kill -1'", "bash -ec 'kill 123'"],
  // 0.14.1 (#1105): `-o1` is not read as a cluster; bash itself rejects it (`-o` takes the next word as an invalid option name), so this refusal is on input bash refuses
  ["bash -c -o1 'kill -1'", "bash -c -o1 'kill 123'"],
  // 0.14.1 (#1105): a short cluster takes one value per o or O it holds, wherever the letter sits, and a cluster holding c sets -c
  ["bash -co pipefail 'kill -1'", "bash -co pipefail 'kill 123'"],
  ["bash -oc pipefail 'kill -1'", "bash -oc pipefail 'kill 123'"],
  ["bash -cO extglob 'kill -1'", "bash -cO extglob 'kill 123'"],
  ["bash -oe pipefail -c 'kill -1'", "bash -oe pipefail -c 'kill 123'"],
  ["bash -Oc extglob 'kill -1'", "bash -Oc extglob 'kill 123'"],
  ["bash -ecO extglob 'kill -1'", "bash -ecO extglob 'kill 123'"],
  ["bash -Oe extglob -c 'kill -1'", "bash -Oe extglob -c 'kill 123'"],
  ["sh -oe pipefail -c 'kill -1'", "sh -oe pipefail -c 'kill 123'"],
  ["bash -oo pipefail errexit -c 'kill -1'", "bash -oo pipefail errexit -c 'kill 123'"],
  // PR 1108 r1: a + cluster holding c is -c in bash, dash and zsh; a non-last o after -c still takes its value
  ["bash +c 'kill -1'", "bash +c 'kill 123'"],
  ["bash +co pipefail 'kill -1'", "bash +co pipefail 'kill 123'"],
  ["bash -x +c 'kill -1'", "bash -x +c 'kill 123'"],
  ["bash -c -oe pipefail 'kill -1'", "bash -c -oe pipefail 'kill 123'"],
  ["bash -c -Oc extglob 'kill -1'", "bash -c -Oc extglob 'kill 123'"],
  // 0.14.2 (#1109): a bare - or + after -c is not the string; the shells run the next word
  ["bash -c - 'kill -1'", "bash -c - 'kill 123'"],
  ["bash -c + 'kill -1'", "bash -c + 'kill 123'"],
  ["sh -c - 'kill -1'", "sh -c - 'kill 123'"],
  ["zsh -c + 'kill -1'", "zsh -c + 'kill 123'"],
  // zsh reads the word before the bare one as the string here, so only bash's reading sees the kill
  ["bash -c -oe pipefail - 'kill -1'", "bash -c -oe pipefail - 'kill 123'"],
  ["bash -c -oe pipefail + 'kill -1'", "bash -c -oe pipefail + 'kill 123'"],
  // 0.14.2 (#1109, #1108 C6): a bare + before a later -c; bash and dash skip it, zsh ends the options
  ["bash -co pipefail + -c 'kill -1'", "bash -co pipefail + -c 'kill 123'"],
  ["bash +c + -c 'kill -1'", "bash +c + -c 'kill 123'"],
  ["bash +c + -ec 'kill -1'", "bash +c + -ec 'kill 123'"],
  ["bash +ec + -c 'kill -1'", "bash +ec + -c 'kill 123'"],
  ["dash +ec + -ec 'kill -1'", "dash +ec + -ec 'kill 123'"],
  // 0.14.2 (#1109, #1108 C7): zsh's -O takes no value
  ["zsh -cO 'kill -1'", "zsh -cO 'kill 123'"],
  ["zsh -Oc 'kill -1'", "zsh -Oc 'kill 123'"],
  ["zsh +cO 'kill -1'", "zsh +cO 'kill 123'"],
  ["zsh -c -O 'kill -1'", "zsh -c -O 'kill 123'"],
  ["zsh -c +O 'kill -1'", "zsh -c +O 'kill 123'"],
  ["sudo -u dev zsh -cO 'kill -1'", "sudo -u dev zsh -cO 'kill 123'"],
  // 0.14.2 (#1109, CodeRabbit on #1108): zsh's o takes the rest of its cluster as the option name
  ["zsh -c -xoshwordsplit 'pkill -u alice'", "zsh -c -xoshwordsplit 'pkill node'"],
  ["zsh -c -oshwordsplit 'kill -1'", "zsh -c -oshwordsplit 'kill 123'"],
  ["zsh -xoshwordsplit -c 'kill -1'", "zsh -xoshwordsplit -c 'kill 123'"],
  ["zsh -coshwordsplit 'kill -1'", "zsh -coshwordsplit 'kill 123'"],
  ["zsh -c -opipefail 'kill -1'", "zsh -c -opipefail 'kill 123'"],
  // 0.14.2 (#1109, ruling 3): two zsh forms the issue does not list; digits are ordinary zsh option letters, and --emulate takes a value
  ["zsh -c1 'kill -1'", "zsh -c1 'kill 123'"],
  ["zsh --emulate sh -c 'kill -1'", "zsh --emulate sh -c 'kill 123'"],
  // 0.14.2 (#1109): zsh's b ends the options after its cluster, so the next word is the string even when it starts with -
  ["zsh -cb '-x; kill -1'", "zsh -cb '-x; kill 123'"],
  // 0.14.2 (#1109): zsh's bare + ends the options (bash skips it), so the next word is the string even when it starts with -
  ["zsh -c + '-x; kill -1'", "zsh -c + '-x; kill 123'"],
  // 0.14.2 round 0 C1: a - that ends a zsh cluster ends the options too (bash, dash and ash reject these)
  ["zsh -c- '-x; kill -1'", "zsh -c- '-x; kill 123'"],
  ["zsh +c- '-x; kill -1'", "zsh +c- '-x; kill 123'"],
  ["zsh -xc- '-x; kill -1'", "zsh -xc- '-x; kill 123'"],
  ["zsh -fc- '-x; kill -1'", "zsh -fc- '-x; kill 123'"],
  ["zsh -c -x- '-y; kill -1'", "zsh -c -x- '-y; kill 123'"],
  ["zsh -c -f- '-y; kill -1'", "zsh -c -f- '-y; kill 123'"],
  ["zsh -c +- '-y; kill -1'", "zsh -c +- '-y; kill 123'"],
  ["sh -c- '-x; kill -1'", "sh -c- '-x; kill 123'"],
  // round 0 C2: the zsh reading is read under every name, not only zsh
  ["sh -cO 'kill -1'", "sh -cO 'kill 123'"],
  ["dash -cO 'kill -1'", "dash -cO 'kill 123'"],
  ["bash -cO 'kill -1'", "bash -cO 'kill 123'"],
  // round 0 C3: a digit before the c is an ordinary zsh option letter too
  ["zsh -1c 'kill -1'", "zsh -1c 'kill 123'"],
  // 0.14.2 (#1109): forms 0.14.1 refused stay refused though the shell runs neither string (a false stop kept so the rail never loosens)
  ["bash - -c 'kill -1'", "bash - -c 'kill 123'"],
  ["zsh + -c 'kill -1'", "zsh + -c 'kill 123'"],
  ["zsh -cO extglob 'kill -1'", "zsh -cO extglob 'kill 123'"],
  ["zsh -c -oe pipefail 'kill -1'", "zsh -c -oe pipefail 'kill 123'"],
  // fix r1 C3: command runs its operand unless it is -v or -V
  ['command pkill -u dev', 'command -v pkill'],
  // fix r1 C6: a clean command after a refused one does not clear the refusal (one row per site)
  ['kill -1; kill 123', 'kill 123; kill 456'],
  ['pkill -u dev; pkill node', 'pkill node; pkill bash'],
  ['killall5; kill 123', 'killall node; kill 123'],
  ['systemctl --user exit; kill 123', 'systemctl --user status x; kill 123'],
  ['loginctl kill-user dev; kill 123', 'loginctl show-user dev; kill 123'],
  // round 2 C9: killall reads every name; env's own -v is skipped
  ["killall node ''", 'killall node bash'],
  ['env -v pkill -u dev', 'env -v pkill node'],
  ["killall --regexp '.*'", "killall --regexp '^herdr'"],
  ["pkill --ignore-case 'X|S|N|B'", "pkill 'X|S|N|B'"],
  ['pkill --signal HUP', 'pkill --signal HUP node'],
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
  // fix r1 C1: words after a substitution are not a command of their own; C2/C3 controls
  'echo $(ps) kill', 'echo $(pgrep x) kill 1', 'echo $(date) kill -1', 'pkill -f foo $(echo x)',
  "bash -- -c 'kill -1'", 'command -v pkill', 'command -V pkill', 'command -pv pkill', 'command -v killall', 'command -v pgrep >/dev/null && kill 123',
  "pkill --exact '[a-z]'",
  // 0.14.1 (#1105): a word that is not an option ends the options before -c, so a script's own -c is not a shell string
  "bash -eo pipefail script.sh -c 'kill -1'", "bash -oe pipefail script.sh -c 'kill -1'",
  // after `--` the next word is the string, even one that looks like a cluster (bash runs it as the command)
  "bash -c -- -x 'kill -1'", "bash -c -- -o 'kill -1'",
  // fix r0 N4: a help or version request names no process
  'pkill --help', 'pkill -V', 'pkill -h', 'killall --version', 'killall -V', 'pkill --version',
  'time -p ls', 'builtin echo hi', 'bash -c -- \'echo hi\'', 'bash -O extglob -c \'echo hi\'',
  // 0.14.2 (#1109): the same shapes with a harmless string; and after a bare - the next word is the string in every shell
  "zsh -cO 'echo hi'", "zsh -cO extglob 'echo hi'", "bash -cO extglob 'echo hi'", "zsh -c -oshwordsplit 'echo hi'",
  "bash -c - -x 'kill -1'", "zsh -c - - 'kill -1'", "zsh -c -- -x 'kill -1'", "zsh -- -c 'kill -1'",
  "zsh -c1 'echo hi'", "zsh --emulate sh -c 'echo hi'", "bash -c + 'echo hi'", "zsh -cb 'echo hi'",
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
  ["env -S 'kill -1'", 'env -S (the value is the command)'],
  ["env --split-string='kill -1'", 'env --split-string'],
  ["flock /tmp/l -c 'kill -1'", 'flock <file> -c'],
  ['coproc kill -1', 'coproc'],
  ['doas kill -1', 'a wrapper not in the list (doas)'],
  ['runuser -u dev kill -1', 'a wrapper not in the list (runuser)'],
  ['unshare kill -1', 'a wrapper not in the list (unshare)'],
  ['pkill -G 100', 'pkill -G'],
  ['pkill --parent 1', 'pkill --parent'],
  ['pkill --session 1', 'pkill --session'],
  ['pkill --group 0', 'pkill --group'],
  ['pkill --pidfile /tmp/p', 'pkill --pidfile'],
  ['pkill -F /tmp/pidfile', 'pkill -F'],
  ['pkill "$(cat /tmp/name)"', 'a pattern held in a quoted substitution'],
  // 0.14.2 (#1109, #1116): shells outside KILL_SHELLS are not read; the grammar of ksh, mksh, yash and fish is unprobed
  ["ksh -c 'kill -1'", 'ksh is not a shell the rail reads'],
  ["mksh -c 'kill -1'", 'mksh is not a shell the rail reads'],
  ["ash -c 'kill -1'", 'ash is not a shell the rail reads'],
  ["busybox sh -c 'kill -1'", 'busybox sh is not a shell the rail reads'],
  ["yash -c 'kill -1'", 'yash is not a shell the rail reads'],
  ["rbash -c 'kill -1'", 'rbash is not a shell the rail reads'],
  ["fish -c 'kill -1'", 'fish is not a shell the rail reads'],
  // round 2 C7, C8, C10
  ['kill 123 $(case x in a) echo 1;; esac) -1', "a case pattern's ) inside $(…) ends the span early"],
  ['kill 123 $(echo ${x:-)}) -1', 'a ) inside ${…} inside $(…) ends the span early'],
  ["pkill node '.*'", "a second pkill operand (procps rejects it; BSD and macOS pkill take several)"],
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

// 0.14.2 (#1109, ruling 2): every shell name is read twice (bash's grammar and zsh's) into one scan. Where the two
// readings pick different words, one listing and the other signaling is refused as "lists and signals", though no
// shell runs both. A deliberate false stop: it can only add a refusal.
describe('killRule: the two readings share one scan (a deliberate false stop)', () => {
  test("bash -cO 'ps aux' 'kill 123': bash's reading signals, zsh's lists, so the call is refused", () => {
    expect(killRule("bash -cO 'ps aux' 'kill 123'")).toContain('lists processes and signals')
  })
  test('control: the same call with an echo in either slot is allowed', () => {
    expect(killRule("bash -cO 'ps aux' 'echo hi'")).toBeUndefined()
    expect(killRule("bash -cO 'echo hi' 'kill 123'")).toBeUndefined()
  })
})

// 0.14.2 (#1109, ruling 1): the rail never approves what 0.14.1 refused. LEGACY is 0.14.1's reader for the words of a
// call, frozen here as the oracle: it returns the index of the word it read as the shell string. The grid is every
// sequence of one to three option words, then two strings, run under each shell name in KILL_SHELLS and with the
// kill in either string or both. Strings only: nothing here runs a command.
const GRID_WORDS = ['-c', '+c', '-cO', '-Oc', '-co', '-coshwordsplit', '-ec', '-e', '-b', '-o', '-oshwordsplit', '-O', '+O', '+ec', '+', 'pipefail', '-', '--']
function legacyIndex(args: readonly string[]): number | undefined {
  let seenC = false
  let dashed = false
  for (let k = 0; k < args.length; k++) {
    const arg = args[k]!
    if (arg === '--rcfile' || arg === '--init-file') { k += 1; continue }
    if (!dashed && /^[-+][A-Za-z]+$/.test(arg)) {
      if (arg.includes('c')) seenC = true
      k += arg.replace(/[^oO]/g, '').length
      continue
    }
    if (!seenC) {
      if (arg === '--' || (!arg.startsWith('-') && !arg.startsWith('+'))) return undefined
      continue
    }
    if (arg === '--' && !dashed) { dashed = true; continue }
    if (!dashed && arg.length > 1 && (arg.startsWith('-') || arg.startsWith('+'))) continue
    return k
  }
  return undefined
}
describe('killRule: the grid of option forms never loosens against the 0.14.1 reader', () => {
  const forms: string[][] = []
  const grow = (prefix: string[]): void => {
    if (prefix.length > 0) forms.push([...prefix, 'S1', 'S2'])
    if (prefix.length < 3) for (const w of GRID_WORDS) grow([...prefix, w])
  }
  grow([])
  test('the grid holds 6174 forms', () => { expect(forms.length).toBe(6174) })
  test('every form 0.14.1 refuses is still refused (0 loosened over 4 names x 3 kill placements)', () => {
    const loosened: string[] = []
    let refusedBefore = 0
    for (const name of ['sh', 'bash', 'zsh', 'dash'])
      for (const form of forms)
        for (const kill of ['S1', 'S2', 'all']) {
          const words = form.map(w => (w === 'S1' || w === 'S2') && (kill === 'all' || kill === w) ? "'kill -1'" : /^S\d$/.test(w) ? `'echo ${w}'` : w)
          const at = legacyIndex(form)
          if (at === undefined || words[at] !== "'kill -1'") continue
          refusedBefore++
          const command = `${name} ${words.join(' ')}`
          if (killRule(command) === undefined) loosened.push(command)
        }
    expect(refusedBefore).toBe(24472)
    expect(loosened).toEqual([])
  })
})

describe('killRule: a ( inside ${…} inside $(…) leaves the span open, so the call is unread (a deliberate false stop)', () => {
  test('echo $(echo ${x:-(}) ; kill 123 throws (a throw is refused as unread by both glues; see the depth-8 glue rows)', () => {
    expect(() => killRule('echo $(echo ${x:-(}) ; kill 123')).toThrow()
  })
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

// fix r0 N2 and N3: what the rail cannot bound it does not read, and a throw is the glues' fail-closed (KILL_UNCHECKED).
describe('killRule: bounds', () => {
  const nest = (depth: number): string => {
    let text = 'kill -9 -1'
    for (let i = 0; i < depth; i++) text = `echo "$(${text})"`
    return text
  }
  test('8 substitutions deep is still read and refused', () => { expect(killRule(nest(8))).toContain('kill rail') })
  test('control: 8 deep and clean is allowed', () => { expect(killRule(nest(8).replace('kill -9 -1', 'kill 123'))).toBeUndefined() })
  test('deeper than 8 substitutions is unread: it throws, so a glue refuses it', () => {
    expect(() => killRule(nest(9))).toThrow()
    expect(() => killRule(nest(9).replace('kill -9 -1', 'kill 123'))).toThrow()
  })
  test('a substitution that never closes is unread: it throws', () => {
    expect(() => killRule('kill 123 $(echo 1')).toThrow()
    expect(() => killRule('kill 123 $((1+1')).toThrow()
  })
  test('the first refusal stands: a later refused command of another kind does not replace its text', () => {
    expect(killRule('kill -1; killall5')).toContain('kill -1')
    expect(killRule('kill -1; killall5')).not.toContain('killall5')
    expect(killRule('kill -1; systemctl --user exit')).not.toContain('systemctl')
    expect(killRule('kill -1; loginctl kill-user dev')).not.toContain('loginctl')
    expect(killRule('killall5; kill -1')).toContain('killall5')
  })
  test('8 nested xargs are read; 9 are unread', () => {
    expect(killRule('ps | ' + 'xargs '.repeat(8) + 'kill 1')).toContain('kill rail')
    expect(() => killRule('ps | ' + 'xargs '.repeat(9) + 'kill 1')).toThrow()
  })
  test('a 30 KB xargs chain finishes under a second', () => {
    const started = performance.now()
    try { killRule('ps | ' + 'xargs '.repeat(5000) + 'kill 1') } catch {}
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
