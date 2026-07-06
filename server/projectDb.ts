import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { CleanupResult, ProjectExport, ProjectSnapshot, ProjectSummary } from "../src/lib/projects";
import type {
  AuditLogEntry,
  SavedPreset,
  StoredRun,
  TrustedAdapter,
  TrustedExecutable,
  TrustedSchema,
  WorkspaceState
} from "../src/lib/storage";
import type { ToolManifest } from "../src/lib/schema";
import type { SavedWorkflow, StoredWorkflowRun } from "../src/lib/workflows";

const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_PROJECT_NAME = "Default Project";
const WORKSPACE_TABLES = [
  "tool_manifests",
  "presets",
  "runs",
  "workflows",
  "workflow_runs",
  "trusted_executables",
  "trusted_schemas",
  "trusted_adapters",
  "audit_log",
  "output_artifacts"
] as const;

export type ProjectDatabaseOptions = {
  dataDir?: string;
  databasePath?: string;
};

export type ProjectDatabase = {
  cleanupProject(projectId?: string): CleanupResult;
  createProject(name: string): ProjectSnapshot;
  deleteProject(projectId: string): ProjectSnapshot;
  exportProject(projectId?: string): ProjectExport;
  getSnapshot(): ProjectSnapshot;
  saveWorkspace(workspace: WorkspaceState, projectId?: string): ProjectSnapshot;
  selectProject(projectId: string): ProjectSnapshot;
};

let sqlPromise: Promise<SqlJsStatic> | null = null;
let databasePromise: Promise<ProjectDatabase> | null = null;

export function defaultDataDir(): string {
  return resolve(process.env.GIVEMEUI_DATA_DIR ?? join(homedir(), ".givemeui"));
}

export function defaultDatabasePath(dataDir = defaultDataDir()): string {
  return resolve(process.env.GIVEMEUI_DB_PATH ?? join(dataDir, "givemeui.sqlite"));
}

export function resetProjectDatabaseForTests(): void {
  databasePromise = null;
}

export async function getProjectDatabase(options: ProjectDatabaseOptions = {}): Promise<ProjectDatabase> {
  if (!options.dataDir && !options.databasePath && databasePromise) return databasePromise;

  const create = async () => {
    const SQL = await loadSql();
    const dataDir = resolve(options.dataDir ?? defaultDataDir());
    const databasePath = resolve(options.databasePath ?? defaultDatabasePath(dataDir));
    return createProjectDatabase(SQL, { dataDir, databasePath });
  };

  if (!options.dataDir && !options.databasePath) {
    databasePromise = create();
    return databasePromise;
  }

  return create();
}

export function createProjectDatabase(SQL: SqlJsStatic, options: Required<ProjectDatabaseOptions>): ProjectDatabase {
  mkdirSync(options.dataDir, { recursive: true });
  mkdirSync(dirname(options.databasePath), { recursive: true });

  const db = existsSync(options.databasePath) ? new SQL.Database(readFileSync(options.databasePath)) : new SQL.Database();
  migrateDatabase(db);
  ensureActiveProject(db);
  persistDatabase(db, options.databasePath);

  return {
    cleanupProject(projectId) {
      const activeProjectId = projectId ?? ensureActiveProject(db).id;
      const before = loadWorkspaceRows(db, activeProjectId);
      trimTable(db, "runs", activeProjectId, 60);
      trimTable(db, "workflow_runs", activeProjectId, 80);
      trimTable(db, "audit_log", activeProjectId, 240);
      const after = loadWorkspaceRows(db, activeProjectId);
      persistDatabase(db, options.databasePath);
      return {
        runsRemoved: before.runs - after.runs,
        workflowRunsRemoved: before.workflowRuns - after.workflowRuns,
        auditEntriesRemoved: before.auditLog - after.auditLog
      };
    },
    createProject(name) {
      const now = new Date().toISOString();
      const project: ProjectSummary = {
        id: createId("project"),
        name: name.trim() || DEFAULT_PROJECT_NAME,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now
      };
      db.run(
        "INSERT INTO projects (id, name, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
        [project.id, project.name, project.createdAt, project.updatedAt, project.lastOpenedAt]
      );
      setSetting(db, "active_project_id", project.id);
      persistDatabase(db, options.databasePath);
      return snapshot(db, options, project.id);
    },
    deleteProject(projectId) {
      const projects = listProjects(db);
      if (projects.length <= 1) {
        throw new Error("Cannot delete the last project.");
      }
      if (!projects.some((project) => project.id === projectId)) {
        throw new Error("Project not found.");
      }

      for (const table of WORKSPACE_TABLES) {
        db.run(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
      }
      db.run("DELETE FROM project_settings WHERE project_id = ?", [projectId]);
      db.run("DELETE FROM projects WHERE id = ?", [projectId]);

      const activeProjectId = getSetting(db, "active_project_id");
      if (activeProjectId === projectId) {
        setSetting(db, "active_project_id", listProjects(db)[0].id);
      }

      persistDatabase(db, options.databasePath);
      return snapshot(db, options);
    },
    exportProject(projectId) {
      const activeProjectId = projectId ?? ensureActiveProject(db).id;
      const project = getProject(db, activeProjectId);
      const workspace = loadWorkspace(db, activeProjectId);
      if (!workspace) throw new Error("Project has no workspace data to export.");
      return {
        exportedAt: new Date().toISOString(),
        project,
        workspace
      };
    },
    getSnapshot() {
      return snapshot(db, options);
    },
    saveWorkspace(workspace, projectId) {
      const activeProjectId = projectId ?? ensureActiveProject(db).id;
      saveWorkspaceRows(db, activeProjectId, workspace);
      persistDatabase(db, options.databasePath);
      return snapshot(db, options, activeProjectId);
    },
    selectProject(projectId) {
      if (!listProjects(db).some((project) => project.id === projectId)) {
        throw new Error("Project not found.");
      }
      const now = new Date().toISOString();
      db.run("UPDATE projects SET last_opened_at = ? WHERE id = ?", [now, projectId]);
      setSetting(db, "active_project_id", projectId);
      persistDatabase(db, options.databasePath);
      return snapshot(db, options, projectId);
    }
  };
}

export function migrateDatabase(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = Number(selectValue(db, "SELECT MAX(version) FROM migrations") ?? 0);
  if (applied < 1) {
    db.run(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        active_tool_id TEXT NOT NULL,
        ai_settings_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_manifests (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id)
      );

      CREATE TABLE IF NOT EXISTS presets (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        preset_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id)
      );

      CREATE TABLE IF NOT EXISTS runs (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        run_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id)
      );

      CREATE TABLE IF NOT EXISTS workflows (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        workflow_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id)
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        run_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id)
      );

      CREATE TABLE IF NOT EXISTS trusted_executables (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        executable TEXT NOT NULL,
        pinned_path TEXT,
        trust_json TEXT NOT NULL,
        trusted_at TEXT NOT NULL,
        PRIMARY KEY (project_id, executable, pinned_path)
      );

      CREATE TABLE IF NOT EXISTS trusted_schemas (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL,
        trust_json TEXT NOT NULL,
        trusted_at TEXT NOT NULL,
        PRIMARY KEY (project_id, fingerprint)
      );

      CREATE TABLE IF NOT EXISTS trusted_adapters (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        adapter_id TEXT NOT NULL,
        version TEXT NOT NULL,
        trust_json TEXT NOT NULL,
        trusted_at TEXT NOT NULL,
        PRIMARY KEY (project_id, adapter_id, version)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        action TEXT NOT NULL,
        entry_json TEXT NOT NULL,
        at TEXT NOT NULL,
        PRIMARY KEY (project_id, id)
      );

      CREATE TABLE IF NOT EXISTS output_artifacts (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        artifact_index INTEGER NOT NULL,
        artifact_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, run_id, artifact_index)
      );

      CREATE INDEX IF NOT EXISTS idx_runs_project_completed ON runs(project_id, completed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_project_at ON audit_log(project_id, at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_project_completed ON workflow_runs(project_id, completed_at DESC);
    `);
    db.run("INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)", [1, "initial_project_model", new Date().toISOString()]);
  }

  const current = Number(selectValue(db, "SELECT MAX(version) FROM migrations") ?? 0);
  if (current !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported database schema version: ${current}.`);
  }
}

function saveWorkspaceRows(db: Database, projectId: string, workspace: WorkspaceState): void {
  const now = new Date().toISOString();
  db.run("UPDATE projects SET updated_at = ?, last_opened_at = ? WHERE id = ?", [now, now, projectId]);
  db.run(
    `INSERT INTO project_settings (project_id, active_tool_id, ai_settings_json)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET active_tool_id = excluded.active_tool_id, ai_settings_json = excluded.ai_settings_json`,
    [projectId, workspace.activeToolId, JSON.stringify(workspace.aiSettings)]
  );

  replaceRows(db, "tool_manifests", projectId, workspace.manifests, (manifest) => [
    projectId,
    manifest.id,
    JSON.stringify(manifest),
    manifest.createdAt,
    manifest.updatedAt
  ]);
  replaceRows(db, "presets", projectId, workspace.presets, (preset) => [
    projectId,
    preset.id,
    preset.toolId,
    preset.commandId,
    JSON.stringify(preset),
    preset.createdAt,
    preset.updatedAt
  ]);
  replaceRows(db, "runs", projectId, workspace.runs, (run) => [projectId, run.id, run.toolId, run.commandId, JSON.stringify(run), run.startedAt, run.completedAt]);
  replaceRows(db, "workflows", projectId, workspace.workflows, (workflow) => [
    projectId,
    workflow.id,
    JSON.stringify(workflow),
    workflow.createdAt,
    workflow.updatedAt
  ]);
  replaceRows(db, "workflow_runs", projectId, workspace.workflowRuns, (run) => [
    projectId,
    run.id,
    run.workflowId,
    JSON.stringify(run),
    run.startedAt,
    run.completedAt
  ]);
  replaceRows(db, "trusted_executables", projectId, workspace.trustedExecutables, (trust) => [
    projectId,
    trust.executable,
    trust.pinnedPath ?? "",
    JSON.stringify(trust),
    trust.trustedAt
  ]);
  replaceRows(db, "trusted_schemas", projectId, workspace.trustedSchemas, (trust) => [
    projectId,
    trust.fingerprint,
    JSON.stringify(trust),
    trust.trustedAt
  ]);
  replaceRows(db, "trusted_adapters", projectId, workspace.trustedAdapters, (trust) => [
    projectId,
    trust.id,
    trust.version ?? "",
    JSON.stringify(trust),
    trust.trustedAt
  ]);
  replaceRows(db, "audit_log", projectId, workspace.auditLog, (entry) => [projectId, entry.id, entry.action, JSON.stringify(entry), entry.at]);
  saveArtifacts(db, projectId, workspace);
}

function replaceRows<T>(db: Database, table: (typeof WORKSPACE_TABLES)[number], projectId: string, rows: T[], valuesFor: (row: T) => unknown[]): void {
  db.run(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
  if (rows.length === 0) return;

  const placeholders = {
    tool_manifests: "(?, ?, ?, ?, ?)",
    presets: "(?, ?, ?, ?, ?, ?, ?)",
    runs: "(?, ?, ?, ?, ?, ?, ?)",
    workflows: "(?, ?, ?, ?, ?)",
    workflow_runs: "(?, ?, ?, ?, ?, ?)",
    trusted_executables: "(?, ?, ?, ?, ?)",
    trusted_schemas: "(?, ?, ?, ?)",
    trusted_adapters: "(?, ?, ?, ?, ?)",
    audit_log: "(?, ?, ?, ?, ?)",
    output_artifacts: "(?, ?, ?, ?)"
  }[table];
  const columns = {
    tool_manifests: "(project_id, id, manifest_json, created_at, updated_at)",
    presets: "(project_id, id, tool_id, command_id, preset_json, created_at, updated_at)",
    runs: "(project_id, id, tool_id, command_id, run_json, started_at, completed_at)",
    workflows: "(project_id, id, workflow_json, created_at, updated_at)",
    workflow_runs: "(project_id, id, workflow_id, run_json, started_at, completed_at)",
    trusted_executables: "(project_id, executable, pinned_path, trust_json, trusted_at)",
    trusted_schemas: "(project_id, fingerprint, trust_json, trusted_at)",
    trusted_adapters: "(project_id, adapter_id, version, trust_json, trusted_at)",
    audit_log: "(project_id, id, action, entry_json, at)",
    output_artifacts: "(project_id, run_id, artifact_index, artifact_json)"
  }[table];
  const statement = db.prepare(`INSERT INTO ${table} ${columns} VALUES ${placeholders}`);
  try {
    for (const row of rows) {
      statement.run(valuesFor(row));
    }
  } finally {
    statement.free();
  }
}

function saveArtifacts(db: Database, projectId: string, workspace: WorkspaceState): void {
  db.run("DELETE FROM output_artifacts WHERE project_id = ?", [projectId]);
  const statement = db.prepare("INSERT INTO output_artifacts (project_id, run_id, artifact_index, artifact_json) VALUES (?, ?, ?, ?)");
  try {
    for (const run of workspace.runs) {
      for (const [index, artifact] of (run.outputAnalysis?.artifacts ?? []).entries()) {
        statement.run([projectId, run.id, index, JSON.stringify(artifact)]);
      }
    }
    for (const workflowRun of workspace.workflowRuns) {
      for (const stepRun of workflowRun.stepRuns) {
        for (const [index, artifact] of (stepRun.outputAnalysis?.artifacts ?? []).entries()) {
          statement.run([projectId, `${workflowRun.id}:${stepRun.stepId}`, index, JSON.stringify(artifact)]);
        }
      }
    }
  } finally {
    statement.free();
  }
}

function loadWorkspace(db: Database, projectId: string): WorkspaceState | null {
  const settings = selectOne(db, "SELECT active_tool_id, ai_settings_json FROM project_settings WHERE project_id = ?", [projectId]);
  const manifests = selectJson<ToolManifest>(db, "SELECT manifest_json FROM tool_manifests WHERE project_id = ? ORDER BY updated_at DESC", [projectId], "manifest_json");
  if (!settings || manifests.length === 0) return null;

  return {
    schemaVersion: 1,
    manifests,
    activeToolId: String(settings.active_tool_id),
    presets: selectJson<SavedPreset>(db, "SELECT preset_json FROM presets WHERE project_id = ? ORDER BY updated_at DESC", [projectId], "preset_json"),
    runs: selectJson<StoredRun>(db, "SELECT run_json FROM runs WHERE project_id = ? ORDER BY completed_at DESC", [projectId], "run_json"),
    workflows: selectJson<SavedWorkflow>(db, "SELECT workflow_json FROM workflows WHERE project_id = ? ORDER BY updated_at DESC", [projectId], "workflow_json"),
    workflowRuns: selectJson<StoredWorkflowRun>(db, "SELECT run_json FROM workflow_runs WHERE project_id = ? ORDER BY completed_at DESC", [projectId], "run_json"),
    trustedExecutables: selectJson<TrustedExecutable>(db, "SELECT trust_json FROM trusted_executables WHERE project_id = ? ORDER BY trusted_at DESC", [projectId], "trust_json"),
    trustedSchemas: selectJson<TrustedSchema>(db, "SELECT trust_json FROM trusted_schemas WHERE project_id = ? ORDER BY trusted_at DESC", [projectId], "trust_json"),
    trustedAdapters: selectJson<TrustedAdapter>(db, "SELECT trust_json FROM trusted_adapters WHERE project_id = ? ORDER BY trusted_at DESC", [projectId], "trust_json"),
    auditLog: selectJson<AuditLogEntry>(db, "SELECT entry_json FROM audit_log WHERE project_id = ? ORDER BY at DESC", [projectId], "entry_json"),
    aiSettings: JSON.parse(String(settings.ai_settings_json))
  };
}

function snapshot(db: Database, options: Required<ProjectDatabaseOptions>, activeProjectId = ensureActiveProject(db).id): ProjectSnapshot {
  return {
    dataDir: options.dataDir,
    databasePath: options.databasePath,
    activeProjectId,
    projects: listProjects(db),
    workspace: loadWorkspace(db, activeProjectId)
  };
}

function ensureActiveProject(db: Database): ProjectSummary {
  const projects = listProjects(db);
  const activeProjectId = getSetting(db, "active_project_id");
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  if (activeProject) {
    setSetting(db, "active_project_id", activeProject.id);
    return activeProject;
  }

  const now = new Date().toISOString();
  const project: ProjectSummary = {
    id: createId("project"),
    name: DEFAULT_PROJECT_NAME,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  };
  db.run("INSERT INTO projects (id, name, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?)", [
    project.id,
    project.name,
    project.createdAt,
    project.updatedAt,
    project.lastOpenedAt
  ]);
  setSetting(db, "active_project_id", project.id);
  return project;
}

function listProjects(db: Database): ProjectSummary[] {
  return selectRows(db, "SELECT id, name, created_at, updated_at, last_opened_at FROM projects ORDER BY last_opened_at DESC").map((row) => ({
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastOpenedAt: String(row.last_opened_at)
  }));
}

function getProject(db: Database, projectId: string): ProjectSummary {
  const row = selectOne(db, "SELECT id, name, created_at, updated_at, last_opened_at FROM projects WHERE id = ?", [projectId]);
  if (!row) throw new Error("Project not found.");
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastOpenedAt: String(row.last_opened_at)
  };
}

function loadWorkspaceRows(db: Database, projectId: string): { runs: number; workflowRuns: number; auditLog: number } {
  return {
    runs: Number(selectValue(db, "SELECT COUNT(*) FROM runs WHERE project_id = ?", [projectId]) ?? 0),
    workflowRuns: Number(selectValue(db, "SELECT COUNT(*) FROM workflow_runs WHERE project_id = ?", [projectId]) ?? 0),
    auditLog: Number(selectValue(db, "SELECT COUNT(*) FROM audit_log WHERE project_id = ?", [projectId]) ?? 0)
  };
}

function trimTable(db: Database, table: "runs" | "workflow_runs" | "audit_log", projectId: string, keep: number): void {
  const orderColumn = table === "audit_log" ? "at" : "completed_at";
  const idColumn = table === "audit_log" ? "id" : "id";
  const keepIds = new Set(
    selectRows(db, `SELECT ${idColumn} FROM ${table} WHERE project_id = ? ORDER BY ${orderColumn} DESC LIMIT ?`, [projectId, keep]).map((row) =>
      String(row[idColumn])
    )
  );
  for (const row of selectRows(db, `SELECT ${idColumn} FROM ${table} WHERE project_id = ?`, [projectId])) {
    const id = String(row[idColumn]);
    if (!keepIds.has(id)) db.run(`DELETE FROM ${table} WHERE project_id = ? AND ${idColumn} = ?`, [projectId, id]);
  }
}

function selectJson<T>(db: Database, sql: string, params: unknown[], column: string): T[] {
  return selectRows(db, sql, params).map((row) => JSON.parse(String(row[column])) as T);
}

function selectRows(db: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  try {
    statement.bind(params);
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return rows;
}

function selectOne(db: Database, sql: string, params: unknown[] = []): Record<string, unknown> | null {
  return selectRows(db, sql, params)[0] ?? null;
}

function selectValue(db: Database, sql: string, params: unknown[] = []): unknown {
  const row = selectOne(db, sql, params);
  if (!row) return undefined;
  return Object.values(row)[0];
}

function getSetting(db: Database, key: string): string | undefined {
  const value = selectValue(db, "SELECT value FROM app_settings WHERE key = ?", [key]);
  return value === undefined ? undefined : String(value);
}

function setSetting(db: Database, key: string, value: string): void {
  db.run("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}

function persistDatabase(db: Database, databasePath: string): void {
  writeFileSync(databasePath, db.export());
}

async function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs();
  return sqlPromise;
}

function createId(prefix: string): string {
  const cryptoProvider = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return `${prefix}-${cryptoProvider?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
