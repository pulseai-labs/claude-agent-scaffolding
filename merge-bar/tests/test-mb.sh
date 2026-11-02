#!/usr/bin/env bash
#
# merge-bar - mb tests (#750)
#
# bin/mb runs against a fake `gh` on PATH that serves recorded output. The recorded files in
# fixtures/gh/ are real `gh` output from pulseai-labs/claude-agent-scaffolding PRs 1028, 1029 and
# 1031 and the repo's rules (read only; sender fields that carry email addresses are deleted
# from the run objects, nothing is added). Merged PRs cannot show a BEHIND head, an unresolved
# thread or a queued run, so those states are the real files with named values changed by the jq
# edit written beside each test: a field is never invented, only its value. The two mutation
# responses (reply, resolve) cannot be recorded without a write; they are written from the
# GraphQL schema as read by introspection.
#
# Usage: bash merge-bar/tests/test-mb.sh

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

MB="$PLUGIN_ROOT/bin/mb"
FIX="$SCRIPT_DIR/fixtures/gh"
FAKE="$SCRIPT_DIR/fixtures/fake-bin"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
HEAD1="$(jq -r .headRefOid "$FIX/pr-1031.view.json")"
OPEN='.state = "OPEN" | .mergeStateStatus = "CLEAN" | .mergeable = "MERGEABLE"'
PENDING='.statusCheckRollup[0] |= (.status = "IN_PROGRESS" | .conclusion = "")'
D=""; OUT=""; ERR=""; RC=0

# scn <name>: a fresh scenario directory holding the real fixtures as the default answers.
scn() {
  D="$T/$1"; mkdir -p "$D"
  cp "$FIX/pr-1031.view.json" "$D/pr.json"
  cp "$FIX/threads-1031.json" "$D/threads.json"
  cp "$FIX/runs-head-1031.json" "$D/runs-head.json"
  cp "$FIX/runs-branch-1031.json" "$D/runs-branch.json"
  cp "$FIX/rules-main.json" "$D/rules.json"
  cp "$FIX/repo-subset.json" "$D/repo.json"
}
# edit <file in $D> <jq filter>: change values in place.
edit() { jq -c "$2" "$D/$1" > "$D/$1.new" && mv "$D/$1.new" "$D/$1"; }
run() { MB_FAKE_DIR="$D" PATH="$FAKE:$PATH" "$MB" "$@" >"$D/out" 2>"$D/err"; RC=$?; OUT="$(cat "$D/out")"; ERR="$(cat "$D/err")"; }
has() { case "$2" in *"$3"*) pass "$1" ;; *) fail "$1" "missing: $3 | got: $2" ;; esac; }
hasnt() { case "$2" in *"$3"*) fail "$1" "unexpected: $3 | got: $2" ;; *) pass "$1" ;; esac; }
rc_is() { [ "$RC" -eq "$2" ] && pass "$1" || fail "$1" "rc=$RC want $2 | out: $OUT | err: $ERR"; }
sleeps_total() { awk '{ s += $1 } END { print s + 0 }' "$D/sleeps" 2>/dev/null || echo 0; }

section "dispatcher"
scn disp
run help
rc_is "help exits 0" 0
has "help names the plugin" "$OUT" "plugin: merge-bar"
run
has "no verb is help" "$OUT" "plugin: merge-bar"
run frobnicate
rc_is "an unknown verb is rc 2" 2
has "an unknown verb is named" "$ERR" "unknown verb 'frobnicate'"
run threads
rc_is "threads without a PR number is rc 2" 2
run threads 12x
rc_is "a non-numeric PR number is rc 2" 2
run threads 1 --nonsense
rc_is "an unknown option is rc 2" 2
[ -x "$MB" ] && pass "bin/mb is executable" || fail "bin/mb is executable"
if grep -nE 'mapfile|readarray|declare -A|\$\{[A-Za-z_]+(,,|\^\^)\}|&>>|\|&' "$MB" >/dev/null; then
  fail "bin/mb avoids bash 4 constructs" "$(grep -nE 'mapfile|readarray|declare -A|&>>|\|&' "$MB" | head -3)"
else pass "bin/mb avoids bash 4 constructs"; fi

section "threads"
scn thr-resolved
run threads 1031
rc_is "real PR 1031, every thread resolved: rc 0" 0
has "...prints the count" "$OUT" "unresolved: 0"
hasnt "...prints no thread" "$OUT" "thread PRRT"
# Edit: flip one of PR 1028's two real threads to unresolved. The other stays resolved (control).
scn thr-open
cp "$FIX/threads-1028.json" "$D/threads.json"
edit threads.json '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved = false'
run threads 1028
rc_is "one unresolved thread: rc 0" 0
has "...names it" "$OUT" "thread $(jq -r '.data.repository.pullRequest.reviewThreads.nodes[0].id' "$D/threads.json")"
has "...with path and author" "$OUT" "@coderabbitai"
has "...counts one" "$OUT" "unresolved: 1"
has "...keeps the finding text" "$OUT" "Add the 1.33.0 changelog entry."
hasnt "...strips HTML comments" "$OUT" "coderabbit-ai-generated"
hasnt "...strips a <details> block with its contents" "$OUT" "Script executed"
hasnt "...strips <picture> tags" "$OUT" "<picture"
hasnt "...strips <summary> tags" "$OUT" "<summary"
# Control: the resolved thread's text is not printed.
hasnt "...does not print the resolved thread" "$OUT" "$(jq -r '.data.repository.pullRequest.reviewThreads.nodes[1].id' "$D/threads.json")"
run threads 1028 --raw
has "--raw keeps the markup" "$OUT" "<details>"
has "--raw keeps the comment marker" "$OUT" "coderabbit-ai-generated"
# Pagination: gh --paginate prints one document per page; both pages count.
scn thr-pages
cp "$FIX/threads-1028.json" "$D/threads.json"
edit threads.json '.data.repository.pullRequest.reviewThreads.nodes[].isResolved = false'
jq -c '.data.repository.pullRequest.reviewThreads.nodes[].id |= . + "x"' "$D/threads.json" > "$D/page2"
cat "$D/page2" >> "$D/threads.json"
run threads 1028
has "two pages: all four threads counted" "$OUT" "unresolved: 4"
scn thr-missing
edit threads.json 'del(.data.repository.pullRequest.reviewThreads.nodes)'
run threads 1031
rc_is "a missing nodes field is rc 2" 2
has "...and says which field" "$ERR" "reviewThreads.nodes"
hasnt "...with nothing on stdout" "$OUT" "unresolved"
scn thr-fail
printf 'gh: Could not resolve to a PullRequest with the number of 9. (repository.pullRequest)\n' > "$D/threads.fail"
run threads 9
rc_is "a PR gh cannot find is rc 2" 2
has "...with gh's message" "$ERR" "Could not resolve"

section "checks"
scn chk-real
run checks 1031
rc_is "real PR 1031: rc 0" 0
has "...lists the passing check" "$OUT" "success  success  repository test suites"
has "...shows the skipped one as skipped" "$OUT" "skipped  neutral  CodeRabbit"
has "...summarises" "$OUT" "summary: success=1 failure=0 pending=0 skipped=1"
has "...lists the run at the head" "$OUT" "41344090802  repository test suites  completed/success"
has "...states no older run holds the queue" "$OUT" "still holding runs:
  none"
# Edit: drop the real success check, leaving only CodeRabbit's neutral one.
scn chk-skipped
edit pr.json 'del(.statusCheckRollup[0])'
run checks 1031
has "skipped-only list: summary shows no success" "$OUT" "summary: success=0 failure=0 pending=0 skipped=1"
# Edit: the run at the head is queued, and an older head's run (a copy of the real second run) is in progress.
scn chk-queued
edit pr.json "$OPEN | $PENDING"
edit runs-head.json '.workflow_runs[0] |= (.status = "queued" | .conclusion = null)'
edit runs-branch.json '.workflow_runs[0] |= (.status = "queued" | .conclusion = null) | .workflow_runs[1] |= (.status = "in_progress" | .conclusion = null)'
run checks 1031
has "queued behind an older head: the head's run is shown queued" "$OUT" "repository test suites  queued"
has "...the older head's run is named" "$OUT" "41344065733  repository test suites  in_progress  head da723f8c40742300710a4a5174e36583bb34b952"
hasnt "...the head's own queued run is not an older one" "$OUT" "41344090802  repository test suites  queued  head"
hasnt "...a cancelled older run is not holding the queue" "$OUT" "41344042211"
scn chk-norun
cp "$FIX/runs-none.json" "$D/runs-head.json"
run checks 1031
has "no run at the head: says none" "$OUT" "workflow runs at head:
  none"
scn chk-missing
edit pr.json 'del(.headRefOid)'
run checks 1031
rc_is "a missing headRefOid is rc 2" 2
has "...names the field" "$ERR" "headRefOid"
scn chk-badcheck
edit pr.json 'del(.statusCheckRollup[0].status)'
run checks 1031
rc_is "a check without status is rc 2" 2

section "rules"
scn rules-real
run rules
rc_is "real rules of main: rc 0" 0
has "...merge methods are the ruleset's, not the repo's squash" "$OUT" "merge methods allowed: merge rebase"
has "...an up-to-date branch is required" "$OUT" "up-to-date branch required: yes"
has "...the required check" "$OUT" "required checks: repository test suites"
has "...threads must be resolved" "$OUT" "threads must be resolved: yes"
has "...names the repository" "$OUT" "rules for pulseai-labs/claude-agent-scaffolding, base main"
# Control: with no ruleset at all, the repository's own switches decide, and nothing is required.
scn rules-none
printf '[]' > "$D/rules.json"
run rules
has "no rules: all three methods the repo allows" "$OUT" "merge methods allowed: merge squash rebase"
has "...nothing required" "$OUT" "required checks: none"
has "...no up-to-date branch" "$OUT" "up-to-date branch required: no"
scn rules-unreadable
rm "$D/rules.json"; cp "$FIX/rules-unreadable.err" "$D/rules.fail"
run rules
rc_is "a token that cannot read rules: rc 2" 2
has "...with gh's message" "$ERR" "Bad credentials"
has "...says what could not be read" "$ERR" "could not read the rules of main"
[ -z "$OUT" ] && pass "...and prints no guess" || fail "...and prints no guess" "$OUT"
scn rules-missing
edit rules.json '(.[] | select(.type == "pull_request") | .parameters) |= del(.allowed_merge_methods)'
run rules
rc_is "a pull_request rule without allowed_merge_methods is rc 2" 2
run rules extra
rc_is "rules takes no PR number" 2

section "blockers"
# Edit: the PR is open and BEHIND.
scn blk-behind
edit pr.json "$OPEN | .mergeStateStatus = \"BEHIND\""
run blockers 1031
rc_is "BEHIND head: rc 0" 0
has "...states it is behind" "$OUT" "blocker: branch is behind main and the base requires an up-to-date branch"
has "...echoes GitHub's status" "$OUT" "state: mergeStateStatus=BEHIND"
# Edit: BLOCKED, with PR 1031's real thread flipped to unresolved.
scn blk-thread
edit pr.json "$OPEN | .mergeStateStatus = \"BLOCKED\""
edit threads.json '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved = false'
run blockers 1031
has "BLOCKED with an unresolved thread: the thread is the reason" "$OUT" "blocker: unresolved thread PRRT_kwDOSMv3ks6yd0XI  tests/test-retired-plugins.sh:43"
hasnt "...so there is no 'unknown'" "$OUT" "unknown:"
has "...one blocker counted" "$OUT" "blockers stated: 1"
# Control: BLOCKED and nothing explains it.
scn blk-unknown
edit pr.json "$OPEN | .mergeStateStatus = \"BLOCKED\""
run blockers 1031
has "BLOCKED with no reason found: says unknown" "$OUT" "unknown: BLOCKED"
has "...and counts none" "$OUT" "blockers stated: 0"
# Edit: BLOCKED, the required check is pending.
scn blk-check
edit pr.json "$OPEN | .mergeStateStatus = \"BLOCKED\" | $PENDING"
run blockers 1031
has "a pending required check is a blocker" "$OUT" "blocker: required check not passed: repository test suites (pending)"
scn blk-clean
edit pr.json "$OPEN"
run blockers 1031
rc_is "clean: rc 0" 0
has "clean: no blocker is not a verdict" "$OUT" "blockers stated: 0 (a list of facts, not a verdict that the PR can merge)"
hasnt "...and never says ready" "$OUT" "ready"
scn blk-norules
edit pr.json "$OPEN | .mergeStateStatus = \"BLOCKED\""
edit threads.json '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved = false'
rm "$D/rules.json"; cp "$FIX/rules-unreadable.err" "$D/rules.fail"
run blockers 1031
rc_is "rules unreadable: blockers still exits 0" 0
has "...adds 'unread: rules'" "$OUT" "unread: rules"
has "...and still prints what it can read" "$OUT" "blocker: unresolved thread"
scn blk-conflict
edit pr.json "$OPEN | .mergeStateStatus = \"DIRTY\" | .mergeable = \"CONFLICTING\""
run blockers 1031
has "a conflict is stated" "$OUT" "blocker: merge conflict with main"
scn blk-draft
edit pr.json "$OPEN | .isDraft = true | .mergeStateStatus = \"DRAFT\""
run blockers 1031
has "a draft is stated" "$OUT" "blocker: draft pull request"
scn blk-missing
edit pr.json 'del(.mergeStateStatus)'
run blockers 1031
rc_is "a missing mergeStateStatus is rc 2" 2

section "wait: outcomes"
# The real fixtures, with the PR made open: a finished run and every check green.
scn w-pass
edit pr.json "$OPEN"
run wait 1031 --head "$HEAD1"
rc_is "run exists and the required check succeeded: rc 0" 0
has "...says why" "$OUT" "result: every required check succeeded"
run wait 1031 --head "${HEAD1:0:9}"
rc_is "a short head prefix is accepted" 0
# The run-exists rule: the same green rollup, but no workflow run for the SHA.
scn w-norun
edit pr.json "$OPEN"
cp "$FIX/runs-none.json" "$D/runs-head.json"
run wait 1031 --head "$HEAD1"
rc_is "no workflow run for the SHA: rc 4, never 0" 4
has "...says it is not a pass" "$OUT" "Not a pass"
has "...and that no run appeared" "$OUT" "no workflow run appeared"
[ -s "$D/sleeps" ] && [ "$(sleeps_total)" -le 120 ] && pass "...after at most the 120s settle" || fail "...after at most the 120s settle" "slept $(sleeps_total)"
# The skipped-check rule: a finished run, a rollup of only CodeRabbit's neutral check, rules unreadable.
scn w-skipped
edit pr.json "$OPEN | del(.statusCheckRollup[0])"
rm "$D/rules.json"; cp "$FIX/rules-unreadable.err" "$D/rules.fail"
run wait 1031 --head "$HEAD1"
rc_is "only skipped checks: rc 4, never 0" 4
has "...says only skipped" "$OUT" "only skipped checks"
has "...notes the unreadable rules" "$OUT" "note: required checks unreadable"
# Control: the real green check beside the skipped one passes under the same unreadable rules.
scn w-skipped-ctl
edit pr.json "$OPEN"
rm "$D/rules.json"; cp "$FIX/rules-unreadable.err" "$D/rules.fail"
run wait 1031 --head "$HEAD1"
rc_is "a success beside a skipped check: rc 0" 0
has "...says non-skipped" "$OUT" "every non-skipped check succeeded"
# Required checks known, but the rollup lacks the required one: skipped-only again, via the required arm.
scn w-skipped-req
edit pr.json "$OPEN | del(.statusCheckRollup[0])"
run wait 1031 --head "$HEAD1"
rc_is "required check never reported, only a skipped one: rc 4" 4
# A check failed.
scn w-fail
edit pr.json "$OPEN | .statusCheckRollup[0] |= (.conclusion = \"FAILURE\")"
run wait 1031 --head "$HEAD1"
rc_is "a required check failed: rc 1" 1
has "...names it" "$OUT" "a required check failed on $HEAD1: repository test suites"
scn w-fail-open
edit pr.json "$OPEN | .statusCheckRollup[1] |= (.conclusion = \"FAILURE\")"
run wait 1031 --head "$HEAD1"
rc_is "control: a non-required check failing beside a green required one: rc 0" 0
scn w-fail-norules
edit pr.json "$OPEN | .statusCheckRollup[0] |= (.conclusion = \"FAILURE\")"
rm "$D/rules.json"; cp "$FIX/rules-unreadable.err" "$D/rules.fail"
run wait 1031 --head "$HEAD1"
rc_is "without rules, any failed check: rc 1" 1
# The head moved between polls.
scn w-moved
edit pr.json "$OPEN"
jq -c "$OPEN | $PENDING" "$FIX/pr-1031.view.json" > "$D/pr.1.json"
jq -c "$OPEN | .headRefOid = \"ffffffffffffffffffffffffffffffffffffffff\"" "$FIX/pr-1031.view.json" > "$D/pr.2.json"
edit runs-head.json '.workflow_runs[0] |= (.status = "in_progress" | .conclusion = null)'
run wait 1031 --head "$HEAD1"
rc_is "the head moved: rc 3" 3
has "...names the new head" "$OUT" "head moved to ffffffffffffffffffffffffffffffffffffffff"
# Control: the head did not move, only the checks did.
scn w-stable
jq -c "$OPEN | $PENDING" "$FIX/pr-1031.view.json" > "$D/pr.1.json"
jq -c "$OPEN" "$FIX/pr-1031.view.json" > "$D/pr.2.json"
run wait 1031 --head "$HEAD1"
rc_is "control: same head, checks finish: rc 0" 0
# A run queued behind an older head, then it runs and passes; one line per change.
scn w-queued
jq -c "$OPEN | $PENDING" "$FIX/pr-1031.view.json" > "$D/pr.1.json"
jq -c "$OPEN" "$FIX/pr-1031.view.json" > "$D/pr.2.json"
jq -c '.workflow_runs[0] |= (.status = "queued" | .conclusion = null)' "$FIX/runs-head-1031.json" > "$D/runs-head.1.json"
run wait 1031 --head "$HEAD1"
rc_is "queued, then passed: rc 0" 0
has "...reports the queued run" "$OUT" "[0s] run repository test suites: queued"
has "...reports the change to success" "$OUT" "[20s] check repository test suites: success"
n="$(printf '%s\n' "$OUT" | awk 'index($0, "check CodeRabbit: skipped") { n++ } END { print n + 0 }')"
[ "$n" -eq 1 ] && pass "...an unchanged check is printed once" || fail "...an unchanged check is printed once" "printed $n times"
scn w-closed
run wait 1031 --head "$HEAD1"
rc_is "a merged PR: rc 2" 2
has "...says so" "$OUT" "is MERGED"

section "wait: bounded"
# A run that never finishes. Every sleep stays inside the limit.
scn w-limit
edit pr.json "$OPEN | $PENDING"
edit runs-head.json '.workflow_runs[0] |= (.status = "in_progress" | .conclusion = null)'
run wait 1031 --head "$HEAD1" --max-seconds 50 --interval 20
rc_is "a run that never ends reaches the limit: rc 75" 75
has "...says run it again" "$OUT" "Run mb wait again"
[ "$(sleeps_total)" -le 50 ] && pass "...total sleep within the 50s limit ($(sleeps_total))" || fail "...total sleep within the limit" "$(sleeps_total)"
[ "$(tr '\n' ' ' < "$D/sleeps")" = "20 20 10 " ] && pass "...the last sleep is cut to what is left" || fail "...the last sleep is cut to what is left" "$(tr '\n' ' ' < "$D/sleeps")"
scn w-default
edit pr.json "$OPEN | $PENDING"
edit runs-head.json '.workflow_runs[0] |= (.status = "in_progress" | .conclusion = null)'
run wait 1031 --head "$HEAD1"
rc_is "default limit: rc 75" 75
[ "$(sleeps_total)" -le 540 ] && [ "$(sleeps_total)" -lt 600 ] && pass "...default sleeps total $(sleeps_total) <= 540, under 600" || fail "...default limit" "$(sleeps_total)"
scn w-args
run wait 1031
rc_is "wait without --head is rc 2" 2
run wait 1031 --head zzzz
rc_is "a non-hex --head is rc 2" 2
run wait 1031 --head "$HEAD1" --max-seconds 0
rc_is "--max-seconds 0 is rc 2" 2
run wait 1031 --head "$HEAD1" --max-seconds abc
rc_is "--max-seconds abc is rc 2" 2
scn w-missing
edit pr.json "$OPEN | del(.headRefOid)"
run wait 1031 --head "$HEAD1"
rc_is "wait: a missing field is rc 2" 2
scn w-runs-missing
edit pr.json "$OPEN"
edit runs-head.json 'del(.workflow_runs)'
run wait 1031 --head "$HEAD1"
rc_is "wait: a runs answer without workflow_runs is rc 2" 2

section "reply and resolve"
scn reply
printf '{"data":{"addPullRequestReviewThreadReply":{"comment":{"id":"PRRC_kwDOexample","url":"https://github.com/o/r/pull/1#discussion_r1"}}}}' > "$D/reply.json"
printf 'Answered - not a bar condition. $(touch /tmp/mb-pwned) `id` "quoted"\nsecond line\n' > "$D/body.md"
run reply PRRT_kwDOexample --body-file "$D/body.md"
rc_is "reply: rc 0" 0
has "...prints the reply id" "$OUT" "reply PRRC_kwDOexample"
[ "$(cat "$D/reply.body")" = "$(cat "$D/body.md")" ] && pass "...the body reached gh from the file, byte for byte" || fail "...the body reached gh from the file"
hasnt "...and never as an argument" "$(cat "$D/gh.log")" "Answered"
[ ! -e /tmp/mb-pwned ] && pass "...shell syntax in the body ran nothing" || fail "...shell syntax in the body ran nothing"
run reply PRRT_kwDOexample
rc_is "reply without --body-file is rc 2" 2
run reply PRRT_kwDOexample "a body as an argument"
rc_is "reply with a body argument is rc 2" 2
: > "$D/empty.md"
run reply PRRT_kwDOexample --body-file "$D/empty.md"
rc_is "reply with an empty body file is rc 2" 2
run reply 'PRRT x;rm' --body-file "$D/body.md"
rc_is "reply with a malformed thread id is rc 2" 2
scn resolve
printf '{"data":{"resolveReviewThread":{"thread":{"id":"PRRT_kwDOexample","isResolved":true}}}}' > "$D/resolve.json"
run resolve PRRT_kwDOexample
rc_is "resolve: rc 0" 0
has "...prints the resolved id" "$OUT" "resolved PRRT_kwDOexample"
printf '{"data":{"resolveReviewThread":{"thread":{"id":"PRRT_kwDOexample","isResolved":false}}}}' > "$D/resolve.json"
run resolve PRRT_kwDOexample
rc_is "resolve answered still-unresolved is rc 2" 2
printf '{"data":{"resolveReviewThread":null}}' > "$D/resolve.json"
run resolve PRRT_kwDOexample
rc_is "resolve answered with no thread is rc 2" 2

report
