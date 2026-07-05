import { commandNameFromExecutable, parseCommandLine } from "./commandLine";
import type { CommandSpec, DiscoveryMetadata, FieldKind, FieldSpec, ToolManifest } from "./schema";

type ParsedOption = {
  flag?: string;
  shortFlag?: string;
  valueHint?: string;
  description: string;
  confidence: number;
};

type ParsedSubcommand = {
  name: string;
  description?: string;
};

const HELP_ARGS = new Set(["--help", "-h", "help"]);

export function commandLineForHelp(input: string): string[] {
  return helpCommandCandidates(input)[0] ?? [];
}

export function helpCommandCandidates(input: string): string[][] {
  const argv = parseCommandLine(input);
  if (argv.length === 0) return [];
  const hasHelp = argv.slice(1).some((arg) => HELP_ARGS.has(arg));
  if (hasHelp) return [argv];

  const candidates = [
    [...argv, "--help"],
    [...argv, "-h"],
    argv.length > 1 ? [argv[0], "help", ...argv.slice(1)] : [argv[0], "help"]
  ];

  return dedupeCommands(candidates);
}

export function parseHelpOutput(
  helpText: string,
  originalCommandLine: string,
  options: { executable?: string; baseArgs?: string[]; version?: string; discovery?: DiscoveryMetadata } = {}
): ToolManifest {
  const originalArgv = parseCommandLine(originalCommandLine);
  const executable = options.executable ?? originalArgv[0] ?? "command";
  const baseArgs = options.baseArgs ?? originalArgv.slice(1).filter((arg) => !HELP_ARGS.has(arg));
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
  const subcommands: CommandSpec[] = parseSubcommands(helpText).slice(0, 16).map((subcommand) => ({
    id: stableId(`${name}-${subcommand.name}`),
    name: subcommand.name,
    description: subcommand.description,
    subcommand: [subcommand.name],
    fields: cloneFields(fields),
    output: { expectedTypes: ["text"] },
    safety: {
      notes: ["Runs locally without shell interpolation.", "Subcommand schema is inferred from top-level help and should be reviewed."]
    }
  }));

  const now = new Date().toISOString();
  return {
    id: stableId(`${name}-${baseArgs.join("-") || "root"}`),
    name,
    executable,
    baseArgs,
    version: options.version,
    source: "detected",
    rawHelp: helpText,
    discovery: options.discovery,
    commands: [command, ...subcommands],
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

  const fieldsWithRequiredHints = markRequiredFields(fields, helpText);
  return [...fieldsWithRequiredHints, ...parsePositionals(helpText, usedIds)];
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

function parsePositionals(helpText: string, usedIds: Set<string>): FieldSpec[] {
  const fields: FieldSpec[] = [];
  const seen = new Set<string>();
  const usage = usageText(helpText);
  if (!usage) return fields;

  const tokens = usage.split(/\s+/).slice(1);
  let position = 0;

  for (const token of tokens) {
    if (!looksLikePositionalToken(token)) continue;

    const cleaned = cleanPositionalToken(token);
    if (!cleaned || seen.has(cleaned)) continue;

    const id = uniqueId(stableId(cleaned), usedIds);
    const kind = inferPositionalKind(cleaned);
    fields.push({
      id,
      label: titleFromRaw(cleaned),
      description: `Positional argument inferred from usage: ${token}`,
      kind,
      required: !token.includes("["),
      position,
      placeholder: cleaned,
      ui: {
        group: "Arguments",
        advanced: false,
        control: kind === "number" ? "number" : undefined
      },
      confidence: 0.48
    });
    seen.add(cleaned);
    usedIds.add(id);
    position += 1;
  }

  return fields;
}

function parseSubcommands(helpText: string): ParsedSubcommand[] {
  const subcommands: ParsedSubcommand[] = [];
  const seen = new Set<string>();
  let inSection = false;

  for (const rawLine of helpText.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "    ");
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^(available\s+)?commands?:$/i.test(trimmed) || /^subcommands?:$/i.test(trimmed)) {
      inSection = true;
      continue;
    }

    if (inSection && /^[A-Z][A-Za-z\s]+:$/.test(trimmed)) {
      break;
    }

    if (!inSection) continue;

    const match = line.match(/^\s{2,}([a-z][a-z0-9_-]{1,30})\s{2,}(.+)$/i);
    if (!match) continue;

    const name = match[1];
    if (HELP_ARGS.has(name) || seen.has(name)) continue;
    subcommands.push({ name, description: match[2].trim() });
    seen.add(name);
  }

  return subcommands;
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
  const match =
    description.match(/\((?:default|defaults? to):\s*([^)]+)\)/i) ??
    description.match(/\bdefault(?:s)?(?:\s+is|\s*:\s*|\s+to)\s+["'`]?([^,"'`).\]]+)/i);
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

function markRequiredFields(fields: FieldSpec[], helpText: string): FieldSpec[] {
  const usage = usageText(helpText);
  if (!usage) return fields;

  return fields.map((field) => {
    const flag = field.flag ?? field.shortFlag;
    if (!flag) return field;
    const index = usage.indexOf(flag);
    if (index < 0) return field;
    const before = usage.slice(Math.max(0, index - 1), index);
    return before === "[" ? field : { ...field, required: true, confidence: Math.min(1, field.confidence + 0.04) };
  });
}

function usageText(helpText: string): string | undefined {
  return helpText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^usage:/i.test(line))
    ?.replace(/^usage:\s*/i, "")
    .replace(/\s+/g, " ");
}

function looksLikePositionalToken(token: string): boolean {
  const cleaned = cleanPositionalToken(token);
  if (!cleaned) return false;
  if (token.includes("-")) return false;
  if (/^(options?|flags?|command|commands)$/i.test(cleaned) && token.includes("[")) return false;
  if (/^[a-z0-9_./]+$/i.test(cleaned) && cleaned.includes(".")) return false;
  return /^[A-Z][A-Z0-9_-]*$/.test(cleaned) || /^<[^>]+>$/.test(token) || /^[A-Z][A-Za-z0-9_-]*\.\.\.$/.test(token);
}

function cleanPositionalToken(token: string): string {
  return token
    .replace(/^[\[{(<]+/, "")
    .replace(/[\]})>,]+$/, "")
    .replace(/\.\.\.$/, "")
    .trim();
}

function inferPositionalKind(name: string): FieldKind {
  const source = name.toLowerCase();
  if (/\b(count|number|port|size|limit|threads?)\b/.test(source)) return "number";
  if (/\b(dir|directory|folder|cwd)\b/.test(source)) return "directory";
  if (/\b(file|path|input|output|source|dest|destination)\b/.test(source)) return "file";
  if (/\b(url|uri|endpoint)\b/.test(source)) return "string";
  return "string";
}

function cloneFields(fields: FieldSpec[]): FieldSpec[] {
  return fields.map((field) => ({
    ...field,
    choices: field.choices ? [...field.choices] : undefined,
    validation: field.validation ? { ...field.validation } : undefined,
    ui: field.ui ? { ...field.ui } : undefined
  }));
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

function dedupeCommands(commands: string[][]): string[][] {
  const seen = new Set<string>();
  const deduped: string[][] = [];

  for (const command of commands) {
    const key = JSON.stringify(command);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(command);
  }

  return deduped;
}
