import { describe, expect, it } from "vitest";
import { sampleManifest } from "../src/lib/sampleData";
import { isReviewField, normalizeToolManifest, validateToolManifest } from "../src/lib/schemaValidation";
import type { ToolManifest } from "../src/lib/schema";

describe("schema validation", () => {
  it("accepts generated manifests and normalizes schemaVersion", () => {
    const legacyManifest = { ...sampleManifest };
    delete (legacyManifest as Partial<ToolManifest>).schemaVersion;

    expect(validateToolManifest(legacyManifest).valid).toBe(true);
    expect(normalizeToolManifest(legacyManifest as ToolManifest).schemaVersion).toBe(1);
  });

  it("returns actionable errors for invalid manifests", () => {
    const result = validateToolManifest({
      schemaVersion: 7,
      id: "",
      name: "Broken",
      executable: "demo",
      source: "bad-source",
      baseArgs: "nope",
      commands: []
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "id must be a non-empty string.",
        "schemaVersion must be 1.",
        "source must be one of: detected, imported, manual, ai-enhanced.",
        "baseArgs must be an array.",
        "commands must be a non-empty array."
      ])
    );
  });

  it("detects fields that should stay in review", () => {
    expect(isReviewField({ id: "url", label: "URL", kind: "string", required: true, position: 0, confidence: 0.48 })).toBe(true);
    expect(isReviewField({ id: "help", label: "Help", kind: "boolean", required: false, flag: "--help", confidence: 0.92 })).toBe(false);
  });
});
