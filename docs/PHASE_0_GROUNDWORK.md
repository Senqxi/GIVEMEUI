# Phase 0 Groundwork

Phase 0 establishes what GIVEMEUI is allowed to become before the parser, runner, adapters, and AI layers get more powerful.

## Decisions

- GIVEMEUI is a command-line companion for Linux/macOS-style terminal tools.
- V1 targets Debian, Kali Linux, macOS, and Unix-like shell workflows.
- Core functionality must work without cloud AI.
- The app ships first as a local CLI package that serves a browser UI and local API.
- Commands are represented as executable plus argument arrays.
- Shell-string execution is not part of the default execution model.
- Generated schemas are drafts that users can review and edit.
- Dual-use tools are supported only as local, user-provided tools with safety metadata and exact previews.

## Phase 0 Artifacts

- [Product direction](./PRODUCT.md)
- [V1 workflows](./V1_WORKFLOWS.md)
- [Threat model](./THREAT_MODEL.md)
- [Release process](./RELEASE.md)
- Representative help fixtures in `tests/fixtures/help/`

## Representative CLI Fixture Coverage

| Fixture | Purpose |
| --- | --- |
| `ffmpeg.txt` | Media-style flags, input files, overwrite switches |
| `yt-dlp.txt` | Downloader-style options, output templates, proxy/cookie paths |
| `git.txt` | Developer-tool flags and working-directory paths |
| `docker.txt` | Daemon/context/TLS/debug options |
| `python-argparse.txt` | Typical Python script with choices and dry-run |
| `authorized-security-tool.txt` | Sensitive credential/port/rate style fields without target guidance |

## Exit Criteria Status

- App skeleton runs locally: complete.
- Schema package has tests: complete.
- Fixture schemas exist: complete for Phase 0 baseline.
- Written threat model exists: complete.
- Command preview and execution safety documented: complete.

## Handoff

Phase 1 is now tracked in [Phase 1 deterministic CLI discovery](./PHASE_1_DISCOVERY.md).

Phase 1 improved deterministic discovery with:

- executable resolution with path display
- version capture
- richer subcommand detection
- stronger parser fixtures
- low-confidence review states
