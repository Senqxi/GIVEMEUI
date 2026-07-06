# Phase 8 Workflow Builder

Phase 8 adds local sequential workflows for chaining saved command steps without writing shell script glue.

Workflows are still command-schema driven. Each step resolves to an executable plus argument arrays and runs through the existing safe runner. Workflow execution does not introduce shell string execution.

## Scope

- Workflow schema for saved workflows, steps, step runs, statuses, logs, and artifacts.
- Local persistence for workflows and workflow run history.
- Workflow Builder panel in the local UI.
- Add the current generated command as a workflow step.
- Rename workflows and workflow steps inline.
- Duplicate an existing workflow as a reusable preset.
- Run all workflow steps from the beginning.
- Run the next pending workflow step.
- Variable references between steps.
- Copy previous-step artifact tokens from the workflow editor.
- Per-step stdout, stderr, status, timing, command preview, and detected artifacts.

## Workflow Schema

Saved workflows contain:

- `id`
- `name`
- ordered `steps`
- timestamps

Each step stores:

- target `toolId`
- target `commandId`
- captured field `values`
- optional run settings

Workflow runs contain:

- workflow id and name
- final status
- ordered step run records
- per-step command preview, output, analysis, timing, and status

## Variable References

Workflow field values and run settings can reference earlier step results:

```text
{{steps.<step-id>.artifacts.first}}
{{steps.<step-id>.artifacts.0}}
{{steps.<step-id>.stdout}}
{{steps.<step-id>.stderr}}
```

The UI shows a first-artifact token for each step. Users can paste that token into a later file/path field before adding the later command as a step.

References are resolved immediately before a step runs. Missing references resolve to an empty string so the final command preview remains explicit and debuggable.

## Workflow Presets

Saved workflows act as reusable workflow presets. Users can duplicate a workflow with **Save As Preset** before changing names, steps, or field values for a variation.

When a workflow preset is duplicated, GIVEMEUI generates new step ids and rewrites internal `{{steps...}}` references so copied workflows remain self-contained.

## Safety Behavior

- Workflows run locally only.
- Each workflow step uses the existing `/api/run` endpoint.
- Commands are executed as argument arrays.
- Untrusted executables fail the workflow step before execution.
- Secret fields are redacted before values are stored in workflow steps.
- Output artifact detection reuses the deterministic Phase 5 analyzer.

## Exit Criteria Status

- User can build a two-step workflow without writing shell script glue: complete.
- Workflow runs are persisted and debuggable: complete.
- Workflow presets can be saved and reused: complete.

## Next Hardening Steps

- Add drag-and-drop step reordering.
- Add editable workflow step values after a step has been captured.
- Add import/export for workflows.
- Add workflow-level trust review before running imported workflows.
- Add richer artifact pickers for selecting a specific previous output.
