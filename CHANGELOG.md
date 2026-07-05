# Changelog

All notable changes to GIVEMEUI will be documented in this file.

This project follows the spirit of semantic versioning while it is pre-1.0: minor versions may still include breaking changes, and breaking changes should be called out clearly.

## [Unreleased]

### Added

- Deterministic CLI help discovery.
- Generated form UI from command schemas.
- Local command execution with stdout/stderr streaming.
- Editable schema review for generated fields.
- Local browser persistence for schemas, presets, and run history.
- Import/export for schema JSON.
- `givemeui` CLI that serves the built app and API from one local process.
- MIT license, CI, issue templates, and release packaging scaffolding.
- Phase 0 production groundwork docs and representative CLI help fixtures.
- Phase 1 deterministic discovery with executable resolution, version capture, help fallbacks, positional parsing, subcommand drafts, and UI discovery metadata.
- Phase 2 schema review workflow with schema versioning, validation, field table filtering, draft Save/Discard controls, and richer field editing.
- Phase 4 safe command runner with executable trust, working directory controls, environment overrides, bounded timeouts, cancellation, and richer run history.
- Phase 5 deterministic output understanding with JSON, NDJSON, CSV/TSV, diagnostics, progress, artifact detection, and output copy/download controls.
- Phase 6 optional local AI layer with provider settings, Ollama/LM Studio/OpenAI-compatible detection, output explanations, and reviewable schema suggestions.

### Security

- Commands run through argument arrays without shell interpolation.
- Secret field values are redacted before reusable persistence.
- Initial threat model for local command wrapping, schema review, and dual-use tool boundaries.
- Discovery records unresolved executable warnings and keeps generated schemas reviewable before execution.
- Imported schemas are validated and normalized before entering the local workspace.
- Newly discovered or imported executables must be explicitly trusted before local execution.
- Run history stores environment key names only, not environment values.
- AI suggestions never execute commands and must be reviewed before changing schemas.

## [0.1.0] - TBD

Initial alpha release target.
