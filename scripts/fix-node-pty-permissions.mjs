import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const helperPaths = [
  join("node_modules", "node-pty", "prebuilds", "darwin-arm64", "spawn-helper"),
  join("node_modules", "node-pty", "prebuilds", "darwin-x64", "spawn-helper")
];

for (const helperPath of helperPaths) {
  if (!existsSync(helperPath)) continue;

  try {
    chmodSync(helperPath, 0o755);
  } catch {
    // Best effort: PTY launch will surface a clear runtime error if this cannot be repaired.
  }
}
