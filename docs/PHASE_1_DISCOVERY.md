# Phase 1 Deterministic CLI Discovery

Phase 1 makes GIVEMEUI useful without AI by turning a local command into a reviewable first-pass schema.

## Implemented Capabilities

- Resolves executables from absolute paths, relative paths, and `$PATH`.
- Records unresolved executables explicitly instead of hiding lookup failure.
- Captures help output without shell interpolation.
- Tries deterministic help forms:
  - `COMMAND --help`
  - `COMMAND -h`
  - `COMMAND help`
  - `COMMAND help SUBCOMMAND` for command lines with subcommands
- Scores help attempts and keeps the best captured output.
- Captures versions through `--version`, `version`, and `-version`.
- Stores discovery metadata on the generated `ToolManifest`.
- Shows resolved executable, source type, version, help command, attempt count, and warnings in the UI.
- Preserves raw help output for review and export.

## Parser Coverage

The generic parser now detects:

- Long flags.
- Short flags.
- Flags with values.
- Boolean switches.
- Choices from brace and pipe syntax.
- Defaults from descriptions.
- Sensitive credential fields.
- Required flag hints from usage text.
- Positional arguments from usage text.
- Top-level subcommands from `Commands:` style sections.
- Low-confidence fields that stay visible in schema review.

## Test Coverage

Automated tests cover:

- Representative help fixtures for `ffmpeg`, `yt-dlp`, `git`, `docker`, Python `argparse`, and an authorized security-tool style CLI.
- Help-command fallback generation.
- Positional argument extraction.
- Subcommand extraction.
- `$PATH` executable resolution.
- Unresolved executable reporting.
- Help and version capture from a temporary local CLI fixture.

## Current Limits

- Top-level subcommands use inherited global fields until subcommand-specific help capture is added.
- `man` page and structured metadata discovery are planned but not implemented yet.
- Framework-specific adapters for `click`, `typer`, `cobra`, `clap`, `commander`, and `yargs` are still future work.
- Low-confidence fields are editable in schema review, but there is not yet a dedicated review queue.

## Next Production Step

Phase 2 should deepen schema review and editing:

- field table and detail review improvements
- explicit low-confidence review workflow
- schema validation errors
- import provenance and review mode
- schema versioning
