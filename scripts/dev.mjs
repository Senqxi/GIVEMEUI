import { spawn } from "node:child_process";

const commands = [
  {
    name: "api",
    args: ["node_modules/tsx/dist/cli.mjs", "watch", "server/index.ts"]
  },
  {
    name: "web",
    args: ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--force"]
  }
];

const children = commands.map(({ name, args }) => {
  const child = spawn(process.execPath, args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env
  });

  child.stdout.on("data", (chunk) => process.stdout.write(prefixLines(name, chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefixLines(name, chunk)));
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${name}] exited with ${signal ?? code}`);
    shutdown();
  });

  return child;
});

let shuttingDown = false;

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

function prefixLines(name, chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .map((line, index, lines) => (line || index < lines.length - 1 ? `[${name}] ${line}` : ""))
    .join("\n");
}
