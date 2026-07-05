#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.version) {
  console.log(packageJson.version);
  process.exit(0);
}

const staticDir = join(packageRoot, "dist");
const serverEntry = join(packageRoot, "server/index.ts");
const tsxCli = join(packageRoot, "node_modules/tsx/dist/cli.mjs");

if (!existsSync(join(staticDir, "index.html"))) {
  console.error("GIVEMEUI has not been built yet. Run `npm run build` from the project root, then run `givemeui` again.");
  process.exit(1);
}

if (!existsSync(tsxCli)) {
  console.error("GIVEMEUI dependencies are missing. Run `npm install` from the project root, then run `givemeui` again.");
  process.exit(1);
}

const url = `http://${options.host}:${options.port}`;
console.log(`Starting GIVEMEUI at ${url}`);

const child = spawn(process.execPath, [tsxCli, serverEntry], {
  stdio: "inherit",
  env: {
    ...process.env,
    GIVEMEUI_HOST: options.host,
    GIVEMEUI_PORT: String(options.port),
    GIVEMEUI_STATIC_DIR: staticDir
  }
});

if (options.open) {
  openUrl(url);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function parseArgs(args) {
  const parsed = {
    host: "127.0.0.1",
    port: 5173,
    open: false,
    help: false,
    version: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      parsed.version = true;
      continue;
    }

    if (arg === "--open") {
      parsed.open = true;
      continue;
    }

    if (arg === "--no-open") {
      parsed.open = false;
      continue;
    }

    if (arg === "--host") {
      parsed.host = readValue(args, (index += 1), arg);
      continue;
    }

    if (arg === "--port" || arg === "-p") {
      parsed.port = parsePort(readValue(args, (index += 1), arg));
      continue;
    }

    console.error(`Unknown option: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return parsed;
}

function readValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    console.error(`${flag} requires a value.`);
    process.exit(1);
  }
  return value;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${value}`);
    process.exit(1);
  }
  return port;
}

function openUrl(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const opener = spawn(command, args, { stdio: "ignore", detached: true });
  opener.unref();
}

function shutdown() {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
}

function printHelp() {
  console.log(`GIVEMEUI ${packageJson.version}

Usage:
  givemeui [options]

Options:
  -p, --port <port>   Local port to listen on. Default: 5173
      --host <host>   Local host to bind. Default: 127.0.0.1
      --open          Open the app in your default browser
      --no-open       Do not open a browser. Default
  -v, --version       Print version
  -h, --help          Print help

Examples:
  givemeui
  givemeui --port 5180 --open
`);
}
