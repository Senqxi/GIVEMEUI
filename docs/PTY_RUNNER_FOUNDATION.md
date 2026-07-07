# PTY Runner Foundation

GIVEMEUI now supports two local execution modes.

## Modes

- `stream`: the default runner. It uses Node `child_process.spawn()` with `shell: false`, captures stdout and stderr separately, and is best for flag-driven commands.
- `pty`: the terminal runner. It allocates a local pseudoterminal with `node-pty`, preserves terminal-aware behavior, and streams combined terminal output into the UI.

Both modes keep the same safety contract:

- executable plus argument arrays;
- no shell string execution;
- visible command preview before run;
- executable/schema/adapter trust gates;
- bounded timeout;
- cancellation;
- audit log entries.

## Current PTY Scope

PTY mode is available from the command preview run settings and is saved into workflow steps.

The current PTY foundation supports:

- launching a command in a pseudoterminal;
- setting fixed terminal dimensions;
- streaming terminal output to a dedicated UI console tab;
- storing output in run history;
- workflow variable compatibility through stdout-backed terminal output;
- timeout and cancellation.

The current PTY foundation does not yet support:

- typing stdin into an active PTY session from the UI;
- resizing a running PTY from the browser panel;
- xterm-style escape sequence rendering;
- long-lived terminal session management.

## Why Stream Remains Default

Most GIVEMEUI-generated interfaces are forms around explicit flags. For those, separated stdout/stderr, deterministic output analysis, and simple cancellation are better than a terminal session.

PTY mode is for commands that behave differently when attached to a terminal, prompt interactively, use progress rendering, or eventually need a full terminal panel.

## Next Work

- Add an xterm-compatible terminal surface.
- Add stdin forwarding for trusted active PTY runs.
- Add PTY resize events.
- Decide which adapters should recommend PTY mode.
- Add integration tests for PTY output and cancellation.
