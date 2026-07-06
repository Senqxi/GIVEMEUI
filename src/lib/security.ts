import { buildRunRequest, type FieldValues } from "./commandBuilder";
import type { AdapterMetadata, CommandSpec, ToolManifest } from "./schema";

export type CommandRisk = {
  destructive: boolean;
  requiresShell: boolean;
  warnings: string[];
};

const SHELL_EXECUTABLES = new Set(["sh", "bash", "zsh", "fish", "ksh", "csh", "tcsh", "pwsh", "powershell", "cmd"]);
const DESTRUCTIVE_EXECUTABLES = new Set(["mkfs", "mkfs.ext4", "mkfs.xfs", "fdisk", "parted", "shred", "wipefs"]);
const DESTRUCTIVE_FLAGS = new Set(["--delete", "--remove", "--force", "--overwrite", "--wipe", "--format", "--prune"]);

export function schemaFingerprint(manifest: ToolManifest): string {
  return stableHash(stableStringify(canonicalManifestForTrust(manifest)));
}

export function executablePinnedPath(manifest: ToolManifest): string | undefined {
  return manifest.discovery?.resolution.resolvedPath || (manifest.discovery?.resolution.type === "absolute" ? manifest.executable : undefined);
}

export function adapterTrustKey(adapter: AdapterMetadata): string {
  return `${adapter.id}@${adapter.version ?? "unversioned"}`;
}

export function commandRiskReviewKey(manifest: ToolManifest, command: CommandSpec, values: FieldValues): string {
  const request = buildRunRequest(manifest, command, values);
  return stableHash(stableStringify([request.executable, ...request.baseArgs, ...request.args]));
}

export function detectCommandRisk(manifest: ToolManifest, command: CommandSpec, argv: string[]): CommandRisk {
  const warnings = new Set<string>();
  const executable = commandName(argv[0] ?? manifest.executable);
  const tokens = argv.map((token) => token.toLowerCase());
  const args = tokens.slice(1);
  let destructive = command.safety?.destructive === true;
  let requiresShell = command.safety?.requiresShell === true;

  if (command.safety?.destructive) {
    warnings.add("This command is marked destructive by its schema.");
  }

  if (command.safety?.requiresShell) {
    requiresShell = true;
    warnings.add("This command is marked as requiring shell mode. Shell execution is gated in this build.");
  }

  if (SHELL_EXECUTABLES.has(executable)) {
    requiresShell = true;
    warnings.add("Shell executables are gated because they can hide injected commands.");
  }

  if (DESTRUCTIVE_EXECUTABLES.has(executable)) {
    destructive = true;
    warnings.add(`${executable} can modify disks or remove data.`);
  }

  if (executable === "rm" && args.some((arg) => /r.*f|f.*r/.test(arg.replace(/^-+/, "")))) {
    destructive = true;
    warnings.add("Recursive forced removal detected.");
  }

  if (executable === "dd" && args.some((arg) => arg.startsWith("of="))) {
    destructive = true;
    warnings.add("dd output target detected. Review the destination before running.");
  }

  if (executable === "git" && args[0] === "reset" && args.includes("--hard")) {
    destructive = true;
    warnings.add("git reset --hard can discard local changes.");
  }

  if (executable === "git" && args[0] === "clean" && args.some((arg) => arg.includes("f"))) {
    destructive = true;
    warnings.add("git clean with force can delete untracked files.");
  }

  if (args.some((arg) => DESTRUCTIVE_FLAGS.has(arg))) {
    destructive = true;
    warnings.add("A destructive or overwrite flag is present.");
  }

  if (argv.some(hasShellMetacharacter)) {
    warnings.add("Shell-like metacharacters appear in arguments. They are passed as argv values, not through a shell.");
  }

  return { destructive, requiresShell, warnings: [...warnings] };
}

function canonicalManifestForTrust(manifest: ToolManifest): unknown {
  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    executable: manifest.executable,
    baseArgs: manifest.baseArgs,
    version: manifest.version,
    source: manifest.source,
    discovery: manifest.discovery
      ? {
          input: manifest.discovery.input,
          resolvedExecutable: manifest.discovery.resolvedExecutable,
          resolution: manifest.discovery.resolution,
          version: manifest.discovery.version,
          warnings: manifest.discovery.warnings
        }
      : undefined,
    adapters: manifest.adapters?.map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      version: adapter.version,
      notes: adapter.notes
    })),
    commands: manifest.commands.map((command) => ({
      id: command.id,
      name: command.name,
      description: command.description,
      subcommand: command.subcommand,
      fields: command.fields,
      examples: command.examples,
      output: command.output,
      safety: command.safety
    }))
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function commandName(executable: string): string {
  const normalized = executable.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

function hasShellMetacharacter(value: string): boolean {
  return /(?:&&|\|\||[;|`]|[$]\(|>\s*[^=]|<\s*[^=])/.test(value);
}
