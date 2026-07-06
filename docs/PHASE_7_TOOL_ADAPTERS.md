# Phase 7 Tool Adapters

Phase 7 adds a tool adapter layer on top of deterministic help parsing.

Adapters do not replace discovery. They identify known tools after help output is parsed, then improve schema metadata, output expectations, examples, and safety notes.

## Scope

- Adapter interface and registry.
- Adapter provenance stored on `ToolManifest`.
- Discovery-time adapter application.
- UI display for applied adapters.
- Tests for adapter matching and enhancements.
- Initial adapters:
  - `ffmpeg`
  - `yt-dlp`
  - `git`

## Adapter Responsibilities

Adapters can:

- identify a tool from its executable name.
- improve field labels, kinds, groups, and controls.
- set expected output artifact types.
- add examples.
- add safety notes.
- add curated commands when the generic top-level help is too broad.

Adapters cannot:

- execute commands.
- hide command previews.
- bypass executable trust.
- silently run generated commands.
- add unauthorized-use presets.

## Initial Adapter Behavior

### FFmpeg

- Labels input and output paths.
- Groups video, timing, encoding, output, and performance options.
- Adds media output expectations.
- Adds examples for transcoding and extracting audio.
- Adds overwrite-review safety notes.

### yt-dlp

- Labels URL, output template, format selector, cookies, proxy, archive, and playlist options.
- Groups authentication, network, archive, playlist, format, and output fields.
- Adds media/file output expectations.
- Adds review notes for URL, proxy, cookies, and output template.

### Git

- Improves repository path fields.
- Adds curated read-only commands:
  - `status`
  - `log`
  - `diff`
- Adds local repository context safety notes.

## Exit Criteria Status

- Adapter interface exists: complete.
- Adapter registry exists: complete.
- Adapter tests exist: complete.
- At least three popular tools produce better schemas than generic parsing: complete.
- Adapter behavior is visible in the UI: complete.

## Next Hardening Steps

- Add adapters for Docker, kubectl, Python argparse scripts, and npm scripts.
- Add adapter version constraints for behavior that changes across releases.
- Add adapter-specific output artifact resolvers.
- Add a trusted-adapter review state before community adapter loading.
- Add import/export metadata for adapter-enhanced schemas.
