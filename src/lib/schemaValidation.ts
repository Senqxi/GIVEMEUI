import type { AdapterMetadata, CommandSpec, FieldKind, FieldSpec, ToolManifest, ToolSource } from "./schema";

export type SchemaValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

const TOOL_SOURCES: ToolSource[] = ["detected", "imported", "manual", "ai-enhanced"];
const FIELD_KINDS: FieldKind[] = ["string", "number", "boolean", "enum", "file", "directory", "multi-file", "secret", "array", "raw"];

export function validateToolManifest(value: unknown): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["Manifest must be a JSON object."], warnings };
  }

  const manifest = value as Partial<ToolManifest>;
  requireString(manifest.id, "id", errors);
  requireString(manifest.name, "name", errors);
  requireString(manifest.executable, "executable", errors);
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.");
  }

  if (typeof manifest.source !== "string" || !TOOL_SOURCES.includes(manifest.source)) {
    errors.push(`source must be one of: ${TOOL_SOURCES.join(", ")}.`);
  }

  if (!Array.isArray(manifest.baseArgs)) {
    errors.push("baseArgs must be an array.");
  } else if (!manifest.baseArgs.every((arg) => typeof arg === "string")) {
    errors.push("baseArgs must contain only strings.");
  }

  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    errors.push("commands must be a non-empty array.");
  } else {
    validateCommands(manifest.commands, errors, warnings);
  }

  requireString(manifest.createdAt, "createdAt", errors);
  requireString(manifest.updatedAt, "updatedAt", errors);
  validateAdapters(manifest.adapters, errors);
  validateProvenance(manifest.provenance, errors);

  return { valid: errors.length === 0, errors, warnings };
}

export function isToolManifest(value: unknown): value is ToolManifest {
  return validateToolManifest(value).valid;
}

export function normalizeToolManifest(manifest: ToolManifest): ToolManifest {
  return {
    ...manifest,
    schemaVersion: 1,
    baseArgs: [...manifest.baseArgs],
    commands: manifest.commands.map((command) => ({
      ...command,
      subcommand: command.subcommand ? [...command.subcommand] : undefined,
      fields: command.fields.map((field) => ({
        ...field,
        choices: field.choices ? [...field.choices] : undefined,
        validation: field.validation ? { ...field.validation } : undefined,
        ui: field.ui ? { ...field.ui } : undefined
      }))
    })),
    adapters: manifest.adapters ? manifest.adapters.map((adapter) => ({ ...adapter, notes: [...adapter.notes] })) : undefined,
    provenance: manifest.provenance
      ? {
          ...manifest.provenance,
          adapters: manifest.provenance.adapters ? [...manifest.provenance.adapters] : undefined
        }
      : undefined
  };
}

export function isReviewField(field: FieldSpec): boolean {
  return field.confidence < 0.78 || field.kind === "raw" || (!field.flag && !field.shortFlag && field.position === undefined);
}

function validateCommands(commands: unknown[], errors: string[], warnings: string[]): void {
  const commandIds = new Set<string>();

  commands.forEach((item, commandIndex) => {
    if (!item || typeof item !== "object") {
      errors.push(`commands[${commandIndex}] must be an object.`);
      return;
    }

    const command = item as Partial<CommandSpec>;
    requireString(command.id, `commands[${commandIndex}].id`, errors);
    requireString(command.name, `commands[${commandIndex}].name`, errors);

    if (typeof command.id === "string") {
      if (commandIds.has(command.id)) errors.push(`commands[${commandIndex}].id duplicates another command.`);
      commandIds.add(command.id);
    }

    if (command.subcommand !== undefined && (!Array.isArray(command.subcommand) || !command.subcommand.every((arg) => typeof arg === "string"))) {
      errors.push(`commands[${commandIndex}].subcommand must be an array of strings.`);
    }

    if (!Array.isArray(command.fields)) {
      errors.push(`commands[${commandIndex}].fields must be an array.`);
      return;
    }

    validateFields(command.fields, commandIndex, errors, warnings);
  });
}

function validateFields(fields: unknown[], commandIndex: number, errors: string[], warnings: string[]): void {
  const fieldIds = new Set<string>();

  fields.forEach((item, fieldIndex) => {
    if (!item || typeof item !== "object") {
      errors.push(`commands[${commandIndex}].fields[${fieldIndex}] must be an object.`);
      return;
    }

    const field = item as Partial<FieldSpec>;
    const prefix = `commands[${commandIndex}].fields[${fieldIndex}]`;
    requireString(field.id, `${prefix}.id`, errors);
    requireString(field.label, `${prefix}.label`, errors);

    if (typeof field.id === "string") {
      if (fieldIds.has(field.id)) errors.push(`${prefix}.id duplicates another field in this command.`);
      fieldIds.add(field.id);
    }

    if (typeof field.kind !== "string" || !FIELD_KINDS.includes(field.kind)) {
      errors.push(`${prefix}.kind must be one of: ${FIELD_KINDS.join(", ")}.`);
    }

    if (typeof field.required !== "boolean") {
      errors.push(`${prefix}.required must be a boolean.`);
    }

    if (typeof field.confidence !== "number" || field.confidence < 0 || field.confidence > 1) {
      errors.push(`${prefix}.confidence must be a number from 0 to 1.`);
    }

    if (field.flag !== undefined && (typeof field.flag !== "string" || !field.flag.startsWith("--"))) {
      errors.push(`${prefix}.flag must start with -- when provided.`);
    }

    if (field.shortFlag !== undefined && (typeof field.shortFlag !== "string" || !field.shortFlag.startsWith("-"))) {
      errors.push(`${prefix}.shortFlag must start with - when provided.`);
    }

    if (field.choices !== undefined && (!Array.isArray(field.choices) || !field.choices.every((choice) => typeof choice === "string"))) {
      errors.push(`${prefix}.choices must be an array of strings.`);
    }

    if (field.kind === "enum" && (!Array.isArray(field.choices) || field.choices.length === 0)) {
      warnings.push(`${prefix} is enum but has no choices.`);
    }

    if (!field.flag && !field.shortFlag && field.position === undefined) {
      warnings.push(`${prefix} has no flag or positional index.`);
    }
  });
}

function validateAdapters(adapters: unknown, errors: string[]): void {
  if (adapters === undefined) return;
  if (!Array.isArray(adapters)) {
    errors.push("adapters must be an array when provided.");
    return;
  }

  adapters.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      errors.push(`adapters[${index}] must be an object.`);
      return;
    }

    const adapter = item as Partial<AdapterMetadata>;
    requireString(adapter.id, `adapters[${index}].id`, errors);
    requireString(adapter.name, `adapters[${index}].name`, errors);
    requireString(adapter.appliedAt, `adapters[${index}].appliedAt`, errors);

    if (adapter.version !== undefined && typeof adapter.version !== "string") {
      errors.push(`adapters[${index}].version must be a string when provided.`);
    }

    if (!Array.isArray(adapter.notes) || !adapter.notes.every((note) => typeof note === "string")) {
      errors.push(`adapters[${index}].notes must be an array of strings.`);
    }
  });
}

function validateProvenance(provenance: unknown, errors: string[]): void {
  if (provenance === undefined) return;
  if (!provenance || typeof provenance !== "object") {
    errors.push("provenance must be an object when provided.");
    return;
  }

  const metadata = provenance as Record<string, unknown>;
  for (const key of ["exportedAt", "schemaFingerprint", "generatedBy", "source", "executable", "resolvedPath"]) {
    if (metadata[key] !== undefined && typeof metadata[key] !== "string") {
      errors.push(`provenance.${key} must be a string when provided.`);
    }
  }
  if (metadata.adapters !== undefined && (!Array.isArray(metadata.adapters) || !metadata.adapters.every((item) => typeof item === "string"))) {
    errors.push("provenance.adapters must be an array of strings when provided.");
  }
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} must be a non-empty string.`);
  }
}
