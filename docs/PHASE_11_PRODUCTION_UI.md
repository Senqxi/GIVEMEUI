# Phase 11 Production UI

Phase 11 tightens GIVEMEUI into a practical daily-use desktop interface for the locally installed CLI tool.

The app remains a local control surface served by the installed process. It is not a hosted web app and does not target mobile V1.

## Implemented Screens

- Tool library in the left sidebar.
- New tool discovery in the top command bar.
- Generated tool UI in the main panel.
- Schema review and field editor in the right inspector.
- Workflow builder in the lower workspace panel.
- Run history in the output console.
- Run detail in a dedicated output tab.
- Artifacts viewer in a dedicated output tab.
- Settings and AI provider settings in the local settings panel.
- Audit view in the output console.

## Navigation

The sidebar includes a compact screen navigator for:

- Discover;
- Tool UI;
- Schema;
- Workflows;
- Output.

Common keyboard actions are supported:

- `/` focuses command discovery when not editing a field.
- `Cmd/Ctrl+Enter` runs the current command when trust and safety gates pass.
- `Esc` cancels active command or workflow runs.

## Console And Output

The output console now separates:

- run history;
- selected run detail;
- artifacts;
- deterministic insights;
- stdout;
- stderr;
- audit log.

Raw log rendering is bounded to the latest 500 visible lines per stream view so long command output remains usable.

## UI Direction

The production UI keeps the existing operational layout:

- left sidebar for projects, screens, tools, and settings;
- main panel for generated command controls;
- right inspector for schema review;
- lower panels for workflows and output.

The design stays dense, restrained, and command-focused. It avoids marketing sections, decorative heroes, and oversized cards.

## Exit Criteria

- The app feels like a practical developer tool: complete.
- Core workflows are reachable in one or two clicks: complete.
- Desktop resizing does not break the layout: complete for current V1 constraints.
