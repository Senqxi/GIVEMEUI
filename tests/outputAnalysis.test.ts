import { describe, expect, it } from "vitest";
import { analyzeRunOutput } from "../src/lib/outputAnalysis";

describe("output analysis", () => {
  it("detects structured JSON output", () => {
    const analysis = analyzeRunOutput('{"ok":true,"items":[1,2]}', "");

    expect(analysis.format).toBe("json");
    expect(analysis.json?.pretty).toContain('"ok": true');
    expect(analysis.summary.stdoutLines).toBe(1);
  });

  it("detects newline-delimited JSON output", () => {
    const analysis = analyzeRunOutput('{"id":1}\n{"id":2}', "");

    expect(analysis.format).toBe("ndjson");
    expect(analysis.json?.value).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("detects CSV tables", () => {
    const analysis = analyzeRunOutput("name,count\nalpha,2\nbeta,3\n", "");

    expect(analysis.format).toBe("csv");
    expect(analysis.table?.headers).toEqual(["name", "count"]);
    expect(analysis.table?.rows).toEqual([
      ["alpha", "2"],
      ["beta", "3"]
    ]);
  });

  it("highlights diagnostics and progress lines", () => {
    const analysis = analyzeRunOutput("download 25% complete\nWARNING: slow network", "ERROR: failed to open file");

    expect(analysis.summary.errorCount).toBe(1);
    expect(analysis.summary.warningCount).toBe(1);
    expect(analysis.progress[0]).toEqual(expect.objectContaining({ percent: 25 }));
  });

  it("detects generated artifacts by extension", () => {
    const analysis = analyzeRunOutput("Wrote output.mp4 and /tmp/frame.png", "");

    expect(analysis.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "output.mp4", kind: "video", isAbsolute: false }),
        expect.objectContaining({ path: "/tmp/frame.png", kind: "image", isAbsolute: true })
      ])
    );
  });

  it("deduplicates artifact paths across streams", () => {
    const analysis = analyzeRunOutput('{"path":"/tmp/frame.png"}', "WARNING: wrote /tmp/frame.png");

    expect(analysis.artifacts).toHaveLength(1);
    expect(analysis.summary.artifactCount).toBe(1);
  });
});
