import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyToolAdapters, matchingToolAdapters } from "../src/lib/adapters";
import { parseHelpOutput } from "../src/lib/helpParser";

describe("tool adapters", () => {
  it("matches known adapters by executable name", () => {
    const manifest = parseHelpOutput(readFixture("ffmpeg.txt"), "/usr/bin/ffmpeg --help", { executable: "/usr/bin/ffmpeg" });

    expect(matchingToolAdapters(manifest).map((adapter) => adapter.id)).toEqual(["ffmpeg"]);
  });

  it("enhances ffmpeg with media output metadata and focused fields", () => {
    const manifest = applyToolAdapters(parseHelpOutput(readFixture("ffmpeg.txt"), "ffmpeg --help"));
    const command = manifest.commands[0];

    expect(manifest.adapters?.map((adapter) => adapter.id)).toContain("ffmpeg");
    expect(command.output?.expectedTypes).toEqual(expect.arrayContaining(["video", "audio", "image", "file"]));
    expect(command.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "output-file", label: "Output File", kind: "file" }),
        expect.objectContaining({ shortFlag: "-i", label: "Input File", kind: "file", ui: expect.objectContaining({ group: "Input" }) }),
        expect.objectContaining({ shortFlag: "-vf", label: "Video Filters", ui: expect.objectContaining({ group: "Video" }) })
      ])
    );
    expect(command.examples?.map((example) => example.label)).toContain("Transcode video");
  });

  it("enhances yt-dlp with download-focused labels and safety notes", () => {
    const manifest = applyToolAdapters(parseHelpOutput(readFixture("yt-dlp.txt"), "yt-dlp --help"));
    const command = manifest.commands[0];

    expect(manifest.adapters?.map((adapter) => adapter.id)).toContain("yt-dlp");
    expect(command.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flag: "--output", label: "Output Template", kind: "file" }),
        expect.objectContaining({ flag: "--cookies", label: "Cookies File", kind: "file", ui: expect.objectContaining({ group: "Authentication" }) }),
        expect.objectContaining({ id: "url", label: "Video URL" })
      ])
    );
    expect(command.safety?.notes?.join(" ")).toContain("downloads remote media");
  });

  it("enhances git with curated read-only commands", () => {
    const manifest = applyToolAdapters(parseHelpOutput(readFixture("git.txt"), "git --help"));

    expect(manifest.adapters?.map((adapter) => adapter.id)).toContain("git");
    expect(manifest.commands.map((command) => command.name)).toEqual(expect.arrayContaining(["git", "status", "log", "diff"]));
    expect(manifest.commands.find((command) => command.name === "status")?.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ flag: "--short" }), expect.objectContaining({ flag: "--branch" })])
    );
    expect(manifest.commands[0].fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ shortFlag: "-C", label: "Repository Directory", kind: "directory" })])
    );
  });
});

function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/help/${name}`, import.meta.url), "utf8");
}
