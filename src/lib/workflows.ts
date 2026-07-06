import type { FieldValues } from "./commandBuilder";
import type { OutputAnalysis } from "./outputAnalysis";
import type { RunRequest } from "./schema";

export type WorkflowStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type WorkflowRunSettings = {
  cwd?: string;
  envText?: string;
  timeoutSeconds?: number;
};

export type WorkflowStep = {
  id: string;
  name: string;
  toolId: string;
  commandId: string;
  values: FieldValues;
  runSettings?: WorkflowRunSettings;
};

export type SavedWorkflow = {
  id: string;
  name: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowStepRun = {
  stepId: string;
  stepName: string;
  command: string[];
  preview: string;
  status: WorkflowStepStatus;
  exitCode: number | null;
  signal?: string | null;
  durationMs: number;
  timedOut?: boolean;
  outputAnalysis?: OutputAnalysis;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
};

export type StoredWorkflowRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowStepStatus;
  stepRuns: WorkflowStepRun[];
  startedAt: string;
  completedAt: string;
};

export type WorkflowStepResultContext = {
  stepId: string;
  stdout: string;
  stderr: string;
  artifacts: string[];
};

const VARIABLE_PATTERN = /\{\{\s*steps\.([a-zA-Z0-9._:-]+)\.(stdout|stderr|artifacts\.first|artifacts\.(\d+))\s*\}\}/g;

export function workflowStatusFromStepRuns(stepRuns: WorkflowStepRun[]): WorkflowStepStatus {
  if (stepRuns.some((step) => step.status === "failed")) return "failed";
  if (stepRuns.some((step) => step.status === "running")) return "running";
  if (stepRuns.length > 0 && stepRuns.every((step) => step.status === "succeeded")) return "succeeded";
  return "pending";
}

export function workflowContextFromStepRun(stepRun: WorkflowStepRun): WorkflowStepResultContext {
  return {
    stepId: stepRun.stepId,
    stdout: stepRun.stdout,
    stderr: stepRun.stderr,
    artifacts: stepRun.outputAnalysis?.artifacts.map((artifact) => artifact.path) ?? []
  };
}

export function resolveWorkflowValues(values: FieldValues, contexts: WorkflowStepResultContext[]): FieldValues {
  const contextByStepId = new Map(contexts.map((context) => [context.stepId, context]));

  return Object.fromEntries(
    Object.entries(values).map(([fieldId, value]) => {
      if (Array.isArray(value)) return [fieldId, value.map((item) => resolveWorkflowString(item, contextByStepId))];
      if (typeof value === "string") return [fieldId, resolveWorkflowString(value, contextByStepId)];
      return [fieldId, value];
    })
  );
}

export function resolveWorkflowRunRequest(request: RunRequest, contexts: WorkflowStepResultContext[]): RunRequest {
  const contextByStepId = new Map(contexts.map((context) => [context.stepId, context]));
  return {
    ...request,
    baseArgs: request.baseArgs.map((arg) => resolveWorkflowString(arg, contextByStepId)),
    args: request.args.map((arg) => resolveWorkflowString(arg, contextByStepId)),
    cwd: request.cwd ? resolveWorkflowString(request.cwd, contextByStepId) : request.cwd,
    env: request.env ? Object.fromEntries(Object.entries(request.env).map(([key, value]) => [key, resolveWorkflowString(value, contextByStepId)])) : undefined
  };
}

export function firstArtifactToken(stepId: string): string {
  return `{{steps.${stepId}.artifacts.first}}`;
}

export function duplicateWorkflowPreset(workflow: SavedWorkflow, options: { idFor: (prefix: string) => string; now: string }): SavedWorkflow {
  const workflowId = options.idFor("workflow");
  const stepIdMap = new Map(workflow.steps.map((step) => [step.id, options.idFor("step")]));

  return {
    id: workflowId,
    name: `${workflow.name} copy`,
    steps: workflow.steps.map((step) => ({
      ...step,
      id: stepIdMap.get(step.id) as string,
      values: rewriteWorkflowValueReferences(step.values, stepIdMap),
      runSettings: step.runSettings
        ? {
            ...step.runSettings,
            cwd: step.runSettings.cwd ? rewriteWorkflowStringReferences(step.runSettings.cwd, stepIdMap) : undefined,
            envText: step.runSettings.envText ? rewriteWorkflowStringReferences(step.runSettings.envText, stepIdMap) : undefined
          }
        : undefined
    })),
    createdAt: options.now,
    updatedAt: options.now
  };
}

export function rewriteWorkflowValueReferences(values: FieldValues, stepIdMap: Map<string, string>): FieldValues {
  return Object.fromEntries(
    Object.entries(values).map(([fieldId, value]) => {
      if (Array.isArray(value)) return [fieldId, value.map((item) => rewriteWorkflowStringReferences(item, stepIdMap))];
      if (typeof value === "string") return [fieldId, rewriteWorkflowStringReferences(value, stepIdMap)];
      return [fieldId, value];
    })
  );
}

export function rewriteWorkflowStringReferences(value: string, stepIdMap: Map<string, string>): string {
  return value.replace(VARIABLE_PATTERN, (match, stepId: string) => {
    const replacementStepId = stepIdMap.get(stepId);
    return replacementStepId ? match.replace(`steps.${stepId}.`, `steps.${replacementStepId}.`) : match;
  });
}

function resolveWorkflowString(value: string, contextByStepId: Map<string, WorkflowStepResultContext>): string {
  return value.replace(VARIABLE_PATTERN, (_match, stepId: string, selector: string, artifactIndex: string | undefined) => {
    const context = contextByStepId.get(stepId);
    if (!context) return "";
    if (selector === "stdout") return context.stdout.trim();
    if (selector === "stderr") return context.stderr.trim();
    if (selector === "artifacts.first") return context.artifacts[0] ?? "";
    return context.artifacts[Number(artifactIndex)] ?? "";
  });
}
