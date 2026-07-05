import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverCommand, resolveExecutable, versionFromOutput } from "../server/discovery";

const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths) {
    rmSync(path, { force: true, recursive: true });
  }
  tempPaths.length = 0;
});

describe("executable resolution", () => {
  it("resolves executables from a PATH-like search list", () => {
    const directory = mkdtempSync(join(tmpdir(), "givemeui-path-"));
    const executable = join(directory, "demo-tool");
    tempPaths.push(directory);
    writeFileSync(executable, "#!/bin/sh\nprintf 'ok\\n'\n");
    chmodSync(executable, 0o755);

    expect(resolveExecutable("demo-tool", { cwd: directory, envPath: directory })).toEqual(
      expect.objectContaining({
        input: "demo-tool",
        executable: "demo-tool",
        resolvedPath: executable,
        type: "path"
      })
    );
  });

  it("keeps unresolved tools explicit", () => {
    expect(resolveExecutable("definitely-not-a-real-givemeui-tool", { envPath: "" })).toEqual(
      expect.objectContaining({
        executable: "definitely-not-a-real-givemeui-tool",
        type: "unresolved"
      })
    );
  });
});

describe("discovery command capture", () => {
  it("captures help, version, resolved executable, and parser metadata", async () => {
    const executable = createFixtureTool();
    const result = await discoverCommand({ commandLine: `${executable} scan` });

    expect(result.executed).toEqual([executable, "scan", "--help"]);
    expect(result.version).toBe("fixture-tool 1.2.3");
    expect(result.resolution).toEqual(expect.objectContaining({ resolvedPath: executable, type: "absolute" }));
    expect(result.manifest).toEqual(
      expect.objectContaining({
        executable,
        baseArgs: ["scan"],
        version: "fixture-tool 1.2.3"
      })
    );
    expect(result.manifest.discovery?.helpAttempts[0]).toEqual(
      expect.objectContaining({
        command: [executable, "scan", "--help"],
        exitCode: 0,
        timedOut: false
      })
    );
    expect(result.manifest.commands[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flag: "--target", kind: "string" }),
        expect.objectContaining({ flag: "--threads", kind: "number" }),
        expect.objectContaining({ flag: "--dry-run", kind: "boolean" })
      ])
    );
  });
});

describe("version parsing", () => {
  it("uses the first non-empty non-usage line", () => {
    expect(versionFromOutput("\nusage: demo\n\ndemo 2.0.0\n")).toBe("demo 2.0.0");
  });
});

function createFixtureTool(): string {
  const directory = mkdtempSync(join(tmpdir(), "givemeui-discovery-"));
  const executable = join(directory, "fixture-tool");
  tempPaths.push(directory);
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fixture-tool 1.2.3");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log(\`Usage: fixture-tool scan [OPTIONS]

Options:
  --target HOST       authorized host or URL
  --threads NUMBER    worker thread count
  --dry-run           print command without running
\`);
  process.exit(0);
}
console.error("missing --help");
process.exit(2);
`
  );
  chmodSync(executable, 0o755);
  return executable;
}
