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

### Security

- Commands run through argument arrays without shell interpolation.
- Secret field values are redacted before reusable persistence.
- Initial threat model for local command wrapping, schema review, and dual-use tool boundaries.
- Discovery records unresolved executable warnings and keeps generated schemas reviewable before execution.

## [0.1.0] - TBD

Initial alpha release target.
