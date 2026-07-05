import type { OutputAnalysis } from "./outputAnalysis";
import type { ToolManifest } from "./schema";

export type AiProviderMode = "none" | "local-openai-compatible" | "ollama" | "lm-studio" | "openai";

export type AiSettings = {
  mode: AiProviderMode;
  endpoint: string;
  model: string;
};

export type AiProviderDetection = {
  mode: Exclude<AiProviderMode, "none" | "openai">;
  label: string;
  endpoint: string;
  available: boolean;
  models: string[];
  error?: string;
};

export type AiCompletion = {
  provider: AiProviderMode;
  model: string;
  text: string;
  createdAt: string;
};

export type AiRunSummaryRequest = {
  settings: AiSettings;
  command: string;
  stdout: string;
  stderr: string;
  analysis: OutputAnalysis;
};

export type AiSchemaSuggestion = {
  commandId: string;
  fieldId: string;
  label?: string;
  description?: string;
  group?: string;
  reason: string;
};

export type AiSchemaPatchResponse = {
  suggestions: AiSchemaSuggestion[];
  rawText: string;
  provider: AiProviderMode;
  model: string;
  createdAt: string;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  mode: "none",
  endpoint: "",
  model: ""
};

export const DEFAULT_LOCAL_ENDPOINTS: Record<Exclude<AiProviderMode, "none" | "openai">, string> = {
  "local-openai-compatible": "http://127.0.0.1:1234/v1",
  ollama: "http://127.0.0.1:11434",
  "lm-studio": "http://127.0.0.1:1234/v1"
};

export function normalizeAiSettings(value: Partial<AiSettings> | undefined): AiSettings {
  const mode = isAiProviderMode(value?.mode) ? value.mode : "none";
  const endpoint = typeof value?.endpoint === "string" ? value.endpoint.trim() : "";
  const model = typeof value?.model === "string" ? value.model.trim() : "";

  return {
    mode,
    endpoint: endpoint || defaultEndpointFor(mode),
    model: model || defaultModelFor(mode)
  };
}

export function isAiEnabled(settings: AiSettings): boolean {
  return settings.mode !== "none";
}

export function buildRunOutputPrompt(request: AiRunSummaryRequest): string {
  return [
    "You are helping a user understand output from a local command-line tool.",
    "Do not suggest running new commands. Do not invent facts. Base the answer only on the captured output and deterministic analysis.",
    "Return a concise explanation with: result, important errors or warnings, artifacts, and next review step if needed.",
    "",
    `Command: ${request.command}`,
    `Detected format: ${request.analysis.format}`,
    `Errors: ${request.analysis.summary.errorCount}`,
    `Warnings: ${request.analysis.summary.warningCount}`,
    `Artifacts: ${request.analysis.artifacts.map((artifact) => artifact.path).join(", ") || "none"}`,
    "",
    "STDOUT:",
    truncateForPrompt(request.stdout),
    "",
    "STDERR:",
    truncateForPrompt(request.stderr)
  ].join("\n");
}

export function buildSchemaSuggestionPrompt(manifest: ToolManifest): string {
  const fields = manifest.commands.flatMap((command) =>
    command.fields.map((field) => ({
      commandId: command.id,
      fieldId: field.id,
      label: field.label,
      description: field.description,
      kind: field.kind,
      flag: field.flag ?? field.shortFlag,
      group: field.ui?.group
    }))
  );

  return [
    "You are improving a generated command schema for a local CLI UI.",
    "Do not add new commands. Do not add new fields. Do not change executable, arguments, safety, or defaults.",
    "Only suggest clearer labels, descriptions, and UI groups for existing fields.",
    "Return strict JSON only with this shape:",
    '{"suggestions":[{"commandId":"...","fieldId":"...","label":"...","description":"...","group":"...","reason":"..."}]}',
    "",
    `Tool: ${manifest.name}`,
    `Executable: ${manifest.executable}`,
    "Fields:",
    JSON.stringify(fields.slice(0, 80), null, 2),
    "",
    "Raw help excerpt:",
    truncateForPrompt(manifest.rawHelp ?? "")
  ].join("\n");
}

export function parseSchemaSuggestions(rawText: string, manifest: ToolManifest): AiSchemaSuggestion[] {
  const parsed = parseJsonObject(rawText);
  const rawSuggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const validFieldIds = new Map(manifest.commands.map((command) => [command.id, new Set(command.fields.map((field) => field.id))]));

  return rawSuggestions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const suggestion = item as Partial<AiSchemaSuggestion>;
    if (typeof suggestion.commandId !== "string" || typeof suggestion.fieldId !== "string") return [];
    if (!validFieldIds.get(suggestion.commandId)?.has(suggestion.fieldId)) return [];

    const clean: AiSchemaSuggestion = {
      commandId: suggestion.commandId,
      fieldId: suggestion.fieldId,
      reason: typeof suggestion.reason === "string" && suggestion.reason.trim() ? suggestion.reason.trim() : "AI suggested metadata cleanup."
    };
    if (typeof suggestion.label === "string" && suggestion.label.trim()) clean.label = suggestion.label.trim();
    if (typeof suggestion.description === "string" && suggestion.description.trim()) clean.description = suggestion.description.trim();
    if (typeof suggestion.group === "string" && suggestion.group.trim()) clean.group = suggestion.group.trim();

    return clean.label || clean.description || clean.group ? [clean] : [];
  });
}

function defaultEndpointFor(mode: AiProviderMode): string {
  if (mode === "none" || mode === "openai") return "";
  return DEFAULT_LOCAL_ENDPOINTS[mode];
}

function defaultModelFor(mode: AiProviderMode): string {
  if (mode === "ollama") return "llama3.1";
  if (mode === "lm-studio" || mode === "local-openai-compatible") return "local-model";
  return "";
}

function isAiProviderMode(value: unknown): value is AiProviderMode {
  return value === "none" || value === "local-openai-compatible" || value === "ollama" || value === "lm-studio" || value === "openai";
}

function truncateForPrompt(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 6000 ? `${trimmed.slice(0, 6000)}\n[truncated]` : trimmed || "(empty)";
}

function parseJsonObject(rawText: string): { suggestions?: unknown[] } | null {
  const trimmed = rawText.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) return null;

  try {
    return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as { suggestions?: unknown[] };
  } catch {
    return null;
  }
}
