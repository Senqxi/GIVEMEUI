# Phase 2 Schema Review And Editing

Phase 2 makes generated schemas reviewable before users rely on them for command execution.

## Implemented Capabilities

- Adds `schemaVersion: 1` to generated manifests.
- Normalizes older imported or stored manifests to schema version 1.
- Validates imported schemas before storing them.
- Returns actionable validation errors for invalid imports.
- Shows active schema health in the review panel.
- Adds a field table with type and confidence columns.
- Adds an `All Fields` and `Needs Review` filter.
- Keeps low-confidence and structurally ambiguous fields visible for review.
- Edits fields through local drafts.
- Adds explicit `Save Field` and `Discard` controls.
- Supports editing:
  - label
  - description
  - type
  - required state
  - default value
  - choices
  - placeholder
  - group
  - advanced state
  - validation min, max, and pattern
- Preserves raw help and schema JSON views.
- Imports schemas as untrusted drafts and opens review-oriented fields first.

## Validation Rules

The validator checks:

- manifest identity, executable, source, timestamps, and schema version
- command identity, duplicate command IDs, fields array, and subcommand shape
- field identity, duplicate field IDs, kind, confidence range, flags, choices, and required state
- enum fields without choices as warnings
- fields without flags or positional indexes as warnings

## Current Limits

- Schema versioning is currently a single supported version: `1`.
- Field draft editing is scoped to one selected field at a time.
- The schema JSON viewer is read-only.
- Import still uses a paste prompt instead of a file picker.
- Review state is inferred from confidence and structure; explicit user-reviewed markers are not stored yet.

## Next Production Step

Phase 3 should deepen the schema-driven UI generator:

- stronger validation feedback in generated forms
- richer controls for field kinds
- better grouping and advanced-field ergonomics
- required-field run blocking
- keyboard-friendly navigation through generated forms
