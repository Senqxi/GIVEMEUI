import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { spawn as spawnPty, type IPty } from "node-pty";
import type { RunEvent, RunRequest } from "../src/lib/schema";

const DEFAULT_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXECUTION_MODES = new Set(["stream", "pty"]);
const MIN_PTY_COLS = 20;
const MAX_PTY_COLS = 300;
const MIN_PTY_ROWS = 5;
const MAX_PTY_ROWS = 120;

export function validateRunRequest(request: RunRequest): string[] {
  const errors: string[] = [];

  if (!request || typeof request !== "object") {
    return ["Run request body must be an object."];
  }

  if (typeof request.executable !== "string" || request.executable.trim().length === 0) {
    errors.push("Run request is missing an executable.");
  } else if (containsNullByte(request.executable)) {
    errors.push("Executable path contains an invalid null byte.");
  }

  validateStringArray("baseArgs", request.baseArgs, errors);
  validateStringArray("args", request.args, errors);

  if (request.executionMode !== undefined && !EXECUTION_MODES.has(request.executionMode)) {
    errors.push("Execution mode must be stream or pty.");
  }

  if (request.pty !== undefined) {
    if (!request.pty || typeof request.pty !== "object" || Array.isArray(request.pty)) {
      errors.push("PTY options must be an object.");
    } else {
      validateOptionalInteger("pty.cols", request.pty.cols, MIN_PTY_COLS, MAX_PTY_COLS, errors);
      validateOptionalInteger("pty.rows", request.pty.rows, MIN_PTY_ROWS, MAX_PTY_ROWS, errors);
    }
  }

  if (request.cwd !== undefined) {
    if (typeof request.cwd !== "string" || request.cwd.trim().length === 0) {
      errors.push("Working directory must be a non-empty string.");
    } else if (containsNullByte(request.cwd)) {
      errors.push("Working directory contains an invalid null byte.");
    } else {
      try {
        if (!statSync(request.cwd).isDirectory()) {
          errors.push("Working directory must point to an existing directory.");
        }
      } catch {
        errors.push("Working directory does not exist or cannot be accessed.");
      }
    }
  }

  if (request.env !== undefined) {
    if (!request.env || typeof request.env !== "object" || Array.isArray(request.env)) {
      errors.push("Environment must be a KEY=value object.");
    } else {
      for (const [key, value] of Object.entries(request.env)) {
        if (!ENV_KEY_PATTERN.test(key)) errors.push(`Environment key is invalid: ${key}.`);
        if (typeof value !== "string") errors.push(`Environment value for ${key} must be a string.`);
        if (containsNullByte(key) || containsNullByte(String(value))) errors.push(`Environment entry ${key} contains an invalid null byte.`);
      }
    }
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    errors.push(`Timeout must be between ${MIN_TIMEOUT_MS}ms and ${MAX_TIMEOUT_MS}ms.`);
  }

  return errors;
}

export async function runCommand(request: RunRequest, incoming: IncomingMessage, res: ServerResponse): Promise<void> {
  const errors = validateRunRequest(request);
  if (errors.length > 0) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(errors.join("\n"));
    return;
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const executionMode = request.executionMode ?? "stream";
  const argv = [request.executable, ...request.baseArgs, ...request.args];

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });

  const started = performance.now();
  const writeEvent = (event: RunEvent) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  writeEvent({ type: "start", command: argv, executionMode, at: new Date().toISOString() });

  if (executionMode === "pty") {
    runPtyCommand(request, incoming, res, writeEvent, started, timeoutMs);
    return;
  }

  runStreamCommand(request, incoming, res, writeEvent, started, timeoutMs);
}

function runStreamCommand(
  request: RunRequest,
  incoming: IncomingMessage,
  res: ServerResponse,
  writeEvent: (event: RunEvent) => void,
  started: number,
  timeoutMs: number
): void {
  let timedOut = false;
  let hardKillTimer: unknown;
  const child = spawn(request.executable, [...request.baseArgs, ...request.args], {
    cwd: request.cwd,
    shell: false,
    env: { ...process.env, ...(request.env ?? {}) }
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    hardKillTimer = hardKillTimeout();
  }, timeoutMs);

  const hardKillTimeout = () =>
    setTimeout(() => {
      child.kill("SIGKILL");
    }, 2000);

  incoming.on("close", () => {
    if (!child.killed) child.kill("SIGTERM");
  });

  child.stdout?.on("data", (chunk) => {
    writeEvent({ type: "stdout", chunk: chunk.toString(), at: new Date().toISOString() });
  });

  child.stderr?.on("data", (chunk) => {
    writeEvent({ type: "stderr", chunk: chunk.toString(), at: new Date().toISOString() });
  });

  child.on("error", (error) => {
    writeEvent({ type: "error", message: error.message, at: new Date().toISOString() });
  });

  child.on("close", (exitCode, signal) => {
    clearTimeout(timeout);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    writeEvent({
      type: "exit",
      exitCode,
      signal,
      durationMs: Math.round(performance.now() - started),
      timedOut,
      at: new Date().toISOString()
    });
    res.end();
  });
}

function runPtyCommand(
  request: RunRequest,
  incoming: IncomingMessage,
  res: ServerResponse,
  writeEvent: (event: RunEvent) => void,
  started: number,
  timeoutMs: number
): void {
  const cols = request.pty?.cols ?? 120;
  const rows = request.pty?.rows ?? 30;
  let timedOut = false;
  let closed = false;
  let hardKillTimer: unknown;

  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...(request.env ?? {}) }).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );

  let child: IPty;
  try {
    child = spawnPty(request.executable, [...request.baseArgs, ...request.args], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: request.cwd ?? process.cwd(),
      env
    });
  } catch (error) {
    writeEvent({ type: "error", message: error instanceof Error ? error.message : "PTY launch failed.", at: new Date().toISOString() });
    writeEvent({
      type: "exit",
      exitCode: null,
      signal: null,
      durationMs: Math.round(performance.now() - started),
      timedOut,
      at: new Date().toISOString()
    });
    res.end();
    return;
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    hardKillTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2000);
  }, timeoutMs);

  incoming.on("close", () => {
    if (!closed) child.kill("SIGTERM");
  });

  child.onData((chunk) => {
    writeEvent({ type: "terminal", chunk, at: new Date().toISOString() });
  });

  child.onExit((event) => {
    closed = true;
    clearTimeout(timeout);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    writeEvent({
      type: "exit",
      exitCode: event.exitCode,
      signal: event.signal === undefined || event.signal === 0 ? null : String(event.signal),
      durationMs: Math.round(performance.now() - started),
      timedOut,
      at: new Date().toISOString()
    });
    res.end();
  });
}

function validateStringArray(name: "baseArgs" | "args", value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${name} must be an array of strings.`);
    return;
  }

  value.forEach((item, index) => {
    if (typeof item !== "string") errors.push(`${name}[${index}] must be a string.`);
    if (typeof item === "string" && containsNullByte(item)) errors.push(`${name}[${index}] contains an invalid null byte.`);
  });
}

function validateOptionalInteger(name: string, value: unknown, min: number, max: number, errors: string[]): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function containsNullByte(value: string): boolean {
  return value.includes("\0");
}
