# V1 Workflows

These workflows define the first production target for GIVEMEUI.

GIVEMEUI should feel like a faster command-composition surface for users who already work in the terminal. It should preserve the power and transparency of the CLI while reducing flag memorization and repeated manual typing.

## Workflow 1: Discover A Local Tool

1. User starts GIVEMEUI from the terminal:

```bash
givemeui
```

2. User enters a command such as:

```bash
ffmpeg --help
```

3. GIVEMEUI resolves the executable from an absolute path, project-local path, or `$PATH`.
4. GIVEMEUI captures help output with a timeout.
5. GIVEMEUI generates a first-pass `ToolManifest`.
6. User sees:
   - tool name
   - executable
   - raw captured help
   - generated fields
   - parser confidence
   - schema JSON

Exit criteria:

- Discovery does not require cloud AI.
- Failed discovery gives a useful local error.
- Raw help is preserved for auditability.

## Workflow 2: Review And Correct The Schema

1. User selects a generated field.
2. User can edit:
   - label
   - description
   - type
   - required state
   - default
   - choices
   - UI group
   - advanced/hidden state
3. Generated UI updates immediately.
4. User can export the corrected schema as JSON.
5. User can re-import that schema later.
6. If local AI is enabled, user can request schema suggestions and apply or dismiss each suggestion.

Exit criteria:

- No file editing is required for ordinary schema correction.
- Low-confidence and sensitive fields are easy to inspect.
- Invalid imports are rejected with actionable errors.
- AI suggestions are optional and reviewable.

## Workflow 3: Compose And Run A Command

1. User fills out generated UI fields.
2. GIVEMEUI builds an argument-array run request.
3. User sees the exact command preview before running.
4. User explicitly trusts the resolved executable if it has not been trusted before.
5. User optionally sets a working directory, timeout, and environment variables.
6. User clicks Run.
7. GIVEMEUI executes the local process without shell interpolation.
8. GIVEMEUI streams stdout and stderr separately.
9. GIVEMEUI detects obvious JSON, tables, diagnostics, progress, and artifact paths.
10. User sees exit code, signal, timeout state, duration, structured output, and run history.

Exit criteria:

- The preview matches the executed argument array.
- Runs can be canceled.
- Secret values are redacted from reusable persistence.
- Environment values are not stored in run history.
- JSON, table-like output, artifacts, and errors are easier to inspect without AI.
- If local AI is enabled, output can be explained from captured stdout/stderr without executing follow-up commands.

## Workflow 4: Save A Repeatable Preset

1. User configures a command once.
2. User saves the field values as a preset.
3. User can reload that preset later for the same command schema.
4. Secret fields are excluded or redacted.

Exit criteria:

- Presets survive app restarts.
- Presets are scoped to a tool and command.
- Saved values do not hide the command preview.

## Workflow 5: Authorized Security Tool Wrapper

1. User discovers a locally installed security tool they are authorized to run.
2. GIVEMEUI parses documented flags into a UI.
3. GIVEMEUI marks sensitive fields and command categories when detected or adapter-provided.
4. User must explicitly trust the executable and review the exact command preview before execution.
5. GIVEMEUI does not provide unauthorized targets, credential lists, or attack-playbook presets.

Exit criteria:

- Sensitive options are visible and reviewable.
- Secret fields are redacted.
- The product remains a local wrapper around user-provided tools, not a misuse guide.

## Workflow 6: Install From GitHub

1. User clones the repo.
2. User installs dependencies.
3. User builds the app.
4. User links or runs the CLI.

```bash
git clone https://github.com/Senqxi/GIVEMEUI.git
cd GIVEMEUI
npm install
npm run build
npm link
givemeui
```

Exit criteria:

- `givemeui` serves the local desktop UI and API from one local process.
- No hosted backend is required.
- CI verifies the package contents before release.
