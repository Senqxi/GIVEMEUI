# Threat Model

GIVEMEUI is a local app that helps users run local command-line tools. Its primary security risk is that a friendly UI can make a powerful command easier to run without enough understanding or review.

## Assets

- Local filesystem paths selected by the user.
- Command schemas and presets.
- Run history and captured output.
- Secret field values typed into generated forms.
- Environment variables passed to child processes.
- Trust decisions for local executables and imported schemas.

## Trust Boundaries

### Trusted

- GIVEMEUI source code installed by the user.
- The local browser session rendering the app.
- The local API process started by `givemeui`.

### User-Reviewed

- Local executables found through `$PATH`.
- Generated command schemas.
- Imported schema JSON.
- Adapter-provided schemas.
- Optional AI suggestions.

### Untrusted

- Raw help output from arbitrary commands.
- Command stdout/stderr.
- Imported schemas before review.
- AI-generated schema patches.
- File paths printed by commands.
- Network output or remote content fetched by wrapped tools.

## Main Threats

| Threat | Risk | Mitigation |
| --- | --- | --- |
| Command injection | User input becomes shell code | Store executable and arguments as arrays; no shell mode by default |
| Misleading generated UI | Friendly label hides dangerous flag | Preserve raw help, show flag names, allow schema review |
| Destructive command execution | UI makes destructive commands easy to run | Detect destructive patterns, show warnings, require preview acknowledgement, and block destructive workflow steps until workflow-level review exists |
| Secret leakage | Passwords or tokens saved into presets/logs | Secret field type and redaction before persistence |
| Unsafe schema import | Imported JSON hides risky defaults | Treat imports as untrusted, fingerprint schemas, and require review before execution |
| Wrong binary execution | `$PATH` resolves unexpected executable | Show executable path and pin trust decisions to resolved paths when discovery provides them |
| Dual-use tool misuse | UI accelerates unauthorized activity | No bundled unauthorized presets, exact previews, sensitive metadata |
| AI hallucination | AI invents invalid or unsafe flags | AI suggestions are optional, diffable, and user-reviewed |

## Command Execution Rules

- Default execution uses `spawn(executable, args, { shell: false })`.
- Shell mode is gated and does not execute in this build.
- Every run must have a visible command preview.
- Newly discovered executables must become trust decisions before execution.
- Timeouts and cancellation are required.
- stdout and stderr are captured separately.
- Trust decisions and execution events are recorded in the local audit log with redacted previews.

## Schema Import Rules

- Validate structure before storing.
- Preserve provenance.
- Do not trust labels more than flags.
- Imported schemas open in review mode and require explicit trust before execution.
- Future schema versions must not silently break old presets or run records.

## Secret Handling Rules

- Fields inferred as passwords, tokens, or secrets use `kind: "secret"`.
- Secret values should not be saved in presets.
- Secret values should be redacted from run records and logs.
- Secret previews should show placeholders, not raw values.

## Dual-Use Tool Rules

GIVEMEUI may wrap authorized security tools installed by the user, especially on Kali Linux and Debian-based systems. It must not ship content that encourages unauthorized use.

Production behavior should include:

- Sensitive-command metadata for destructive, privileged, credential-based, network-scanning, and brute-force-capable options.
- No bundled targets, credential lists, or exploit workflows.
- Clear command preview before execution.
- Adapter docs that focus on safe local wrapping and schema quality, not target guidance.

## Phase 0 Security Decisions

- Keep core functionality local-first.
- Keep cloud AI optional.
- Keep command preview central.
- Keep command execution argument-array based.
- Treat generated schemas as drafts.
- Document trust and redaction before adding more powerful adapters.
