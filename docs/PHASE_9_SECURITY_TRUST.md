# Phase 9 Security And Trust Hardening

Phase 9 prepares GIVEMEUI for real users running real local commands from an installed CLI tool. The local browser UI is still only the desktop control surface served by the installed tool; command execution remains local and uses argv arrays without shell interpolation.

## Implemented Controls

- Trusted executable records with optional pinned resolved paths.
- Imported schema trust based on deterministic schema fingerprints.
- Adapter trust based on adapter id and detected version.
- Clear command preview before each run.
- Destructive-command detection for schema-marked commands, common destructive executables, and risky flags.
- Shell-mode gating for shell executables and schema commands marked `requiresShell`.
- Schema export provenance with fingerprint, source, executable, resolved path, and adapter ids.
- Secret redaction before presets, reusable workflow steps, run history, and audit previews are persisted.
- Local audit log records for trust decisions, blocked runs, command starts/completions, and workflow starts/completions.

## Trust Model

Executable trust is tied to the manifest executable and, when available, the resolved path discovered from the local system. If a tool was discovered from `$PATH`, the trust record pins the resolved path shown in the command preview.

Imported schemas are not trusted just because they validate. They open in review mode, receive a deterministic fingerprint, and must be explicitly trusted before execution.

Adapter metadata is also a trust boundary. Adapter-generated schemas can improve UI quality, but an adapter id/version must be trusted before running commands from that enhanced schema.

## Run Gating

A direct command run is allowed only when:

- the executable is trusted;
- imported schema trust is satisfied;
- applied adapter trust is satisfied;
- the command does not require shell mode;
- destructive risk is either absent or explicitly acknowledged for the current preview.

Workflow steps use the same trust model. Destructive workflow steps are blocked in this phase until a dedicated workflow-level destructive review flow exists.

## Audit Log

Audit records are stored locally in the workspace and capped to a bounded retention window. The console includes an Audit tab that shows recent trust decisions, blocked runs, and run/workflow execution records using redacted command previews.

## Limitations

- GIVEMEUI is not an OS sandbox. It does not prevent a trusted executable from doing what the local user account is allowed to do.
- Shell execution remains gated rather than implemented.
- Path pinning depends on discovery metadata. Manual schemas without resolved paths can only trust the executable string.
- Destructive detection is intentionally conservative and deterministic; adapters should continue adding richer safety metadata over time.

## Exit Criteria

- New executable requires user trust: complete.
- Imported schema requires review: complete.
- Shell mode is explicitly gated: complete.
- Secret redaction has tests: complete.
