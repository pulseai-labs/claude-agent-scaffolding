# Security policy

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a
vulnerability**. Only the maintainers see the report. Do not open a public issue or pull request
for it.

Include the plugin, its version, the harness it ran on (Claude Code, Codex or OMP), and the steps
that show the problem.

## Supported versions

Each plugin is released on its own, with tags such as `ossify-v1.36.7`. Fixes land in the plugin's
next release; earlier releases are not patched. Update to the latest release of a plugin before you
report a problem in it.

## Scope

These plugins run inside a coding agent on your machine, with the permissions you give that agent.
Some ship shell scripts and hooks that the harness runs. A report about a plugin that runs a
command, reads a file or sends data you did not ask for is in scope. A problem in Claude Code,
Codex or OMP themselves belongs to that project.
