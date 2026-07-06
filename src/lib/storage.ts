import type { FieldValues } from "./commandBuilder";
import { DEFAULT_AI_SETTINGS, normalizeAiSettings, type AiSettings } from "./ai";
import type { OutputAnalysis } from "./outputAnalysis";
import type { AdapterMetadata, CommandSpec, FieldKind, FieldSpec, ToolManifest, ToolSource } from "./schema";
import { normalizeToolManifest } from "./schemaValidation";
import type { SavedWorkflow, StoredWorkflowRun, WorkflowStep, WorkflowStepRun, WorkflowStepStatus } from "./workflows";

const STORAGE_KEY = "givemeui.workspace.v1";
const MAX_RUNS = 60;
const MAX_PRESETS = 120;
const MAX_WORKFLOWS = 80;
const MAX_WORKFLOW_RUNS = 80;
const TOOL_SOURCES: ToolSource[] = ["detected", "imported", "manual", "ai-enhanced"];
const FIELD_KINDS: FieldKind[] = ["string", "number", "boolean", "enum", "file", "directory", "multi-file", "secret", "array", "raw"];
const WORKFLOW_STEP_STATUSES: WorkflowStepStatus[] = ["pending", "running", "succeeded", "failed", "skipped"];

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
  signal?: string | null;
  durationMs: number;
  timedOut?: boolean;
  cwd?: string;
  envKeys?: string[];
  outputAnalysis?: OutputAnalysis;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
};

export type TrustedExecutable = {
  executable: string;
  name?: string;
  source: "user" | "imported";
  trustedAt: string;
};

export type WorkspaceState = {
  schemaVersion: 1;
  manifests: ToolManifest[];
  activeToolId: string;
  presets: SavedPreset[];
  runs: StoredRun[];
  workflows: SavedWorkflow[];
  workflowRuns: StoredWorkflowRun[];
  trustedExecutables: TrustedExecutable[];
  aiSettings: AiSettings;
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
      runs: Array.isArray(parsed.runs) ? parsed.runs.filter(isStoredRun).slice(0, MAX_RUNS) : [],
      workflows: Array.isArray(parsed.workflows) ? parsed.workflows.filter(isSavedWorkflow).slice(0, MAX_WORKFLOWS) : [],
      workflowRuns: Array.isArray(parsed.workflowRuns) ? parsed.workflowRuns.filter(isStoredWorkflowRun).slice(0, MAX_WORKFLOW_RUNS) : [],
      trustedExecutables: Array.isArray(parsed.trustedExecutables) ? parsed.trustedExecutables.filter(isTrustedExecutable) : [],
      aiSettings: normalizeAiSettings(parsed.aiSettings)
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
    runs: [],
    workflows: [],
    workflowRuns: [],
    trustedExecutables: [],
    aiSettings: DEFAULT_AI_SETTINGS
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

export function upsertWorkflow(state: WorkspaceState, workflow: SavedWorkflow): WorkspaceState {
  const existingIndex = state.workflows.findIndex((current) => current.id === workflow.id);
  const workflows =
    existingIndex >= 0
      ? state.workflows.map((current, index) => (index === existingIndex ? workflow : current))
      : [workflow, ...state.workflows];

  return {
    ...state,
    workflows: workflows.slice(0, MAX_WORKFLOWS)
  };
}

export function appendWorkflowRun(state: WorkspaceState, run: StoredWorkflowRun): WorkspaceState {
  return {
    ...state,
    workflowRuns: [run, ...state.workflowRuns].slice(0, MAX_WORKFLOW_RUNS)
  };
}

export function isExecutableTrusted(state: WorkspaceState, executable: string): boolean {
  return state.trustedExecutables.some((item) => item.executable === executable);
}

export function trustExecutable(state: WorkspaceState, executable: TrustedExecutable): WorkspaceState {
  const existing = state.trustedExecutables.filter((item) => item.executable !== executable.executable);
  return {
    ...state,
    trustedExecutables: [{ ...executable, executable: executable.executable.trim() }, ...existing]
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
    (manifest.adapters === undefined || (Array.isArray(manifest.adapters) && manifest.adapters.every(isAdapterMetadata))) &&
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

function isSavedWorkflow(value: unknown): value is SavedWorkflow {
  if (!value || typeof value !== "object") return false;
  const workflow = value as Partial<SavedWorkflow>;
  return (
    typeof workflow.id === "string" &&
    typeof workflow.name === "string" &&
    Array.isArray(workflow.steps) &&
    workflow.steps.every(isWorkflowStep) &&
    typeof workflow.createdAt === "string" &&
    typeof workflow.updatedAt === "string"
  );
}

function isWorkflowStep(value: unknown): value is WorkflowStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<WorkflowStep>;
  return (
    typeof step.id === "string" &&
    typeof step.name === "string" &&
    typeof step.toolId === "string" &&
    typeof step.commandId === "string" &&
    isFieldValues(step.values) &&
    (step.runSettings === undefined || typeof step.runSettings === "object")
  );
}

function isStoredWorkflowRun(value: unknown): value is StoredWorkflowRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<StoredWorkflowRun>;
  return (
    typeof run.id === "string" &&
    typeof run.workflowId === "string" &&
    typeof run.workflowName === "string" &&
    typeof run.status === "string" &&
    WORKFLOW_STEP_STATUSES.includes(run.status) &&
    Array.isArray(run.stepRuns) &&
    run.stepRuns.every(isWorkflowStepRun) &&
    typeof run.startedAt === "string" &&
    typeof run.completedAt === "string"
  );
}

function isWorkflowStepRun(value: unknown): value is WorkflowStepRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<WorkflowStepRun>;
  return (
    typeof run.stepId === "string" &&
    typeof run.stepName === "string" &&
    Array.isArray(run.command) &&
    typeof run.preview === "string" &&
    typeof run.status === "string" &&
    WORKFLOW_STEP_STATUSES.includes(run.status) &&
    typeof run.durationMs === "number" &&
    typeof run.stdout === "string" &&
    typeof run.stderr === "string" &&
    typeof run.startedAt === "string" &&
    typeof run.completedAt === "string"
  );
}

function isFieldValues(value: unknown): value is FieldValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) =>
      item === undefined ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      (Array.isArray(item) && item.every((entry) => typeof entry === "string"))
  );
}

function isTrustedExecutable(value: unknown): value is TrustedExecutable {
  if (!value || typeof value !== "object") return false;
  const trusted = value as Partial<TrustedExecutable>;
  return (
    typeof trusted.executable === "string" &&
    trusted.executable.trim().length > 0 &&
    (trusted.name === undefined || typeof trusted.name === "string") &&
    (trusted.source === "user" || trusted.source === "imported") &&
    typeof trusted.trustedAt === "string"
  );
}

function isAdapterMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const adapter = value as Partial<AdapterMetadata>;
  return (
    typeof adapter.id === "string" &&
    typeof adapter.name === "string" &&
    (adapter.version === undefined || typeof adapter.version === "string") &&
    typeof adapter.appliedAt === "string" &&
    Array.isArray(adapter.notes) &&
    adapter.notes.every((note) => typeof note === "string")
  );
}

function canUseLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}
