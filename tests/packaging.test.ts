import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageJson = {
  bin?: Record<string, string>;
  files?: string[];
  os?: string[];
  scripts?: Record<string, string>;
};

type AppMetadata = {
  entrypoint: string;
  icon: string;
  supportedPlatforms: string[];
  updateStrategy: string;
  crashReporting: {
    enabled: boolean;
    policy: string;
  };
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const appMetadata = JSON.parse(readFileSync("packaging/app-metadata.json", "utf8")) as AppMetadata;

describe("packaging metadata", () => {
  it("ships the CLI entrypoint, built app, server, docs, scripts, and packaging metadata", () => {
    expect(packageJson.bin?.givemeui).toBe("./bin/givemeui.mjs");
    expect(packageJson.files).toEqual(expect.arrayContaining(["bin/", "dist/", "server/", "scripts/", "docs/", "packaging/"]));
  });

  it("documents the local-first distribution contract", () => {
    expect(packageJson.os).toEqual(["darwin", "linux"]);
    expect(appMetadata.entrypoint).toBe("bin/givemeui.mjs");
    expect(appMetadata.icon).toBe("public/favicon.svg");
    expect(appMetadata.supportedPlatforms).toEqual(["darwin", "linux"]);
    expect(appMetadata.updateStrategy).toMatch(/manual GitHub release/i);
    expect(appMetadata.crashReporting.enabled).toBe(false);
    expect(appMetadata.crashReporting.policy).toMatch(/No crash or error reports leave the device/i);
  });

  it("defines reproducible release commands", () => {
    expect(packageJson.scripts?.["release:check"]).toContain("npm run typecheck");
    expect(packageJson.scripts?.["release:check"]).toContain("npm run test");
    expect(packageJson.scripts?.["release:check"]).toContain("npm run pack:check");
    expect(packageJson.scripts?.["package:local"]).toBe("node scripts/package-local.mjs");
  });
});
