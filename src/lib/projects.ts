import type { WorkspaceState } from "./storage";

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
};

export type ProjectSnapshot = {
  dataDir: string;
  databasePath: string;
  activeProjectId: string;
  projects: ProjectSummary[];
  workspace: WorkspaceState | null;
};

export type ProjectExport = {
  exportedAt: string;
  project: ProjectSummary;
  workspace: WorkspaceState;
};

export type CleanupResult = {
  runsRemoved: number;
  workflowRunsRemoved: number;
  auditEntriesRemoved: number;
};
