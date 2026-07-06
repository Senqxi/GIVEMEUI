# Phase 10 Persistence And Project Model

Phase 10 moves GIVEMEUI from browser-only persistence toward a durable local project database for the installed CLI tool.

The browser still keeps a localStorage fallback cache, but the source of truth for normal installed use is now a local SQLite database served by the local GIVEMEUI process.

## Local Database

GIVEMEUI stores project data in:

```text
~/.givemeui/givemeui.sqlite
```

The location can be overridden for development or testing:

```bash
GIVEMEUI_DATA_DIR=/path/to/data givemeui
GIVEMEUI_DB_PATH=/path/to/givemeui.sqlite givemeui
```

The implementation uses `sql.js`, which keeps installation portable because it does not require native SQLite compilation during `npm install`.

## Persisted Data

The SQLite schema persists:

- projects;
- active project settings;
- tool manifests;
- presets;
- run history;
- workflow definitions;
- workflow run history;
- output artifact metadata;
- trusted executables;
- trusted schemas;
- trusted adapters;
- audit log entries;
- AI settings.

## Migrations

Migrations are tracked in the `migrations` table. Version 1 creates the initial project model and all workspace tables.

Migration coverage is included in `tests/projectDb.test.ts`.

## Project Model

The local API exposes project operations:

- load active project snapshot;
- save active workspace;
- create project;
- select project;
- delete project;
- export project backup;
- cleanup old retained records.

The sidebar includes a compact Project section for project selection, creation, export, cleanup, and deletion.

## Backup And Cleanup

Project export downloads a `.givemeui.project.json` backup containing project metadata plus the full workspace payload.

Cleanup trims persisted records to current retention limits:

- 60 command runs;
- 80 workflow runs;
- 240 audit log entries.

## Limitations

- This phase introduces local database persistence, not cloud sync.
- Export is JSON-based for portability; direct SQLite backup/restore UX is a later release concern.
- Delete removes the local project from the SQLite database after user confirmation.
- Importing a full project backup is intentionally deferred until restore semantics and trust review are designed.

## Exit Criteria

- User data persists across restarts: complete.
- Database migrations are tested: complete.
- User can export important data: complete.
