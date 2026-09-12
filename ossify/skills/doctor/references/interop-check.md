# Workspace interop check

The depth behind `doctor/SKILL.md` §7. Absorbed from `scaffold-onboard`'s
`checking-workspace-interoperability` (spec §8.1), so the unified plugin owns
the question and `workspace-init` stays unchanged.

**Check only.** Spec §9.1 allocates `doctor` an *interop check*; the additive
repair half was scaffold-onboard's own extension and is not shipped here. This
surface reports and names the fix. It does not edit the manifest and does not
touch `AGENTS.md`.

**You perform this check by reading. There is no dispatcher verb for it** — the
`interop_check` subcommand was removed. It was 175 lines of bash that opened
files and described what it found, which is work a model does directly and
better. What remains deterministic is *path resolution* (`oss repo_root`,
`oss state_path`), because every mutating verb routes through it and two
spellings of one path is a real defect class. Deciding whether what you read is
healthy is yours.

---

## 1. The question

*Can this workspace be driven by Claude Code and by Codex, interchangeably,
mid-project, without either one silently working from different assumptions?*

Everything below is a way that question comes out **no**.

### Output grammar — match it exactly

One line per check, `ok:` or `fail:`, then the check name, then a dash and the
detail. Same grammar as `oss doctor`, because a single read-out should not carry
two vocabularies:

```
ok: manifest - /path/to/.workspace/pairing.json
fail: agents_md - no AGENTS.md at /path/AGENTS.md; a Codex session gets no project instructions at all
```

Check names, in this order: `manifest`, `ai_workspace`, one `ok:`/`fail:`
line per declared repo — named by its own key, `canonical` for a project that
declares one that way — `state_path`, `agents_md`. **If any line is `fail:`,
say so explicitly at the end** — there is no exit code to carry it now, so the
summary is what the reader acts on. Report every failing line, not just the
first, except where §3 says to stop.

---

## 2. What was absorbed: the question, not the checklist

The scaffold-onboard original requires ten `.routing.*` keys including
`roadmap`, `sprint_specs` and `implementation_handoffs`, plus a
`.workspace/locks` directory.

**Every one of those is an artifact this stack retired.** `ROADMAP.md` is
replaced by the feature map plus `RELEASE.md`; sprint specs by spine specs;
`PROJECT_PLAN.md` outright. ossify's lock is a `<state>.lock` directory beside
the state file, not a workspace-wide one.

Porting that key set would make `doctor` report a correctly-configured ossify
project as broken for not having the previous stack's furniture — a check whose
failures are all false is worse than no check, because someone will eventually
"fix" a healthy project to satisfy it.

**If you are ever tempted to add a key here, the test is: does an ossify
ceremony read it?** If nothing reads it, its absence is not a finding.

---

## 3. The checks

### `manifest`

Walk up from `$PWD` for `.ossify/topology.json` **first**, then for
`.workspace/pairing.json` if no topology file turns up — the identical order
`oss_topology_discover` resolves through (`lib/manifest.sh`), which is what
every mutating verb and `oss manifest_require` itself already routes on. When
both exist on the walk-up, topology wins; read whichever file you actually
found. That walk is a
few directory checks; do it yourself.

**This is not a cosmetic ordering choice.** The declared-repo loop the next
check runs already reads either manifest kind (`.repos` under a native
topology, or every top-level `.root`-carrying object under a legacy pairing
manifest). A `manifest` check that only ever looks for `.workspace/pairing.json`
would STOP here — before that loop ever runs — on every project `/start`'s A1
topology probe onboarded the normal way, which is `.ossify/topology.json` with
no pairing manifest at all.

`oss manifest_require` is the *refusal*, not the finder — it returns rc 1 and
prints the project's canonical refusal text to **stderr** (already worded for
both manifest kinds — `/ossify:start`/`/ossify:adopt` for a topology
declaration, `/init-workspace`/`/pair-workspace` for a pairing manifest), and
discards the path
on success. Use it when you want that exact wording; do not expect a path from
it. There is no dispatcher verb that echoes the manifest path.

**Absent (neither file found anywhere on the walk-up) → `fail:`, and STOP.**
Do not run the remaining checks. Every one of
them reads this file, so continuing emits four derived failures for one root
cause and buries the only thing that has to be fixed first. Remedy:
`/ossify:start` or `/ossify:adopt` (authors `.ossify/topology.json`) for a new
or adopted project, or `/init-workspace`/`/pair-workspace` (authors
`.workspace/pairing.json`) for an existing dual-repo workspace — name those
tokens literally, do not paraphrase them.

**Present but unreadable → `fail:`, and STOP**, for the same reason. Read
whichever file you found and satisfy yourself it is **exactly one JSON
object**. Three ways it is
not, all of which used to reach the later checks and produce nonsense:

- Malformed JSON.
- A valid non-object: `[]`, `null`, `42`, `"a string"`. Each parses, then every
  key read comes back empty.
- **Two or more concatenated top-level values** — `{...}{...}`. This is the one
  worth reading for deliberately. A tool checking only "does the last value
  parse as an object" accepts it, and every key read then returns *both* values'
  answers joined by a newline, so roots and paths come out as two-line strings
  and every later line is nonsense about a path nobody configured. Count the
  top-level values. (#169)

### `ai_workspace` and every declared repo

`ai_workspace`'s root must resolve and be a real directory, and so must every
repo the manifest declares — the same repo set the `manifest` check above
already read the file for (a native topology's `.repos` object; every top-level
object carrying a `root` other than `ai_workspace` under a legacy pairing
manifest, translated the same way `_oss_topology_shape` does). Emit one
`ok:`/`fail:` line per key, tagged with that key.

```bash
oss repo_root ai_workspace
oss repo_root "<repo-key>"            # once per declared repo
```

Use the verb, not the raw JSON value. It substitutes `${...}` tokens and refuses
a path that only *looks* absolute — reading the raw value would pass a manifest
that every real call then fails on. Its refusals are already worded for you,
including the `${PLUGIN_DATA:...}` case, which is legal workspace-init
vocabulary that ossify does not resolve: report that refusal as written rather
than calling it malformed. (#165)

Distinguish the two failures — they have different causes and different fixes:

| Condition | Line | Means |
|---|---|---|
| the verb refuses | `fail: <key> - .<key>.root is absent, holds an unresolved ${...} token, or is not absolute` | the manifest is wrong |
| resolves, not a directory | `fail: <key> - resolved root is not a directory: <path>` | the manifest is right and the directory moved |

The second is the one that happens to real projects, usually after a repo is
renamed or moved.

**Every declared repo must also be a git work tree — and its OWN top level.**
Probe each:

```bash
root="$(oss repo_root "<repo-key>")"
# `-P` because git resolves symlinks in --show-toplevel; comparing an
# unresolved manifest root against a resolved toplevel reports drift that
# is not there.
top="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)"
[ "$top" = "$(cd "$root" 2>/dev/null && pwd -P)" ] \
  && echo "ok: worktree(<repo-key>)" \
  || echo "fail: worktree(<repo-key>) - resolved root is not this repo's top level (git says '${top:-<no work tree>}')"
```

**`--show-toplevel` compared against the root, not `--is-inside-work-tree`.**
A declared root that is a *subdirectory* of another repo's work tree answers
`true` to `--is-inside-work-tree`, so the check reports the repo healthy while
every later `git -C "$root"` branch, worktree, checkout and merge targets the
**parent** repository. Two topology entries pointing inside one repo then mutate
the same repository while reading as separate. `boundary-audit.md` §2 already
specifies the exact-root form and says why; this is the same check, and the two
must not disagree about what "is a repo" means.

The comparison must hold — rc 0 alone is not the pass.

**And the top levels must be DISTINCT across declared repos.** Two keys whose
roots resolve to the same git top level are accepted everywhere else as
independent repos: the two-pass branch setup in
`work-item/references/round-orchestration.md` §2 sees the spine branch absent
for both, cuts it on the first key's iteration, and fails `checkout -b` on the
second — and re-running hits the existing-branch guard, which that document says
is not resumable. Collect the resolved top levels and report a duplicate as a
`fail:` line naming both keys.

This check lives HERE and not in `_oss_topology_shape` deliberately. Distinctness
is a filesystem question — it needs a `git rev-parse` per declared repo — and the
shape function runs on every `oss` invocation, so answering it there would put N
git subprocesses behind every state read. Doctor is the surface that already
walks the roots. A declared repo whose
root is an ordinary directory (`.git` removed, the manifest hand-edited) fails the
probe outright; a **bare repository or a `.git` directory** answers rc 0 to
weaker probes like `--git-dir` — and even *survives* `oss worktree_add`, since
git happily adds worktrees from a bare repo — so the first break comes later
and worse: spine close's checkouts and merges run against the root itself and
need a work tree there. A probe that certifies switch-ready and defers the
failure to mid-ceremony is the #153 shape one level in. Line:
`fail: <repo-key> - resolved root is not a git work tree: <path>`. (#153, #183)

**Do not apply the git probe to `ai_workspace`.** That workspace is legitimately
allowed to be untracked, so the same probe there is a false failure. This is the
one place `ai_workspace` and a declared repo are deliberately *not* treated
alike — a check that loops over `ai_workspace` with the declared repos is
wrong.

### `state_path`

The state file's path must resolve, and the session must not be quietly driving
a different project's state.

```bash
oss state_path      # the manifest's answer; ignores the environment
if [ -n "${OSS_STATE_FILE+set}" ]; then printf 'set: [%s]\n' "$OSS_STATE_FILE"; else printf 'unset\n'; fi
```

**`${VAR+set}` and `printf`, not `echo "${VAR:-<unset>}"`.** Both halves of that
shorter form lose information this check depends on, and both lose it toward a
false `ok:`:

- `${VAR:-<unset>}` cannot distinguish *unset* from the literal string `<unset>`
  — they print identically. The resolver treats the literal as an active
  **relative** override, so ceremonies would read and write `./<unset>` while the
  check reported no override at all.
- `echo` eats its own option-looking arguments: a value of `-n` or `-e` prints as
  empty, so a live override reads as "not set".

`${VAR+set}` tests **setness** without substituting, and `printf '%s'` prints any
value literally. The brackets in `[%s]` make a trailing space or an empty value
visible too.

**Resolution first.** If `oss state_path` fails, that is
`fail: state_path - the state path does not resolve to an absolute location (an
unresolved ${...} token, a relative routed value, or no ai_workspace.root)`.

**Routing is not required.** `.well_known_paths.project_state` is honoured when
present; when absent the path derives as
`<ai_workspace.root>/.ossify/project-state.json`. **Both forms are
manifest-absolute**, so both resolve identically from any directory. An unrouted
manifest is therefore **not** an interop risk and must not be reported as one.

**Then the override.** `$OSS_STATE_FILE` takes precedence over the manifest for
every ceremony in this session, so a check that reads only the manifest path
certifies the workspace switch-ready while this session reads and *mutates*
another project's state. That is the interop failure in its purest form.

**The rule is deliberately blunt, and the bluntness is the design:**

1. **Not set, or set but empty** → no override. `_oss_resolve_state` guards on
   `[ -n "${OSS_STATE_FILE:-}" ]`, so an empty value falls through to the manifest
   exactly as an unset one does. `ok: state_path - <routed>`.
2. **Set and byte-identical to `oss state_path`** → `ok: state_path - <routed>`.
3. **Anything else** → `fail: state_path - $OSS_STATE_FILE is set to '<env>' but
   the manifest routes state to '<routed>'. If these name the same file, unset the
   variable — the manifest already routes there. If they do not, this session's
   ceremonies would read and WRITE another project's state.`

**Do not normalize the two paths before comparing them.** Not `/./`, not `//`,
not symlinks, not `..`, not case. A byte comparison, and a failure whenever it
does not match.

**Why, in full, because the temptation to "improve" this is strong and it has
already been costly.** An earlier revision of this file compared *directory
entries*: resolve the deepest existing ancestor with `cd -P`, keep the final
component verbatim. It was five lines and it looked obviously correct. Review
found, in four consecutive rounds: `-ef` accepting a hard link that `mv` then
forks; a lexical-only fallback failing a healthy workspace whose root is a
symlink; a bare `cd` disagreeing with the kernel about `..` after a symlink — a
false `ok:` while writes landed in another project; an unreadable ancestor
returning an empty prefix; case-insensitive volumes calling one entry two; and a
`.` component in a not-yet-existing tail. Every one was real. None was the last.

Path normalization is a **tarpit**, and this repo has now paid for it twice —
PR #166 spent four rounds and five defects on a hand-rolled normalizer whose net
product value was a hand-rolled normalizer, and this surface repeated it in prose.
`CLAUDE.md` states the rule that both violated: *over-specifying mechanical
precision in prose is its own failure — it drives review churn without buying
correctness.*

**What the blunt rule costs, stated honestly:** a `fail:` on an override that is
merely spelled differently — `$ws/./.ossify/…`, or a symlinked root. That is a
**false failure, never a false OK**, and it is the safe direction: this check
exists to stop a session silently driving another project. **And the remedy is
correct in every one of those cases anyway** — if the two spellings name the same
file, unsetting the variable loses nothing, because the manifest already routes
there. An operator who follows the message is right whether or not the paths were
equivalent, which is what makes the imprecision affordable.

**Exact-equivalence detection is settled, not pending (#171, 2026-08-16):** the
resolution-time rail stays blunt and says so in its own text ("paths compared as
written"). Canonicalization is not coming back, and the refuse-at-resolution
redesign was declined under the freeze — see `_oss_resolve_state`'s header for
the walked alternatives. This check inherits the same bluntness deliberately;
do not grow a normalizer here either.

### `agents_md`

The check that is actually about Codex.

`AGENTS.md` in the AI workspace must exist **and name ossify**. It is the only
file Codex reads for project instructions: a workspace whose `AGENTS.md` never
mentions ossify has a Codex session driving the project with none of its
ceremonies — no spine planning, no close gates, no demo ledger — while the state
file goes on recording a lifecycle nobody is following.

Read `<ai_workspace.root>/AGENTS.md` and look for `ossify`, case-insensitively,
anywhere in the file — a `## Ossify` heading satisfies it.

| Line | Remedy |
|---|---|
| `fail: agents_md - no AGENTS.md at <path>; a Codex session gets no project instructions at all` | author one; it is the Codex-side entry point |
| `fail: agents_md - <path> never mentions ossify; a Codex session would drive this project with none of its ceremonies` | add a section routing Codex to the ossify ceremonies |

If the `ai_workspace` root did not resolve, you cannot look for the file: report
`fail: agents_md - cannot look for AGENTS.md without a resolvable ai_workspace
root` and stop there.

**Do not write or edit `AGENTS.md` yourself.** It holds user-authored content,
and this surface has no managed-section contract to merge into — that machinery
belongs to the repair half that is deliberately not shipped here. Report the
line, name the fix, stop.

---

## 4. What this check cannot tell you

Stated so a green result is not over-read:

- **Whether a Codex session will actually behave.** The check is a handful of
  presence-and-resolution facts. `AGENTS.md` mentioning ossify is not the same
  as `AGENTS.md` describing it correctly.
- **Whether the two agents agree on anything else** — model config, tool
  availability, or which branch is checked out.
- **Anything about `.codex` memory.** There is no Codex memory mirror and there
  should not be one: the shared source of truth is the topology declaration, the
  lean spec, the memory bank and `project-state.json`. If you find a `.codex`
  memory tree, that is drift worth reporting in the read-out, not a thing to
  create.
