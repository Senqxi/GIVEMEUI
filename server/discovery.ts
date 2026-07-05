import { constants, accessSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { commandNameFromExecutable, parseCommandLine } from "../src/lib/commandLine";
import { helpCommandCandidates, parseHelpOutput } from "../src/lib/helpParser";
import type { DiscoveryAttempt, DiscoveryMetadata, DiscoveryRequest, DiscoveryResponse, ExecutableResolution } from "../src/lib/schema";

const HELP_TIMEOUT_MS = 8000;
const VERSION_TIMEOUT_MS = 2500;
const VERSION_ARGS = [["--version"], ["version"], ["-version"]];

type CapturedCommand = {
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export async function discoverCommand(request: DiscoveryRequest): Promise<DiscoveryResponse> {
  const originalArgv = parseCommandLine(request.commandLine);
  if (originalArgv.length === 0) {
    throw new Error("Enter a command to discover.");
  }

  const cwd = request.cwd ? resolve(request.cwd) : process.cwd();
  const resolution = resolveExecutable(originalArgv[0], { cwd });
  const executable = resolution.resolvedPath ?? resolution.executable;
  const baseArgs = stripHelpArgs(originalArgv.slice(1));
  const warnings: string[] = [];

  if (resolution.type === "unresolved") {
    warnings.push(`Executable could not be resolved from ${resolution.input}. The discovery attempt still uses the provided command name.`);
  }

  const helpCandidates = helpCommandCandidates(request.commandLine).map((candidate) => [executable, ...candidate.slice(1)]);
  const helpResults = await captureHelpCandidates(helpCandidates, cwd);
  const bestHelp = chooseBestHelpResult(helpResults);
  const helpText = [bestHelp.stdout, bestHelp.stderr].filter(Boolean).join("\n");
  const versionResult = await captureVersion(executable, cwd);

  if (!helpText.trim()) {
    warnings.push("No help output was captured. The generated schema may be empty.");
  }

  if (bestHelp.timedOut) {
    warnings.push("Help capture timed out and the process was terminated.");
  }

  const metadata: DiscoveryMetadata = {
    input: request.commandLine,
    resolvedExecutable: executable,
    resolution,
    helpCommand: bestHelp.command,
    helpAttempts: helpResults.map(toAttempt),
    version: versionResult.version,
    versionCommand: versionResult.command,
    warnings
  };
  const manifest = parseHelpOutput(helpText || bestHelp.stderr || bestHelp.stdout, request.commandLine, {
    executable,
    baseArgs,
    version: versionResult.version,
    discovery: metadata
  });

  return {
    manifest,
    executed: bestHelp.command,
    stderr: bestHelp.stderr,
    exitCode: bestHelp.exitCode,
    timedOut: bestHelp.timedOut,
    resolution,
    helpAttempts: metadata.helpAttempts,
    version: versionResult.version
  };
}

export function resolveExecutable(input: string, options: { cwd?: string; envPath?: string } = {}): ExecutableResolution {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();

  if (isAbsolute(input)) {
    return {
      input,
      executable: input,
      resolvedPath: isExecutableFile(input) ? input : undefined,
      type: isExecutableFile(input) ? "absolute" : "unresolved",
      cwd
    };
  }

  if (input.startsWith(`.${sep}`) || input.startsWith(`..${sep}`) || input.includes(sep)) {
    const candidate = resolve(cwd, input);
    return {
      input,
      executable: input,
      resolvedPath: isExecutableFile(candidate) ? candidate : undefined,
      type: isExecutableFile(candidate) ? "relative" : "unresolved",
      cwd
    };
  }

  for (const directory of pathEntries(options.envPath ?? process.env.PATH ?? "")) {
    const candidate = join(directory, input);
    if (isExecutableFile(candidate)) {
      return {
        input,
        executable: input,
        resolvedPath: candidate,
        type: "path",
        cwd
      };
    }
  }

  return {
    input,
    executable: input,
    type: "unresolved",
    cwd
  };
}

export function versionFromOutput(output: string): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !/^usage:/i.test(item));

  return line?.slice(0, 160);
}

async function captureHelpCandidates(commands: string[][], cwd: string): Promise<CapturedCommand[]> {
  const results: CapturedCommand[] = [];

  for (const command of commands) {
    const result = await captureCommand(command[0], command.slice(1), { cwd, timeoutMs: HELP_TIMEOUT_MS });
    results.push({ command, ...result });

    if (helpScore(results.at(-1) as CapturedCommand) >= 85) break;
  }

  return results;
}

function chooseBestHelpResult(results: CapturedCommand[]): CapturedCommand {
  return [...results].sort((left, right) => helpScore(right) - helpScore(left))[0] ?? {
    command: [],
    stdout: "",
    stderr: "No help command was attempted.",
    exitCode: null,
    timedOut: false
  };
}

function helpScore(result: CapturedCommand): number {
  const output = `${result.stdout}\n${result.stderr}`;
  let score = Math.min(30, Math.floor(output.length / 120));
  if (/usage:/i.test(output)) score += 40;
  if (/\b(options?|flags?)\b:/i.test(output)) score += 25;
  if (/\bcommands?\b:/i.test(output)) score += 15;
  if (result.exitCode === 0) score += 10;
  if (result.timedOut) score -= 30;
  return score;
}

async function captureVersion(executable: string, cwd: string): Promise<{ version?: string; command?: string[] }> {
  for (const args of VERSION_ARGS) {
    const result = await captureCommand(executable, args, { cwd, timeoutMs: VERSION_TIMEOUT_MS });
    const version = versionFromOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
    if (version && result.exitCode === 0) {
      return { version, command: [executable, ...args] };
    }
  }

  return {};
}

function captureCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const settle = (result: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      settle({ stdout, stderr: stderr || error.message, exitCode: null, timedOut });
    });
    child.on("close", (exitCode) => {
      settle({ stdout, stderr, exitCode, timedOut });
    });
  });
}

function toAttempt(result: CapturedCommand): DiscoveryAttempt {
  return {
    command: result.command,
    stdoutBytes: result.stdout.length,
    stderrBytes: result.stderr.length,
    exitCode: result.exitCode,
    timedOut: result.timedOut
  };
}

function pathEntries(envPath: string): string[] {
  return envPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function stripHelpArgs(args: string[]): string[] {
  const helpArgs = new Set(["--help", "-h"]);
  if (args[0] === "help") return args.slice(1);
  return args.filter((arg) => !helpArgs.has(arg));
}

export function executableDisplayName(resolution: ExecutableResolution): string {
  return commandNameFromExecutable(resolution.resolvedPath ?? resolution.executable);
}

export function executableDirectory(resolution: ExecutableResolution): string | undefined {
  return resolution.resolvedPath ? dirname(resolution.resolvedPath) : undefined;
}
