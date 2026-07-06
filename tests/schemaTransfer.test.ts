import { describe, expect, it } from "vitest";
import { applyToolAdapters } from "../src/lib/adapters";
import { parseHelpOutput } from "../src/lib/helpParser";
import { exportSchemaJson, importSchemaJson, schemaExportFilename } from "../src/lib/schemaTransfer";

describe("schema transfer", () => {
  it("exports and re-imports adapter-generated schemas with provenance", () => {
    const manifest = applyToolAdapters(
      parseHelpOutput("usage: git [--version] [-C <path>]\n", "git --help", {
        version: "git version 2.45.0"
      })
    );

    const exported = exportSchemaJson(manifest);
    const parsed = JSON.parse(exported);
    const imported = importSchemaJson(exported, new Date("2026-07-05T00:00:00.000Z"));

    expect(schemaExportFilename(manifest)).toBe("git.givemeui.schema.json");
    expect(parsed.provenance).toEqual(
      expect.objectContaining({
        generatedBy: "GIVEMEUI",
        schemaFingerprint: expect.stringMatching(/^fnv1a-[a-f0-9]{8}$/),
        executable: "git",
        adapters: ["git@git version 2.45.0"]
      })
    );
    expect(imported.manifest.source).toBe("imported");
    expect(imported.manifest.updatedAt).toBe("2026-07-05T00:00:00.000Z");
    expect(imported.manifest.adapters).toEqual([
      expect.objectContaining({
        id: "git",
        name: "Git",
        version: "git version 2.45.0",
        notes: expect.arrayContaining([expect.stringContaining("Adapter matched detected version")])
      })
    ]);
  });

  it("rejects invalid adapter metadata on import", () => {
    const invalid = JSON.stringify({
      schemaVersion: 1,
      id: "bad",
      name: "Bad",
      executable: "bad",
      source: "detected",
      baseArgs: [],
      adapters: [{ id: "bad", name: "Bad", appliedAt: "2026-07-05T00:00:00.000Z", notes: "not-array" }],
      commands: [{ id: "bad", name: "bad", fields: [] }],
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    });

    expect(() => importSchemaJson(invalid)).toThrow("adapters[0].notes must be an array of strings.");
  });
});
