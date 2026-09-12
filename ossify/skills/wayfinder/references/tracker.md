# Tracker resolution

Depth for `SKILL.md` §1's routing pointer, and the file every other wayfinder
reference cites by section number: §1 the ladder that decides which tracker a
map lives on, and §2 the query both chart and work modes run against it.

A **map** is the parent ticket for one decision — the question wayfinder
exists to resolve. Its **tickets** are the map's sub-issues: the research,
smoke tests, spikes, prototypes, grilling sessions, and plain tasks the
decision needs before it can close.

---

## 1. Which tracker

**Branch 0 runs first — but it runs on the resolved origin, not the
manifest.** Resolve the workspace remote below, then: if that resolution
produced a tracker *and* `.wayfinder.json` exists *and* the two name different
trackers, **stop and ask**. Never resolve it silently — a repo that adopted
ossify after using wayfinder would otherwise switch trackers and orphan every
existing map.

Comparing the *manifest's* stored remote instead is the bug this phrasing
exists to prevent. Branch 1 discovers a workspace through either
`.ossify/topology.json` or `.workspace/pairing.json` and then deliberately
takes the **live** git origin (see below), so a manifest whose stored remote
is stale — or a topology migration that moved the workspace — leaves branch 0
comparing one value while branch 1 selects another. `.wayfinder.json` would
then point at the old tracker, branch 0 would see no conflict, and branch 1
would silently switch: exactly the orphaning this stop exists to catch, reached
through the check meant to prevent it.

1. The AI workspace is discoverable — `.ossify/topology.json` or
   `.workspace/pairing.json`, by walking up from `$PWD` — **and that workspace
   repo has an `origin` remote** → the tracker is that remote. Maps are process
   records, so they go to the workspace and never to a canonical; no manifest
   key records this.
2. Branch 1 declined, `.wayfinder.json` present → use it.
3. Branch 1 declined, no `.wayfinder.json` → ask once, then write it.
4. Chosen tracker unreachable → **stop**, naming which probe failed and
   what would restore it.

**Branch 1 needs the remote, not just the workspace.** A discoverable
workspace with no `origin` declines to branch 2 — `workspace-init` writes
`git_remote: null` by default, and its own default-case test asserts exactly
that (`workspace-init/tests/test-manifest.sh:372`), so a freshly initialised
workspace has no remote as its **normal** state rather than as a failure.
Branching on discoverability alone would hand the reachability guard below an
empty `$OWNER_REPO` and stop wayfinder outright on every new workspace, while
reporting a resolution bug — which is why branches 2 and 3 key off "branch 1
declined" and not off "no manifest".

`.wayfinder.json` sits at the repo root and carries one key, in one of two
forms:

```json
{"tracker": "github:owner/repo"}
```

`github:owner/repo` is the only form 1.3.0 accepts. Branch 3 writes
**exactly this key name** — a session that invents
its own leaves a dotfile the next session cannot read, which orphans every
map on it just as surely as the silent tracker switch branch 0 exists to
prevent.

**Whichever branch fires, it ends by binding `$OWNER_REPO`, `$OWNER` and
`$REPO`.** Those three names are what every other wayfinder file consumes and
none of them assigns — this is their only definition site. Branch 1 derives
them from the workspace remote below; branches 2 and 3 derive them from
`.wayfinder.json`'s `tracker` value, dropping its `github:` prefix. There is
no branch that leaves them unbound: **wayfinder requires a reachable issue
tracker**, and every path that cannot produce one stops.

Resolve the workspace root with the shipped resolver, then read its remote
**from git, never from the manifest**:

```bash
# `oss repo_root` walks up from $PWD and refuses by name when unpaired: a
# non-zero rc here IS branch 2, not an error, so it is swallowed for the same
# reason the origin read below is. Under `set -e` a bare assignment would abort
# the session on the ordinary standalone repo before .wayfinder.json is read.
# It resolves the root under either manifest schema, so the topology branch
# needs no separate read.
AI_ROOT="$(oss repo_root ai_workspace 2>/dev/null || true)"

# Both branch-1 preconditions are now empty-or-set, so one test routes them:
# no workspace, or a workspace with no origin, is branch 2 either way. Written
# as an `if` rather than `[ ... ] && ...` on purpose - the AND-list form is
# safe under `set -e` but only by a rule about non-final list elements that a
# later reader is liable to "correct" the wrong way.
ORIGIN=""
if [ -n "$AI_ROOT" ]; then
  ORIGIN="$(git -C "$AI_ROOT" remote get-url origin 2>/dev/null || true)"
fi

# The ladder BRANCHES here; it does not fall through. Normalizing an empty
# $ORIGIN unconditionally would derive an empty $OWNER_REPO on every branch-2
# and branch-3 repo and hand it straight to the guard below, which is the
# standalone path failing in the one shape that looks like a resolution bug.
if [ -n "$ORIGIN" ]; then
  # BRANCH 1. Git documents four remote spellings for the same repo and all
  # four reach here: scp-style (git@host:owner/repo), the ssh:// URL form,
  # plain https, and https carrying userinfo - an authenticated remote whose
  # token or password sits between scheme and host
  # (https://x-access-token:TOKEN@github.com/owner/repo). Miss the ssh://
  # form and OWNER binds to "ssh:", which then queries a repo that does not
  # exist rather than failing at the parse. Miss the userinfo form (#337) and
  # $OWNER_REPO keeps the credential verbatim - it then flows into every
  # `gh -R "$OWNER_REPO"` call and gets printed on every later failure: the
  # reachability guard below, branch 4's stop, and branch 0's own stop
  # message all echo $OWNER_REPO to the terminal.
  #
  # THE USERINFO STRIP IS ONE RULE FOR EVERY SCHEME, not one per scheme
  # (#337 rounds 1-2 tried ssh-only then ssh-plus-https, and each time the
  # scheme that was NOT enumerated rode a credential straight through - a
  # plain http:// remote, or git://, are unlikely but real: a self-hosted
  # GHE reachable over http, or a stale copy-pasted origin). The rule
  # `^([A-Za-z][A-Za-z0-9+.-]*://)[^/]*@` matches any RFC-3986-shaped scheme
  # (letter, then letters/digits/+/./-, then `://`) followed by userinfo, and
  # captures the scheme so the replacement can put it back unchanged - this
  # is shorter than enumerating schemes AND does not miss the next one.
  #
  # EVERY class here spans BOTH cases, and that is the round-3 fix. Schemes and
  # hosts are case-insensitive per RFC 3986, git PRESERVES whatever spelling the
  # remote was typed in, and the lowercase-only rules matched none of
  # `HTTPS://tok@github.com/...` - so the credential survived into $OWNER_REPO
  # and branch 0 and branch 4 printed it to the transcript. Typing the remote in
  # caps reopened the exact leak #337 closed. Bracket classes rather than sed's
  # `I` flag or GNU `\L`: neither is portable to the BSD sed on macOS. It
  # cannot fire on the scp-style git@host:owner/repo form, which has no
  # `://` at all, so that spelling is untouched by construction rather than
  # by a separate exclusion.
  #
  # THE CLASS EXCLUDES / ONLY, NOT @. A userinfo field can itself carry a
  # raw, unescaped @ (a password containing one) - excluding @ from the class
  # as well stops the match at the FIRST @ rather than the last one before
  # the host, so `user:p@ss@github.com/...` would strip only `user:p@` and
  # leave `ss@github.com/...` still credential-bearing. `[^/]*` is greedy and
  # POSIX ERE takes the longest leftmost match, so it runs all the way to the
  # last @ before the first /, which is the actual userinfo terminator - and
  # `*` rather than `+` so an empty userinfo (`https://@github.com/...`)
  # still matches instead of falling through untouched.
  #
  # WHAT THIS RULE DOES NOT DO: turn every scheme into owner/repo. Only ssh
  # and https get a github.com-specific rewrite below; a credential-free
  # http:// or git:// origin is left as `http://github.com/owner/repo` or
  # similar rather than reduced further, which is fine - the reachability
  # guard fails it the same way an unsupported scheme was always going to
  # fail, just without printing a secret on the way. This rule runs FIRST,
  # before either scheme-specific rewrite, so neither rewrite below needs
  # its own userinfo handling any more.
  OWNER_REPO="$(printf '%s' "$ORIGIN" \
    | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*://)[^/]*@#\1#; s#^[Ss][Ss][Hh]://[Gg][Ii][Tt][Hh][Uu][Bb]\.[Cc][Oo][Mm]/#https://github.com/#; s#^[Gg][Ii][Tt]@[Gg][Ii][Tt][Hh][Uu][Bb]\.[Cc][Oo][Mm]:#https://github.com/#; s#^[Hh][Tt][Tt][Pp][Ss]?://[Gg][Ii][Tt][Hh][Uu][Bb]\.[Cc][Oo][Mm]/##; s#\.git$##')"

  # BRANCH 0 RUNS HERE, and only here. It compares the RESOLVED origin against
  # the dotfile, so it needs both - and this is the only arm that has an
  # origin. Stating the rule in prose above and leaving the ladder without the
  # comparison is the shape this block exists to close: the stop reads as
  # binding and never executes.
  WF_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$WF_ROOT" ] && [ -f "$WF_ROOT/.wayfinder.json" ]; then
    WF_TRACKER="$(jq -r '.tracker // empty' "$WF_ROOT/.wayfinder.json" | sed -E 's#^github:##')"
    if [ -n "$WF_TRACKER" ] && [ "$WF_TRACKER" != "$OWNER_REPO" ]; then
      echo "wayfinder: branch 0 - .wayfinder.json names $WF_TRACKER but the workspace origin resolves to $OWNER_REPO. Stop and ask which tracker this repo's maps live on; do not resolve it silently." >&2
      exit 1
    fi
  fi
else
  # BRANCHES 2 and 3. The dotfile is the source. It sits at the REPO root, not
  # $PWD, so resolve the root rather than reading a relative path that misses
  # from any subdirectory - the same failure the manifest note below describes.
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$REPO_ROOT" ] || { echo "wayfinder: not inside a git repository - cannot locate .wayfinder.json" >&2; exit 1; }
  WF="$REPO_ROOT/.wayfinder.json"

  # BRANCH 3 is branch 2 with one extra step: ask, write the dotfile, then read
  # it back through the same path, so the two branches cannot drift apart.
  [ -f "$WF" ] || { echo "wayfinder: no tracker configured - ask the operator for one and write $WF as {\"tracker\": \"github:owner/repo\"} before continuing" >&2; exit 1; }

  OWNER_REPO="$(jq -r '.tracker // empty' "$WF" | sed -E 's#^github:##')"
  [ -n "$OWNER_REPO" ] || { echo "wayfinder: $WF has no usable \"tracker\" key" >&2; exit 1; }
fi
OWNER="${OWNER_REPO%%/*}"
REPO="${OWNER_REPO##*/}"
```

**Branch 3 is not a separate code path.** It asks the operator, writes
`.wayfinder.json`, and then re-enters branch 2's read — the dotfile is the only
thing either branch consumes. Writing the value into `$OWNER_REPO` directly and
skipping the read-back would let a session that wrote a malformed dotfile
succeed once and fail on every later invocation, which is the drift the exact
key names above already exist to prevent.

**Why this reads git, and not a manifest field that plainly exists.** A
concurrent internal design, landing after wayfinder, makes the workspace root
implicit and removes the key that would otherwise carry it — routing fields,
including a tracker pointer, are on that design's list of keys ossify's own
resolvers never read. An `ai_workspace.git_remote` field and a
`routing.wayfinder_maps` key would both be dependencies on manifest surfaces
already scheduled for deletion. The workspace root is stable across both the
current and the incoming schema, and `git remote get-url` returns the
identical string under either one — so branch 1 asks git directly, and a
future reader who "fixes" this back to a manifest read is reintroducing the
dependency this design deliberately avoided.

**Why the resolver and not a hand-rolled `jq` read of the manifest.**
`oss repo_root ai_workspace` is the walk-up branch 1 describes — a raw
`jq -r '.ai_workspace.root' .workspace/pairing.json` only ever finds a
manifest sitting in `$PWD`, so branch 1 misses on a correctly paired repo
invoked from any subdirectory. The resolver also substitutes the manifest's
`${…}` tokens and refuses with a named message, which is why this repo
removed `oss_cmd_manifest_get` in v0.2.0 (`lib/commands.sh:117-126`): the raw
read handed the caller a literal unresolved token string. It is a read that
already ships, so using it adds no verb.

Check reachability before committing to a tracker — auth lapses and issues
can be disabled per repo:

```bash
[ -n "$OWNER_REPO" ] || { echo "wayfinder: tracker resolution failed - \$OWNER_REPO is empty after the ladder" >&2; exit 1; }

# --jq PRINTS a value; it does not test one. Capturing and comparing is what
# makes a disabled tracker branch 4 instead of a line of output nobody reads.
HAS_ISSUES="$(gh repo view "$OWNER_REPO" --json hasIssuesEnabled --jq '.hasIssuesEnabled' 2>/dev/null || true)"
[ "$HAS_ISSUES" = "true" ] || { echo "wayfinder: branch 4 - $OWNER_REPO is unreachable or has Issues disabled (probe returned '${HAS_ISSUES:-<error>}')" >&2; exit 1; }
```

A `false`, or a `gh` error from a probe that was actually constructed, is
branch 4: **stop**, and say which it was — an unreachable tracker and one that
simply has issues turned off need different things from the operator, and both
are recoverable outside this session.

**The two stops are different failures and say so.** Branch 4 means the probe
ran and answered no: auth, network, or issues disabled. The guard above means
the probe could not be built at all — it runs **after the ladder has
finished**, so it fires only when a branch that claimed to bind `$OWNER_REPO`
did not, which is a bug in the resolution rather than a fact about the
tracker. Without the guard the probe runs as `gh repo view ""`, errors, and
reports itself as branch 4 — a resolution bug wearing an unreachable-tracker
message.

An empty `$ORIGIN` is neither: branch 1 declined, so the ladder went on to
branch 2 or 3 and bound `$OWNER_REPO` from `.wayfinder.json`. The guard is
never handed the no-origin workspace.

**Why there is no local fallback.** An earlier draft of this file routed both
stops to a Markdown-backed map on disk. It was cut before release: nothing
exercised it, and every review round found another tracker operation the file
mapping did not cover — clearing a resolved blocker out of a dependent's
metadata, closing a map that has no state field, and a transient probe failure
silently splitting one effort across two backends once connectivity returned.
A map is a **shared, mutable, queryable** record with parent/child and
blocking edges, which is what an issue tracker is for. Requiring one is the
honest boundary; a half-built second backend is not a fallback, it is a second
place for maps to be lost.

---

## 2. The frontier query

A map's frontier is the tickets ready to work right now: open, unassigned,
and not waiting on another open ticket. The obvious per-ticket form — one
REST call per sub-issue to read its assignees and what blocks it — is N+1: a
15-ticket map costs 15 round trips before a session can say what's next.
This query costs one, and is written **once**, here, never re-inlined
elsewhere:

```bash
MAP_JSON="$(gh api graphql -f query='
query($owner:String!,$repo:String!,$number:Int!){
  viewer{login}
  repository(owner:$owner,name:$repo){
    issue(number:$number){
      title url
      subIssues(first:100){
        pageInfo{hasNextPage}
        nodes{
          number title url state body
          assignees(first:100){nodes{login}}
          labels(first:100){nodes{name}}
          blockedBy(first:100){nodes{number state}}
        }
      }
    }
  }
}' -F owner="$OWNER" -F repo="$REPO" -F number="$MAP")"

# The frontier VIEW - what the operator picks from.
printf '%s' "$MAP_JSON" | jq -r '
  .data.repository.issue.subIssues.nodes
  | map(select(.state=="OPEN"
        and (.assignees.nodes|length)==0
        and ([.blockedBy.nodes[]|select(.state=="OPEN")]|length)==0))
  | .[] | "\(.title)  [\([.labels.nodes[].name | select(startswith("wayfinder:"))] | .[0] // "no-type")]  #\(.number)"'

# The UNFILTERED nodes - the named-ticket check, the claim re-read and the
# terminal check all read these, and none of them can use the view above.
printf '%s' "$MAP_JSON" | jq -r '.data.repository.issue.subIssues.nodes'

# One named ticket's node, for §1's four checks
printf '%s' "$MAP_JSON" | jq -r --argjson n "$TICKET" '
  .data.repository.issue.subIssues.nodes[] | select(.number==$n)'

# The pagination gate for working.md §5's terminal branch
printf '%s' "$MAP_JSON" | jq -r '.data.repository.issue.subIssues.pageInfo.hasNextPage'

# The operator this session runs as - the ONLY source for telling "assigned to
# somebody else" from "assigned to me" in working.md §1's resume rule. `@me`
# is a write-side special value for --add-assignee/--remove-assignee; it never
# reveals a login, and §4 rules out a separate `gh api user` call.
printf '%s' "$MAP_JSON" | jq -r '.data.viewer.login'
```

**The response is captured once and filtered several times, rather than
`--jq`'d at the call.** `--jq` applies its filter to the response and prints
only the result, so putting the frontier filter there would throw away the
unfiltered nodes and `pageInfo` — the very things the three readers named
below need. One call, four views; a second round trip for facts the first
response already carried is the N+1 this query exists to avoid.

`$MAP` is the map's issue number, resolved once — from the name or URL the
operator gave — and never asked for again. The bracket in each output line is
the ticket's type label: `wayfinder:research`, `wayfinder:smoke-test`,
`wayfinder:spike`, `wayfinder:prototype`, `wayfinder:grilling`, or
`wayfinder:task`, set when the ticket was filed; the map itself carries
`wayfinder:map`. The filter picks that label out by prefix rather than by
position — a ticket also carrying an unrelated label (`priority:high`, say)
still reports its real type, and a ticket carrying none reports `no-type`
rather than guessing.

**Exactly one `wayfinder:` type label, checked before claim or dispatch.**
`.[0]` above takes whichever the API returned first, and `ticket-types.md` §1
requires exactly one — so a ticket that collected a second one, from a
collaborator or an automation, gets classified arbitrarily. That is not
cosmetic: a `prototype` also carrying `wayfinder:research` can be read as AFK
and fanned out to a subagent, which is the HITL refusal bypassed by a label
edit. Count against the **six allowed ticket labels**, not the `wayfinder:` prefix:
a prefix count of one also passes `wayfinder:map` on a child and a typo like
`wayfinder:reseach`, both of which name no resolver — and a prefixed label
that names no resolver is a stop even riding alongside a valid type, because
`.[0]` above still classifies the ticket by whichever label the API returned
first. Exactly one of the six, and no other `wayfinder:` label, in one check:

```bash
printf '%s' "$MAP_JSON" | jq -r '
  ["wayfinder:research","wayfinder:smoke-test","wayfinder:spike",
   "wayfinder:prototype","wayfinder:grilling","wayfinder:task"] as $valid
  | .data.repository.issue.subIssues.nodes[]
  | . as $t
  | [.labels.nodes[].name] as $all
  | ([$all[] | select(. as $l | $valid | index($l))]) as $typed
  | ([$all[] | select(startswith("wayfinder:"))
      | select(. as $l | ($valid | index($l)) | not)]) as $stray
  | select(($typed|length) != 1 or ($stray|length) != 0)
  | "\($t.number) needs exactly one of the six ticket labels and no other
     wayfinder: label - carries \(
       if ($all|length) > 0 then ($all|join(", ")) else "no labels" end)"'
```

Any output is a stop, naming the ticket and its labels. `no-type` in the
frontier view is the zero case of the same problem and is equally a stop
before the ticket is worked — the view reports it rather than guessing
precisely so this check has something to catch.

**Every nested connection asks for 100, the GraphQL maximum, and none of the
three may be trimmed to "enough".** Each one feeds the eligibility boolean, so
a truncated page does not lose information — it *inverts* the answer. Miss an
open blocker past the cut and the ticket is admitted to the frontier and worked
before its evidence exists; miss the `wayfinder:` label past the cut on a repo
with ten of its own and a correctly typed ticket reports `no-type` and loses
its resolver. A wayfinder map will not approach 100 of any of them; asking for
the maximum costs one page either way and removes the question.

The `--jq` filter is doing the derivation the REST form would need N calls to
assemble: three raw facts per ticket — `state`, `assignees`, `blockedBy` —
collapse into one boolean, frontier-eligible or not.

**The filter is a view, not the query.** `subIssues.nodes` holds *every* sub-issue
of the map with all three facts on it; the `--jq` above narrows that to the
eligible set and formats it for a human to pick from. Three callers need the
**unfiltered** nodes instead, and each reads them from this same single call
rather than issuing another:

- a **named ticket** — its node is read directly and the predicate applied to
  it, and its presence in the list is the parent check
  (`references/working.md` §1);
- the **claim re-read** — that node's `assignees`, immediately before
  assigning (`references/working.md` §1);
- the **terminal check** — an empty eligible set is ambiguous on its own, so
  §5's two cases are told apart by the unfiltered nodes: all closed, or some
  open but blocked or claimed (`references/working.md` §5).

That last one is why the distinction is stated here rather than left implicit.
A caller that saw only the filtered output would read an empty result as "no
work left" in both cases and could close a map with open tickets still on it.

**`pageInfo.hasNextPage` gates the terminal decision, and only that one.**
`subIssues(first:100)` returns one page. For the named-ticket and claim reads
a truncated page can only make a real ticket look absent, which refuses a
valid input — the safe direction. For §5's terminal check it is the opposite:
if the first 100 are closed and ticket 101 is open, "every ticket is closed"
is **wrong**, and acting on it closes a map with live work on it. So `working.md`
§5 **refuses the terminal branch entirely while `hasNextPage` is true** and
says the map is too large to judge in one page, rather than paginating a case
no wayfinder map is expected to reach.
