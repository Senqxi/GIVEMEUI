import { describe, expect, it } from "vitest";
import { parseEnvText, timeoutMsFromSeconds } from "../src/lib/runSettings";

describe("run settings helpers", () => {
  it("parses KEY=value environment text without storing comments", () => {
    expect(parseEnvText("FOO=bar\n# ignored\nTOKEN=a=b")).toEqual({
      FOO: "bar",
      TOKEN: "a=b"
    });
  });

  it("rejects invalid environment lines", () => {
    expect(() => parseEnvText("BAD LINE")).toThrow("Environment line 1");
    expect(() => parseEnvText("1BAD=value")).toThrow("invalid key");
  });

  it("clamps timeout seconds to the runner limits", () => {
    expect(timeoutMsFromSeconds(0)).toBe(1000);
    expect(timeoutMsFromSeconds(5)).toBe(5000);
    expect(timeoutMsFromSeconds(9999)).toBe(1800000);
  });
});
