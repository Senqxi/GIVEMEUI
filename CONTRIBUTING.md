# Contributing To GIVEMEUI

Thanks for helping build GIVEMEUI. This project is local-first and MIT licensed.

## Development Setup

```bash
npm install
npm run dev
```

The dev command starts:

- Vite frontend on `http://127.0.0.1:5173`
- Local command API on `http://127.0.0.1:5174`

## Before Opening A Pull Request

Run the same checks CI runs:

```bash
npm run typecheck
npm run test
npm run build
npm run pack:check
```

## Project Rules

- Keep core functionality working without cloud AI.
- Prefer deterministic parsing before AI-assisted inference.
- Execute commands with argument arrays, not shell strings.
- Do not hide the underlying command preview.
- Treat imported schemas and AI suggestions as untrusted until reviewed.
- Do not commit secrets, local env files, or generated reports.
- Keep changes scoped and tested.

## Areas That Need Help

- CLI help parsing fixtures for real-world tools.
- Safer command execution and trust prompts.
- Output rendering for JSON, CSV, tables, and generated files.
- Tool adapters for `ffmpeg`, `yt-dlp`, `docker`, `git`, and Python CLIs.
- Packaging and install flows across macOS, Linux, and Windows.

## Commit Style

Use short, imperative commit messages:

```text
Add schema import validation
Fix run history redaction
Document local install flow
```

## Security Work

Security-sensitive changes should include tests when practical. If you find a vulnerability, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
