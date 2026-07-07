import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root, "release");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

mkdirSync(releaseDir, { recursive: true });

const build = spawnSync(npmCommand, ["run", "build"], {
  cwd: root,
  stdio: "inherit"
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const pack = spawnSync(npmCommand, ["pack", "--ignore-scripts", "--pack-destination", releaseDir, "--json"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
});

if (pack.status !== 0) {
  process.exit(pack.status ?? 1);
}

const packed = JSON.parse(pack.stdout.trim())[0];
const artifactPath = resolveArtifactPath(packed.filename);
const artifact = readFileSync(artifactPath);
const sha256 = createHash("sha256").update(artifact).digest("hex");
const checksumPath = `${artifactPath}.sha256`;
const manifestPath = join(releaseDir, `givemeui-${packageJson.version}-release-manifest.json`);

writeFileSync(checksumPath, `${sha256}  ${packed.filename}\n`);
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      generatedAt: new Date().toISOString(),
      packageManager: "npm",
      node: process.version,
      platforms: packageJson.os,
      artifacts: [
        {
          file: packed.filename,
          sha256,
          bytes: statSync(artifactPath).size
        }
      ]
    },
    null,
    2
  )}\n`
);

console.log(`Created ${artifactPath}`);
console.log(`SHA-256 ${sha256}`);
console.log(`Wrote ${checksumPath}`);
console.log(`Wrote ${manifestPath}`);

function resolveArtifactPath(filename) {
  if (isAbsolute(filename)) return filename;
  const inRelease = join(releaseDir, filename);
  return inRelease;
}
