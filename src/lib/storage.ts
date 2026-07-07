import type { FieldValues } from "./commandBuilder";
import { DEFAULT_AI_SETTINGS, normalizeAiSettings, type AiSettings } from "./ai";
import type { OutputAnalysis } from "./outputAnalysis";
import type { AdapterMetadata, CommandSpec, ExecutionMode, FieldKind, FieldSpec, ToolManifest, ToolSource } from "./schema";
import { normalizeToolManifest } from "./schemaValidation";
import type { SavedWorkflow, StoredWorkflowRun, WorkflowStep, WorkflowStepRun, WorkflowStepStatus } from "./workflows";

const STORAGE_KEY = "givemeui.workspace.v1";
const MAX_RUNS = 60;
const MAX_PRESETS = 120;
const MAX_WORKFLOWS = 80;
const MAX_WORKFLOW_RUNS = 80;
const MAX_AUDIT_LOG = 240;
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
  executionMode?: ExecutionMode;
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
  pinnedPath?: string;
  resolutionType?: "absolute" | "relative" | "path" | "unresolved";
  trustedAt: string;
};

export type TrustedSchema = {
  fingerprint: string;
  toolId: string;
  name: string;
  source: ToolSource;
  trustedAt: string;
};

export type TrustedAdapter = {
  id: string;
  name: string;
  version?: string;
  trustedAt: string;
};

export type AuditLogEntry = {
  id: string;
  at: string;
  action:
    | "trust.executable"
    | "trust.schema"
    | "trust.adapter"
    | "run.blocked"
    | "run.started"
    | "run.completed"
    | "workflow.blocked"
    | "workflow.started"
    | "workflow.completed";
  toolId?: string;
  commandId?: string;
  workflowId?: string;
  executable?: string;
  preview?: string;
  outcome?: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
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
  trustedSchemas: TrustedSchema[];
  trustedAdapters: TrustedAdapter[];
  auditLog: AuditLogEntry[];
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
      trustedSchemas: Array.isArray(parsed.trustedSchemas) ? parsed.trustedSchemas.filter(isTrustedSchema) : [],
      trustedAdapters: Array.isArray(parsed.trustedAdapters) ? parsed.trustedAdapters.filter(isTrustedAdapter) : [],
      auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog.filter(isAuditLogEntry).slice(0, MAX_AUDIT_LOG) : [],
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
    trustedSchemas: [],
    trustedAdapters: [],
    auditLog: [],
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

export function appendAuditLog(state: WorkspaceState, entry: AuditLogEntry): WorkspaceState {
  return {
    ...state,
    auditLog: [entry, ...state.auditLog].slice(0, MAX_AUDIT_LOG)
  };
}

export function isExecutableTrusted(state: WorkspaceState, executable: string, pinnedPath?: string): boolean {
  return state.trustedExecutables.some((item) => {
    if (item.executable !== executable) return false;
    if (!pinnedPath) return true;
    return item.pinnedPath === pinnedPath;
  });
}

export function trustExecutable(state: WorkspaceState, executable: TrustedExecutable): WorkspaceState {
  const trusted = { ...executable, executable: executable.executable.trim(), pinnedPath: executable.pinnedPath?.trim() || undefined };
  const existing = state.trustedExecutables.filter((item) => item.executable !== trusted.executable || item.pinnedPath !== trusted.pinnedPath);
  return {
    ...state,
    trustedExecutables: [trusted, ...existing]
  };
}

export function isSchemaTrusted(state: WorkspaceState, fingerprint: string): boolean {
  return state.trustedSchemas.some((item) => item.fingerprint === fingerprint);
}

export function trustSchema(state: WorkspaceState, schema: TrustedSchema): WorkspaceState {
  const existing = state.trustedSchemas.filter((item) => item.fingerprint !== schema.fingerprint);
  return {
    ...state,
    trustedSchemas: [schema, ...existing]
  };
}

export function areAdaptersTrusted(state: WorkspaceState, adapters: AdapterMetadata[] | undefined): boolean {
  if (!adapters || adapters.length === 0) return true;
  return adapters.every((adapter) =>
    state.trustedAdapters.some((item) => item.id === adapter.id && (item.version ?? "") === (adapter.version ?? ""))
  );
}

export function trustAdapter(state: WorkspaceState, adapter: TrustedAdapter): WorkspaceState {
  const existing = state.trustedAdapters.filter((item) => item.id !== adapter.id || (item.version ?? "") !== (adapter.version ?? ""));
  return {
    ...state,
    trustedAdapters: [adapter, ...existing]
  };
}

export function createStorageId(prefix: string): string {
  const cryptoProvider = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const randomId = cryptoProvider?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    (trusted.pinnedPath === undefined || typeof trusted.pinnedPath === "string") &&
    (trusted.resolutionType === undefined ||
      trusted.resolutionType === "absolute" ||
      trusted.resolutionType === "relative" ||
      trusted.resolutionType === "path" ||
      trusted.resolutionType === "unresolved") &&
    typeof trusted.trustedAt === "string"
  );
}

function isTrustedSchema(value: unknown): value is TrustedSchema {
  if (!value || typeof value !== "object") return false;
  const trusted = value as Partial<TrustedSchema>;
  return (
    typeof trusted.fingerprint === "string" &&
    typeof trusted.toolId === "string" &&
    typeof trusted.name === "string" &&
    typeof trusted.source === "string" &&
    TOOL_SOURCES.includes(trusted.source) &&
    typeof trusted.trustedAt === "string"
  );
}

function isTrustedAdapter(value: unknown): value is TrustedAdapter {
  if (!value || typeof value !== "object") return false;
  const trusted = value as Partial<TrustedAdapter>;
  return (
    typeof trusted.id === "string" &&
    typeof trusted.name === "string" &&
    (trusted.version === undefined || typeof trusted.version === "string") &&
    typeof trusted.trustedAt === "string"
  );
}

function isAuditLogEntry(value: unknown): value is AuditLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<AuditLogEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.at === "string" &&
    typeof entry.action === "string" &&
    [
      "trust.executable",
      "trust.schema",
      "trust.adapter",
      "run.blocked",
      "run.started",
      "run.completed",
      "workflow.blocked",
      "workflow.started",
      "workflow.completed"
    ].includes(entry.action) &&
    (entry.toolId === undefined || typeof entry.toolId === "string") &&
    (entry.commandId === undefined || typeof entry.commandId === "string") &&
    (entry.workflowId === undefined || typeof entry.workflowId === "string") &&
    (entry.executable === undefined || typeof entry.executable === "string") &&
    (entry.preview === undefined || typeof entry.preview === "string") &&
    (entry.outcome === undefined || typeof entry.outcome === "string") &&
    (entry.reason === undefined || typeof entry.reason === "string")
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
