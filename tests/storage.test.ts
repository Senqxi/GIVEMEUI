import { describe, expect, it } from "vitest";
import {
  appendAuditLog,
  appendRun,
  appendWorkflowRun,
  areAdaptersTrusted,
  createWorkspace,
  isExecutableTrusted,
  isSchemaTrusted,
  redactSecretValues,
  trustAdapter,
  trustExecutable,
  trustSchema,
  upsertManifest,
  upsertWorkflow,
  type StoredRun
} from "../src/lib/storage";
import { sampleManifest } from "../src/lib/sampleData";
import type { CommandSpec, ToolManifest } from "../src/lib/schema";

describe("workspace storage helpers", () => {
  it("upserts manifests and makes the latest manifest active", () => {
    const workspace = createWorkspace(sampleManifest);
    const imported: ToolManifest = {
      ...sampleManifest,
      id: "imported-tool",
      name: "Imported Tool",
      source: "imported"
    };

    const next = upsertManifest(workspace, imported);

    expect(next.activeToolId).toBe("imported-tool");
    expect(next.manifests.map((manifest) => manifest.id)).toContain("imported-tool");
    expect(next.manifests.find((manifest) => manifest.id === "imported-tool")?.schemaVersion).toBe(1);
  });

  it("defaults to deterministic AI-off mode", () => {
    const workspace = createWorkspace(sampleManifest);

    expect(workspace.aiSettings).toEqual({ mode: "none", endpoint: "", model: "" });
  });

  it("trims run history to the local retention limit", () => {
    let workspace = createWorkspace(sampleManifest);

    for (let index = 0; index < 70; index += 1) {
      workspace = appendRun(workspace, createRun(`run-${index}`));
    }

    expect(workspace.runs).toHaveLength(60);
    expect(workspace.runs[0].id).toBe("run-69");
    expect(workspace.runs.at(-1)?.id).toBe("run-10");
  });

  it("redacts secret values before saving reusable data", () => {
    const command: CommandSpec = {
      id: "demo",
      name: "demo",
      fields: [
        { id: "token", label: "Token", kind: "secret", required: false, flag: "--token", confidence: 1 },
        { id: "name", label: "Name", kind: "string", required: false, flag: "--name", confidence: 1 }
      ]
    };

    expect(redactSecretValues(command.fields, { token: "abc", name: "build" })).toEqual({
      token: undefined,
      name: "build"
    });
    expect(redactSecretValues(command.fields, { token: "abc", name: "build" }, "[redacted]")).toEqual({
      token: "[redacted]",
      name: "build"
    });
  });

  it("requires explicit executable trust records", () => {
    const workspace = createWorkspace(sampleManifest);

    expect(isExecutableTrusted(workspace, sampleManifest.executable)).toBe(false);
    expect(
      isExecutableTrusted(
        trustExecutable(workspace, {
          executable: sampleManifest.executable,
          name: sampleManifest.name,
          source: "user",
          trustedAt: "2026-07-05T00:00:00.000Z"
        }),
        sampleManifest.executable,
        "/usr/bin/python3"
      )
    ).toBe(false);

    const next = trustExecutable(workspace, {
      executable: sampleManifest.executable,
      name: sampleManifest.name,
      source: "user",
      pinnedPath: "/usr/bin/python3",
      trustedAt: "2026-07-05T00:00:00.000Z"
    });

    expect(isExecutableTrusted(next, sampleManifest.executable, "/usr/bin/python3")).toBe(true);
    expect(isExecutableTrusted(next, sampleManifest.executable, "/tmp/python3")).toBe(false);
    expect(next.trustedExecutables).toHaveLength(1);
  });

  it("tracks schema and adapter trust records independently", () => {
    let workspace = createWorkspace(sampleManifest);

    expect(isSchemaTrusted(workspace, "fnv1a-demo")).toBe(false);
    workspace = trustSchema(workspace, {
      fingerprint: "fnv1a-demo",
      toolId: sampleManifest.id,
      name: sampleManifest.name,
      source: "imported",
      trustedAt: "2026-07-05T00:00:00.000Z"
    });
    workspace = trustAdapter(workspace, {
      id: "git",
      name: "Git",
      version: "git version 2.45.0",
      trustedAt: "2026-07-05T00:00:00.000Z"
    });

    expect(isSchemaTrusted(workspace, "fnv1a-demo")).toBe(true);
    expect(areAdaptersTrusted(workspace, [{ id: "git", name: "Git", version: "git version 2.45.0", appliedAt: "now", notes: [] }])).toBe(true);
    expect(areAdaptersTrusted(workspace, [{ id: "git", name: "Git", version: "git version 2.46.0", appliedAt: "now", notes: [] }])).toBe(false);
  });

  it("keeps a bounded audit log", () => {
    let workspace = createWorkspace(sampleManifest);

    for (let index = 0; index < 250; index += 1) {
      workspace = appendAuditLog(workspace, {
        id: `audit-${index}`,
        at: "2026-07-05T00:00:00.000Z",
        action: "run.blocked",
        reason: "test"
      });
    }

    expect(workspace.auditLog).toHaveLength(240);
    expect(workspace.auditLog[0].id).toBe("audit-249");
  });

  it("persists workflows and trims workflow run history", () => {
    let workspace = createWorkspace(sampleManifest);
    workspace = upsertWorkflow(workspace, {
      id: "workflow-1",
      name: "Demo Workflow",
      steps: [
        {
          id: "step-1",
          name: "Python help",
          toolId: sampleManifest.id,
          commandId: sampleManifest.commands[0].id,
          values: {}
        }
      ],
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    });

    for (let index = 0; index < 90; index += 1) {
      workspace = appendWorkflowRun(workspace, {
        id: `workflow-run-${index}`,
        workflowId: "workflow-1",
        workflowName: "Demo Workflow",
        status: "succeeded",
        stepRuns: [],
        startedAt: "2026-07-05T00:00:00.000Z",
        completedAt: "2026-07-05T00:00:00.012Z"
      });
    }

    expect(workspace.workflows).toHaveLength(1);
    expect(workspace.workflowRuns).toHaveLength(80);
    expect(workspace.workflowRuns[0].id).toBe("workflow-run-89");
    expect(workspace.workflowRuns.at(-1)?.id).toBe("workflow-run-10");
  });
});

function createRun(id: string): StoredRun {
  return {
    id,
    toolId: sampleManifest.id,
    commandId: sampleManifest.commands[0].id,
    toolName: sampleManifest.name,
    commandName: sampleManifest.commands[0].name,
    command: ["python3", "--help"],
    preview: "python3 --help",
    exitCode: 0,
    durationMs: 12,
    stdout: "ok",
    stderr: "",
    startedAt: "2026-07-05T00:00:00.000Z",
    completedAt: "2026-07-05T00:00:00.012Z"
  };
}
