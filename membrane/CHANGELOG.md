# membrane changelog

Named `claude-security-audit` through 0.3.1.

## 0.5.0 (2026-11-05)

#1034 (the real-run report buried its signal) and #1072's C11 (a crafted finding could share a suppressed finding's uid), shipped together on the operator's ruling of 2026-11-05. The scan is unchanged: plugin `fixtures/` and `tests/` and `.dagr/scratch/` copies are still scanned, and every finding keeps its severity, state and count.

### Changed
- **Chat folds plugin test files and agent scratch copies into one count line.** A finding whose file is under an enabled plugin's `fixtures/` or `tests/` (a directory segment anywhere in the path inside the plugin's tree, as the `@plugin:<plugin>@<marketplace>:<rest>` id shows it) or under the project's own `.dagr/scratch/` is not listed in chat. One line replaces them, after the table: `N findings in plugin fixtures/tests and agent scratch copies (C critical, H high, M medium); listed in the report` (`, L low` and `, I info` follow when not zero; `1 finding` in the singular). It prints when the group holds only Info, counts non-suppressed findings, and prints nothing for an empty group. The headline total and the table count every finding, as before. A project's own `tests/` or `fixtures/` is not in the group, nor is a file merely named `tests`, nor a plugin outside the `cache/` layout (a `local/` plugin): those stay listed. `--verbose` lists the group in full and prints no count line. The markdown report lists every group finding at full severity with a `**Group:**` line (`plugin fixtures/tests` or `agent scratch`).
- **Findings from the free-text rules get a new uid once (C11).** `csa_finding_uid` hashes the excerpt after `csa_redact`, which caps it at 200 characters and masks every secret-like run to its first and last four, so two long matches that shared their first 200 characters, or their masked form, shared a uid. The rules whose excerpt is a grep line, a file's content or a JSON value now call the new `csa_finding_uid_raw`, which hashes the whitespace-squeezed excerpt itself. The raw excerpt reaches only `sha256` and is never printed or stored; the uid keeps 8 hex characters. `csa_finding_uid` is unchanged and keeps serving the callers whose excerpt is a constant, a rule-written string or a fixed-length digest: a hook command read from JSON (HOOK-001 to HOOK-004 on a settings or plugin file; the digest of its json path and command), HOOK-005, HOOK-006, PERM-002, PERM-004 and MARKETPLACE-002. Of the 26 call sites in `lib/`, 20 moved to the raw form (listed under Migration) and 6 did not.

### Fixed
- **SECRETS-004 no longer reports a pure-hex run or a slash-heavy path.** A match is `[A-Za-z0-9+/]{40,}` with up to two `=`; it is now skipped when the whole run is `[0-9a-fA-F]+` (a git SHA, a sha256 digest) and its line names no credential (case-insensitive `token`, `secret`, `passw`, `api_key`/`api-key`/`apikey`, `auth`, `credential`, `private_key`/`private-key`), or when it holds two or more `/` and every `/`-separated segment is a word shape (`[A-Z]?[a-z0-9]+` or `[A-Z0-9]+`, so no `+` and no `=`): `pulsestack/actions/runs/41344090802/rerun`, `ROOT/skills/orchestrate/references/roles`. A line is dropped only when every run on it is skipped. The AWS documentation secret key `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` has two slashes but mixed-case segments, so it is still reported, as are a blob with `+` or `=`, a long blob with no slash, a run with one slash, a path with a camelCase or multi-capital segment, and a hex run on a line that names a credential (`"github_token": "<40 hex>"`). Known limits: a hex credential on a line with no credential word is no longer reported (`dop_v1_<64 hex>` with no `token` beside it); SECRETS-003 still reports `NAME=value` when the name holds API_KEY, SECRET, TOKEN or PASSWORD, and a JSON- or YAML-keyed hex token has no other rule. `sk-...`, `ghp_...` and `AKIA...` keys are not hex and are unaffected (SECRETS-001; a JWT is SECRETS-002). A placeholder of only `A` to `F` characters (`AAAAAAAA...`) is hex and is skipped unless its line names a credential. In a path, a Capitalized, UPPER-case or digit segment is a word shape, so a documentation webhook URL with `XXXX` segments is skipped, and so is a base32 or hex token that sits as a segment between slashes (`.../webhooks/<32 hex>`). If the filter cannot run, the unfiltered findings are reported. Skill-first question 3: the scanner is a stop-only rail; a narrower pattern changes which stops it adds, and it still never approves anything. Each shape is pinned beside a control it must not skip.

### Migration
- **One-time uid change, so suppressions and baseline entries read NEW once.** A finding from a rule below whose excerpt is over 200 characters, or holds a run that `csa_redact` masks (a secret-shaped value, or 32 or more characters of `A-Za-z0-9+/=`), has a new uid; for SECRETS-001 to SECRETS-004, CLAUDE-MD-001 and MCP-003 that is nearly every finding. Its old suppression or baseline entry no longer matches: it reads NEW in the next audit, and must be suppressed again. The old baseline entry (`state.json` findings registry) is evicted by the usual GC. A `suppressions.json` entry for the old uid is not: GC does not touch that file, and the plugin has no command to remove an entry, so it stays there matching nothing until you edit `.claude/audits/suppressions.json` by hand. Rules: HOOK-001 to HOOK-004 (findings in script files; a hook command read from JSON keeps its uid), PROMPT-INJ-001, PROMPT-INJ-002, SECRETS-001 to SECRETS-004, CLAUDE-MD-001, CLAUDE-MD-002, MCP-001 to MCP-003, MARKETPLACE-001, PERM-001, PERM-003, PERM-005 and PROVENANCE-002. A short finding with nothing to mask, from any rule, keeps its uid byte for byte. A secret that is rotated now reads NEW, since the uid hashes the secret's line. This is by design: a suppression covers one secret, not a position.
- A SECRETS-004 finding that the new filter skips disappears from the next report: its baseline entry is evicted by the usual GC.

### Tests
- `tests/test-fingerprint.sh`: `csa_finding_uid_raw` for two excerpts that differ only after character 200 and only under a masked run (each beside the unchanged `csa_finding_uid`, which still collides), whitespace, equality with `csa_finding_uid` for a plain short excerpt, nothing but the uid on stdout and stderr; `csa_finding_uid` pinned to 0.4.2 values.
- `tests/test-uid-long-text-callers.sh` (new): every moved caller except PERM-001 (whose excerpt is the fixed string `Bash(*)`, `Read(*)` or `Write(*)`, so no long one exists), 18 rules and PROVENANCE-002, each on two inputs that differ in one character after character 200 or in a long name or key (the first six were red on 0.4.2); three short-excerpt uids pinned to 0.4.2 values; the set of files that still call `csa_finding_uid` pinned, and no raw-uid call may take `$preview`.
- `tests/test-report-render.sh`: a project with a plugin fixture finding, a scratch finding and a real one (chat lists the real one and prints the count line with the right counts; headline and table equal the same findings outside the group; the markdown lists all three at full severity with two tagged); controls for the project's own `tests/`, a plugin file outside `fixtures/` and `tests/`, a file named `tests`, a nested or foreign `.dagr/scratch`, an empty group, a suppressed group finding, `--verbose`, an Info-only group, a relative scratch path and a missing `csa_normalize_path`.
- `tests/test-rules-secrets.sh`: SECRETS-004 skips for hex and path shapes, beside the AWS key, a hex run on a credential line (each keyword, and a commit OID line without one), multi-capital segments, a `+`/`=` blob, a long blob, a one-slash run, a path then a blob, a SHA then the AWS key, and an `awk` that fails. `tests/test-dispatcher-rule-engine.sh` runs SECRETS-004 and the group line through `bin/csa` (`set -euo pipefail`).
- `tests/test-fail-closed-readers.sh`: the 0.4.2 r3 C7 half-match pin, HOOK-004 with a `curl http://x` prefix and a read error, rc 2.
- Mutation-checked, each with the control beside it; the mutations that first survived (`[A-Z]?` to `[A-Z]*`, the project-root anchor, a caller passing `$preview`, 14 callers with no behaviour pin) now have a control and are killed. Still surviving: the `break` after a kept run, and `sub(/^[0-9]+:/` in SECRETS-004's filter, both equivalent (same output).

## 0.4.2 (2026-11-05)

The rest of #1089, from #1088's review, and the same failure in the MCP rules and the other grep rules. A reader that could not read used to report no finding; the readers below now report one. The checks can only add a stop: a real non-match, and a readable file with nothing in it, still report nothing, and a match a rule already found is never dropped.

### Fixed
- **A file the scan cannot read is a finding, once.** A target the audit could not read (`chmod 000`) was skipped silently by the rules that read it. The engine now emits one SCANNER-003 (Medium) per such target, when a rule in the scan's focus would have read it, and it does not count toward the "rule(s) failed" banner. The rules still skip the file themselves; an enabled plugin's unreadable `hooks/hooks.json` is still reported as HOOK-005. Run as root, where every file reads, none is reported.
- **A malformed `settings.json` no longer reads clean.** A settings file that is not valid JSON was a non-match in PERM-001 to PERM-004 and the schema check (PERM-005); it is now rc 2, a SCANNER-002 per rule: four, or five when a `settings.local.json` sits beside it (the divergence check on the local file also reports a malformed sibling `settings.json`). That alone trips the "rule(s) failed" banner. A top level that is valid JSON but has no keys (`42`, `"x"`, `true`) is rc 2 in PERM-005 too. A `permissions.deny` that has no length (a boolean) gives a SCANNER-002 from the two rules that read `deny`: PERM-002 always, and PERM-004 when `Bash(*)` is allowed. The project's own settings files also keep their HOOK-005.
- **A malformed `mcp.json` no longer reads clean.** MCP-002 (missing auth) and MCP-003 (env-var leak) read a jq failure as no servers. A jq failure is now a SCANNER-002 (rc 2) when the rule had found nothing before it; a server or secret it found before the failure is still emitted as a finding (rc 0), because the engine drops a rule's output on rc 2. A valid file with no `mcpServers` stays silent.
- **A marketplace entry that is not an object is a finding, and no longer hides the URLs after it.** `malformed-marketplace` read a jq failure on the entry check as no malformed entries; it now reports one. `untrusted-source` (MARKETPLACE-001) aborted its walk at such an entry and missed an http URL after it; it now skips the entry and checks the rest. The invalid-JSON and missing-array findings were already emitted and are pinned.
- **A jq error in HOOK-006 is rc 2, not a non-match.** An empty count is still rc 1.
- **A read error in the file rules is rc 2.** `grep` rc 2 or more was masked by `2>/dev/null | while` in the file mode of HOOK-001 to HOOK-003, the secrets rules, the CLAUDE.md rules, the prompt-injection rules and the MCP endpoint rule, and `cat` in HOOK-004 (network-exfiltration). `grep` rc 1 (no match) is unchanged. When the read fails after a match was found, the rule emits that match and returns 0, because the engine drops a rule's output on rc 2; when it found none, it stops with a SCANNER-002. HOOK-004 matches the content it read before a `cat` error and emits if both patterns match; otherwise a clean prefix is not a clean file, so it is a SCANNER-002.
- **A failed `mktemp` or hook-entry walk is a SCANNER-002, not a skip.** The walk was cached run-wide even when it failed, which silenced HOOK-001 to HOOK-005 for the file; a failed walk is no longer cached, and each hook rule that reads the file reports it. A failed walk's partial output is discarded, not scanned. A failure to write the coverage `.target` file costs the coverage line a count, not the walk. A failed `mktemp` for a rule's target list is a SCANNER-002 for that rule.
- **threat-model.md** says what a finding with no line (the bare file) and one with a `json_path` (`file#path`) print.

### Tests
- `tests/test-fail-closed-readers.sh`: each stop above beside a control (a real non-match, a valid file, a readable target), the SCANNER-002 counts for a malformed settings file, and a match kept through a read error. `tests/test-dispatcher-rule-engine.sh` runs a malformed `settings.json` and a `chmod 000` target through `bin/csa` (`set -euo pipefail`). The unreadable-target tests skip when run as root. Each pin was mutation-checked, with these exceptions that the sourced tests cannot observe: the `rm -f "$cf.target"` cleanup after a failed coverage-file write (the test's failing target is a directory, which `rm -f` cannot remove either way; it is kept, as it removes a half-written file), and the `continue` after a failed per-rule `mktemp` (a sourced run without errexit skips the rule anyway; under the dispatcher a failing `mktemp` earlier in the scan aborts it, as before).

## 0.4.1 (2026-11-05)

The P3 sweep from #1068's review (#1072). No new rule. Two failures that used to read as "nothing found" now say so: a jq error while one of the five rules that read hook entries (HOOK-001 to HOOK-005) reads an entry, and a failed HOOK-006 chat count. Other failures still read as no finding, among them HOOK-006's own rule and the permissions and marketplace rules on a jq failure, and a script the file-mode rules cannot read.

### Fixed
- **A jq error while one of the five rules reads a hook entry is no longer a non-match.** `csa_hook_entry_command` returned rc 1 for both "not a command" and a jq failure; HOOK-001 to HOOK-004 and HOOK-005 therefore counted an unreadable entry as checked. A jq failure is now rc 2, passed through by those rules, so the engine reports a SCANNER-002. When the engine can still name the entry (its own `json_path` read succeeds), the SCANNER-002 names it and the coverage line counts it `unreadable`; when that read fails too, the SCANNER-002 carries no `json_path` and the entry stays counted as `checked`. A real non-match stays rc 1.
- **A failed HOOK-006 count no longer reads as zero.** The chat summary printed nothing when its `jq` count failed (`|| echo 0`); it now prints `HOOK-006 count unavailable`.
- **A trailing slash on `CSA_PROJECT_ROOT` no longer moves finding ids.** `csa_normalize_path` compared the raw value, so `<p>/` changed every uid under the project and suppressions resurfaced. Under `<p>/`, a finding suppressed or saved under `<p>` now reads SUPPRESSED or PERSISTED there, where 0.4.0 read it NEW. It now strips every trailing slash before it compares (`/` stays `/`).
- **A finding with no line prints the bare file.** SCANNER-002, PROVENANCE-002 and the other line-0 findings printed `file:0` (chat) and `file:0:0` (report); they now print `file`.
- **Coverage:** `flagged` is documented, and pinned, as a subset of `checked`: an entry that one rule flags and another rule fails on is counted `unreadable`, so it is not `flagged` either; its finding still prints. A redundant `SCANNER-002` filter in the `flagged` definition is gone (no change in output).

### Tests
- `_hook_scan` (a checked scan, then the HOOK filter) replaces the roughly 28 `_scan | _hook_findings` pipes in `test-hook-entries.sh`, so a failed scan now fails the test instead of reading as no findings; a check that every `$(_scan_checked ...)` and `$(_hook_scan ...)` capture keeps its `|| return 1` (with a control line it must flag).
- Pins for branches that survived mutation: the HOOK-006 chat line's verbose guard, SUPPRESSED filter and plural wording; the `:0:0` check now runs on verbose chat, which is where Info prints; the file-scope SCANNER-002 carrying no `json_path` for a multi-entry file (`length == 1`, and an empty `json_path` key); the `$ok` base of the `flagged` count.
- Mutation-checked, each with an adjacent control: a jq error versus a real non-match (rc 2 versus rc 1) in each of the five rules and in the engine; a failing jq in the HOOK-006 count; `$_P`, `$_P/` and `$_P///` as project root; line 0 versus a real line in chat and report.

## 0.4.0

Renamed from `claude-security-audit` to `membrane`, in the marketplace's rename to `pulsestack`.
The commands are now `/membrane:security-audit` and its siblings, the install key is
`membrane@pulsestack`, and the session-start reminder and the report footer name `membrane`.
State files, the audit directory and the `# claude-security-audit` block the auto-fix writes into a
project's `.gitignore` keep their names, so an existing audit history, baseline and suppressions
carry over. To move: uninstall `claude-security-audit@claude-agent-scaffolding`, then install
`membrane@pulsestack` (the root README's *Renamed from claude-agent-scaffolding* section has every
step).

## 0.3.1 (2026-11-03)

Follow-ups to 0.3.0 (#1059). No new rule; one reading of the coverage line changes.

### Fixed
- **A trailing slash on the project root no longer skips settings hooks.** `csa rule_engine_scan_all "<p>/"` enumerated `<p>//.claude/settings.json`, which the exact-path test never matched, so the project's settings hooks were not read and nothing said so. The engine now strips trailing slashes from the root once. This holds for any root other than `/`; for `/` itself the settings hooks are still skipped, as before 0.3.1.
- **A failing `detect_text` is no longer counted as checked.** Its SCANNER-002 now names the entry's `json_path`, and the coverage line counts that entry under `unreadable`, not `checked`.
- **HOOK-006 prints `file#hooks`, not `file:0:0`,** and the chat summary, which hides Info, adds one line (`N file(s) declare hooks the audit does not inspect (HOOK-006, Info; pass --verbose)`) so an unchecked `http` or `prompt` hook is no longer invisible in chat.
- **HOOK-006's `finding_uid` hashes the per-type counts first,** as HOOK-005 does, so a long type name no longer hides a later change to the counts.
- **Wording:** the `finding_uid` is 32 bits, so two different hook commands share an id only by a 32-bit collision; 0.3.0's "never share an id" is corrected.

### Tests
- A real `\u` escape in the decoding tests, a `detect` versus `detect_text` verdict comparison on one command, a test that the json path is part of the entry digest, and a `_scan_checked` helper (the scan's status is captured before any pipe) used by the `&` and nested-settings controls and a few positive-result tests, with a test that makes its failed-scan and malformed-output arms run. (Corrected in 0.4.1: most positive-result tests and the roughly 25 older "0 findings" assertions still read the scan through a pipe and did not fail on a failed scan; 0.4.1 converts them.)

## 0.3.0 (2026-11-03)

**Hook commands declared in JSON are now audited (#427).** Before, a `curl ... | bash` in `.claude/settings.json`, or in an enabled plugin's `hooks/hooks.json`, gave zero findings: the hook rules read only scripts. Expect new findings, on first-party plugins too, the first time you audit after upgrading.

Skill-first question 3 (`docs/conventions/skill-first.md`): reading hook entries from JSON is mechanical work on open input (attacker-written command text), allowed as code because it can only add a stop and never approves anything. What it misses goes on to your own reading exactly as before. No model reads hook text.

### Added
- **`csa_hook_entries <file> <wrapped|plugin-manifest>`** (`lib/hook-entries.sh`) walks `.hooks.<Event>[i].hooks[j]` with `jq` and emits one JSON line per entry. `command` entries are decoded (JSON escapes; exec-form `args` joined into the checked text); other types are counted; each unreadable piece is an inconclusive line with its `json_path`. A `plugin.json` `hooks` field may be an inline event map, a path inside the plugin root (physical containment check; `./hooks/hooks.json` is a target already and is skipped) or an array of both.
- **Exact targets only:** the project's `.claude/settings.json` and `.claude/settings.local.json`, and a plugin's `hooks/hooks.json` and `.claude-plugin/plugin.json`. Never a nested `.claude/**/settings.json`, a plugin's `fixtures/` or `tests/` copy, or a plugin's root `settings.json`.
- **HOOK-001 to HOOK-004 read decoded commands** through a new `detect_text` entry point (one pattern per rule, shared with the file `detect`; HOOK-004 shares its two regexes). A match is a finding at line 0 with `context.json_path`; the `finding_uid` is built from 24 hex characters of the sha256 of the path and the full decoded command, short enough to pass `csa_redact` whole, so path and command length never hide a difference (the id itself is 32 bits, so two different commands share one only by a 32-bit collision), and reformatting the file changes nothing.
- **HOOK-005 `hook-entry-unreadable`** (High): a malformed file or a hook entry of the wrong shape is a finding, so a hook that went unread never reads as a clean audit.
- **HOOK-006 `hook-type-not-inspected`** (Info): one finding per file with per-type counts for `http`, `prompt`, `agent`, `mcp_tool` and later hook types.
- **A coverage line.** The engine prints `csa: hook-coverage checked=N flagged=N not-inspected=N unreadable=N` on stderr, the skill passes it to the report as `scope_summary`, and the report header prints it. `checked` counts every command entry matched against the HOOK patterns, and `flagged` those of them with a finding.
- Reports print `file#<json_path>` instead of `file:0:0` for a finding with a `context.json_path`.

### Known limits
- The patterns are the same common-pattern regexes as before; obfuscation still gets through. HOOK-002 (rm-rf) matches only `rm -rf` of an absolute path, so `rm -rf "$HOME"/x` is missed, in files and in hook entries alike; no pattern was widened.
- A handler script outside `.claude/hooks/` and the plugin directory is not read (the command that calls it is checked). `http`, `prompt` and `agent` hooks are counted, not inspected.
- User-level `~/.claude/settings.json` hooks are not read. Hooks in skill or agent frontmatter, inline hooks in a marketplace entry, managed-policy hooks, and Codex or OpenCode hook formats are not read.
- A plugin whose files do not normalize to `@plugin:<plugin>@<marketplace>:` (a `local/` plugin, an install record pointing outside the cache layout) has its JSON hooks unread.

## 0.2.0 (2026-11-02)

**Audits now scan your enabled plugins, so a first real run reports more.** On a real Claude Code install the scanner read no enabled plugin at all, and said nothing about it: a clean audit and a skipped one looked the same (#825). Expect new findings, on first-party plugins too, the first time you audit after upgrading.

### Fixed
- **`enabledPlugins` is read as Claude Code writes it.** It is an object map, `{"plugin@marketplace": true|false}`; the scanner only knew an array of names and read the object as empty. Only boolean values count, `false` means not enabled, and the array form still reads (each name as `true`). The user's `settings.json`, the project's, then the project's `settings.local.json` merge by key, the later file winning, so a project `false` disables a user `true`. A plugin's identity is the whole `plugin@marketplace` key. `settings.local.json` is a new read.
- **Each enabled plugin resolves to where it is installed.** The scanner looked for `cache/<plugin>/<version>`; Claude Code uses `cache/<marketplace>/<plugin>/<version>` and records every install in `~/.claude/plugins/installed_plugins.json`. The scanner now takes this project's `local` or `project` entry (its `projectPath` is the project root), else the `user` entry. An `installPath` is used only if it is a directory physically inside `~/.claude/plugins/`; one that points elsewhere (a `..`, a symlink out) is PROVENANCE-002. With no record entry it falls back to the cache layout, and a name part holding `/` or `..` is refused. An `installed_plugins.json` that exists but cannot be read or is not the shape this code knows stops the audit (rc 2), never an empty set.
- **PROVENANCE-002 is a finding.** An enabled plugin that does not resolve was a stderr line that a successful scan dropped. It is now a High finding that names the plugin and why, recorded in `state.json` and reported like any other, and a later audit that resolves it removes it from the report.
- **A plugin finding's id survives a version bump.** `FUID` paths for `cache/<marketplace>/<plugin>/<version>/...` now normalise to `@plugin:<plugin>@<marketplace>:...`; the older two-level form is unchanged. No stored id needs migrating: a real install never scanned a plugin, so no real finding used the old form.
- **Paranoid-mode candidates are plugins, not marketplaces.** They are the install record's keys plus each `cache/<marketplace>/<plugin>` as `plugin@marketplace`, minus the enabled set; a `false` plugin is a candidate. `temp_git_*` (a clone in progress) is skipped.
- **The SessionStart reminder's "enabled-plugin set changed" note is true.** `state.json` stored an empty snapshot whatever was enabled, and the hook read the object map's values (`true`, `false`) instead of names. The audit now records the enabled set and the hook compares the same set. After upgrading, each session's reminder may print a false "changed" note until the next audit rewrites the snapshot.

### Added
- **A loud warning for a shape the reader cannot use.** An `enabledPlugins` value that holds entries but yields none (a string, an array of non-strings, an object of non-booleans) prints `csa: warning: ... unrecognized shape (...)`, since Claude Code can change this format.

## 0.1.8 (2026-10-15)

### Fixed
- **A large enabled-plugin array no longer empties the enabled set** (#424). The project and user `enabledPlugins` arrays reached jq as one `--argjson` argv value each, so an array over the OS per-argument limit (131072 bytes on Linux) made jq print nothing, and every enabled plugin turned into a paranoid candidate. The lists now reach jq on stdin. A settings file that exists but cannot be read or is not a regular file (a FIFO would block jq forever), an unreadable plugin cache, or a failed merge now fails the enumeration with rc 2 and a message, never an empty set, and the scan's target list fails with it. Malformed JSON and an `enabledPlugins` value that is not an array still read as an empty list, as before; such a value no longer empties the other file's list as well.
- **Plugin cache names are compared whole** (#425). Paranoid candidates came from `find | xargs basename`, which split `my plugin` into `my` and `plugin`. Names are now read NUL-delimited and compared to the enabled set inside jq, so a name with a space or a newline is one identity. Candidates print one per line in codepoint order; a candidate whose name holds a newline cannot be one line, so the enumeration refuses it (rc 2) and prints nothing rather than split it.

## 0.1.7 (2026-10-15)

### Fixed
- **Focused scans no longer age other aspects' findings** (#429). Every audit advanced one global run index, so 11 `/secrets-scan` runs evicted a permissions or hook finding, and the next full audit labelled it NEW with a fresh `first_seen`. Each `audit_history` entry now records its `focus` (`all` for a full audit), and GC counts a finding's absence only in full runs and in runs focused on its aspect (its rule's directory). `csa state_record_audit` takes the focus as an optional fifth argument and refuses an unknown aspect before writing. A full audit ages findings exactly as before; runs recorded by 0.1.6 and earlier read as full runs, so an upgrade changes nothing until a focused run is recorded.

## 0.1.6 (2026-10-15)

### Fixed
- **Executable hook handlers with any suffix** (#426). The enumerator added extensionless executables under `.claude/hooks/` but skipped every dotted name, so an executable handler such as `preflight.tool` or a hidden `.guard` was never scanned. Every executable regular file there is now a target whatever its suffix; listed suffixes still come from the main pass, once. Non-executable files and symlinks stay out, as before.

## 0.1.5 (2026-10-13)

### Fixed
- **Secrets in TOML, YAML and JSONC configs** (#121). The target enumerator lists `.toml`, `.yaml`, `.yml` and `.jsonc` files (an OpenCode `settings.toml`, `~/.codex/config.toml`), but the `secrets` aspect gate dropped them before any detector ran, so a plaintext key there reported clean. The gate now passes all four.
- **Hook rules read OpenCode code outside `bin/`** (#127). The `hooks` aspect gate and the guard each hook rule repeats (HOOK-001 to HOOK-004) matched only `*.sh` and `.opencode/bin/*`, so `.opencode/lib/runtime.js` and `.opencode/plugin/*.ts` were never inspected. Both now pass `.js`, `.ts` and `.mjs` files under `.opencode/`.

## 0.1.4 (2026-09-04)

### Fixed
- **Public dispatcher delivery.** Both manifests now publish the dispatcher environment setup required for `csa rule_engine_scan_all` to discover rules without ambient `CSA_*` variables.
- **Hook handler safety rails.** The scanner covers executable extensionless handlers under `.claude/hooks/`, including plaintext-secret detection, while non-executable hook documents are skipped safely.
- **Pipefail false negatives.** Hook network-exfiltration, MCP literal-secret matching, and paranoid-plugin membership avoid producer-to-`grep -q` pipelines.

## 0.1.3 (2026-06-21)

CI hardening (#71) — keep the wall-clock perf benchmark out of blocking PR CI.

### Changed
- **`tests/test-perf.sh` honors `CSA_SKIP_PERF` (#71).** When the env var is set, the benchmark prints `skipped (CSA_SKIP_PERF set)` and exits 0 (a no-op pass — `run-tests.sh`'s glob still counts the file). The repo CI sets `CSA_SKIP_PERF=1` on the security-audit step because the 30s wall-clock hard-fail threshold is calibrated for the homelab reference machine and flakes on slower shared runners. Local / homelab runs are unaffected — the benchmark still runs there with no env var. No rule or audit-behavior changes; 182 tests otherwise unchanged.

## 0.1.2 (2026-05-26)

Shell-portability patch (v0.x.1 bundle). See `docs/HANDOFF-shell-portability-v0x1.md` in the marketplace repo.

### Fixed
- **Shell portability (zsh compatibility):** Claude Code's Bash tool runs zsh by default on macOS; skill bodies referenced libs as prose ("call `lib/state.sh::csa_state_bootstrap_gitignore`") which Claude would otherwise source under zsh, where `${BASH_SOURCE[0]}` is unset and lib self-location crashed. Added `bin/csa` dispatcher with `#!/usr/bin/env bash` shebang — kernel forces bash on direct execution regardless of caller shell. `auditing-claude-configs/SKILL.md` prose references rewritten to explicit `csa <fn-suffix>` dispatcher invocations across the audit/focus/apply-fix/suppress paths. `csa --list` enumerates dispatchable functions. The dispatcher is auto-discoverable via `$PATH` (Claude Code adds each plugin's `bin/` to PATH automatically). claude-security-audit had the highest BASH_SOURCE volume in the plugin lineup (50 sites across 11 lib files) but the simplest skill-body refactor (zero literal `source` statements; pure prose-reference rewrites) and zero BASH_REMATCH risk (1 site, non-critical).

## 0.1.1 (2026-05-25)

Manifest schema fix — v0.1.0 failed installation due to plugin.json shape mismatch against Claude Code's marketplace schema. Three fixes:
- `author` changed from string `"Praveen Kumar Singh"` to object `{"name": "Pras"}` (schema requires object form, matching sibling plugins ai-mentor/architect-critic)
- Removed explicit `skills` array — auto-discovered from `skills/*/SKILL.md` by convention
- Removed explicit `commands` array — auto-discovered from `commands/*.md` by convention
- Added top-level `category: "security"` for marketplace categorization

No code or rule changes. All 182 tests still pass.

## 0.1.0 (2026-05-25)

First public release. Static-analysis security audit for Claude Code project configs and enabled plugins, inspired by AgentShield in Everything Claude Code (Mustafa, 2026; MIT). 28 rules across 7 aspects, 182 tests, ≤30s perf budget for ~200-file workloads. Zero ambient surface by default — SessionStart reminder ships opt-in only (T1-C). Two-flag auto-fix gated by 5-layer defense-in-depth (T2-H). Durable `finding_uid` survives whitespace edits (T2-I). Self-tamper detection on state files (T1-F). 5 clean-fixture release gate (D17) verified at zero findings.

### Phase 0 — Eval fixtures
- Plugin manifest (no hooks declared per T1-C opt-in pattern)
- Bash test harness skeleton (`_helpers.sh`, `run-tests.sh`) with accumulator-style exit propagation
- `.gitignore` override re-including `.claude/` fixtures vs contributor global gitignore
- 5 clean-set fixture projects (release-gate metric per SPEC D17)
- 8 issue-set fixture projects covering all 7 v0.1 aspects + dedicated PERM-005 schema-typo
- 15 fixture existence tests (full detection assertions deferred to Phase 7 e2e)

### Phase 1 — Skill body + references
- SKILL.md for auditing-claude-configs with rich description for natural-language matching
- references/threat-model.md (distilled from SPEC §4 + §6.3 enumerate algorithm)
- references/severity-rubric.md (5-tier + chat posture + GC)
- references/auto-fix-policy.md (two-flag system + safe-write allowlist + tamper detection + gitignore bootstrap)

### Phase 2 — Foundation libs
- `lib/helpers.sh`: csa_sha256 (cross-platform), csa_realpath (with macOS fallback), csa_sed_inplace (GNU/BSD), csa_mkdir_lock (atomic)
- `lib/redact.sh`: pattern-aware redaction for Anthropic/OpenAI keys, JWT, GitHub PAT family, AWS keys, base64 blobs; configurable length cap
- `lib/fingerprint.sh`: two-layer per T2-I — `csa_finding_uid` (durable, no line number) + `csa_dedup_fingerprint` (per-run); plugin-version-stripping
- `lib/severity.sh`: 5-tier rank + compare + validate
- 35 unit tests added (cumulative 50)

### Phase 3 — Orchestration libs
- `lib/enumerate-targets.sh` per §6.3 pinned algorithm (T2-J); local-dev fallback for marketplace operator dogfood
- `lib/rule-engine.sh` with SCANNER-001/002 High-severity emit (T2-G); banner aggregation for 3+ SCANNER-002
- `lib/state.sh` schema_version=2; findings registry keyed on finding_uid (T2-I); GC after 10-run absence (T2-K); self_integrity tamper detection (T1-F); first-audit gitignore bootstrap (T1-D)
- `lib/baseline.sh` NEW/PERSISTED tagging via finding_uid
- `lib/suppress.sh` with race-window refusal + Critical-cannot-suppress
- `lib/report-render.sh` chat+markdown per §8.4 with stable display_id
- `lib/apply-fix.sh` two-flag system (T2-H) + 5-layer defense-in-depth (rule re-validation, target re-resolution, symlink refusal, path-traversal refusal, atomic state log)
- 54 unit tests added (cumulative ~104)

### Phase 4 — Rule files (7 aspects, 28 rules)
- secrets/ (4): SECRETS-001 to 004
- permissions/ (5): PERM-001 to 005 including dedicated schema validation per T1-E
- hooks/ (4): HOOK-001 to 004 (common-pattern only; AST is v0.2)
- mcp/ (3): MCP-001 to 003
- claude-md/ (2): CLAUDE-MD-001 to 002
- prompt-injection/ (2): PROMPT-INJ-001 to 002 (common-pattern only; semantic-intent is v0.2)
- marketplace/ (2): MARKETPLACE-001 to 002
- _known-keys.txt allowlist for PERM-005
- 51 rule tests added (cumulative ~151)
- All 5 clean fixtures produce zero findings (D17 release gate verified)

### Phase 5 — Slash command wrappers
- /security-audit, /secrets-scan, /permissions-review, /apply-fix — all use $ARGUMENTS (per feedback_slash_command_dollar_n_bug)
- Wrappers route to skill modes; no dedicated unit tests (covered by Phase 7 e2e)

### Phase 6 — Opt-in hook + README + LICENSE
- hooks/session-start-reminder.sh shipped as file (NOT declared in plugin.json — T1-C invariant)
- README.md with ECC attribution + scope-honesty caveats + opt-in registration snippet
- LICENSE (MIT)
- 2 hook smoke tests (153 cumulative)

### Phase 7 — E2E integration tests + perf benchmark
- 4 core e2e test files (audit, apply-fix, suppress, baseline) against all 13 fixtures
- 4 adversarial e2e test files covering T1-F (tamper), T2-G (rule-load), T2-H (malicious-rule), T2-I (uid-stability) per SPEC §14.4
- Perf benchmark validates ≤10s ideal / ≤30s fail-threshold for ~200-file workload (17s on Mac Mini M-series — passes threshold, WARN on ideal)
- Release-gate metric: ZERO findings on all 5 clean fixtures asserted in test-e2e-audit.sh
- Integration bugs found and fixed: (1) enumerate-targets.sh scanned .claude/audits/ — excluded via -not -path filter; (2) rule-engine ran N×M subshell cross-product — restructured to batch targets per rule (csa_rule_run_many) with aspect-based pre-filtering; (3) _next_scratch pattern using $() subshell lost counter increments — fixed to use global _CSA_SCRATCH without $()
- 29 e2e/perf tests added (cumulative 182)
