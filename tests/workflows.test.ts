import { describe, expect, it } from "vitest";
import { resolveWorkflowRunRequest, resolveWorkflowValues, workflowContextFromStepRun, workflowStatusFromStepRuns, type WorkflowStepRun } from "../src/lib/workflows";

describe("workflow helpers", () => {
  it("resolves stdout, stderr, and artifact references in values", () => {
    const values = resolveWorkflowValues(
      {
        input: "{{steps.step-1.artifacts.first}}",
        label: "result {{steps.step-1.stdout}}",
        errors: "{{steps.step-1.stderr}}",
        unchanged: true
      },
      [
        {
          stepId: "step-1",
          stdout: "done\n",
          stderr: "warning\n",
          artifacts: ["/tmp/out.mp4"]
        }
      ]
    );

    expect(values).toEqual({
      input: "/tmp/out.mp4",
      label: "result done",
      errors: "warning",
      unchanged: true
    });
  });

  it("resolves workflow variables inside run requests", () => {
    const request = resolveWorkflowRunRequest(
      {
        executable: "cat",
        baseArgs: [],
        args: ["{{steps.prepare.artifacts.0}}"],
        cwd: "{{steps.prepare.stdout}}",
        env: { RESULT: "{{steps.prepare.artifacts.first}}" },
        timeoutMs: 1000
      },
      [{ stepId: "prepare", stdout: "/tmp\n", stderr: "", artifacts: ["/tmp/report.json"] }]
    );

    expect(request.args).toEqual(["/tmp/report.json"]);
    expect(request.cwd).toBe("/tmp");
    expect(request.env).toEqual({ RESULT: "/tmp/report.json" });
  });

  it("builds contexts and final workflow status from step runs", () => {
    const run = createStepRun("step-1", "succeeded");
    const context = workflowContextFromStepRun({
      ...run,
      outputAnalysis: {
        format: "text",
        diagnostics: [],
        progress: [],
        artifacts: [{ path: "/tmp/file.txt", kind: "file", stream: "stdout", line: 1, isAbsolute: true }],
        summary: { stdoutLines: 1, stderrLines: 0, errorCount: 0, warningCount: 0, artifactCount: 1, progressCount: 0 }
      }
    });

    expect(context.artifacts).toEqual(["/tmp/file.txt"]);
    expect(workflowStatusFromStepRuns([run])).toBe("succeeded");
    expect(workflowStatusFromStepRuns([run, createStepRun("step-2", "failed")])).toBe("failed");
  });
});

function createStepRun(stepId: string, status: WorkflowStepRun["status"]): WorkflowStepRun {
  return {
    stepId,
    stepName: stepId,
    command: ["echo", "ok"],
    preview: "echo ok",
    status,
    exitCode: status === "succeeded" ? 0 : 1,
    durationMs: 12,
    stdout: "ok",
    stderr: "",
    startedAt: "2026-07-05T00:00:00.000Z",
    completedAt: "2026-07-05T00:00:00.012Z"
  };
}
