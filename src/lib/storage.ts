import type { FieldValues } from "./commandBuilder";
import type { CommandSpec, FieldKind, FieldSpec, ToolManifest, ToolSource } from "./schema";
import { normalizeToolManifest } from "./schemaValidation";

const STORAGE_KEY = "givemeui.workspace.v1";
const MAX_RUNS = 60;
const MAX_PRESETS = 120;
const TOOL_SOURCES: ToolSource[] = ["detected", "imported", "manual", "ai-enhanced"];
const FIELD_KINDS: FieldKind[] = ["string", "number", "boolean", "enum", "file", "directory", "multi-file", "secret", "array", "raw"];

export type SavedPreset = {
  id: string;
  toolId: string;
  commandId: string;
  name: string;
  values: FieldValues;
  createdAt: string;
  updatedAt: string;
};

export type StoredRun = {
  id: string;
  toolId: string;
  commandId: string;
  toolName: string;
  commandName: string;
  command: string[];
  preview: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
};

export type WorkspaceState = {
  schemaVersion: 1;
  manifests: ToolManifest[];
  activeToolId: string;
  presets: SavedPreset[];
  runs: StoredRun[];
};

export function loadWorkspace(fallbackManifest: ToolManifest): WorkspaceState {
  if (!canUseLocalStorage()) return createWorkspace(fallbackManifest);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createWorkspace(fallbackManifest);

    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    const manifests = Array.isArray(parsed.manifests) ? parsed.manifests.filter(isToolManifest).map(normalizeToolManifest) : [];
    const state: WorkspaceState = {
      schemaVersion: 1,
      manifests: manifests.length > 0 ? manifests : [fallbackManifest],
      activeToolId: typeof parsed.activeToolId === "string" ? parsed.activeToolId : fallbackManifest.id,
      presets: Array.isArray(parsed.presets) ? parsed.presets.filter(isSavedPreset).slice(0, MAX_PRESETS) : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs.filter(isStoredRun).slice(0, MAX_RUNS) : []
    };

    if (!state.manifests.some((manifest) => manifest.id === state.activeToolId)) {
      state.activeToolId = state.manifests[0].id;
    }

    return state;
  } catch {
    return createWorkspace(fallbackManifest);
  }
}

export function persistWorkspace(state: WorkspaceState): void {
  if (!canUseLocalStorage()) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or unavailable storage backend should not block command work.
  }
}

export function createWorkspace(fallbackManifest: ToolManifest): WorkspaceState {
  return {
    schemaVersion: 1,
    manifests: [normalizeToolManifest(fallbackManifest)],
    activeToolId: fallbackManifest.id,
    presets: [],
    runs: []
  };
}

export function upsertManifest(state: WorkspaceState, manifest: ToolManifest): WorkspaceState {
  const normalizedManifest = normalizeToolManifest(manifest);
  const existingIndex = state.manifests.findIndex((current) => current.id === normalizedManifest.id);
  const manifests =
    existingIndex >= 0
      ? state.manifests.map((current, index) => (index === existingIndex ? normalizedManifest : current))
      : [normalizedManifest, ...state.manifests];

  return {
    ...state,
    manifests,
    activeToolId: normalizedManifest.id
  };
}

export function appendRun(state: WorkspaceState, run: StoredRun): WorkspaceState {
  return {
    ...state,
    runs: [run, ...state.runs].slice(0, MAX_RUNS)
  };
}

export function appendPreset(state: WorkspaceState, preset: SavedPreset): WorkspaceState {
  return {
    ...state,
    presets: [preset, ...state.presets].slice(0, MAX_PRESETS)
  };
}

export function createStorageId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomId}`;
}

export function redactSecretValues(fields: FieldSpec[], values: FieldValues, replacement?: string): FieldValues {
  const secretFieldIds = new Set(fields.filter((field) => field.kind === "secret").map((field) => field.id));

  return Object.fromEntries(
    Object.entries(values).map(([fieldId, value]) => {
      if (!secretFieldIds.has(fieldId)) return [fieldId, value];
      return [fieldId, replacement && value ? replacement : undefined];
    })
  );
}

export function isToolManifest(value: unknown): value is ToolManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ToolManifest>;
  return (
    typeof manifest.id === "string" &&
    (manifest.schemaVersion === undefined || manifest.schemaVersion === 1) &&
    typeof manifest.name === "string" &&
    typeof manifest.executable === "string" &&
    typeof manifest.source === "string" &&
    TOOL_SOURCES.includes(manifest.source) &&
    Array.isArray(manifest.baseArgs) &&
    Array.isArray(manifest.commands) &&
    manifest.commands.every(isCommandSpec) &&
    typeof manifest.createdAt === "string" &&
    typeof manifest.updatedAt === "string"
  );
}

function isCommandSpec(value: unknown): value is CommandSpec {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<CommandSpec>;
  return (
    typeof command.id === "string" &&
    typeof command.name === "string" &&
    Array.isArray(command.fields) &&
    command.fields.every(isFieldSpec)
  );
}

function isFieldSpec(value: unknown): value is FieldSpec {
  if (!value || typeof value !== "object") return false;
  const field = value as Partial<FieldSpec>;
  return (
    typeof field.id === "string" &&
    typeof field.label === "string" &&
    typeof field.kind === "string" &&
    FIELD_KINDS.includes(field.kind) &&
    typeof field.required === "boolean" &&
    typeof field.confidence === "number"
  );
}

function isSavedPreset(value: unknown): value is SavedPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<SavedPreset>;
  return (
    typeof preset.id === "string" &&
    typeof preset.toolId === "string" &&
    typeof preset.commandId === "string" &&
    typeof preset.name === "string" &&
    typeof preset.values === "object" &&
    typeof preset.createdAt === "string" &&
    typeof preset.updatedAt === "string"
  );
}

function isStoredRun(value: unknown): value is StoredRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<StoredRun>;
  return (
    typeof run.id === "string" &&
    typeof run.toolId === "string" &&
    typeof run.commandId === "string" &&
    typeof run.toolName === "string" &&
    typeof run.commandName === "string" &&
    Array.isArray(run.command) &&
    typeof run.preview === "string" &&
    typeof run.durationMs === "number" &&
    typeof run.stdout === "string" &&
    typeof run.stderr === "string" &&
    typeof run.startedAt === "string" &&
    typeof run.completedAt === "string"
  );
}

function canUseLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}
