import { describe, expect, it } from "vitest";
import { buildRunRequest } from "../src/lib/commandBuilder";
import { detectCommandRisk, executablePinnedPath, schemaFingerprint } from "../src/lib/security";
import { sampleManifest } from "../src/lib/sampleData";
import type { CommandSpec, ToolManifest } from "../src/lib/schema";

describe("security helpers", () => {
  it("creates stable schema fingerprints without timestamp churn", () => {
    const first = schemaFingerprint(sampleManifest);
    const second = schemaFingerprint({
      ...sampleManifest,
      updatedAt: "2026-07-06T00:00:00.000Z",
      rawHelp: "different raw help"
    });

    expect(first).toMatch(/^fnv1a-[a-f0-9]{8}$/);
    expect(second).toBe(first);
  });

  it("pins discovered executables to the resolved path", () => {
    const manifest: ToolManifest = {
      ...sampleManifest,
      executable: "git",
      discovery: {
        input: "git --help",
        resolvedExecutable: "git",
        resolution: {
          input: "git",
          executable: "git",
          resolvedPath: "/usr/bin/git",
          type: "path"
        },
        helpCommand: ["git", "--help"],
        helpAttempts: [],
        warnings: []
      }
    };

    expect(executablePinnedPath(manifest)).toBe("/usr/bin/git");
  });

  it("detects destructive command patterns", () => {
    const command: CommandSpec = {
      id: "remove",
      name: "remove",
      fields: [{ id: "target", label: "Target", kind: "string", required: true, position: 0, confidence: 1 }]
    };
    const manifest = { ...sampleManifest, executable: "rm", commands: [command] };
    const request = buildRunRequest(manifest, command, { target: "/tmp/demo" });
    const risk = detectCommandRisk(manifest, command, [request.executable, "-rf", ...request.args]);

    expect(risk.destructive).toBe(true);
    expect(risk.requiresShell).toBe(false);
    expect(risk.warnings.join(" ")).toContain("Recursive forced removal");
  });

  it("gates shell executables", () => {
    const command: CommandSpec = {
      id: "shell",
      name: "shell",
      fields: [{ id: "script", label: "Script", kind: "raw", required: true, position: 0, confidence: 1 }]
    };
    const manifest = { ...sampleManifest, executable: "bash", commands: [command] };
    const risk = detectCommandRisk(manifest, command, ["bash", "-c", "echo ok"]);

    expect(risk.requiresShell).toBe(true);
    expect(risk.warnings.join(" ")).toContain("Shell executables are gated");
  });
});
