import { describe, expect, it } from "vitest";
import { buildArgs } from "../src/lib/commandBuilder";
import { formatCommand } from "../src/lib/commandLine";
import { commandLineForHelp, parseFields } from "../src/lib/helpParser";
import type { CommandSpec } from "../src/lib/schema";

describe("commandLineForHelp", () => {
  it("keeps explicit help commands", () => {
    expect(commandLineForHelp("python3 --help")).toEqual(["python3", "--help"]);
  });

  it("appends help to plain commands", () => {
    expect(commandLineForHelp("node")).toEqual(["node", "--help"]);
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
});

describe("formatCommand", () => {
  it("uses readable double quotes when a value contains single quotes", () => {
    expect(formatCommand(["python3", "-c", "print('hello')"])).toBe(`python3 -c "print('hello')"`);
  });
});
