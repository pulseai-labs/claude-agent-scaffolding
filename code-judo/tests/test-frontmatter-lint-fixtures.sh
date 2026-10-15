#!/usr/bin/env bash
#
# code-judo — fixtures for the frontmatter lint
#
# test-frontmatter-lint.sh checks code-judo's own skills, which are all well
# formed, so none of its failure branches runs in CI. This suite builds small
# plugin trees, runs the lint on each through CODE_JUDO_LINT_ROOT, and asserts
# the verdict: each defect class must fail, and its adjacent control must pass
# (#390, #404).
#
# Usage:   bash code-judo/tests/test-frontmatter-lint-fixtures.sh
# Exit:    0 if every fixture gets the expected verdict; 1 otherwise.
# Deps:    bash 3.2+, ruby with psych (the lint's own dependency).

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LINT="$SCRIPT_DIR/test-frontmatter-lint.sh"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

require_ruby_psych || { report; exit 1; }

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cj-lint-fixtures.XXXXXX")"
trap 'chmod -R u+rwX "$TMP_ROOT" 2>/dev/null; rm -rf "$TMP_ROOT"' EXIT

# new_plugin <dir> <name> <skill-frontmatter-body> [human-only: yes|no]
# Writes skills/<name>/SKILL.md, commands/<name>.md and the Codex policy file,
# with the command flag and the Codex policy matching the posture.
new_plugin() {
  _d="$1"; _n="$2"; _fm="$3"; _h="${4:-no}"
  mkdir -p "$_d/skills/$_n/agents" "$_d/commands"
  printf -- '---\n%s\n---\n\nBody.\n' "$_fm" > "$_d/skills/$_n/SKILL.md"
  if [ "$_h" = yes ]; then
    printf -- '---\ndescription: Run it.\ndisable-model-invocation: true\n---\n\nBody.\n' > "$_d/commands/$_n.md"
    printf 'interface:\n  display_name: "Demo"\n  short_description: "Demo"\npolicy:\n  allow_implicit_invocation: false\n' > "$_d/skills/$_n/agents/openai.yaml"
  else
    printf -- '---\ndescription: Run it.\n---\n\nBody.\n' > "$_d/commands/$_n.md"
    printf 'interface:\n  display_name: "Demo"\n  short_description: "Demo"\n' > "$_d/skills/$_n/agents/openai.yaml"
  fi
}

# expect <label> <pass|fail> <plugin-dir> [needle]
# Runs the lint on the tree; needle, when given, must appear in its output.
expect() {
  _out="$(CODE_JUDO_LINT_ROOT="$3" bash "$LINT" 2>&1)"; _rc=$?
  if [ "$2" = pass ]; then _ok=$([ "$_rc" -eq 0 ] && echo 1 || echo 0)
  else _ok=$([ "$_rc" -ne 0 ] && echo 1 || echo 0); fi
  if [ "$_ok" = 1 ] && { [ -z "${4:-}" ] || printf '%s' "$_out" | grep -Fq -- "$4"; }; then
    pass "$1"
  else
    fail "$1" "lint rc=$_rc; expected $2${4:+ with '$4'}; last lines: $(printf '%s' "$_out" | grep -E '✗|passed' | tail -3 | tr '\n' ' ')"
  fi
}

section "control: a well-formed model-invocable skill"
P="$TMP_ROOT/ok"; new_plugin "$P" demo $'name: demo\ndescription: Use when demonstrating.'
expect "a well-formed plugin passes" pass "$P"

section "#390: the description cap counts the parsed bytes"
# A literal block with long runs of spaces and blank lines: about 1,100 raw
# bytes that collapse to well under 1,024 once whitespace is squeezed.
long=""; for i in $(seq 1 30); do long="$long  word$i                              "$'\n\n'; done
P="$TMP_ROOT/over"; new_plugin "$P" demo "name: demo"$'\n'"description: |"$'\n'"$(printf '%s' "$long" | sed 's/^/  /')"
raw="$(ruby -ryaml -e 'puts YAML.safe_load(File.read(ARGV[0]).split("---")[1])["description"].bytesize' "$P/skills/demo/SKILL.md")"
if [ "$raw" -gt 1024 ]; then pass "fixture: the literal description is over the cap raw ($raw bytes)"
else fail "fixture: the literal description is over the cap raw" "only $raw bytes"; fi
expect "an over-cap literal description fails the cap" fail "$P" "description' length ≤1024"
P="$TMP_ROOT/under"; new_plugin "$P" demo "name: demo"$'\n'"description: |"$'\n'"  Use when demonstrating."$'\n\n'"  A second paragraph."
expect "control: an under-cap literal description still passes" pass "$P"

P="$TMP_ROOT/blank"; new_plugin "$P" demo $'name: demo\ndescription: "    "'
expect "control: a whitespace-only description is still empty, not three bytes of text" fail "$P" "'description' is non-empty"

section "#404: a parser failure is a lint failure, never silence"
P="$TMP_ROOT/unreadable"; new_plugin "$P" demo $'name: demo\ndescription: Use when demonstrating.'
chmod 000 "$P/commands/demo.md"
if [ -r "$P/commands/demo.md" ]; then
  pass "skip: this user can read a mode-000 file"
else
  expect "an unreadable command file fails 'frontmatter parses'" fail "$P" "commands/demo.md: frontmatter parses"
fi
P="$TMP_ROOT/badbytes"; new_plugin "$P" demo $'name: demo\ndescription: Use when demonstrating.'
printf -- '---\nname: demo\ndescription: Use when \xff\xfe demonstrating.\n---\n' > "$P/skills/demo/SKILL.md"
expect "a SKILL.md with invalid UTF-8 gets a verdict, never a silent pass" fail "$P" "skills/demo/SKILL.md"

section "#404: kebab-case is ASCII only"
P="$TMP_ROOT/accent"; new_plugin "$P" "démo" $'name: démo\ndescription: Use when demonstrating.'
expect "a name with a non-ASCII letter is not kebab-case" fail "$P" "'name' is kebab-case"
P="$TMP_ROOT/upper"; new_plugin "$P" "Demo" $'name: Demo\ndescription: Use when demonstrating.'
expect "a name with an upper-case letter is not kebab-case" fail "$P" "'name' is kebab-case"

section "#404: the human-only branch"
P="$TMP_ROOT/human"; new_plugin "$P" demo $'name: demo\ndescription: Human-invoked only. Run the demo.\ndisable-model-invocation: true' yes
expect "a human-only skill with the flag, command flag and Codex policy passes" pass "$P"
P="$TMP_ROOT/human-noflag"; new_plugin "$P" demo $'name: demo\ndescription: Human-invoked only. Run the demo.' yes
expect "control: a human-only description without the skill flag fails" fail "$P" "expected exactly one disable-model-invocation"

report
