# Working a map

Depth for `SKILL.md` §1's work-mode branch, and the file that resolves an
existing map's frontier, one ticket per session: the five steps that do it,
the claim that keeps two sessions from resolving the same ticket, and the
rule that keeps a ticket ruled out of scope from posing as a decision made.
It runs `references/tracker.md` §2's frontier query when no ticket is
named, and resolves whichever ticket it lands on through the instrument
`references/ticket-types.md` names for that ticket's type.

Work mode moves the frontier forward by exactly one ticket, then records
and stops. A session that resolves a second ticket, or claims a ticket
after resolving it instead of before, has broken the mode — not bent it.

---

## 1. The five steps

1. **Load the map** — the low-resolution view, not every ticket body.
2. **Choose and claim.** The operator's ticket if named, otherwise the first
   frontier ticket. **Assign it to the operator before any work** — that
   assignment *is* the claim, and it is what lets concurrent sessions skip it.
3. **Resolve it** through its type's instrument (`ticket-types.md`), reading
   the ticket's **body** — §2's query returns it per node. The title is the
   short form; `charting.md` §3 puts the actionable question, why it gates the
   destination, what would settle it, and the known constraints in the body,
   so resolving from the title alone discards everything charting recorded.
   Zoom further as needed: fetch any related or closed ticket on demand.
4. **Record the resolution** — post the answer as a resolution comment,
   **close** the issue, then append one line to the map's Decisions so far.
5. **Graduate and re-scope.** Add tickets the answer made specifiable
   (created and parented in one call, §4), clearing each graduated patch from
   Not yet specified so it lives only as its new ticket. If the answer reveals
   a ticket sits beyond the destination, **rule it out of scope** rather than
   resolving it.

Step 2's "first frontier ticket" is `references/tracker.md` §2's query, run
once. A session that resolves a ticket first and assigns it after has broken
step 2 — the assignment is what a concurrent session reads to know the ticket
is spoken for, and an assignment made after the work is not a claim at all.

**A named ticket skips the frontier *choice*, not the frontier *query*.**
Naming a ticket settles which one to work; it warrants nothing about whether
that ticket may be worked. §2's query establishes four facts at once for every
sub-issue of `$MAP` — membership, `state`, `blockedBy`, and `assignees` — and
those are exactly the four the named case needs, so the named case runs the
same query. Reading a per-ticket alternative out of `gh issue view` does not
work and must not be attempted: it has no `blockedBy` field at all, so the one
check `references/ticket-types.md` §3 calls non-negotiable would have no source.

What differs is only which node is read out of the result. §2's `--jq` filters
to the eligible set and formats it for the operator to pick from; the named
case instead reads the **unfiltered** node for `$TICKET` out of
`.data.repository.issue.subIssues.nodes` and applies the predicate to it
directly. One query, either way.

**Membership is the parent check.** A named ticket that is not among `$MAP`'s
sub-issues is absent from that node list, which is the mismatch stop below —
no separate parentage read is needed or wanted. (§2 asks for `subIssues(first:100)`,
so a map with more than 100 tickets could report a real ticket as absent. That
refuses a valid input rather than admitting an invalid one, which is the
direction to fail in, and no wayfinder map approaches it.)

Each failure is a **stop**, and each is stated rather than worked around:

- **Not a sub-issue of `$MAP`** — name both the map it does belong to and the
  one that was asked for. Step 4 **closes** the issue and appends its answer to
  `$MAP`'s Decisions so far, so a typo or a stale link mutates two wrong things
  at once: an unrelated issue closed, and a decision recorded on a map that
  never asked the question.
- **Already closed** — its resolution is on record. Recording a second one
  double-counts a decision in Decisions so far.
- **Blocked by something still open** — name the blocker. This is the same
  rule `references/ticket-types.md` §3 applies to the AFK fan-out, for the same
  reason: an answer derived before its evidence exists is worse than no answer.
- **Assigned to someone else** — see the claim rule below.

Resolve `$MAP` the same way, and there are three checks on it, all **before**
anything is claimed or closed. The map load in §4 requests `labels` and
`state` for exactly these — a check whose field is not fetched has no data
source and passes by default, which is worse than not stating it.

- **It carries `wayfinder:map`.** A map name that lands on an ordinary issue
  otherwise gets a Decisions so far heading appended to something that was
  never a map.
- **It is open.** A closed map has been finalised by §5. Working one either
  runs the terminal ceremony against a map that already had it, or — if a
  child was reopened or added after the close — claims and resolves that child
  while the parent stays closed, producing a decision on a map nothing will
  read again. A closed map is a **stop**: say it is closed and ask the
  operator to reopen it deliberately.
- **A supplied URL points at this tracker.** When the operator gives a map
  **URL** rather than a number, it encodes `owner/repo` — check that against
  `$OWNER_REPO` *before* reducing it to `$MAP`. Reducing first throws that
  identity away and re-attaches the bare number to the resolved tracker, so a
  URL from another repository silently addresses whatever issue holds the same
  number here. If that issue happens to carry `wayfinder:map`, every check
  above passes and work mode claims and closes an unrelated map's children. A
  mismatch is a stop naming both repositories — never a silent retarget.

**Every `gh` call on this page takes `-R "$OWNER_REPO"`, and §2's query takes
its `-F owner`/`-F repo` from the same resolution.** The tracker is frequently not the repository the
session is running in — `references/tracker.md` §1 branch 1 puts maps on the
**AI workspace** while the work happens in a canonical — so a bare `gh issue
view` or `gh issue close` resolves the number against the wrong repository and
reads, or closes, an unrelated issue that merely shares it.

**The claim is a marker, not a lock.** `--add-assignee` succeeds whether or not
the ticket was already assigned — GitHub offers no compare-and-set on
assignment — so two sessions that run the frontier query before either
assignment lands will both select the same ticket and both claims will
succeed. Re-read the chosen ticket's assignees immediately before claiming — §2's query
again, reading that ticket's `assignees` node — and act on **who** holds it:

- **Nobody** — claim it and work it.
- **The operator this session runs as, and nobody else** — **resume it.**
- **Anybody else, including alongside the operator** — skip it and say so.

The middle row is an exact-set test, not a membership test. GitHub allows
several assignees, so a ticket holding both the viewer and a collaborator
matches "mine" and "someone else's" at once — and resuming on that reading
closes work a second person has also claimed. Resume only when the assignee
set is **exactly** the viewer; any other login present is a skip.

Telling those apart needs the operator's login, and `@me` does not supply it —
it is a write-side special value for `--add-assignee`/`--remove-assignee` only.
§2's query returns `viewer.login` for exactly this comparison; §4 rules out a
separate `gh api user` call, so that field is the only source.

That last row is not a nicety. A session that dies between the claim and the
close leaves the ticket assigned and therefore off every future frontier query
(§2 filters on `(.assignees.nodes|length)==0`), so the only way back to it is
the operator naming it explicitly — and a rule that skips any assigned ticket
would refuse that retry too, stranding the ticket until someone hand-edits
GitHub. An assignment held by the current operator is a **resumable claim**,
not a competing one. To hand a stuck ticket to someone else, drop the
assignment (`gh issue edit "$TICKET" -R "$OWNER_REPO" --remove-assignee
"@me"`), which returns it to the frontier.

The re-read shrinks the concurrent window to the gap between the read and the
write; it does not close it. **Two sessions working one map at the same time
can still double-resolve a ticket**, and no mechanism here prevents it. Work a
map from one session at a time; the assignment makes a claim *visible*, not
exclusive.

---

## 2. One ticket per session

**Never resolve more than one ticket per session**, except AFK types.
AFK tickets — `research`, `smoke-test`, `spike`; `references/ticket-types.md`
§2 — are the exception: §3's fan-out already dispatches several of them at
once from a single session, so the one-per-session limit binds what a
session resolves itself, not a batch it only launched and is waiting on.

**Plan, don't do.** Tickets produce decisions, not deliverables. Ossify is a
build lifecycle, so the pull to start building mid-map is stronger here than
elsewhere — and that pull is the signal the map's edge has been reached and
it is time to hand off. An effort may override this in its `Notes`
(`references/charting.md` §3 names Notes as the override channel);
**absent that override, the default binds.**

---

## 3. Out of scope

Ruling something out of scope is a scoping act, not a step on the route.
**Close** the ticket — a closed ticket is unambiguously off the frontier —
and leave one line in Out of scope: the gist, why it is out, and a link. It
never enters Decisions so far, which records the route actually walked.

---

## 4. The commands

`$OWNER_REPO` is `references/tracker.md` §1's resolved tracker, and it is
always bound by the time this section runs — §1 stops rather than reaching
here without one.
`$RESOLUTION` is the answer this session is recording, fed on **stdin** —
`--body-file -` — so no scratch file lands in the operator's working tree.
In the claim and record calls below, `$MAP` and `$TICKET` are the map's and
the session's own ticket — the one chosen and claimed in step 2 — resolved
once from the name the operator gave or the frontier query returned, never
re-asked for and never how either is referred to in conversation.

```bash
# load the map low-res: its body is the whole index, tickets are a separate
# query. `labels` and `state` are not optional - they are the only sources for
# the wayfinder:map check and the closed-map refusal in §1, both of which run
# before anything is claimed or closed.
gh issue view "$MAP" -R "$OWNER_REPO" --json title,body,url,labels,state

# claim FIRST, before any work — "@me" needs no login lookup
gh issue edit "$TICKET" -R "$OWNER_REPO" --add-assignee "@me"

# Build $NEW_BODY by appending $ENTRY as the last line of the $HEADING section:
# emit it just before the next "## ", or at EOF when that section is last,
# dropping the section's trailing blanks so the first entry on a fresh map and
# the tenth on an old one land the same way. Every other section passes
# through untouched. Non-zero when the heading is absent or duplicated -
# absent because an unchanged body means nothing was recorded and a no-op
# write looks exactly like a recorded decision, duplicated because the append
# would land twice and split the record - the failures this section exists to
# prevent.
build_map_update() {
  # $HEADING and $ENTRY cross into awk through the ENVIRONMENT, never -v.
  # awk -v processes escape sequences in the value before the program sees it:
  # a resolution mentioning \d+ loses its backslash, C:\new\test gains a tab,
  # and any \n SPLITS the Decisions-so-far line in two. Measured, not assumed.
  # ENVIRON passes the bytes through untouched.
  #
  # The heading must appear EXACTLY once. Zero is caught below by the
  # unchanged-body stop, but TWO copies of the heading would append the entry
  # to both - the body changes, so that stop passes, and the decision lands
  # twice on a map a collaborator split or duplicated. Count first, exact-line
  # match, and refuse anything but one.
  HEADING_COUNT="$(printf '%s\n' "$MAP_BODY" | HEADING="$HEADING" awk '
    BEGIN { h = ENVIRON["HEADING"] }
    $0 == h { c++ }
    END { print c+0 }
  ')"
  [ "$HEADING_COUNT" -eq 1 ] || {
    echo "wayfinder: expected exactly one '$HEADING' on $MAP, found $HEADING_COUNT - not writing an ambiguous map" >&2
    return 1
  }
  NEW_BODY="$(printf '%s\n' "$MAP_BODY" | HEADING="$HEADING" ENTRY="$ENTRY" awk '
    BEGIN { h = ENVIRON["HEADING"]; entry = ENVIRON["ENTRY"] }
    /^## / { if (inside) { print entry; print ""; inside=0; pend=0 } print; if ($0 == h) inside=1; next }
    inside && /^[ \t]*$/ { pend++; next }
    { while (inside && pend > 0) { print ""; pend-- } print }
    END { if (inside) print entry }
  ')"
  [ "$NEW_BODY" != "$MAP_BODY" ] || {
    echo "wayfinder: map body unchanged - '$HEADING' not found on $MAP; nothing recorded" >&2
    return 1
  }
}

# DRY RUN, before anything irreversible. It fails on a map whose headings
# moved or were renamed - and finding that out AFTER the ticket is closed
# strands the decision: ticket closed, map with no record, and §1's
# closed-ticket stop refusing the retry. Prove the append is possible while
# the ticket is still open and nothing has happened yet.
MAP_BODY="$(gh issue view "$MAP" -R "$OWNER_REPO" --json body --jq '.body')"
build_map_update || exit 1

# record: comment, then close
printf '%s\n' "$RESOLUTION" \
  | gh issue comment "$TICKET" -R "$OWNER_REPO" --body-file -
gh issue close "$TICKET" -R "$OWNER_REPO"

# THEN write the map, rebuilt against a FRESH read - the dry run's copy is two
# API calls stale by now, and gh cannot append to an issue body, so this is a
# read-modify-write of the WHOLE body either way.
MAP_BODY="$(gh issue view "$MAP" -R "$OWNER_REPO" --json body --jq '.body')"
build_map_update || exit 1
printf '%s\n' "$NEW_BODY" | gh issue edit "$MAP" -R "$OWNER_REPO" --body-file -

# §3's out-of-scope ruling is this same close with NO resolution comment
# before it, the same map write against Out of scope instead of Decisions so
# far, and --reason "not planned" - GitHub's default state reason is
# COMPLETED, which is precisely the "posing as a decision made" that §3
# forbids, recorded in tracker history and every filter built on it:
#   gh issue close "$TICKET" -R "$OWNER_REPO" --reason "not planned"
```

### Writing the map body

The map body is the feature's durable output — `preflight.md` §1 exists to
carry `## Decisions so far` into `/start` and `/plan-release`, and §5 reads it
to judge whether the destination is reached. Three of the five headings are
written after charting, all through the read-modify-write pair above:

| When | `$HEADING` | `$ENTRY` |
|---|---|---|
| step 4, every resolved ticket | `## Decisions so far` | one line: what was asked, what was decided, and a link to the ticket |
| step 5 and §3, a scoping ruling | `## Out of scope` | one line: the gist, why it is out, and a link |

Step 5's other map edit — **removing** a graduated patch from
`## Not yet specified`, so it lives only as its new ticket — is the same
read-modify-write with a deletion in place of the append. The `awk` above does
not do it: which prose patch a new ticket replaced is a judgement, not a
pattern match. Edit that section's lines directly in `$MAP_BODY`, leave the
other four byte-identical, and keep the **same unchanged-body stop** — a
removal that removed nothing is as silent as an append that appended
nothing.

Four rules bind every one of those writes:

- **One heading per write.** The other four sections come back byte-identical.
  A write that reflows or "tidies" a heading it did not come to change is how
  a map body drifts out of the shape `charting.md` §3 fixed and six files
  read by name.
- **Append chronologically** to `Decisions so far`. It records the route
  actually walked, so the order is part of the record.
- **Re-read immediately before each write.** The body loaded at step 1 is
  stale by step 4 — the resolve step ran in between, and on a fan-out other
  tickets may have landed their lines.
- **Never hand-build a body.** Always the re-read, edited. `--body` replaces
  the whole issue body, so a hand-built one silently deletes every heading it
  forgot.
- **Prove the append before closing anything.** The same build runs twice: once
  as a dry run while the ticket is still open, and once for real against a
  fresh read. The first exists so a map with moved headings fails while
  everything is still recoverable; the second because the first is stale by
  then.

**If the map write fails after the close**, the decision is recorded on the
ticket and missing from the map, and the ticket is closed. That state is
recoverable but only deliberately: re-run the map write alone for that ticket.
§1's closed-ticket stop carries its one exception here — a closed ticket whose
decision is **absent from `Decisions so far`** may have its map line written,
and nothing else. It is not re-resolved, not re-commented, and not reopened.

**The lost-update window is real and is closed by ownership, not by the
command.** `gh` offers no compare-and-set on an issue body any more than it
does on assignment, so two writers that read the same body will have the
second overwrite the first. Re-reading immediately before the write shrinks
that window; what actually prevents the race is that
`references/ticket-types.md` §3 makes the dispatching session the **sole**
writer of the map body while a fan-out is in flight. That rule is what makes
this command safe, so it is not optional scheduling advice.

`@me` is documented gh behaviour (`gh issue edit --help`: *"Use `@me` to
assign yourself"*) and is exactly the semantics the claim wants — the
session assigns the operator it is running as. Do not resolve a login with
`gh api user --jq .login` first; it is an extra call for the same result.

Graduating a ticket the answer made specifiable reuses
`references/charting.md` §5's create call, `--parent "$MAP"` and all — the
map already has a number, so a graduated ticket needs no second pass unless
something blocks it that does not exist yet.

In a graduate context, `$TICKET` is not the ticket claimed in step 2 but
the new one step 5 creates — `references/charting.md` §5 defines its
`$TYPE` and `$TICKET_TITLE`. Wired or claimed, a ticket is always
addressed by its issue number, never a database id.

---

## 5. The empty frontier, and closing the map

An empty frontier is not an error and not an edge case — it is the state
every map reaches. §2's *filtered* output returning nothing means one of
exactly two things, and the filter cannot tell them apart — it discards every
node it excludes, so both cases look identical from it. Read the **unfiltered**
`subIssues.nodes` of the same query (`references/tracker.md` §2) and say
which:

**First check `pageInfo.hasNextPage`.** If it is true, the map has more than
one page of tickets and this section does not run: say the map is too large to
judge from one page, close nothing, and stop. Everything below reasons from
"every ticket" and only the first 100 were fetched, so a closed first page with
an open ticket at 101 would read as complete and close a map with live work on
it. That is the one place in wayfinder where a truncated read fails toward a
wrong mutation rather than toward a refusal.

- **Every ticket is closed.** The map has no open work left.
- **Tickets remain, but none is workable** — each is blocked by something
  still open, or already claimed by another session. Name them and what holds
  each one. Close nothing; there is nothing to decide here.

On the first, read the map's Destination against its Decisions so far and say
whether the question is answered. If it is, **ask the operator, then close the
map** — `gh issue close "$MAP" -R "$OWNER_REPO"` — leaving Decisions so far as
the record of the route walked. If it is not, the remaining uncertainty is fog that never
graduated: say what is still open, and let the operator decide whether to
chart the next ticket or stop.

**The close is the operator's, not the session's.** A map's destination is a
judgment about whether a question is settled, which is the one thing work mode
does not decide on its own — the same reason `prototype` and `grilling`
tickets are HITL. What binds here is that the session must **reach** the
question rather than reporting an empty frontier and stopping.

A closed map is a real state, not a hypothetical one: `references/preflight.md`
§1 queries `--state all` precisely so a closed map's Decisions so far still
reaches the ceremony that comes after it. This section is what produces one.
