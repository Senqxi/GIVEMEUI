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
- Phase 7 tool adapter layer with registry support and initial adapters for FFmpeg, yt-dlp, and Git.
- Phase 8 workflow builder with saved sequential workflows, previous-step variable references, step-by-step/full workflow runs, and per-step logs/artifacts.
- Workflow builder tightening with inline workflow/step renaming, reusable workflow preset duplication, and copyable previous-step artifact tokens.
- Phase 9 security and trust hardening with schema/adapter trust, executable path pinning, destructive warnings, shell gating, provenance metadata, and a local audit log.
- Phase 10 local SQLite project model with migrations, project switching, workspace save/load, JSON project export, delete flow, cleanup flow, and output artifact metadata persistence.
- Phase 11 production UI pass with screen navigation, keyboard run/cancel/focus actions, run detail, artifacts viewer, and bounded raw log rendering.
- PTY execution foundation with explicit Stream/PTY run mode selection, terminal event streaming, workflow propagation, and local runner validation.
- Phase 12 testing strategy with jsdom app integration tests for discovery, schema editing, generated UI rendering, command runs, streamed output, run history, and presets.
- Phase 13 packaging and distribution with checksummed GitHub release tarballs, packaging metadata, manual update docs, and release artifact automation.
- QA hardening for preset saving, blank-slate workspace clearing, and reduced false-positive destructive warnings.

### Security

- Commands run through argument arrays without shell interpolation.
- Secret field values are redacted before reusable persistence.
- Initial threat model for local command wrapping, schema review, and dual-use tool boundaries.
- Discovery records unresolved executable warnings and keeps generated schemas reviewable before execution.
- Imported schemas are validated and normalized before entering the local workspace.
- Newly discovered or imported executables must be explicitly trusted before local execution.
- Imported schemas and adapter metadata require explicit trust before execution.
- Shell-mode commands are gated, and destructive command previews require explicit review.
- Schema exports include local provenance metadata and deterministic fingerprints.
- Trust decisions and command execution events are recorded in a bounded local audit log.
- Run history stores environment key names only, not environment values.
- AI suggestions never execute commands and must be reviewed before changing schemas.
- Tool adapters improve metadata only; command execution still requires preview and executable trust.
- Workflow steps run through the same safe argument-array runner and require trusted executables.
- PTY mode still uses executable plus argument arrays and remains behind the same trust, preview, timeout, and cancellation controls.

## [0.1.0] - TBD

Initial alpha release target.
