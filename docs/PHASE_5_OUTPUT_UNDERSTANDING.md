# Phase 5 Output Understanding Without AI

Phase 5 makes command results easier to inspect without adding AI.

The goal is deterministic output handling: captured stdout and stderr are parsed locally into structured views when the format is obvious, while the raw terminal stream remains available.

## Scope

- Detect JSON and newline-delimited JSON.
- Detect CSV and TSV style tables.
- Highlight common error and warning lines.
- Detect progress-style output.
- Detect file artifacts mentioned in output.
- Add copy, download, and open controls where practical.
- Persist output analysis with saved run history.

## Analyzer Contract

The analyzer receives captured stdout and stderr and returns:

- format: `json`, `ndjson`, `csv`, `tsv`, or `text`
- optional JSON view
- optional table view
- diagnostics
- artifacts
- progress entries
- summary counts

The analyzer does not execute commands, read generated files, call AI, or infer intent beyond format and pattern matching.

## UI Behavior

The console now has an `Insights` tab.

That tab shows:

- output format
- error and warning counts
- detected artifact count
- JSON viewer
- table viewer
- diagnostic list
- artifact rows with copy/open controls
- progress rows
- copy/download controls for captured output

Raw stdout and stderr remain available in their existing tabs.

## Persistence

Saved runs store deterministic output analysis alongside the captured stdout and stderr.

This lets run history show badges for structured output, errors, and artifacts without reparsing old runs every time.

## Exit Criteria Status

- JSON and table-like output are displayed structurally: complete.
- File artifacts are visible and openable when represented by absolute paths: complete.
- Errors are easier to find than in raw terminal output: complete.

## Next Hardening Steps

- Resolve relative artifact paths against the run working directory.
- Add thumbnail previews for local image artifacts through the local API.
- Add safe media preview support for common audio/video outputs.
- Add configurable diagnostic patterns per tool adapter.
- Add export controls for parsed tables.
