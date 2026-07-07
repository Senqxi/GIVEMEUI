/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { parseHelpOutput } from "../src/lib/helpParser";
import { sampleManifest } from "../src/lib/sampleData";
import { createWorkspace, type WorkspaceState } from "../src/lib/storage";

type FetchCall = {
  url: string;
  body?: unknown;
};

const project = {
  id: "project-test",
  name: "Test Project",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
  lastOpenedAt: "2026-07-07T00:00:00.000Z"
};

function projectSnapshot(workspace: WorkspaceState | null = null) {
  return {
    dataDir: "/tmp/givemeui-test",
    databasePath: "/tmp/givemeui-test/projects.sqlite",
    activeProjectId: project.id,
    projects: [project],
    workspace
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

function streamResponse(lines: unknown[]): Response {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    headers: { "Content-Type": "application/x-ndjson" },
    status: 200
  });
}

function setupFetch() {
  const calls: FetchCall[] = [];
  let workspace = createWorkspace(sampleManifest);

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });

    if (url === "/api/projects" && !init?.method) {
      return jsonResponse(projectSnapshot(workspace));
    }

    if (url === "/api/workspace") {
      workspace = body.workspace;
      return jsonResponse(projectSnapshot(workspace));
    }

    if (url === "/api/discover") {
      const manifest = parseHelpOutput(
        `usage: echo [OPTION]... [STRING]...
  -n     do not output the trailing newline
  --help  : display this help and exit`,
        body.commandLine
      );
      return jsonResponse({
        manifest,
        executed: ["echo", "--help"],
        stderr: "",
        exitCode: 0,
        timedOut: false,
        helpAttempts: [],
        version: "echo test"
      });
    }

    if (url === "/api/run") {
      return streamResponse([
        { type: "start", command: [body.executable, ...body.baseArgs, ...body.args], executionMode: body.executionMode ?? "stream", at: "2026-07-07T00:00:00.000Z" },
        { type: body.executionMode === "pty" ? "terminal" : "stdout", chunk: "ok\n", at: "2026-07-07T00:00:00.010Z" },
        { type: "exit", exitCode: 0, signal: null, durationMs: 10, timedOut: false, at: "2026-07-07T00:00:00.020Z" }
      ]);
    }

    return new Response("Not found", { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Schema valid");
  return user;
}

describe("GIVEMEUI app integration", () => {
  beforeEach(() => {
    localStorage.clear();
    setupFetch();
    vi.stubGlobal("prompt", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("discovers a CLI tool from mocked help output and renders generated fields", async () => {
    const user = await renderApp();

    await user.clear(screen.getByTestId("command-discovery-input"));
    await user.type(screen.getByTestId("command-discovery-input"), "echo --help");
    await user.click(screen.getByTestId("discover-command"));

    expect(await screen.findByText("Captured help via echo --help (2 fields).")).toBeTruthy();
    expect(screen.getByTestId("field-n")).toBeTruthy();
    expect(screen.getByTestId("field-help")).toBeTruthy();
  });

  it("edits schema field metadata and updates the generated form", async () => {
    const user = await renderApp();

    await user.click(screen.getByTestId("schema-field-c"));
    await user.clear(screen.getByTestId("field-editor-label"));
    await user.type(screen.getByTestId("field-editor-label"), "Python Code");
    await user.click(screen.getByTestId("save-field-draft"));

    expect((await screen.findAllByText("Python Code")).length).toBeGreaterThan(0);
  });

  it("runs a harmless command, streams output, and persists run history", async () => {
    const user = await renderApp();

    await user.click(screen.getByTestId("trust-executable"));
    await user.type(screen.getByTestId("field-c"), "print('ok')");
    await user.click(screen.getByTestId("run-command"));

    expect(await screen.findByText("ok")).toBeTruthy();
    expect((await screen.findAllByText(/exit 0/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10ms/).length).toBeGreaterThan(0);
  });

  it("saves a preset and reloads it into the generated UI", async () => {
    const user = await renderApp();

    await user.type(screen.getByTestId("field-c"), "print('preset')");
    await user.type(screen.getByLabelText("Preset name"), "Preset A");
    await user.click(screen.getByRole("button", { name: "Save Preset" }));
    expect(await screen.findByText('Saved preset "Preset A".')).toBeTruthy();

    await user.clear(screen.getByTestId("field-c"));
    const presetSelect = screen.getByLabelText("Load preset") as HTMLSelectElement;
    const option = within(presetSelect).getByRole("option", { name: "Preset A" }) as HTMLOptionElement;
    await user.selectOptions(presetSelect, option.value);

    await waitFor(() => {
      expect((screen.getByTestId("field-c") as HTMLInputElement).value).toBe("print('preset')");
    });
  });

  it("clears the active workspace after a confirmation click", async () => {
    const user = await renderApp();

    await user.type(screen.getByTestId("field-c"), "print('preset')");
    await user.type(screen.getByLabelText("Preset name"), "Preset A");
    await user.click(screen.getByRole("button", { name: "Save Preset" }));
    expect(await screen.findByText('Saved preset "Preset A".')).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText("Click Confirm Clear to reset the active workspace to a blank slate.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm Clear" }));

    expect(await screen.findByText("Workspace cleared. Blank slate ready.")).toBeTruthy();
    expect((screen.getByTestId("field-c") as HTMLInputElement).value).toBe("");
    expect(within(screen.getByLabelText("Load preset")).queryByRole("option", { name: "Preset A" })).toBeNull();
  });
});
