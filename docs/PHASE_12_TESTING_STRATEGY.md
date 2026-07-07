# Phase 12 Testing Strategy

Phase 12 turns the roadmap testing checklist into a repeatable local validation stack for the CLI alpha.

## Test Commands

```bash
npm run typecheck
npm run test
npm run test:app
npm run pack:check
```

`npm run test` includes unit, integration, persistence, adapter, workflow, and app-level tests. `npm run test:app` is a focused jsdom pass for the generated UI workflow.

## Unit Coverage

- Help parsers: `tests/helpParser.test.ts`
- Schema validation: `tests/schemaValidation.test.ts`
- Command preview generation: `tests/helpParser.test.ts`
- Argument array generation: `tests/helpParser.test.ts`
- Output detection: `tests/outputAnalysis.test.ts`
- Secret redaction: `tests/storage.test.ts`
- Adapter behavior: `tests/adapters.test.ts`
- Safe runner validation: `tests/runner.test.ts`
- Workflow variable resolution: `tests/workflows.test.ts`
- Project persistence and migrations: `tests/projectDb.test.ts`
- AI prompt and parsing helpers: `tests/ai.test.ts`

## Integration Coverage

The app integration suite lives in `tests/app.integration.test.tsx` and mocks the local API boundary.

It covers:

- discovering a CLI tool from fixture-like help output;
- rendering generated fields from a discovered schema;
- editing schema field metadata;
- running a harmless mocked command;
- streaming output into the console;
- persisting run history through workspace saves;
- saving and loading presets.

Discovery and parser integration with real fixture files is covered in `tests/discovery.test.ts` and `tests/helpParser.test.ts`.

## End-To-End Coverage

Current E2E-style coverage is app-level jsdom automation, not full browser automation.

Covered flows:

- Add a CLI tool through discovery.
- Review and edit generated schema.
- Run command after trust.
- Save preset.
- Load preset back into the generated UI.
- Persist run history.
- Import/export schema is covered at the schema-transfer layer in `tests/schemaTransfer.test.ts`.

Future browser E2E should add:

- full local browser workflow against `http://127.0.0.1:5173`;
- actual harmless command execution through the local API;
- import/export through the visible UI;
- rerun from selected history once history-specific rerun semantics are separated from current-form rerun.

## Manual Baseline Commands

Use harmless commands for release smoke tests:

```bash
echo "hello"
node --help
python3 --help
python3 -c "import argparse; print('ok')"
```

For PTY smoke testing, use:

```bash
node -e "console.log(process.stdout.isTTY ? 'tty' : 'not-tty')"
```

## Exit Criteria Status

- CI/local validation can run typecheck, unit tests, app integration tests, and packaging checks: complete.
- Primary user flow has automated app-level coverage: complete.
- Representative command help fixtures are tested: complete.
- Manual harmless command list is documented: complete.
