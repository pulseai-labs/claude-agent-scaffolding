# Security policy

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a
vulnerability**. Only the maintainers see the report. Do not open a public issue or pull request
for it.

Include the plugin, its version, the harness it ran on (Claude Code, Codex or OMP), and the steps
that show the problem.

## Supported versions

Each plugin is released on its own, with tags such as `ossify-v1.36.7`. Fixes land in the plugin's
next release; earlier releases are not patched. Before you report a problem in a plugin, update it to
the version on `main`.

## Scope

These plugins run on your machine with your user's privileges. Most of what they do happens inside
a coding agent, under the permissions you give it, but not all of it:

- hooks are shell commands the harness runs on its own events, outside the agent's tool prompts;
- some plugins ship command-line tools (`oss`, `mb`, `crew-run`, `baton`, `omp-seat` and others)
  that the harness puts on `PATH` or that you link there, and that you or a script can run directly;
- baton installs a systemd user timer that runs `baton tick` with no agent involved.

A report about any of these that runs a command, reads or writes a file, or sends data you did not
ask for is in scope. A problem in Claude Code, Codex or OMP themselves belongs to that project.
