import { describe, expect, it } from "vitest";
import { appendRun, createWorkspace, redactSecretValues, upsertManifest, type StoredRun } from "../src/lib/storage";
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
