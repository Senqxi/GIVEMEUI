# Phase 4 Safe Command Runner

Phase 4 makes GIVEMEUI a real local command runner instead of only a schema and preview tool.

## Scope

- Run local commands with executable plus argument arrays.
- Keep shell execution out of the default runner.
- Require explicit executable trust before a generated command can run.
- Stream stdout and stderr separately.
- Record exit code, signal, timeout state, duration, timestamps, working directory, and environment key names.
- Allow cancellation through the active request.
- Keep secret field values out of previews, presets, and saved run history.

## Local Runner Contract

`RunRequest` stays intentionally simple:

- `executable`: exact executable path or command name selected by the schema.
- `baseArgs`: static schema arguments and subcommands.
- `args`: generated user argument array.
- `cwd`: optional working directory.
- `env`: optional environment overrides.
- `timeoutMs`: bounded process timeout.

The server validates the request before spawning:

- executable must be present.
- args must be arrays of strings.
- null bytes are rejected.
- working directory must exist and be a directory.
- environment keys must be valid shell-style names.
- timeout must be between 1 second and 30 minutes.

Commands are launched with `shell: false`.

## Trust Model

Discovered and imported schemas are not automatically trusted for execution.

The user must trust the exact executable string shown in the command preview panel. Trust records are stored locally with:

- executable
- display name
- source
- trust timestamp

Changing to a different executable creates a new trust decision.

## Persistence

Saved runs store:

- redacted command preview
- exit code or signal
- timeout state
- duration
- stdout and stderr
- optional working directory
- environment key names only

Environment values are intentionally not stored.

## Exit Criteria Status

- User can run a generated command and see live output: complete.
- Runs can be canceled: complete.
- Run history persists locally: complete.
- Secrets are not shown in command logs: complete.
- Explicit trust is required before local execution: complete.
- Working directory, timeout, and environment controls exist: complete.

## Next Hardening Steps

- Add file picker controls for working directory and file fields.
- Add PTY mode for commands that require interactive terminal behavior.
- Add optional signed release artifacts for GitHub downloads.
- Add a stronger permissions model before adding shell mode.
- Move long-term persistence from local UI storage to SQLite or another local database.
