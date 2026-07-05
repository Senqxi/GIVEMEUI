import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildArgs, buildRunRequest, initialValuesFor } from "../src/lib/commandBuilder";
import { formatCommand } from "../src/lib/commandLine";
import { commandLineForHelp, helpCommandCandidates, parseFields, parseHelpOutput } from "../src/lib/helpParser";
import type { CommandSpec } from "../src/lib/schema";

describe("commandLineForHelp", () => {
  it("keeps explicit help commands", () => {
    expect(commandLineForHelp("python3 --help")).toEqual(["python3", "--help"]);
  });

  it("appends help to plain commands", () => {
    expect(commandLineForHelp("node")).toEqual(["node", "--help"]);
  });

  it("builds deterministic fallback help candidates", () => {
    expect(helpCommandCandidates("git commit")).toEqual([
      ["git", "commit", "--help"],
      ["git", "commit", "-h"],
      ["git", "help", "commit"]
    ]);
  });
});

describe("parseFields", () => {
  it("extracts long flags, short flags, values, choices, and booleans", () => {
    const fields = parseFields(`
Options:
  -i INPUT, --input INPUT       input file path
  --format {json,csv,text}      output format
  --dry-run                     show command without running
  --port PORT                   server port number
`);

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flag: "--input", shortFlag: "-i", kind: "file" }),
        expect.objectContaining({ flag: "--format", kind: "enum", choices: ["json", "csv", "text"] }),
        expect.objectContaining({ flag: "--dry-run", kind: "boolean" }),
        expect.objectContaining({ flag: "--port", kind: "number" })
      ])
    );
  });

  it("parses python-style colon descriptions", () => {
    const fields = parseFields(`
-c cmd : program passed in as string
-V     : print the Python version number and exit
--check-hash-based-pycs always|default|never:
         control how Python invalidates hash-based .pyc files
`);

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shortFlag: "-c", kind: "string" }),
        expect.objectContaining({ shortFlag: "-V", kind: "boolean" }),
        expect.objectContaining({
          flag: "--check-hash-based-pycs",
          kind: "enum",
          choices: ["always", "default", "never"]
        })
      ])
    );
  });

  it("keeps field IDs unique when short flags differ only by case", () => {
    const fields = parseFields(`
-s     : don't add user site directory to sys.path
-S     : don't imply 'import site' on initialization
`);

    expect(fields.map((field) => field.id)).toEqual(["s", "s-2"]);
  });
});

describe("representative help fixtures", () => {
  it.each([
    ["ffmpeg", "ffmpeg.txt", "ffmpeg --help", 9],
    ["yt-dlp", "yt-dlp.txt", "yt-dlp --help", 8],
    ["git", "git.txt", "git --help", 8],
    ["docker", "docker.txt", "docker --help", 8],
    ["backup.py", "python-argparse.txt", "backup.py --help", 7],
    ["audit-tool", "authorized-security-tool.txt", "audit-tool --help", 8]
  ])("creates a first-pass schema for %s", (name, fixture, commandLine, minimumFieldCount) => {
    const manifest = parseHelpOutput(readFixture(fixture), commandLine);

    expect(manifest.name).toBe(name);
    expect(manifest.commands).toHaveLength(1);
    expect(manifest.rawHelp?.toLowerCase()).toContain("usage");
    expect(manifest.commands[0].fields.length).toBeGreaterThanOrEqual(minimumFieldCount);
  });

  it("captures media-tool flags as runnable fields", () => {
    const manifest = parseHelpOutput(readFixture("ffmpeg.txt"), "ffmpeg --help");
    const fields = manifest.commands[0].fields;

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shortFlag: "-i", kind: "file" }),
        expect.objectContaining({ shortFlag: "-y", kind: "boolean" }),
        expect.objectContaining({ shortFlag: "-threads", kind: "number" })
      ])
    );
  });

  it("captures argparse choices and boolean fields", () => {
    const manifest = parseHelpOutput(readFixture("python-argparse.txt"), "backup.py --help");
    const fields = manifest.commands[0].fields;

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flag: "--compress", kind: "enum", choices: ["none", "gzip", "zstd"] }),
        expect.objectContaining({ flag: "--threads", kind: "number" }),
        expect.objectContaining({ flag: "--dry-run", kind: "boolean" })
      ])
    );
  });

  it("classifies credential fields as secrets in authorized security-tool style help", () => {
    const manifest = parseHelpOutput(readFixture("authorized-security-tool.txt"), "audit-tool --help");
    const fields = manifest.commands[0].fields;

    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flag: "--password", kind: "secret" }),
        expect.objectContaining({ flag: "--port", kind: "number" }),
        expect.objectContaining({ flag: "--dry-run", kind: "boolean" })
      ])
    );
  });

  it("captures positional arguments with low confidence review state", () => {
    const manifest = parseHelpOutput(readFixture("yt-dlp.txt"), "yt-dlp --help");
    const positional = manifest.commands[0].fields.find((field) => field.position === 0);

    expect(positional).toEqual(
      expect.objectContaining({
        id: "url",
        label: "URL",
        kind: "string",
        required: true,
        confidence: 0.48
      })
    );
  });

  it("captures top-level subcommands as reviewable command drafts", () => {
    const manifest = parseHelpOutput(
      `
Usage: demo [OPTIONS] COMMAND

Options:
  --config FILE      config path

Commands:
  build              build project assets
  deploy             deploy reviewed project assets
`,
      "demo --help"
    );

    expect(manifest.commands.map((command) => command.name)).toEqual(["demo", "build", "deploy"]);
    expect(manifest.commands[1]).toEqual(
      expect.objectContaining({
        subcommand: ["build"],
        description: "build project assets"
      })
    );
  });
});

describe("buildArgs", () => {
  it("builds argument arrays without shell strings", () => {
    const command: CommandSpec = {
      id: "demo",
      name: "demo",
      fields: [
        { id: "input", label: "Input", kind: "file", required: false, flag: "--input", confidence: 1 },
        { id: "dry-run", label: "Dry Run", kind: "boolean", required: false, flag: "--dry-run", confidence: 1 }
      ]
    };

    expect(buildArgs(command, { input: "a file.txt", "dry-run": true })).toEqual([
      "--input",
      "a file.txt",
      "--dry-run"
    ]);
  });

  it("carries local run settings without changing argument construction", () => {
    const command: CommandSpec = {
      id: "demo",
      name: "demo",
      fields: [{ id: "name", label: "Name", kind: "string", required: false, flag: "--name", confidence: 1 }]
    };
    const manifest = parseHelpOutput("Usage: demo [--name NAME]", "demo --help");
    const request = buildRunRequest(manifest, command, { name: "report" }, {
      cwd: "/tmp",
      env: { GIVEMEUI_TEST: "1" },
      timeoutMs: 5000
    });

    expect(request).toEqual(
      expect.objectContaining({
        executable: "demo",
        args: ["--name", "report"],
        cwd: "/tmp",
        env: { GIVEMEUI_TEST: "1" },
        timeoutMs: 5000
      })
    );
  });
});

describe("initialValuesFor", () => {
  it("does not prefill optional discovered defaults into runnable command values", () => {
    const command: CommandSpec = {
      id: "demo",
      name: "demo",
      fields: [
        { id: "mode", label: "Mode", kind: "string", required: false, flag: "--mode", defaultValue: "safe", confidence: 0.82 },
        { id: "target", label: "Target", kind: "string", required: true, flag: "--target", defaultValue: "localhost", confidence: 0.82 }
      ]
    };

    expect(initialValuesFor(command)).toEqual({ mode: "", target: "localhost" });
  });
});

describe("default parsing", () => {
  it("ignores prose about a default value subject", () => {
    const fields = parseFields(`
Options:
  --dns-result-order=...      set default value of verbatim in dns.lookup
`);

    expect(fields[0].defaultValue).toBeUndefined();
  });
});

describe("formatCommand", () => {
  it("uses readable double quotes when a value contains single quotes", () => {
    expect(formatCommand(["python3", "-c", "print('hello')"])).toBe(`python3 -c "print('hello')"`);
  });
});

function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/help/${name}`, import.meta.url), "utf8");
}
