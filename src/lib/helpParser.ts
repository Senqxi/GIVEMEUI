import { commandNameFromExecutable, parseCommandLine } from "./commandLine";
import type { CommandSpec, FieldKind, FieldSpec, ToolManifest } from "./schema";

type ParsedOption = {
  flag?: string;
  shortFlag?: string;
  valueHint?: string;
  description: string;
  confidence: number;
};

const HELP_ARGS = new Set(["--help", "-h", "help"]);

export function commandLineForHelp(input: string): string[] {
  const argv = parseCommandLine(input);
  if (argv.length === 0) return [];
  const hasHelp = argv.slice(1).some((arg) => HELP_ARGS.has(arg));
  return hasHelp ? argv : [...argv, "--help"];
}

export function parseHelpOutput(helpText: string, originalCommandLine: string): ToolManifest {
  const originalArgv = parseCommandLine(originalCommandLine);
  const executable = originalArgv[0] ?? "command";
  const baseArgs = originalArgv.slice(1).filter((arg) => !HELP_ARGS.has(arg));
  const name = commandNameFromExecutable(executable);
  const fields = parseFields(helpText);
  const command: CommandSpec = {
    id: stableId(`${name}-default`),
    name,
    description: firstSentence(helpText) ?? `Generated UI for ${name}`,
    fields,
    output: { expectedTypes: ["text"] },
    safety: {
      notes: ["Runs locally without shell interpolation."]
    }
  };

  const now = new Date().toISOString();
  return {
    id: stableId(`${name}-${baseArgs.join("-") || "root"}`),
    name,
    executable,
    baseArgs,
    source: "detected",
    rawHelp: helpText,
    commands: [command],
    createdAt: now,
    updatedAt: now
  };
}

export function parseFields(helpText: string): FieldSpec[] {
  const fields: FieldSpec[] = [];
  const seen = new Set<string>();
  const usedIds = new Set<string>();
  let pending: FieldSpec | null = null;

  for (const rawLine of helpText.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "    ");
    const option = parseOptionLine(line);

    if (!option) {
      if (pending && /^\s{6,}\S/.test(line)) {
        pending.description = [pending.description, line.trim()].filter(Boolean).join(" ");
      }
      continue;
    }

    const id = uniqueId(stableId(option.flag ?? option.shortFlag ?? option.valueHint ?? option.description), usedIds);
    const key = option.flag ?? option.shortFlag ?? id;
    if (seen.has(key)) {
      pending = null;
      continue;
    }

    const field = toFieldSpec(id, option);
    fields.push(field);
    seen.add(key);
    usedIds.add(id);
    pending = field;
  }

  return fields;
}

function parseOptionLine(line: string): ParsedOption | null {
  const trimmed = line.trimEnd();
  const leftTrimmed = trimmed.trimStart();
  if (!leftTrimmed.startsWith("-")) return null;

  const split = splitOptionDescription(leftTrimmed);
  if (!split) return null;

  const segments = splitOptionSegments(split.spec);

  let flag: string | undefined;
  let shortFlag: string | undefined;
  let valueHint: string | undefined;

  for (const segment of segments) {
    const parsed = parseOptionSegment(segment);
    if (!parsed) continue;
    if (parsed.flag.startsWith("--")) {
      flag = parsed.flag;
      valueHint = valueHint ?? parsed.valueHint;
    } else if (parsed.flag.startsWith("-")) {
      shortFlag = parsed.flag;
      valueHint = valueHint ?? parsed.valueHint;
    }
  }

  if (!flag && !shortFlag) return null;

  return {
    flag,
    shortFlag,
    valueHint,
    description: split.description,
    confidence: flag ? 0.82 : 0.7
  };
}

function splitOptionDescription(input: string): { spec: string; description: string } | null {
  const separator = input.match(/\s+:\s+|:\s+|\s{2,}/);
  if (separator?.index !== undefined) {
    const spec = input.slice(0, separator.index).replace(/:$/, "").trim();
    const description = input.slice(separator.index + separator[0].length).trim();
    return spec ? { spec, description } : null;
  }

  if (input.endsWith(":")) {
    const spec = input.slice(0, -1).trim();
    return spec ? { spec, description: "" } : null;
  }

  return null;
}

function parseOptionSegment(segment: string): { flag: string; valueHint?: string } | null {
  const match = segment.match(/^(-{1,2}[A-Za-z0-9][A-Za-z0-9-_]*)(?:[=\s]+(.+))?$/);
  if (!match) return null;
  const valueHint = match[2]?.trim().replace(/^\[|\]$/g, "");
  return { flag: match[1], valueHint };
}

function splitOptionSegments(spec: string): string[] {
  const segments: string[] = [];
  let current = "";
  let braceDepth = 0;

  for (const char of spec) {
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth = Math.max(0, braceDepth - 1);

    if (char === "," && braceDepth === 0) {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function toFieldSpec(id: string, option: ParsedOption): FieldSpec {
  const label = labelFromOption(option, id);
  const choices = extractChoices(option.valueHint, option.description);
  const defaultValue = extractDefault(option.description);
  const kind = inferKind(option, choices, defaultValue);
  const group = inferGroup(option, kind);

  return {
    id,
    label,
    description: option.description || undefined,
    kind,
    required: false,
    flag: option.flag,
    shortFlag: option.shortFlag,
    defaultValue,
    choices,
    placeholder: placeholderFromKind(kind, option.valueHint),
    ui: {
      group,
      advanced: isAdvanced(option),
      control: kind === "boolean" ? "switch" : kind === "enum" ? "select" : kind === "number" ? "number" : undefined
    },
    confidence: option.confidence
  };
}

function inferKind(option: ParsedOption, choices: string[] | undefined, defaultValue: string | number | undefined): FieldKind {
  const source = `${option.flag ?? ""} ${option.shortFlag ?? ""} ${option.valueHint ?? ""} ${option.description}`.toLowerCase();
  if (source.includes("password") || source.includes("secret") || source.includes("token")) return "secret";
  if (choices?.length) return "enum";
  if (!option.valueHint) return "boolean";
  if (typeof defaultValue === "number") return "number";
  if (/\b(number|integer|float|count|seconds|minutes|hours|port|size|limit|width|height|quality|level)\b/.test(source)) {
    return "number";
  }
  if (/\b(directory|folder|dir|cwd)\b/.test(source)) return "directory";
  if (/\b(file|path|input|output|source|destination|dest)\b/.test(source)) return "file";
  return "string";
}

function inferGroup(option: ParsedOption, kind: FieldKind): string {
  const source = `${option.flag ?? ""} ${option.description}`.toLowerCase();
  if (kind === "file" || kind === "directory") return "Files";
  if (source.includes("debug") || source.includes("verbose") || source.includes("warning")) return "Diagnostics";
  if (source.includes("format") || source.includes("output")) return "Output";
  return "Options";
}

function extractChoices(valueHint: string | undefined, description: string): string[] | undefined {
  const source = [valueHint, description].filter(Boolean).join(" ");
  const braceMatch = source.match(/\{([^}]+)\}/);
  if (braceMatch) {
    return braceMatch[1].split(/[,\s|]+/).map((choice) => choice.trim()).filter(Boolean);
  }

  if (valueHint?.includes("|")) {
    return valueHint.split("|").map((choice) => choice.trim()).filter(Boolean);
  }

  return undefined;
}

function extractDefault(description: string): string | number | undefined {
  const match = description.match(/default(?:s)?(?: is|:)?\s+["'`]?([^,"'`).\]]+)/i);
  if (!match) return undefined;
  const raw = match[1].trim();
  const numeric = Number(raw);
  return Number.isFinite(numeric) && raw !== "" ? numeric : raw;
}

function placeholderFromKind(kind: FieldKind, valueHint: string | undefined): string | undefined {
  if (valueHint) return valueHint;
  if (kind === "file") return "Select a file";
  if (kind === "directory") return "Select a directory";
  if (kind === "secret") return "Stored only for this run";
  return undefined;
}

function isAdvanced(option: ParsedOption): boolean {
  const source = `${option.flag ?? ""} ${option.shortFlag ?? ""} ${option.description}`.toLowerCase();
  return /\b(debug|trace|verbose|quiet|deprecated|internal|experimental)\b/.test(source);
}

function labelFromOption(option: ParsedOption, fallback: string): string {
  if (!option.flag && option.shortFlag) {
    if (option.valueHint) return titleFromRaw(option.valueHint);
    return option.shortFlag;
  }

  return labelFromFlag(option.flag ?? option.shortFlag ?? fallback);
}

function labelFromFlag(flag: string): string {
  return titleFromRaw(flag.replace(/^-+/, ""));
}

function titleFromRaw(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstSentence(helpText: string): string | undefined {
  const line = helpText
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !item.toLowerCase().startsWith("usage:"));
  return line?.replace(/\s+/g, " ").slice(0, 160);
}

function stableId(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/^-+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "field";
}

function uniqueId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) return baseId;
  let suffix = 2;
  while (usedIds.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}
