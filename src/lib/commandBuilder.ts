import { formatCommand } from "./commandLine";
import type { CommandSpec, FieldSpec, RunRequest, ToolManifest } from "./schema";

export type FieldValues = Record<string, string | number | boolean | string[] | undefined>;
export type RunOptions = Pick<RunRequest, "cwd" | "env" | "timeoutMs">;

export function buildArgs(command: CommandSpec, values: FieldValues): string[] {
  const positional: Array<{ position: number; value: string }> = [];
  const args: string[] = [];

  for (const field of command.fields) {
    const value = values[field.id];
    if (isEmptyValue(value)) continue;

    if (field.position !== undefined) {
      positional.push({ position: field.position, value: String(value) });
      continue;
    }

    const flag = field.flag ?? field.shortFlag;
    if (!flag) continue;

    if (field.kind === "boolean") {
      if (value === true) args.push(flag);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        args.push(flag, item);
      }
      continue;
    }

    args.push(flag, String(value));
  }

  return [
    ...args,
    ...positional.sort((left, right) => left.position - right.position).map((item) => item.value)
  ];
}

export function buildRunRequest(manifest: ToolManifest, command: CommandSpec, values: FieldValues, options: RunOptions = {}): RunRequest {
  return {
    executable: manifest.executable,
    baseArgs: [...manifest.baseArgs, ...(command.subcommand ?? [])],
    args: buildArgs(command, values),
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs ?? 120000,
    redactedFieldIds: command.fields.filter((field) => field.kind === "secret").map((field) => field.id)
  };
}

export function buildCommandPreview(manifest: ToolManifest, command: CommandSpec, values: FieldValues): string {
  const request = buildRunRequest(manifest, command, values);
  return formatCommand([request.executable, ...request.baseArgs, ...request.args]);
}

export function initialValuesFor(command: CommandSpec): FieldValues {
  return Object.fromEntries(command.fields.map((field) => [field.id, initialValueForField(field)]));
}

function initialValueForField(field: FieldSpec): FieldValues[string] {
  if (field.required && field.defaultValue !== undefined) return field.defaultValue;
  if (field.kind === "boolean") return false;
  return "";
}

function isEmptyValue(value: FieldValues[string]): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
