# GIVEMEUI

GIVEMEUI is a local-first command-line companion that converts terminal tools into generated graphical interfaces.

It is intended to be an MIT-licensed open-source tool that users can install from GitHub or a package registry, run from their CLI, and use locally without a hosted backend. The goal is not to replace the terminal; it is to make command-line tools faster to configure, safer to preview, and easier to repeat.

Think of it like a Wireshark-style UI layer for terminal workflows: the underlying CLI stays in control, while GIVEMEUI helps users select flags, manage presets, run commands, and inspect output.

This alpha slice focuses on deterministic behavior:

- Capture help output from a command.
- Parse flags and options into a command schema.
- Render a generated form from that schema.
- Preview the exact command arguments.
- Run the command locally without shell interpolation.
- Stream stdout/stderr into the UI.
- Edit generated field labels, descriptions, types, groups, required state, choices, and UI hints.
- Persist tool schemas, presets, and run history locally in the browser.
- Import/export command schemas as JSON.

Cloud AI is not required. AI provider support will be added later as an optional enhancement layer.

## Target Systems

GIVEMEUI starts with Unix-like systems:

- Debian and Debian-based Linux.
- Kali Linux.
- macOS.

It should work with ordinary developer tools, media tools, scripts, automation tools, and authorized security tools that users already run locally. Sensitive tools still require clear command previews, local trust, and responsible use.

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

Open `http://127.0.0.1:5173` after the CLI starts. Use another port if needed:

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
- V1 workflows: [docs/V1_WORKFLOWS.md](./docs/V1_WORKFLOWS.md)
- Threat model: [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md)
- Release process: [docs/RELEASE.md](./docs/RELEASE.md)

## License

MIT. See [LICENSE](./LICENSE).
