# Product Direction

GIVEMEUI is a command-line companion.

It is not a generic app builder and it is not meant to hide the terminal from people who know how to use it. Its job is to make command-line tools faster, safer, and easier to operate by generating a focused UI around the tool's documented flags, arguments, presets, output, and run history.

Think of it like a Wireshark-style interface for terminal workflows: the power still comes from the underlying command-line tool, but the user gets a structured interface for choosing options, previewing the exact command, running it, and reading the result.

## Primary Target

Start with Unix-like systems:

- Debian and Debian-based Linux.
- Kali Linux.
- macOS.

Windows support can come later, but V1 should optimize for tools and workflows common on Linux and macOS shells.

## Core User Flow

1. User enters or selects a local command-line tool.
2. GIVEMEUI captures help output and metadata.
3. GIVEMEUI generates a schema from flags, arguments, defaults, choices, and descriptions.
4. User reviews and edits the schema.
5. GIVEMEUI renders a practical UI for that command.
6. User fills inputs, selects presets, and previews the exact command.
7. User runs the command locally.
8. GIVEMEUI streams stdout/stderr, exit status, artifacts, and run history.

## Tool Categories

GIVEMEUI should work for broad terminal tooling, including:

- Media tools such as `ffmpeg`, `imagemagick`, and `yt-dlp`.
- Developer tools such as `git`, `docker`, `kubectl`, `npm`, and Python scripts.
- Data and automation tools such as Python/R scripts, shell scripts, CSV tools, and backup utilities.
- Authorized security tools commonly used on Kali Linux and Debian-based systems.

Security-oriented tools are in scope as local tools a user may already be authorized to run. GIVEMEUI should not become an attack playbook generator. It should expose documented options, preserve command previews, require trust for newly discovered executables, and keep safety metadata visible.

## Design Priorities

- Speed up command composition.
- Reduce flag memorization.
- Make command previews impossible to miss.
- Make repeated workflows easy through presets.
- Keep advanced options accessible without overwhelming the default view.
- Show output clearly, including errors, warnings, tables, JSON, and files.
- Preserve terminal-level transparency for advanced users.

## Non-Goals

- Do not hide the underlying command.
- Do not generate unauthorized usage guidance.
- Do not require cloud AI.
- Do not replace the underlying CLI tool.
- Do not turn into a broad low-code app builder.
- Do not silently modify commands or schemas without review.

## Safety Boundaries

GIVEMEUI can wrap powerful tools, including dual-use tools. That requires product-level guardrails:

- Run local executables only after clear user action.
- Store commands as argument arrays, not shell strings.
- Show exact command previews before execution.
- Mark destructive, privileged, credential-based, network-scanning, or brute-force-capable commands as sensitive when detected or adapter-provided.
- Redact secrets from persisted presets and run logs.
- Avoid shipping presets that imply unauthorized targets or credential attacks.
- Treat imported schemas as untrusted until reviewed.
