import { describe, expect, it } from "vitest";
import { validateRunRequest } from "../server/runner";

describe("safe command runner validation", () => {
  it("accepts argument-array run requests", () => {
    expect(
      validateRunRequest({
        executable: process.execPath,
        baseArgs: ["-e"],
        args: ["console.log('ok')"],
        cwd: process.cwd(),
        env: { GIVEMEUI_TEST: "1" },
        timeoutMs: 5000
      })
    ).toEqual([]);
  });

  it("rejects shell-shaped or malformed request fields", () => {
    expect(
      validateRunRequest({
        executable: "",
        baseArgs: "not-array" as unknown as string[],
        args: ["ok\0bad"],
        timeoutMs: 25
      })
    ).toEqual(
      expect.arrayContaining([
        "Run request is missing an executable.",
        "baseArgs must be an array of strings.",
        "args[0] contains an invalid null byte.",
        "Timeout must be between 1000ms and 1800000ms."
      ])
    );
  });

  it("validates working directory and environment keys", () => {
    expect(
      validateRunRequest({
        executable: process.execPath,
        baseArgs: [],
        args: [],
        cwd: "/path/that/does/not/exist/givemeui",
        env: { "BAD-KEY": "1" },
        timeoutMs: 5000
      })
    ).toEqual(expect.arrayContaining(["Working directory does not exist or cannot be accessed.", "Environment key is invalid: BAD-KEY."]));
  });
});
