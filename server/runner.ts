import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { RunEvent, RunRequest } from "../src/lib/schema";

const DEFAULT_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  const argv = [request.executable, ...request.baseArgs, ...request.args];

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });

  const started = performance.now();
  let timedOut = false;
  let hardKillTimer: unknown;
  const child = spawn(request.executable, [...request.baseArgs, ...request.args], {
    cwd: request.cwd,
    shell: false,
    env: { ...process.env, ...(request.env ?? {}) }
  });

  const writeEvent = (event: RunEvent) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  writeEvent({ type: "start", command: argv, at: new Date().toISOString() });

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

function containsNullByte(value: string): boolean {
  return value.includes("\0");
}
