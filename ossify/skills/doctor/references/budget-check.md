# Budget check

The depth behind `doctor/SKILL.md` §8. The progressive-disclosure design claims
the front-loaded surface costs **0.3–0.4% of a 200k context window** (spec §64).
This is where the claim gets measured against the installed plugin instead of
against the design document.

---

## 1. Three budgets, and they are not connected

The single most repeated error in this project's history is trimming one of
these and reporting that it freed room in another. It has now produced the same
wrong claim in three separate documents. **Before asserting that any edit buys
room, open the check that enforces the budget you mean.**

| Budget | Sums | Enforced by | Effect of a `references/` edit |
|---|---|---|---|
| **Every-call description** | the `description:` frontmatter of `commands/*.md` — what the skill listing actually loads (the SKILL.md descriptions never load; measured from a live session's listing, #263) | `check 7` — a red test | **none** |
| **SKILL.md body** | line count, per file, cap 500 | `check 6` — a red test | **none** |
| **Agent listing** | `agents/*.md` descriptions | **nothing** | **none** |

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

```bash
oss_bin="$(command -v oss 2>/dev/null || true)"
# Devin: bin/ is not on PATH — resolve the installed source instead. For a
# --local install `source:` is the linked filesystem path; a remote install
# reports a git URL and the tree materializes under the plugin cache —
# measured on 3000.10.21: cache/<source-id>-<hash>/<version>/ under
# ${XDG_DATA_HOME:-~/.local/share}/devin/cli/plugins/.
[ -n "$oss_bin" ] || {
  oss_src="$(devin plugins info ossify | sed -n 's/^ *source: *//p')"
  case "$oss_src" in
    /*) oss_bin="$oss_src/bin/oss" ;;
    *)  for mf in "${XDG_DATA_HOME:-$HOME/.local/share}"/devin/cli/plugins/cache/*/*/.devin-plugin/plugin.json; do
          [ -f "$mf" ] || continue
          [ "$(jq -r .name "$mf" 2>/dev/null)" = "ossify" ] || continue
          oss_bin="${mf%/.devin-plugin/plugin.json}/bin/oss"; break
        done ;;
  esac
  [ -n "$oss_bin" ] && [ -x "$oss_bin" ] || { echo "cannot resolve ossify plugin root (source: '${oss_src:-none}')" >&2; exit 1; }
}
oss_root="$(cd "$(dirname "$oss_bin")/.." && pwd)"
bash "$oss_root/tests/test-skill-bash-blocks.sh"
```

Checks 6 and 7 print their full per-file tables on every run, with live headroom
on each line. That output is the answer; do not carry a remembered figure.

**Locate the harness from the `oss` dispatcher, and not from either of the two
obvious alternatives** — both of which have been tried here and both of which
fail silently:

- **A repo-relative path** (`ossify/tests/...`) exists only when `$PWD` happens
  to be the scaffolding checkout. Everywhere else it is a "No such file" that
  takes both budgets down with it.
- **`${CLAUDE_PLUGIN_ROOT}`** is *not exported into Bash-tool subprocesses*
  on Claude Code (anthropics/claude-code#48230 — `scaffold-onboard/bin/sf`
  documents the same behaviour and self-locates for exactly this reason). It
  expands to the empty string, so the path becomes `/tests/...` — which fails
  identically to the repo-relative form while looking like it was fixed.

`oss` is on `$PATH` on Claude Code (which adds each plugin's `bin/`
automatically), and `command -v` finds it in the subprocess where the env var
does not survive. On Devin, `bin/` is NOT on `$PATH` — resolve `oss` into
`oss_bin` per `rules/dispatcher-path.md` (the plugin-cache manifest glob covers
remote installs, where `source:` is a URL, not a path). Resolving against the
installed plugin also measures the thing the budget is actually about.

### What does *not* move either budget

- Editing any file under `references/`. Reference depth is free until the router
  loads it — that is the entire point of the design.
- Trimming `plugin.json`'s description. Different budget, no test.
- Trimming an agent description. Different budget, no test (§3).

### What moves them

- `check 7`: **only** a `description:` line in a `commands/*.md` frontmatter —
  the listing loads the command descriptions, never the SKILL.md ones.
- `check 6`: **only** the line count of a `SKILL.md` body.

---

## 2. `check 7` — the every-call cost

This is the one the whole design exists to protect: descriptions are loaded on
**every single call**, before any routing decision is made. The cap is a fixed
total across all entry skills, and `check 7` fails the suite when the sum
exceeds it.

Two properties worth knowing before you touch a description:

- **It is a total, not a per-file cap.** Headroom is shared. One wrapper's
  generous description is another wrapper's missing room, which is why a
  description edit is never a local decision.
- **The loop counts `commands/*.md`, whatever is there.** Adding a command
  wrapper adds its description automatically; nothing needs registering. The
  surface sits well under the band today (0.18% against §9.1's 0.3-0.4% —
  three utilities carry full descriptions the spec meant to be name-only,
  #282), so the check is a growth guard, not a tight budget.

**Never edit a `description:` without re-running the check.** `check 7` is a red
test, so an overrun does not degrade — it fails the suite. And headroom that
exists is not spare: it was measured for something.

The floor assertion in the check is not decoration. A glob that silently matches
nothing sums to zero, which sails under any ceiling — so the check also asserts
it saw every entry skill. A budget nobody measures is not a budget, and a budget
measured vacuously is worse.

---

## 3. The agent-listing budget nothing enforces

`agents/implementer-agent.md`'s description is loaded in every agent-listing
context. In v0.3 it was cut from roughly **2,000 characters to under 600** by
moving the full execution contract into the body — at the time, the single
largest every-call string in the plugin.

**No test holds it there.** If it regrows, nothing goes red.

So measure it rather than quoting a remembered figure:

```bash
oss_bin="$(command -v oss 2>/dev/null || true)"
# Devin: bin/ is not on PATH — resolve the installed source instead (same
# guarded recipe as above: absolute source: path, else the materialized
# plugin-cache manifest for remote installs).
[ -n "$oss_bin" ] || {
  oss_src="$(devin plugins info ossify | sed -n 's/^ *source: *//p')"
  case "$oss_src" in
    /*) oss_bin="$oss_src/bin/oss" ;;
    *)  for mf in "${XDG_DATA_HOME:-$HOME/.local/share}"/devin/cli/plugins/cache/*/*/.devin-plugin/plugin.json; do
          [ -f "$mf" ] || continue
          [ "$(jq -r .name "$mf" 2>/dev/null)" = "ossify" ] || continue
          oss_bin="${mf%/.devin-plugin/plugin.json}/bin/oss"; break
        done ;;
  esac
  [ -n "$oss_bin" ] && [ -x "$oss_bin" ] || { echo "cannot resolve ossify plugin root (source: '${oss_src:-none}')" >&2; exit 1; }
}
oss_root="$(cd "$(dirname "$oss_bin")/.." && pwd)"
awk -F'description: ' '/^description: /{print length($2); exit}' "$oss_root/agents/implementer-agent.md"
```

Two notes on reading that number. It counts the raw YAML value **including the
surrounding quotes** when the description is quoted, so it runs a couple of
characters over the string itself — close enough to judge, not close enough to
quote as exact. And the figure is deliberately not written down here: the one
budget with no test is the one most likely to have drifted since anyone last
looked, so a number in this file would be the least trustworthy line in it.

Report a description that has crept back toward four figures as a finding, and
say in the read-out that it is **unguarded** rather than that it passed. An
unmeasured budget is exactly how `check 7`'s own ceiling was breached before
anything enforced it.

---

## 4. Verifying the session-level claim

Checks 6 and 7 measure the *plugin*. The spec's claim is about a **session**,
and the two are not the same number: what a session actually loads depends on
which plugins are enabled in that project.

**In a Claude Code session**, Claude Code's own `/doctor` reports the live
skill-listing percentage. That is ground truth for the spec §64 claim, and it is
the only place the claim can honestly be checked (spec §556 says so explicitly).

Three things to know when reading it:

- **Name the host before naming the command.** Under OpenCode, ossify's own
  entry skills are registered as native slash commands — including **`/doctor`,
  which is this skill**. Telling an OpenCode user to "run `/doctor`" re-enters
  this very surface instead of opening any diagnostics panel, and the loop is
  the only thing they get. On OpenCode, report the session-level figure as
  **unavailable** and give them the plugin-level measurement from §1 instead.
  Do not dress one up as the other.
- **The figure is per-project.** Dormant plugins can be disabled in project
  settings, and project settings override user settings. A repo with the whole
  scaffold family enabled reads far above one running ossify alone.
- **Claude Code's `/doctor` is an interactive terminal panel.** You cannot run
  it from here. Tell the user the command and what to look for; do not
  substitute the plugin-level figure and call it the session figure.

---

## 5. Reporting

A budget finding is worth reporting even when everything passes, because the
headroom number is the actionable part:

- **Both checks green, headroom stated** — for `check 7` the total and the
  remaining characters; for `check 6` the tightest file and its remaining lines.
- **The unguarded agent description** — its current size, and that nothing
  enforces it.
- **Never claim an edit freed budget without naming the check that measures it.**
  If the sentence would be "trimming X frees room for Y", it needs a measurement
  behind it, not a plan.
