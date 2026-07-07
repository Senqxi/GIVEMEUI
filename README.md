# GIVEMEUI

GIVEMEUI is a locally installed command-line companion that converts terminal tools into generated graphical interfaces.

It is intended to be an MIT-licensed open-source tool that users can download from GitHub or a package registry, run from their CLI, and use locally without a hosted backend. The goal is not to replace the terminal; it is to make command-line tools faster to configure, safer to preview, and easier to repeat.

Think of it like a Wireshark-style UI layer for terminal workflows: the underlying CLI stays in control, while GIVEMEUI helps users select flags, manage presets, run commands, and inspect output.

This alpha slice focuses on deterministic behavior:

- Capture help output from a command.
- Parse flags and options into a command schema.
- Render a generated form from that schema.
- Preview the exact command arguments.
- Run the command locally without shell interpolation.
- Stream stdout/stderr into the UI.
- Optionally run commands through a local PTY for terminal-aware tools.
- Show deterministic output insights for JSON, tables, diagnostics, progress, and file artifacts.
- Optionally connect to local AI providers for reviewable schema suggestions and output explanations.
- Apply built-in adapters for popular tools such as FFmpeg, yt-dlp, and Git.
- Edit generated field labels, descriptions, types, groups, required state, choices, and UI hints.
- Persist tool schemas, trusted executables, presets, and run history locally.
- Store projects in a local SQLite database with JSON backup export.
- Import/export command schemas as JSON.

Cloud AI is not required. Local AI provider support is optional and disabled by default.

## Target Systems

GIVEMEUI starts with Unix-like systems:

- Debian and Debian-based Linux.
- Kali Linux.
- macOS.

It should work with ordinary developer tools, media tools, scripts, automation tools, and authorized security tools that users already run locally. Sensitive tools still require clear command previews, explicit executable trust, and responsible use.

GIVEMEUI is not a mobile product. The production target is a local desktop command-line installation for Debian/Linux and macOS-style systems.

## Install From Source

Until a package is published, install the CLI from a local checkout:

```bash
git clone https://github.com/Senqxi/GIVEMEUI.git
cd GIVEMEUI
npm install
npm run build
npm link
givemeui
```

The CLI serves a local desktop UI at `http://127.0.0.1:5173` after it starts. Use another port if needed:

```bash
givemeui --port 5180 --open
```

## CLI

```bash
givemeui [options]
```

Options:

- `--port <port>`: local port to listen on, default `5173`.
- `--host <host>`: local host to bind, default `127.0.0.1`.
- `--open`: open the app in your default browser.
- `--no-open`: do not open a browser.
- `--help`: print CLI help.
- `--version`: print the package version.

## Development

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://127.0.0.1:5173`.

The dev command runs both:

- Vite frontend on port `5173`.
- Local command API on port `5174`.

For a production-bundle preview with command execution, build first, run the API, then run preview in another terminal:

```bash
npm run build
node node_modules/tsx/dist/cli.mjs server/index.ts
npm run preview -- --port 5173
```

The packaged CLI serves the built frontend and API from one process:

```bash
npm run build
node bin/givemeui.mjs --no-open
```

## Useful Commands

```bash
npm run typecheck
npm run test
npm run build
npm run pack:check
```

## Community

- Contributions: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security: [SECURITY.md](./SECURITY.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Product direction: [docs/PRODUCT.md](./docs/PRODUCT.md)
- Phase 0 groundwork: [docs/PHASE_0_GROUNDWORK.md](./docs/PHASE_0_GROUNDWORK.md)
- Phase 1 discovery: [docs/PHASE_1_DISCOVERY.md](./docs/PHASE_1_DISCOVERY.md)
- Phase 2 schema review: [docs/PHASE_2_SCHEMA_REVIEW.md](./docs/PHASE_2_SCHEMA_REVIEW.md)
- Phase 4 safe runner: [docs/PHASE_4_SAFE_RUNNER.md](./docs/PHASE_4_SAFE_RUNNER.md)
- Phase 5 output understanding: [docs/PHASE_5_OUTPUT_UNDERSTANDING.md](./docs/PHASE_5_OUTPUT_UNDERSTANDING.md)
- Phase 6 local AI: [docs/PHASE_6_LOCAL_AI.md](./docs/PHASE_6_LOCAL_AI.md)
- Phase 7 tool adapters: [docs/PHASE_7_TOOL_ADAPTERS.md](./docs/PHASE_7_TOOL_ADAPTERS.md)
- Phase 8 workflow builder: [docs/PHASE_8_WORKFLOW_BUILDER.md](./docs/PHASE_8_WORKFLOW_BUILDER.md)
- Phase 9 security and trust: [docs/PHASE_9_SECURITY_TRUST.md](./docs/PHASE_9_SECURITY_TRUST.md)
- Phase 10 persistence and projects: [docs/PHASE_10_PERSISTENCE_PROJECT_MODEL.md](./docs/PHASE_10_PERSISTENCE_PROJECT_MODEL.md)
- Phase 11 production UI: [docs/PHASE_11_PRODUCTION_UI.md](./docs/PHASE_11_PRODUCTION_UI.md)
- PTY runner foundation: [docs/PTY_RUNNER_FOUNDATION.md](./docs/PTY_RUNNER_FOUNDATION.md)
- V1 workflows: [docs/V1_WORKFLOWS.md](./docs/V1_WORKFLOWS.md)
- Threat model: [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md)
- Release process: [docs/RELEASE.md](./docs/RELEASE.md)

## License

MIT. See [LICENSE](./LICENSE).
