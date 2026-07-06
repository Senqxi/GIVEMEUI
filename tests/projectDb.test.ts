import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectDatabase, getProjectDatabase, migrateDatabase, resetProjectDatabaseForTests } from "../server/projectDb";
import { appendRun, createWorkspace, type StoredRun } from "../src/lib/storage";
import { sampleManifest } from "../src/lib/sampleData";

const tempDirs: string[] = [];

afterEach(() => {
  resetProjectDatabaseForTests();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("project database migrations", () => {
  it("creates the project schema and records the migration", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    migrateDatabase(db);

    const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0].values.flat();
    const migrations = db.exec("SELECT version, name FROM migrations")[0].values;
    expect(tables).toEqual(
      expect.arrayContaining([
        "audit_log",
        "migrations",
        "output_artifacts",
        "project_settings",
        "projects",
        "runs",
        "tool_manifests",
        "workflow_runs",
        "workflows"
      ])
    );
    expect(migrations).toEqual([[1, "initial_project_model"]]);
  });
});

describe("project database repository", () => {
  it("persists a workspace across database reopen", async () => {
    const paths = createTempDatabasePath();
    let database = await getProjectDatabase(paths);
    const workspace = appendRun(createWorkspace(sampleManifest), createRun("run-1"));

    database.saveWorkspace(workspace);
    resetProjectDatabaseForTests();
    database = await getProjectDatabase(paths);
    const snapshot = database.getSnapshot();

    expect(snapshot.workspace?.manifests[0].id).toBe(sampleManifest.id);
    expect(snapshot.workspace?.runs[0].id).toBe("run-1");
    expect(snapshot.databasePath).toBe(paths.databasePath);
  });

  it("creates, selects, exports, and deletes projects", async () => {
    const database = await getProjectDatabase(createTempDatabasePath());
    const first = database.getSnapshot();
    const second = database.createProject("Research");

    expect(second.projects.map((project) => project.name)).toContain("Research");
    database.saveWorkspace(createWorkspace(sampleManifest), second.activeProjectId);
    const exported = database.exportProject(second.activeProjectId);
    expect(exported.project.name).toBe("Research");
    expect(exported.workspace.manifests[0].name).toBe(sampleManifest.name);

    const selected = database.selectProject(first.activeProjectId);
    expect(selected.activeProjectId).toBe(first.activeProjectId);

    const afterDelete = database.deleteProject(second.activeProjectId);
    expect(afterDelete.projects.some((project) => project.id === second.activeProjectId)).toBe(false);
  });

  it("cleans old runs, workflow runs, and audit entries", async () => {
    const database = await getProjectDatabase(createTempDatabasePath());
    let workspace = createWorkspace(sampleManifest);

    workspace = {
      ...workspace,
      runs: Array.from({ length: 70 }, (_, index) => createRun(`run-${index}`)),
      workflowRuns: Array.from({ length: 90 }, (_, index) => ({
        id: `workflow-run-${index}`,
        workflowId: "workflow",
        workflowName: "Workflow",
        status: "succeeded",
        stepRuns: [],
        startedAt: "2026-07-06T00:00:00.000Z",
        completedAt: `2026-07-06T00:${String(index).padStart(2, "0")}:00.000Z`
      })),
      auditLog: Array.from({ length: 250 }, (_, index) => ({
        id: `audit-${index}`,
        at: `2026-07-06T00:${String(index).padStart(2, "0")}:00.000Z`,
        action: "run.started"
      }))
    };

    database.saveWorkspace(workspace);
    const cleanup = database.cleanupProject();
    const snapshot = database.getSnapshot();

    expect(cleanup).toEqual({ runsRemoved: 10, workflowRunsRemoved: 10, auditEntriesRemoved: 10 });
    expect(snapshot.workspace?.runs).toHaveLength(60);
    expect(snapshot.workspace?.workflowRuns).toHaveLength(80);
    expect(snapshot.workspace?.auditLog).toHaveLength(240);
  });
});

function createTempDatabasePath(): { dataDir: string; databasePath: string } {
  const dataDir = mkdtempSync(join(tmpdir(), "givemeui-project-db-"));
  tempDirs.push(dataDir);
  return {
    dataDir,
    databasePath: join(dataDir, "givemeui.sqlite")
  };
}

function createRun(id: string): StoredRun {
  return {
    id,
    toolId: sampleManifest.id,
    commandId: sampleManifest.commands[0].id,
    toolName: sampleManifest.name,
    commandName: sampleManifest.commands[0].name,
    command: ["python3", "--help"],
    preview: "python3 --help",
    exitCode: 0,
    durationMs: 12,
    stdout: "ok",
    stderr: "",
    startedAt: "2026-07-06T00:00:00.000Z",
    completedAt: `2026-07-06T00:00:${id.replace(/\D/g, "").padStart(2, "0")}.000Z`
  };
}
