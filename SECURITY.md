# Security Policy

GIVEMEUI runs local commands, so security issues matter even in early alpha.

## Supported Versions

The project is pre-1.0. Security fixes are handled on the `main` branch until stable release branches exist.

## Reporting A Vulnerability

Do not open a public issue for vulnerabilities.

Until a dedicated security contact is published, report privately through the repository owner's GitHub profile or by opening a private advisory if you have maintainer access.

Include:

- A clear description of the issue.
- Steps to reproduce.
- The affected version or commit.
- Whether command execution, schema import, secret handling, or local file access is involved.
- Any suggested fix, if known.

## Security Principles

- Core execution uses executable plus argument arrays.
- Shell execution is not enabled by default.
- Imported schemas are treated as untrusted.
- Secret fields should not be saved into reusable presets or run logs.
- Cloud AI must be opt-in and must not execute commands.

## Out Of Scope

- Vulnerabilities in third-party CLI tools launched by the user.
- Commands explicitly entered and run by the local user.
- Local machine compromise outside the GIVEMEUI process.
