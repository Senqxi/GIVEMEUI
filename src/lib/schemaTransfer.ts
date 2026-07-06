import type { ToolManifest } from "./schema";
import { normalizeToolManifest, validateToolManifest, type SchemaValidationResult } from "./schemaValidation";

export type SchemaImportResult = {
  manifest: ToolManifest;
  validation: SchemaValidationResult;
};

export function exportSchemaJson(manifest: ToolManifest): string {
  return JSON.stringify(normalizeToolManifest(manifest), null, 2);
}

export function schemaExportFilename(manifest: ToolManifest): string {
  const name = (manifest.name || manifest.id || "tool")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${name || "tool"}.givemeui.schema.json`;
}

export function importSchemaJson(input: string, now = new Date()): SchemaImportResult {
  const parsed: unknown = JSON.parse(input);
  const validation = validateToolManifest(parsed);
  if (!validation.valid) {
    throw new Error(`Schema import failed: ${validation.errors.slice(0, 3).join(" ")}`);
  }

  return {
    manifest: {
      ...normalizeToolManifest(parsed as ToolManifest),
      source: "imported",
      updatedAt: now.toISOString()
    },
    validation
  };
}
