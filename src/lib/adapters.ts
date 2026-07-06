import { commandNameFromExecutable } from "./commandLine";
import type { AdapterMetadata, CommandSpec, FieldKind, FieldSpec, ToolManifest } from "./schema";

export type ToolAdapter = {
  id: string;
  name: string;
  identify(manifest: ToolManifest): boolean;
  version(manifest: ToolManifest): AdapterVersionInfo;
  enhance(manifest: ToolManifest): ToolManifest;
};

export type AdapterVersionInfo = {
  detectedVersion?: string;
  supported: boolean;
  notes: string[];
};

const nowIso = () => new Date().toISOString();

export const toolAdapters: ToolAdapter[] = [ffmpegAdapter(), ytDlpAdapter(), gitAdapter()];

export function applyToolAdapters(manifest: ToolManifest): ToolManifest {
  return toolAdapters.reduce((current, adapter) => {
    if (!adapter.identify(current)) return current;
    const enhanced = adapter.enhance(current);
    return addAdapterMetadata(enhanced, adapter);
  }, manifest);
}

export function matchingToolAdapters(manifest: ToolManifest): ToolAdapter[] {
  return toolAdapters.filter((adapter) => adapter.identify(manifest));
}

function ffmpegAdapter(): ToolAdapter {
  return {
    id: "ffmpeg",
    name: "FFmpeg",
    identify: (manifest) => toolName(manifest) === "ffmpeg",
    version: (manifest) => adapterVersionInfo(manifest, /^ffmpeg version\s+/i),
    enhance(manifest) {
      return {
        ...manifest,
        commands: manifest.commands.map((command) =>
          addFieldIfMissing(
            enhanceCommand(command, {
              output: { expectedTypes: ["text", "video", "audio", "image", "file"] },
              safety: {
                ...command.safety,
                notes: mergeNotes(command.safety?.notes, [
                  "FFmpeg adapter: generated artifacts are expected from output file arguments.",
                  "Review overwrite flags before running."
                ])
              },
              examples: mergeExamples(command.examples, [
                { label: "Transcode video", args: ["-i", "input.mov", "-c:v", "libx264", "output.mp4"] },
                { label: "Extract audio", args: ["-i", "input.mp4", "audio.wav"] }
              ])
            }),
            {
              id: "output-file",
              label: "Output File",
              description: "Output media path.",
              kind: "file",
              required: true,
              position: nextPosition(command.fields),
              placeholder: "output.mp4",
              ui: { group: "Output", advanced: false, control: "file" },
              confidence: 0.86
            }
          )
        ).map((command) =>
          updateFields(command, {
            "-i": { label: "Input File", kind: "file", ui: { group: "Input", advanced: false, control: "file" } },
            "-y": { label: "Overwrite Output", ui: { group: "Output", advanced: false, control: "switch" } },
            "-n": { label: "Never Overwrite", ui: { group: "Output", advanced: false, control: "switch" } },
            "-f": { label: "Container Format", ui: { group: "Output", advanced: false } },
            "-vf": { label: "Video Filters", ui: { group: "Video", advanced: false, control: "text" } },
            "-codec": { label: "Codec", ui: { group: "Encoding", advanced: false } },
            "-threads": { label: "Threads", kind: "number", ui: { group: "Performance", advanced: false, control: "number" } },
            "-t": { label: "Duration", ui: { group: "Timing", advanced: false } },
            "-ss": { label: "Start Time", ui: { group: "Timing", advanced: false } }
          })
        )
      };
    }
  };
}

function ytDlpAdapter(): ToolAdapter {
  return {
    id: "yt-dlp",
    name: "yt-dlp",
    identify: (manifest) => toolName(manifest) === "yt-dlp",
    version: (manifest) => adapterVersionInfo(manifest, /^yt-dlp\s+/i),
    enhance(manifest) {
      return {
        ...manifest,
        commands: manifest.commands.map((command) =>
          updateFields(
            enhanceCommand(command, {
              output: { expectedTypes: ["text", "video", "audio", "file", "json"] },
              safety: {
                ...command.safety,
                notes: mergeNotes(command.safety?.notes, [
                  "yt-dlp adapter: downloads remote media selected by the user.",
                  "Review URL, proxy, cookies, and output template before running."
                ])
              },
              examples: mergeExamples(command.examples, [
                { label: "Download URL", args: ["https://example.com/video"] },
                { label: "Choose format", args: ["-f", "bestvideo+bestaudio", "https://example.com/video"] }
              ])
            }),
            {
              "--output": { label: "Output Template", kind: "file", ui: { group: "Output", advanced: false, control: "file" } },
              "--format": { label: "Format Selector", ui: { group: "Format", advanced: false } },
              "--cookies": { label: "Cookies File", kind: "file", ui: { group: "Authentication", advanced: true, control: "file" } },
              "--proxy": { label: "Proxy URL", ui: { group: "Network", advanced: true } },
              "--download-archive": { label: "Download Archive", kind: "file", ui: { group: "Archive", advanced: true, control: "file" } },
              "--no-playlist": { label: "Single Video Only", ui: { group: "Playlist", advanced: false, control: "switch" } }
            }
          )
        ).map((command) => updatePositionals(command, { url: { label: "Video URL", ui: { group: "Input", advanced: false } } }))
      };
    }
  };
}

function gitAdapter(): ToolAdapter {
  return {
    id: "git",
    name: "Git",
    identify: (manifest) => toolName(manifest) === "git",
    version: (manifest) => adapterVersionInfo(manifest, /^git version\s+/i),
    enhance(manifest) {
      const rootCommand = enhanceCommand(updateFields(manifest.commands[0], {
        "-C": { label: "Repository Directory", kind: "directory", ui: { group: "Repository", advanced: false, control: "file" } },
        "-c": { label: "Config Override", ui: { group: "Advanced", advanced: true } },
        "--work-tree": { label: "Working Tree", kind: "directory", ui: { group: "Repository", advanced: true, control: "file" } },
        "--git-dir": { label: "Git Directory", kind: "directory", ui: { group: "Repository", advanced: true, control: "file" } },
        "--no-pager": { label: "Disable Pager", ui: { group: "Output", advanced: false, control: "switch" } }
      }), {
        output: { expectedTypes: ["text"] },
        safety: {
          ...manifest.commands[0]?.safety,
          notes: mergeNotes(manifest.commands[0]?.safety?.notes, ["Git adapter: commands operate on a local repository context."])
        }
      });
      const curated = [gitStatusCommand(), gitLogCommand(), gitDiffCommand()];
      const existingNames = new Set(manifest.commands.map((command) => command.name));

      return {
        ...manifest,
        commands: [rootCommand, ...manifest.commands.slice(1), ...curated.filter((command) => !existingNames.has(command.name))]
      };
    }
  };
}

function gitStatusCommand(): CommandSpec {
  return {
    id: "git-status",
    name: "status",
    description: "Show local repository status.",
    subcommand: ["status"],
    fields: [
      booleanField("short", "Short Output", "--short", "Show status in short format.", "Output"),
      booleanField("branch", "Show Branch", "--branch", "Show branch and tracking info.", "Output")
    ],
    output: { expectedTypes: ["text"] },
    safety: { notes: ["Read-only Git status command."] }
  };
}

function gitLogCommand(): CommandSpec {
  return {
    id: "git-log",
    name: "log",
    description: "Show commit history.",
    subcommand: ["log"],
    fields: [
      booleanField("oneline", "One Line", "--oneline", "Condense each commit to one line.", "Output"),
      numberField("max-count", "Max Count", "--max-count", "Limit number of commits.", "Output")
    ],
    output: { expectedTypes: ["text"] },
    safety: { notes: ["Read-only Git log command."] }
  };
}

function gitDiffCommand(): CommandSpec {
  return {
    id: "git-diff",
    name: "diff",
    description: "Show local changes.",
    subcommand: ["diff"],
    fields: [booleanField("staged", "Staged Changes", "--staged", "Show changes staged for commit.", "Output")],
    output: { expectedTypes: ["text"] },
    safety: { notes: ["Read-only Git diff command."] }
  };
}

function addAdapterMetadata(manifest: ToolManifest, adapter: ToolAdapter): ToolManifest {
  const existing = manifest.adapters ?? [];
  if (existing.some((item) => item.id === adapter.id)) return manifest;
  const versionInfo = adapter.version(manifest);
  const metadata: AdapterMetadata = {
    id: adapter.id,
    name: adapter.name,
    version: versionInfo.detectedVersion,
    appliedAt: nowIso(),
    notes: [`${adapter.name} adapter enhanced this schema.`, ...versionInfo.notes]
  };
  return { ...manifest, adapters: [...existing, metadata], source: manifest.source === "detected" ? "detected" : manifest.source };
}

function adapterVersionInfo(manifest: ToolManifest, expectedPattern: RegExp): AdapterVersionInfo {
  const detectedVersion = manifest.version ?? manifest.discovery?.version;
  if (!detectedVersion) {
    return {
      supported: true,
      notes: ["Adapter applied without a detected tool version; review exported schemas before sharing."]
    };
  }

  const supported = expectedPattern.test(detectedVersion);
  return {
    detectedVersion,
    supported,
    notes: [
      supported
        ? `Adapter matched detected version: ${detectedVersion}`
        : `Adapter applied to an unrecognized version string: ${detectedVersion}`
    ]
  };
}

function enhanceCommand(command: CommandSpec, patch: Partial<CommandSpec>): CommandSpec {
  return { ...command, ...patch };
}

function updateFields(command: CommandSpec, patches: Record<string, Partial<FieldSpec>>): CommandSpec {
  return {
    ...command,
    fields: command.fields.map((field) => {
      const key = field.flag ?? field.shortFlag ?? field.id;
      const patch = patches[key] ?? patches[field.shortFlag ?? ""] ?? patches[field.id];
      if (!patch) return field;
      return mergeField(field, patch);
    })
  };
}

function updatePositionals(command: CommandSpec, patches: Record<string, Partial<FieldSpec>>): CommandSpec {
  return {
    ...command,
    fields: command.fields.map((field) => mergeField(field, patches[field.id] ?? {}))
  };
}

function mergeField(field: FieldSpec, patch: Partial<FieldSpec>): FieldSpec {
  return {
    ...field,
    ...patch,
    ui: patch.ui ? { ...field.ui, ...patch.ui } : field.ui,
    confidence: Math.max(field.confidence, patch.confidence ?? 0.86)
  };
}

function addFieldIfMissing(command: CommandSpec, field: FieldSpec): CommandSpec {
  if (command.fields.some((item) => item.id === field.id || item.position === field.position)) return command;
  return { ...command, fields: [...command.fields, field] };
}

function mergeNotes(current: string[] | undefined, next: string[]): string[] {
  return Array.from(new Set([...(current ?? []), ...next]));
}

function mergeExamples(current: CommandSpec["examples"], next: NonNullable<CommandSpec["examples"]>): CommandSpec["examples"] {
  const existingLabels = new Set((current ?? []).map((example) => example.label));
  return [...(current ?? []), ...next.filter((example) => !existingLabels.has(example.label))];
}

function nextPosition(fields: FieldSpec[]): number {
  const positions = fields.map((field) => field.position).filter((position): position is number => position !== undefined);
  return positions.length > 0 ? Math.max(...positions) + 1 : 0;
}

function toolName(manifest: ToolManifest): string {
  return commandNameFromExecutable(manifest.executable || manifest.name).toLowerCase();
}

function booleanField(id: string, label: string, flag: string, description: string, group: string): FieldSpec {
  return {
    id,
    label,
    description,
    kind: "boolean",
    required: false,
    flag,
    ui: { group, advanced: false, control: "switch" },
    confidence: 0.96
  };
}

function numberField(id: string, label: string, flag: string, description: string, group: string): FieldSpec {
  return {
    id,
    label,
    description,
    kind: "number",
    required: false,
    flag,
    ui: { group, advanced: false, control: "number" },
    confidence: 0.96
  };
}
